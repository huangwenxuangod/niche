import { NextRequest } from "next/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { llm, type LlmMessage } from "@/lib/llm";
import { AGENT_TOOL_REGISTRY, AGENT_TOOLS } from "@/lib/agent/tools/registry";
import type { ToolContextJourney } from "@/lib/agent/tools/types";
import { recommendKocFromHotArticlesChain } from "@/lib/agent/chains/recommend-koc-from-hot-articles";
import { getUserMemory, compactAndSaveMemory } from "@/lib/memory";

// 导入新的记忆系统
import { recordStep, getSessionSteps } from "@/lib/agent/memory";

const MAX_STEPS = 8;

export async function POST(
  req: NextRequest,
  ctx: RouteContext
) {
  const { id: conversationId } = await ctx.params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { content } = await req.json();

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, title, journey_id, journeys(*)")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .single();

  if (!conv) return new Response("Not found", { status: 404 });

  const journeyRecord = Array.isArray(conv.journeys) ? conv.journeys[0] : conv.journeys;

  // 保存用户消息
  const { data: userMessage } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content })
    .select("id")
    .single();

  // 加载对话历史
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(24);

  const systemPrompt = await buildSystemPrompt(conv.journey_id, user.id, supabase, conversationId);
  const encoder = new TextEncoder();
  let fullContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let goto_done = false;
        const messages: LlmMessage[] = (history ?? []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        // ----------------------------------------------------------------
        // Agent Loop
        // ----------------------------------------------------------------
        for (let step = 0; step < MAX_STEPS; step++) {
          emit(controller, encoder, {
            type: "assistant_status",
            label: step === 0 ? "思考中" : "继续分析中",
          });

          const response = await llm.completeWithTools({
            systemPrompt,
            messages,
            tools: AGENT_TOOLS,
            thinkingProfile: "default",
          });

          if (!response.toolCalls.length) {
            // 无工具调用 → 流式输出最终答案
            fullContent = await streamModelResponse({
              controller,
              encoder,
              systemPrompt,
              messages,
              fallback: response.content || "我已整理好当前可用信息。",
            });
            break;
          }

          messages.push({
            role: "assistant",
            content: response.content || "",
            tool_calls: response.toolCalls,
          });

          for (const toolCall of response.toolCalls) {
            const args = safeParseArgs(toolCall.function.arguments);

            emit(controller, encoder, {
              type: "tool_start",
              toolName: toolCall.function.name,
              label: toolLabel(toolCall.function.name),
            });

            const toolLogId = await createToolCallLog(supabase, {
              conversationId,
              journeyId: conv.journey_id,
              messageId: userMessage?.id ?? null,
              toolName: toolCall.function.name,
              args,
            });

            try {
              const result = await executeTool({
                toolName: toolCall.function.name,
                args,
                journeyId: conv.journey_id,
                userId: user.id,
                supabase,
                journey: (journeyRecord ?? null) as ToolContextJourney | null,
              });

              emit(controller, encoder, {
                type: "tool_result",
                toolName: toolCall.function.name,
                label: toolLabel(toolCall.function.name),
                payload: result,
              });

              // Post-hook：搜爆文完成后触发推荐弹窗
              if (toolCall.function.name === "search_wechat_hot_articles") {
                const hotResult = result as {
                  keyword: string;
                  articles: Array<{
                    mp_nickname?: string;
                    wxid?: string;
                    title?: string;
                    read_num?: number;
                    fans?: number;
                  }>;
                };
                const recs = await recommendKocFromHotArticlesChain({
                  journeyId: conv.journey_id,
                  keyword: hotResult.keyword,
                  articles: hotResult.articles,
                });
                emit(controller, encoder, {
                  type: "koc_recommendation_ready",
                  label: "已找到推荐对标账号",
                  payload: {
                    keyword: hotResult.keyword,
                    articles: hotResult.articles,
                    recommended_accounts: recs.recommended_accounts,
                  },
                });
              }

              // generate_full_article / compliance_check 直接流式输出，跳出循环
              if (toolCall.function.name === "generate_full_article") {
                fullContent = formatFullArticleResponse(
                  "我按你的要求写了一版可发布级公众号完整初稿。",
                  result as FullArticleToolResult
                );
                await emitText(controller, encoder, fullContent);
                await finalizeToolCallLog(supabase, toolLogId, { status: "success", result });
                messages.push(toolResult(toolCall.id, result));
                goto_done = true;
                break;
              }

              if (toolCall.function.name === "compliance_check") {
                fullContent = formatComplianceResponse(result as ComplianceCheckResult);
                await emitText(controller, encoder, fullContent);
                await finalizeToolCallLog(supabase, toolLogId, { status: "success", result });
                messages.push(toolResult(toolCall.id, result));
                goto_done = true;
                break;
              }

              await finalizeToolCallLog(supabase, toolLogId, { status: "success", result });
              messages.push(toolResult(toolCall.id, result));
            } catch (err) {
              const message = err instanceof Error ? err.message : "Unknown tool error";
              emit(controller, encoder, {
                type: "tool_error",
                toolName: toolCall.function.name,
                label: toolLabel(toolCall.function.name),
                error: message,
              });
              await finalizeToolCallLog(supabase, toolLogId, { status: "error", error: message });
              // 错误结果喂给 LLM，让它自己决定重试还是换策略
              messages.push(toolResult(toolCall.id, { error: message }));
            }
          }

          if (goto_done) break;
        }

        // 循环跑满仍未输出 → 强制让 LLM 基于已有信息回答
        if (!fullContent) {
          fullContent = await streamModelResponse({
            controller,
            encoder,
            systemPrompt:
              systemPrompt +
              "\n\n[重要] 你已完成所有工具调用，现在必须直接基于已有信息输出最终回答，不要再调用任何工具。",
            messages,
            fallback: "我已完成检索和分析，下面把核心结论整理给你。",
          });
        }

        await persistAssistantMessage(supabase, controller, encoder, conversationId, fullContent);

        // 更新对话标题（首次）
        if (!conv.title || conv.title === "新对话" || conv.title === "第一次对话") {
          void supabase
            .from("conversations")
            .update({ title: fullContent.slice(0, 40).replace(/\n/g, " ") })
            .eq("id", conversationId);
        }

        // 异步提炼记忆，不阻塞响应
        const conversationText = buildConversationText(messages, fullContent);
        void compactAndSaveMemory(supabase, user.id, conversationText);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        emit(controller, encoder, { type: "tool_error", label: "Agent", error: errMsg });
        await emitText(controller, encoder, `抱歉，这次出了点问题：${errMsg}`);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool({
  toolName,
  args,
  journeyId,
  userId,
  supabase,
  journey,
}: {
  toolName: string;
  args: Record<string, unknown>;
  journeyId: string;
  userId: string;
  supabase: ReturnType<typeof createClient>;
  journey: ToolContextJourney | null;
}) {
  if (toolName === "compliance_check") {
    const title = String(args.title || "").trim();
    const summary = String(args.summary || "").trim();
    const articleMarkdown = String(args.article_markdown || "").trim();
    if (!title || !articleMarkdown) throw new Error("title and article_markdown are required");
    return runComplianceCheck({ supabase, journeyId, userId, journey, article: { title, summary, title_options: [], article_markdown: articleMarkdown, reference_note: "" } });
  }

  const entry = AGENT_TOOL_REGISTRY[toolName as keyof typeof AGENT_TOOL_REGISTRY];
  if (entry?.execute) {
    return entry.execute(args as never, { journeyId, userId, supabase, journey });
  }

  throw new Error(`Unsupported tool: ${toolName}`);
}

// ---------------------------------------------------------------------------
// Compliance check
// ---------------------------------------------------------------------------

type ComplianceLevel = "high" | "medium" | "low";
type ComplianceRiskType = "violation_risk" | "distribution_risk";
type ComplianceIssue = {
  level: ComplianceLevel;
  risk_type: ComplianceRiskType;
  category: string;
  location: "title" | "summary" | "body" | "cta";
  target_text: string;
  reason: string;
  suggestion: string;
  replacement: string;
};
type ComplianceCheckResult = {
  score: number;
  publish_recommendation: "可发布" | "建议修改后发布" | "不建议发布";
  overview: string;
  disclaimer: string;
  safer_title: string;
  safer_summary: string;
  safer_cta: string;
  issues: ComplianceIssue[];
};
type FullArticleToolResult = {
  title: string;
  summary: string;
  title_options: string[];
  article_markdown: string;
  reference_note: string;
};

async function runComplianceCheck(params: {
  supabase: ReturnType<typeof createClient>;
  journeyId: string;
  userId: string;
  journey: ToolContextJourney | null;
  article: FullArticleToolResult;
}) {
  const ruleIssues = collectRuleBasedComplianceIssues(params.article);
  const userMemory = await getUserMemory(params.supabase, params.userId);

  const serializedRuleIssues = ruleIssues.length
    ? ruleIssues
        .map((issue, i) =>
          `${i + 1}. [${issue.level}/${issue.risk_type}] ${issue.category} | ${issue.location} | 命中：${issue.target_text} | 原因：${issue.reason} | 建议：${issue.suggestion} | 替代：${issue.replacement}`
        )
        .join("\n")
    : "暂无明显规则命中";

  const llmResult = await llm.chat(
    "你是公众号内容合规审校助手。只输出 JSON，不要解释，不要使用 Markdown 代码块。",
    `请检查下面这篇公众号内容在微信生态中的合规和限流风险。

赛道：${params.journey?.niche_level2 ?? "未知赛道"}

【用户记忆】
${userMemory || "暂无"}

【标题】${params.article.title}
【摘要】${params.article.summary || "暂无"}
【正文】${params.article.article_markdown}
【规则命中初筛】${serializedRuleIssues}

返回 JSON：
{
  "score": 78,
  "publish_recommendation": "建议修改后发布",
  "overview": "...",
  "disclaimer": "仅作平台风险提示，不构成法律意见",
  "safer_title": "...",
  "safer_summary": "...",
  "safer_cta": "...",
  "issues": [{"level":"medium","risk_type":"distribution_risk","category":"绝对化表达","location":"title","target_text":"...","reason":"...","suggestion":"...","replacement":"..."}]
}`,
    { thinkingProfile: "deep" }
  );

  const parsed = safeParseJson<ComplianceCheckResult>(llmResult);
  const normalized = normalizeComplianceResult(parsed, params.article);
  if (!normalized.issues.length && ruleIssues.length) normalized.issues = ruleIssues;
  else if (ruleIssues.length) normalized.issues = dedupeComplianceIssues([...ruleIssues, ...normalized.issues]);
  normalized.score = clampComplianceScore(normalized.score, normalized.issues);
  normalized.publish_recommendation = derivePublishRecommendation(normalized.publish_recommendation, normalized.issues, normalized.score);
  normalized.disclaimer = normalized.disclaimer || "仅作平台风险提示，不构成法律意见";
  normalized.safer_title = normalized.safer_title || params.article.title;
  normalized.safer_summary = normalized.safer_summary || params.article.summary || "";
  normalized.safer_cta = normalized.safer_cta || suggestSaferCta(params.article.article_markdown);
  normalized.overview = normalized.overview || buildComplianceOverview(normalized.issues, normalized.score);
  return normalized;
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

async function streamModelResponse(params: {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  systemPrompt: string;
  messages: LlmMessage[];
  fallback: string;
}) {
  let fullContent = "";
  const textEmitter = createSmoothTextEmitter(params.controller, params.encoder);
  let reasoningStarted = false;

  emit(params.controller, params.encoder, { type: "assistant_status", label: "输出答案中" });

  try {
    await llm.streamChat({
      systemPrompt: params.systemPrompt,
      messages: params.messages,
      onChunk: (text) => {
        fullContent += text;
        textEmitter.push(text);
      },
      onReasoningChunk: (text) => {
        if (!text.trim()) return;
        if (!reasoningStarted) {
          reasoningStarted = true;
          emitRaw(params.controller, params.encoder, { type: "reasoning_start" });
        }
        emitRaw(params.controller, params.encoder, { type: "reasoning_chunk", text });
      },
      thinkingProfile: "default",
    });
    await textEmitter.flush();
    if (reasoningStarted) emitRaw(params.controller, params.encoder, { type: "reasoning_end" });
  } catch {
    // ignore streaming errors, fall through to fallback
  }

  if (!fullContent.trim()) {
    fullContent = params.fallback;
    await emitText(params.controller, params.encoder, fullContent);
  }

  return fullContent;
}

function emit(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: Record<string, unknown>
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function emitRaw(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  payload: Record<string, unknown>
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

async function emitText(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  text: string
) {
  for (const chunk of chunkText(text)) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`));
  }
}

function createSmoothTextEmitter(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
) {
  let buffer = "";
  return {
    push(text: string) {
      buffer += text;
      const { chunks, remaining } = extractReadyChunks(buffer);
      buffer = remaining;
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`));
      }
    },
    async flush() {
      if (!buffer) return;
      for (const chunk of chunkText(buffer)) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`));
      }
      buffer = "";
    },
  };
}

function extractReadyChunks(text: string) {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 16) break;
    const hardLimit = Math.min(remaining.length, 84);
    const slice = remaining.slice(0, hardLimit);
    const paragraphBreak = slice.lastIndexOf("\n\n");
    if (paragraphBreak >= 12) {
      const end = paragraphBreak + 2;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
      continue;
    }
    const boundaryIndex = findLastSemanticBoundary(slice);
    if (boundaryIndex >= 18) {
      const end = boundaryIndex + 1;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
      continue;
    }
    if (remaining.length > 96) {
      const softSplit = findLastSoftBoundary(slice);
      const end = softSplit >= 28 ? softSplit + 1 : hardLimit;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
      continue;
    }
    break;
  }
  return { chunks, remaining };
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const { chunks: ready, remaining: next } = extractReadyChunks(remaining);
    if (ready.length === 0) { chunks.push(remaining); break; }
    chunks.push(...ready);
    remaining = next;
  }
  return chunks.filter((c) => c.length > 0);
}

function findLastSemanticBoundary(text: string) {
  const matches = [...text.matchAll(/[。！？!?；;：:\n]/g)];
  const last = matches.at(-1);
  return typeof last?.index === "number" ? last.index : -1;
}

function findLastSoftBoundary(text: string) {
  const matches = [...text.matchAll(/[，,、）)】]/g)];
  const last = matches.at(-1);
  return typeof last?.index === "number" ? last.index : -1;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function persistAssistantMessage(
  supabase: ReturnType<typeof createClient>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  conversationId: string,
  content: string
) {
  const { data } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "assistant", content })
    .select("id")
    .single();

  if (data?.id) {
    emit(controller, encoder, { type: "assistant_message", messageId: data.id });
  }
  return data?.id ?? null;
}

async function createToolCallLog(
  supabase: ReturnType<typeof createClient>,
  payload: {
    conversationId: string;
    journeyId: string;
    messageId: string | null;
    toolName: string;
    args: Record<string, unknown>;
  }
) {
  try {
    const { data } = await supabase
      .from("tool_calls")
      .insert({
        conversation_id: payload.conversationId,
        journey_id: payload.journeyId,
        message_id: payload.messageId,
        tool_name: payload.toolName,
        status: "running",
        arguments: payload.args,
        requires_confirmation: false,
      })
      .select("id")
      .single();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function finalizeToolCallLog(
  supabase: ReturnType<typeof createClient>,
  id: string | null,
  payload: { status: string; result?: unknown; error?: string }
) {
  if (!id) return;
  try {
    await supabase
      .from("tool_calls")
      .update({ status: payload.status, result: payload.result, error: payload.error, finished_at: new Date().toISOString() })
      .eq("id", id);
  } catch {
    // ignore
  }
}

function toolResult(toolCallId: string, result: unknown): LlmMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify(result),
  };
}

// ---------------------------------------------------------------------------
// Memory helpers
// ---------------------------------------------------------------------------

function buildConversationText(messages: LlmMessage[], assistantFinalResponse: string) {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user" && typeof m.content === "string") {
      lines.push(`用户：${m.content}`);
    }
  }
  if (assistantFinalResponse) {
    lines.push(`助手：${assistantFinalResponse}`);
  }
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatFullArticleResponse(prefix: string, article: FullArticleToolResult) {
  const titleOptions = article.title_options.length
    ? article.title_options.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "暂无";

  return `${prefix}

**主标题**
${article.title}

**公众号摘要**
${article.summary || "暂无"}

**备选标题**
${titleOptions}

**参考说明**
${article.reference_note}

**完整初稿**

${article.article_markdown}`;
}

function formatComplianceResponse(result: ComplianceCheckResult) {
  return `## 合规检查总览

- **风险评分**：${result.score}/100
- **发布建议**：${result.publish_recommendation}

> ${result.overview}

## 主要风险项

${formatComplianceIssues(result.issues)}

## 更安全的替代表达

**标题建议**：${result.safer_title}
**摘要建议**：${result.safer_summary || "暂无"}
**CTA 建议**：${result.safer_cta || "暂无"}

## 提示

${result.disclaimer}`;
}

function formatComplianceIssues(issues: ComplianceIssue[]) {
  if (!issues.length) return "未发现明显高风险表达，建议人工再过一遍标题、摘要和 CTA。";
  return issues
    .slice(0, 6)
    .map(
      (issue, i) => `### 风险 ${i + 1}｜${issue.category}
- 风险等级：${levelLabel(issue.level)}｜${riskTypeLabel(issue.risk_type)}
- 命中文本：${issue.target_text}
- 原因：${issue.reason}
- 建议：${issue.suggestion}
- 替代表达：${issue.replacement || "—"}`
    )
    .join("\n\n");
}

function toolLabel(toolName: string) {
  const labels: Record<string, string> = {
    search_hot_topics: "搜索赛道热点",
    search_wechat_hot_articles: "搜索公众号爆文",
    import_koc_by_name: "导入对标公众号",
    analyze_my_account: "分析我的账号",
    analyze_journey_data: "分析知识库",
    search_knowledge_base: "检索知识库",
    generate_topics: "生成选题",
    generate_article_draft: "生成初稿",
    generate_full_article: "生成完整稿",
    compliance_check: "合规检查",
  };
  return labels[toolName] ?? toolName;
}

// ---------------------------------------------------------------------------
// Compliance helpers
// ---------------------------------------------------------------------------

function collectRuleBasedComplianceIssues(article: FullArticleToolResult): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const targets: Array<{ text: string; location: ComplianceIssue["location"] }> = [
    { text: article.title || "", location: "title" },
    { text: article.summary || "", location: "summary" },
    { text: article.article_markdown || "", location: "body" },
    { text: extractCta(article.article_markdown), location: "cta" },
  ];
  const rules = [
    { category: "绝对化表达", risk_type: "distribution_risk" as const, level: "medium" as const, pattern: /(最强|第一|唯一|绝对|一定|必然|全网|彻底|完蛋了|100%)/i, reason: "措辞过满，容易被判定为夸大或标题党。", suggestion: "改成更克制、可验证的表达。", replacement: "正在被重新评估 / 更有可能 / 值得关注" },
    { category: "收益承诺", risk_type: "violation_risk" as const, level: "high" as const, pattern: /(保证涨粉|保证赚钱|轻松月入|稳定变现|闭眼入|稳赚|翻倍收益)/i, reason: "存在明显的收益或结果承诺，平台风险较高。", suggestion: "删除承诺式表达，改为经验判断或机会描述。", replacement: "更有机会提升转化 / 可能带来更好的效果" },
    { category: "诱导互动", risk_type: "distribution_risk" as const, level: "medium" as const, pattern: /(转发给|点个在看|点个赞|关注后私信|不转不是|求扩散)/i, reason: "存在明显诱导点赞、转发、关注的表达，容易影响分发。", suggestion: "改成自然邀请用户交流或收藏。", replacement: "如果这篇对你有帮助，欢迎收藏。" },
    { category: "医疗健康", risk_type: "violation_risk" as const, level: "high" as const, pattern: /(治疗|治愈|包治|药到病除|医学证明|临床验证)/i, reason: "涉及医疗健康效果判断，需格外谨慎。", suggestion: "避免效果承诺，改成信息分享或经验观察。", replacement: "仅作信息参考，具体请咨询专业医生" },
    { category: "金融投资", risk_type: "violation_risk" as const, level: "high" as const, pattern: /(买入|抄底|暴涨|稳赚不赔|收益率|财务自由|投资建议)/i, reason: "涉及明确投资指引或收益暗示，平台风险较高。", suggestion: "改成市场观察，不给直接投资建议。", replacement: "仅分享观察，不构成任何投资建议" },
    { category: "政策敏感", risk_type: "violation_risk" as const, level: "high" as const, pattern: /(内幕|监管失控|政策黑幕|封杀|国家不让说)/i, reason: "容易触发政策和公共议题敏感风险。", suggestion: "删除阴谋化表达，改为公开信息层面的描述。", replacement: "基于公开信息来看，相关规则仍在变化" },
  ];
  for (const rule of rules) {
    for (const target of targets) {
      if (!target.text) continue;
      const match = target.text.match(rule.pattern);
      if (!match) continue;
      issues.push({ level: rule.level, risk_type: rule.risk_type, category: rule.category, location: target.location, target_text: truncate(match[0], 36), reason: rule.reason, suggestion: rule.suggestion, replacement: rule.replacement });
    }
  }
  return dedupeComplianceIssues(issues);
}

function dedupeComplianceIssues(issues: ComplianceIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.category}|${issue.location}|${issue.target_text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeComplianceResult(parsed: ComplianceCheckResult | null, article: FullArticleToolResult): ComplianceCheckResult {
  return {
    score: parsed?.score ?? 88,
    publish_recommendation: parsed?.publish_recommendation ?? "可发布",
    overview: parsed?.overview ?? "",
    disclaimer: parsed?.disclaimer ?? "",
    safer_title: parsed?.safer_title ?? article.title,
    safer_summary: parsed?.safer_summary ?? article.summary,
    safer_cta: parsed?.safer_cta ?? extractCta(article.article_markdown),
    issues: Array.isArray(parsed?.issues) ? parsed!.issues : [],
  };
}

function clampComplianceScore(score: number, issues: ComplianceIssue[]) {
  const high = issues.filter((i) => i.level === "high").length;
  const medium = issues.filter((i) => i.level === "medium").length;
  const low = issues.filter((i) => i.level === "low").length;
  const derived = 100 - high * 18 - medium * 10 - low * 4;
  const baseline = Number.isFinite(score) ? score : 88;
  return Math.max(20, Math.min(baseline, derived, 100));
}

function derivePublishRecommendation(
  current: ComplianceCheckResult["publish_recommendation"],
  issues: ComplianceIssue[],
  score: number
): ComplianceCheckResult["publish_recommendation"] {
  if (issues.some((i) => i.level === "high" && i.risk_type === "violation_risk")) return "不建议发布";
  if (issues.some((i) => i.level !== "low") || score < 85) return "建议修改后发布";
  return current === "不建议发布" ? "建议修改后发布" : "可发布";
}

function buildComplianceOverview(issues: ComplianceIssue[], score: number) {
  if (!issues.length) return score >= 90 ? "整体表达较稳，未发现明显高风险措辞。" : "整体风险可控，建议人工复核标题、摘要和 CTA。";
  const high = issues.filter((i) => i.level === "high").length;
  const medium = issues.filter((i) => i.level === "medium").length;
  if (high > 0) return `存在 ${high} 处高风险表达，建议先改写再发布；另有 ${medium} 处可能影响分发的措辞。`;
  return `整体风险可控，但有 ${medium} 处可能引发限流的表达，建议先微调后发布。`;
}

function extractCta(markdown: string) {
  const lines = markdown.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(-2).join(" ");
}

function suggestSaferCta(markdown: string) {
  const cta = extractCta(markdown);
  if (!cta) return "如果这篇内容对你有帮助，欢迎先收藏。";
  return cta.replace(/点个在看|点个赞|转发给.+?(?=[，。]|$)/g, "欢迎先收藏").replace(/关注后私信/g, "欢迎留言交流");
}

function levelLabel(level: ComplianceLevel) {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}

function riskTypeLabel(type: ComplianceRiskType) {
  return type === "violation_risk" ? "违规风险" : "限流风险";
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function safeParseArgs(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeParseJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}
