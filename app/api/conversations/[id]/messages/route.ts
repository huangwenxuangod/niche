import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { llm, type LlmMessage } from "@/lib/llm";
import { AGENT_TOOL_REGISTRY, AGENT_TOOLS } from "@/lib/agent/tools/registry";
import type { ToolContextJourney } from "@/lib/agent/tools/types";
import { buildFollowupQuestionChain } from "@/lib/agent/chains/build-followup-question";
import { recommendKocFromHotArticlesChain } from "@/lib/agent/chains/recommend-koc-from-hot-articles";
import { resolveSearchFocusChain } from "@/lib/agent/chains/resolve-search-focus";
import { resolveUserIntentChain } from "@/lib/agent/chains/resolve-user-intent";
import { runGenerateFullArticle } from "@/lib/agent/tools/generate-full-article";
import { searchJourneyKnowledge } from "@/lib/knowledge-base";
import {
  appendJourneyMemory,
  appendStructuredRoundSummary,
  captureMessageMemory,
  captureProjectMemoryFromMessage,
  ensureJourneyMemory,
  ensureJourneyProjectMemory,
  getJourneyMemory,
  getJourneyProjectMemory,
  getUserMemory,
  type JourneyStrategyState,
  updateProjectCard,
  updateJourneyStrategyState,
} from "@/lib/memory";

type ConversationHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

type GeneratedTopic = {
  index: number;
  title: string;
  angle: string;
  why_fit_user: string;
  why_now: string;
  reference_titles: string[];
};

type TopicToolResult = {
  topics: GeneratedTopic[];
};

type DraftToolResult = {
  title: string;
  subtitle?: string;
  draft_markdown: string;
};

type FullArticleToolResult = {
  title: string;
  summary: string;
  title_options: string[];
  article_markdown: string;
  reference_note: string;
};

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

type ToolCallRow = {
  id: string;
  tool_name: string;
  status: string;
  result: Record<string, unknown> | null;
  created_at: string;
};

export async function POST(req: NextRequest, ctx: RouteContext<"/api/conversations/[id]/messages">) {
  const { id: conversationId } = await ctx.params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  await ensureJourneyMemory(supabase, {
    journeyId: conv.journey_id,
    platform: journeyRecord?.platform === "wechat_mp" ? "公众号" : (journeyRecord?.platform ?? "未知平台"),
    nicheLevel1: journeyRecord?.niche_level1 ?? "",
    nicheLevel2: journeyRecord?.niche_level2 ?? "",
    nicheLevel3: journeyRecord?.niche_level3 ?? "",
  });
  await ensureJourneyProjectMemory(supabase, {
    journeyId: conv.journey_id,
    userId: user.id,
    projectName: journeyRecord?.name ?? "Niche",
    platform: journeyRecord?.platform === "wechat_mp" ? "公众号" : (journeyRecord?.platform ?? "未知平台"),
    nicheLevel1: journeyRecord?.niche_level1 ?? "",
    nicheLevel2: journeyRecord?.niche_level2 ?? "",
    nicheLevel3: journeyRecord?.niche_level3 ?? "",
  });

  const { data: userMessage } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      content,
    })
    .select("id")
    .single();

  await captureMessageMemory(supabase, {
    userId: user.id,
    journeyId: conv.journey_id,
    content,
  });
  await captureProjectMemoryFromMessage(supabase, {
    journeyId: conv.journey_id,
    userId: user.id,
    content,
  });

  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  const { data: recentToolCalls } = await supabase
    .from("tool_calls")
    .select("id, tool_name, status, result, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(8);

  const systemPrompt = await buildSystemPrompt(conv.journey_id, user.id, supabase);
  const encoder = new TextEncoder();
  let fullContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await emitEvent(controller, encoder, {
          type: "assistant_status",
          label: "理解问题中",
        });

        const messages: LlmMessage[] = ((history ?? []) as ConversationHistoryEntry[]).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const trackedAccounts = await getTrackedAccountNames(supabase, conv.journey_id);
        const projectMemory = await getJourneyProjectMemory(supabase, conv.journey_id);

        await emitEvent(controller, encoder, {
          type: "assistant_status",
          label: "整理上下文中",
        });

        const handledFollowUp = await handleNaturalLanguageFollowUp({
          content,
          controller,
          encoder,
          supabase,
          conversationId,
          journeyId: conv.journey_id,
          messageId: userMessage?.id ?? null,
          userId: user.id,
          journey: (journeyRecord ?? null) as ToolContextJourney | null,
          recentToolCalls: (recentToolCalls ?? []) as ToolCallRow[],
        });

        if (handledFollowUp) {
          fullContent = handledFollowUp;
          await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const resolvedIntent = await resolveUserIntentChain({
          journeyId: conv.journey_id,
          content,
          recentMessages: ((history ?? []) as ConversationHistoryEntry[]),
        });
        const resolvedFocus = await resolveSearchFocusChain({
          journeyId: conv.journey_id,
          content,
          recentMessages: ((history ?? []) as ConversationHistoryEntry[]),
          projectMemory,
        });

        if (resolvedFocus.focus_keyword) {
          await updateJourneyStrategyState(supabase, {
            journeyId: conv.journey_id,
            userId: user.id,
            patch: {
              current_problem: content.slice(0, 120),
              current_focus_keyword: resolvedFocus.focus_keyword,
              focus_confidence: resolvedFocus.confidence,
              next_best_question: "",
            },
          });
        } else {
          await updateJourneyStrategyState(supabase, {
            journeyId: conv.journey_id,
            userId: user.id,
            patch: {
              current_problem: content.slice(0, 120),
              focus_confidence: resolvedFocus.confidence,
            },
          });
        }

        const explicitBenchmarkName = detectExplicitBenchmarkName(content, trackedAccounts);
        if (explicitBenchmarkName && shouldAutoImportBenchmark(content)) {
          await emitEvent(controller, encoder, {
            type: "tool_start",
            toolName: "import_koc_by_name",
            label: toolLabel("import_koc_by_name"),
          });

          const importResult = await executeTool({
            toolName: "import_koc_by_name",
            args: { account_name: explicitBenchmarkName },
            journeyId: conv.journey_id,
            userId: user.id,
            supabase,
            journey: (journeyRecord ?? null) as ToolContextJourney | null,
          });

          await emitEvent(controller, encoder, {
            type: "tool_result",
            toolName: "import_koc_by_name",
            label: toolLabel("import_koc_by_name"),
            payload: importResult as Record<string, unknown>,
          });

          await updateJourneyStrategyState(supabase, {
            journeyId: conv.journey_id,
            userId: user.id,
            patch: {
              confirmed_benchmarks: [explicitBenchmarkName],
              current_benchmark_name: explicitBenchmarkName,
              next_best_action: "继续拆解这个号的内容规律，或基于它生成下一篇内容",
            },
          });

          fullContent = `我已经先把 **${explicitBenchmarkName}** 导入成对标样本了，当前会同步最近 3 篇文章到知识库。接下来你可以直接让我：

1. 拆它最近几篇内容为什么能火
2. 对比你的号和它的差距
3. 基于它的写法给你出 3 个更适合你的选题`;
          fullContent = await appendConversationalFollowup({
            controller,
            encoder,
            journeyId: conv.journey_id,
            userMessage: content,
            assistantDraft: fullContent,
            projectMemory: await getJourneyProjectMemory(supabase, conv.journey_id),
            currentContent: fullContent,
          });
          await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
          await appendStructuredRoundSummary(supabase, {
            journeyId: conv.journey_id,
            userId: user.id,
            summary: {
              user_intent: "导入明确对标公众号",
              confirmed_decisions: [`已导入对标号：${explicitBenchmarkName}`],
              produced_outputs: ["对标样本导入"],
              open_questions: [],
              next_action: "基于该对标号继续拆解内容或生成新选题",
            },
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        if (
          resolvedFocus.search_ready &&
          resolvedFocus.focus_keyword &&
          (resolvedIntent.intent === "search_wechat_articles" || /爆文|公众号|对标|账号/.test(content))
        ) {
          await emitEvent(controller, encoder, {
            type: "tool_start",
            toolName: "search_wechat_hot_articles",
            label: toolLabel("search_wechat_hot_articles"),
          });

          const hotSearch = await executeTool({
            toolName: "search_wechat_hot_articles",
            args: { keyword: resolvedFocus.focus_keyword },
            journeyId: conv.journey_id,
            userId: user.id,
            supabase,
            journey: (journeyRecord ?? null) as ToolContextJourney | null,
          }) as {
            keyword: string;
            articles: Array<{
              mp_nickname?: string;
              wxid?: string;
              title?: string;
              read_num?: number;
              fans?: number;
            }>;
          };

          const recommendations = await recommendKocFromHotArticlesChain({
            journeyId: conv.journey_id,
            keyword: hotSearch.keyword,
            articles: hotSearch.articles,
          });

          await emitEvent(controller, encoder, {
            type: "tool_result",
            toolName: "search_wechat_hot_articles",
            label: toolLabel("search_wechat_hot_articles"),
            payload: {
              keyword: hotSearch.keyword,
              total: hotSearch.articles.length,
              recommended_accounts: recommendations.recommended_accounts,
            },
          });

          await updateJourneyStrategyState(supabase, {
            journeyId: conv.journey_id,
            userId: user.id,
            patch: {
              current_focus_keyword: hotSearch.keyword,
              focus_confidence: resolvedFocus.confidence,
              last_search_mode: "wechat_hot_articles",
              last_successful_keyword: hotSearch.keyword,
              next_best_action: "从推荐账号中确认一个并导入知识库",
            },
          });

          const recommendationText = recommendations.recommended_accounts.length
            ? recommendations.recommended_accounts
                .map((item, index) => `${index + 1}. **${item.account_name}**：${item.reason}`)
                .join("\n")
            : "我先帮你搜到了一批相关文章，但还没有足够稳定的账号候选。";

          fullContent = `我先按 **${hotSearch.keyword}** 帮你搜了一轮公众号爆文，这个词已经足够具体，比较适合公众号检索逻辑。

基于这批结果，我更建议优先看这些号：
${recommendationText}

如果你愿意，直接回我其中一个公众号名字，我就把它导入成对标样本；如果你还没想好，我也可以继续帮你缩小角度。`;
          fullContent = await appendConversationalFollowup({
            controller,
            encoder,
            journeyId: conv.journey_id,
            userMessage: content,
            assistantDraft: fullContent,
            projectMemory: await getJourneyProjectMemory(supabase, conv.journey_id),
            currentContent: fullContent,
          });
          await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
          await appendStructuredRoundSummary(supabase, {
            journeyId: conv.journey_id,
            userId: user.id,
            summary: {
              user_intent: "基于唯一关键词搜索公众号爆文",
              confirmed_decisions: [`当前焦点词：${hotSearch.keyword}`],
              produced_outputs: ["公众号爆文搜索结果", "推荐对标账号"],
              open_questions: [],
              next_action: "确认一个推荐账号并导入知识库",
            },
          });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const requestedAccountName = extractRequestedAccountName(content);
        const knowledgeCompareIntent = detectKnowledgeCompareIntent(content, trackedAccounts, requestedAccountName);
        const knowledgeIntent = detectKnowledgeLookupIntent(content, trackedAccounts, requestedAccountName);

        if (knowledgeCompareIntent) {
          await emitEvent(controller, encoder, {
            type: "tool_start",
            toolName: "search_knowledge_base",
            label: toolLabel("search_knowledge_base"),
          });

          const comparisonResults = await Promise.all(
            knowledgeCompareIntent.accountNames.map((accountName) =>
              searchJourneyKnowledge(supabase, conv.journey_id, knowledgeCompareIntent.query || accountName, 4, {
                accountNames: [accountName],
              }).then((result) => ({ accountName, result }))
            )
          );

          const availableResults = comparisonResults.filter((item) => item.result.articles.length > 0);

          await emitEvent(controller, encoder, {
            type: "tool_result",
            toolName: "search_knowledge_base",
            label: toolLabel("search_knowledge_base"),
            payload: {
              compare_accounts: knowledgeCompareIntent.accountNames,
              matches: comparisonResults.map((item) => ({
                account_name: item.accountName,
                total: item.result.articles.length,
              })),
            },
          });

          if (availableResults.length >= 2) {
            const comparisonContext = availableResults
              .map(
                ({ accountName, result }) =>
                  `【${accountName}】\n${result.articles
                    .map((item) => `- ${item.title} | 阅读 ${item.read_count} | 摘要：${item.excerpt || item.digest || "无"}`)
                    .join("\n")}`
              )
              .join("\n\n");

            fullContent = await streamModelResponse({
              controller,
              encoder,
              systemPrompt: `${systemPrompt}

【本轮回答要求】
用户明确要做账号内容对比。优先根据下方知识库文章比较两边的选题、标题、表达、更新频率感和爆款结构，不要转去泛泛讲热点。

【对比账号】
${knowledgeCompareIntent.accountNames.map((name) => `- ${name}`).join("\n")}

【知识库对比材料】
${comparisonContext}`,
              messages,
              fallback: "我已经先把这两个账号的知识库文章翻出来了，下面直接给你做内容对比。",
            });

            await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          const missingAccounts = comparisonResults
            .filter((item) => item.result.articles.length === 0)
            .map((item) => item.accountName);

          fullContent = `我先尝试按知识库帮你做账号对比了，但目前只命中了 ${availableResults
            .map((item) => item.accountName)
            .join("、") || "一部分账号"} 的文章，${
            missingAccounts.length > 0
              ? `还没命中 ${missingAccounts.join("、")} 的内容。`
              : ""
          }

如果你要做 **“我的号 vs 别人的号”** 或 **两个竞品号的内容对比**，最稳的方式是：
1. 先把双方账号都导入当前旅程的知识库
2. 然后直接问：**对比 A 和 B 的选题、标题和爆款结构差别**
3. 或者问：**分析我的号和 A 的内容差距，给我 3 条可执行建议**`;
          await emitEvent(controller, encoder, {
            type: "assistant_status",
            label: "输出答案中",
          });
          await emitText(controller, encoder, fullContent);
          await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        if (knowledgeIntent && !isLatestTrendRequest(content)) {
          await emitEvent(controller, encoder, {
            type: "tool_start",
            toolName: "search_knowledge_base",
            label: toolLabel("search_knowledge_base"),
          });

          const toolLogId = await createToolCallLog(supabase, {
            conversationId,
            journeyId: conv.journey_id,
            messageId: userMessage?.id ?? null,
            toolName: "search_knowledge_base",
            status: "running",
            arguments: {
              query: knowledgeIntent.query,
              account_names: knowledgeIntent.accountNames,
            },
            requiresConfirmation: false,
          });

          const knowledge = await searchJourneyKnowledge(
            supabase,
            conv.journey_id,
            knowledgeIntent.query,
            6,
            { accountNames: knowledgeIntent.accountNames }
          );

          await emitEvent(controller, encoder, {
            type: "tool_result",
            toolName: "search_knowledge_base",
            label: toolLabel("search_knowledge_base"),
            payload: knowledge,
          });

          await finalizeToolCallLog(supabase, toolLogId, {
            status: "success",
            result: knowledge,
          });

          if (knowledge.articles.length > 0) {
            const knowledgeContext = knowledge.articles
              .map((item) => `- ${item.title} | ${item.account_name} | 阅读 ${item.read_count} | 摘要：${item.excerpt || item.digest || "无"}`)
              .join("\n");

            const accountContext = knowledgeIntent.accountNames.length
              ? `【本轮重点账号】\n${knowledgeIntent.accountNames.map((name) => `- ${name}`).join("\n")}\n\n`
              : "";

            fullContent = await streamModelResponse({
              controller,
              encoder,
              systemPrompt: `${systemPrompt}

【本轮回答要求】
用户这次点名了具体账号/作者，优先根据下方知识库结果回答，不要先转去讲泛热点，除非用户明确问“最近热点”“最新趋势”。

${accountContext}【本轮预检知识库结果】
${knowledgeContext}`,
              messages,
              fallback: "我已经先帮你查了知识库，下面把这个账号为什么能火拆给你。",
            });

            await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }

          if (knowledgeIntent.accountNames.length > 0 || knowledgeIntent.articleTitle) {
            fullContent = `我先按知识库查了${knowledgeIntent.accountNames.length > 0 ? `账号「${knowledgeIntent.accountNames.join("、")}」` : "这篇内容"}，但当前还没命中可用文章，所以这次我不会直接拿热点代替回答。

你可以这样继续问我：
- **拆一下这个号最近 3 篇文章的共同写法**
- **分析《${knowledgeIntent.articleTitle || "这篇文章"}》为什么能火**
- **对比我的号和这个号的标题差距**

如果你是要做账号/文章级分析，最稳的是先确认对应文章已经同步进当前旅程知识库。`;
            await emitEvent(controller, encoder, {
              type: "assistant_status",
              label: "输出答案中",
            });
            await emitText(controller, encoder, fullContent);
            await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
        }

        for (let step = 0; step < 5; step++) {
          let shouldStopAfterTool = false;
          await emitEvent(controller, encoder, {
            type: "assistant_status",
            label: "组织回答中",
          });
          const completion = await llm.completeWithTools({
            systemPrompt,
            messages,
            tools: AGENT_TOOLS,
          });

          if (!completion.toolCalls.length) {
            fullContent = await streamModelResponse({
              controller,
              encoder,
              systemPrompt,
              messages,
              fallback: completion.content || "我已经整理好了当前可用信息，但这次没有拿到额外结果。",
            });
            break;
          }

          messages.push({
            role: "assistant",
            content: completion.content || "",
            tool_calls: completion.toolCalls,
          });

          for (const toolCall of completion.toolCalls) {
            const args = safeParseArgs(toolCall.function.arguments);
            await emitEvent(controller, encoder, {
              type: "tool_start",
              toolName: toolCall.function.name,
              label: toolLabel(toolCall.function.name),
            });

            const toolLogId = await createToolCallLog(supabase, {
              conversationId,
              journeyId: conv.journey_id,
              messageId: userMessage?.id ?? null,
              toolName: toolCall.function.name,
              status: "running",
              arguments: args,
              requiresConfirmation: false,
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

              await emitEvent(controller, encoder, {
                type: "tool_result",
                toolName: toolCall.function.name,
                label: toolLabel(toolCall.function.name),
                payload: result,
              });

              if (toolCall.function.name === "generate_full_article") {
                const compliance = await runComplianceCheck({
                  supabase,
                  journeyId: conv.journey_id,
                  userId: user.id,
                  journey: (journeyRecord ?? null) as ToolContextJourney | null,
                  article: result as FullArticleToolResult,
                });

                await emitEvent(controller, encoder, {
                  type: "tool_start",
                  toolName: "compliance_check",
                  label: toolLabel("compliance_check"),
                });

                await emitEvent(controller, encoder, {
                  type: "tool_result",
                  toolName: "compliance_check",
                  label: toolLabel("compliance_check"),
                  payload: compliance as unknown as Record<string, unknown>,
                });

                fullContent = formatFullArticleResponse(
                  "我按你的要求写了一版可发布级公众号完整初稿。",
                  result as FullArticleToolResult,
                  compliance
                );
                await updateProjectCard(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  patch: {
                    current_stage: "内容生成",
                  },
                });
                await updateJourneyStrategyState(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  patch: {
                    last_generated_asset: "公众号完整稿",
                    last_publish_state: "已完成合规检查，待排版发布",
                    current_todos: ["根据合规建议微调标题与摘要", "进入排版并准备发布"],
                    next_best_action: "检查完整稿后进入排版与发布",
                  },
                });
                await appendStructuredRoundSummary(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  summary: {
                    user_intent: "生成可发布级完整稿",
                    confirmed_decisions: [],
                    produced_outputs: ["公众号完整稿", "合规检查结果"],
                    open_questions: [],
                    next_action: "检查完整稿细节后进入排版与发布",
                  },
                });
                await emitEvent(controller, encoder, {
                  type: "assistant_status",
                  label: "输出答案中",
                });
                await emitText(controller, encoder, fullContent);
                shouldStopAfterTool = true;
              }

              if (toolCall.function.name === "generate_topics") {
                const topics = ((result as TopicToolResult | null)?.topics ?? []).map((item) => item.title);
                await updateProjectCard(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  patch: {
                    current_stage: "选题判断",
                  },
                });
                await updateJourneyStrategyState(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  patch: {
                    last_generated_asset: "候选选题",
                    confirmed_directions: topics,
                    current_todos: ["从候选选题中确认一个最优方向"],
                    next_best_action: "从候选选题中确认一个方向，再扩成完整稿",
                  },
                });
              }

              if (toolCall.function.name === "compliance_check") {
                fullContent = formatComplianceResponse(result as ComplianceCheckResult);
                await updateProjectCard(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  patch: {
                    current_stage: "发布准备",
                  },
                });
                await updateJourneyStrategyState(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  patch: {
                    last_generated_asset: "合规检查结果",
                    last_publish_state: "待根据风控建议微调",
                    current_todos: ["按风控建议修改标题或摘要", "确认后进入排版与发布"],
                    next_best_action: "根据合规结果修正文案后进入排版",
                  },
                });
                await appendStructuredRoundSummary(supabase, {
                  journeyId: conv.journey_id,
                  userId: user.id,
                  summary: {
                    user_intent: "检查内容合规风险",
                    confirmed_decisions: [],
                    produced_outputs: ["合规检查结果"],
                    open_questions: [],
                    next_action: "根据风险项修正文案，再进入排版或发布",
                  },
                });
                await emitEvent(controller, encoder, {
                  type: "assistant_status",
                  label: "输出答案中",
                });
                await emitText(controller, encoder, fullContent);
                shouldStopAfterTool = true;
              }

              await finalizeToolCallLog(supabase, toolLogId, {
                status: "success",
                result,
              });

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(addToolHint(toolCall.function.name, result as Record<string, unknown>)),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : "Unknown tool error";

              await emitEvent(controller, encoder, {
                type: "tool_error",
                toolName: toolCall.function.name,
                label: toolLabel(toolCall.function.name),
                error: message,
              });

              await finalizeToolCallLog(supabase, toolLogId, {
                status: "error",
                error: message,
              });

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: message }),
              });
            }
          }

          if (shouldStopAfterTool) {
            break;
          }

          // 工具执行完毕后，continue 回到循环顶部，让 LLM 基于工具结果
          // 决定是继续调工具还是直接回答（no toolCalls → streamModelResponse → break）
          continue;
        }

        if (!fullContent) {
          // 循环跑满但 LLM 还在调工具，强制让它基于已有信息回答
          fullContent = await streamModelResponse({
            controller,
            encoder,
            systemPrompt,
            messages,
            fallback: "我已经完成检索和分析，下面把核心结论整理给你。",
            forceNoTools: true,
          });
        }

        fullContent = await appendConversationalFollowup({
          controller,
          encoder,
          journeyId: conv.journey_id,
          userMessage: content,
          assistantDraft: fullContent,
          projectMemory: await getJourneyProjectMemory(supabase, conv.journey_id),
          currentContent: fullContent,
        });

        await persistAssistantMessageAndEmitId(supabase, controller, encoder, conversationId, fullContent);
        await appendStructuredRoundSummary(supabase, {
          journeyId: conv.journey_id,
          userId: user.id,
          summary: {
            user_intent: content.slice(0, 120),
            confirmed_decisions: inferConfirmedDecisions(content, fullContent),
            produced_outputs: inferProducedOutputs(fullContent),
            open_questions: [],
            next_action: inferNextAction(fullContent),
          },
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        if (!conv.title || conv.title === "新对话" || conv.title === "第一次对话") {
          const title = fullContent.slice(0, 40).replace(/\n/g, " ");
          await supabase.from("conversations").update({ title }).eq("id", conversationId);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        await emitEvent(controller, encoder, {
          type: "tool_error",
          label: "Agent",
          error: errMsg,
        });
        await emitText(controller, encoder, `抱歉，这次 Agent 调用出了点问题：${errMsg}`);
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

function inferConfirmedDecisions(userContent: string, assistantContent: string) {
  const decisions: string[] = [];
  if (/确认|采用|就按这个|就这样|直接改/.test(userContent)) {
    decisions.push("用户已确认当前方向或修改方案");
  }
  if (/完整稿|公众号完整初稿/.test(assistantContent)) {
    decisions.push("当前已推进到完整稿阶段");
  }
  if (/合规检查|风控/.test(assistantContent)) {
    decisions.push("当前内容已完成一轮合规检查");
  }
  return Array.from(new Set(decisions));
}

function inferProducedOutputs(assistantContent: string) {
  const outputs: string[] = [];
  if (/候选选题/.test(assistantContent) || /why_fit_user/.test(assistantContent)) {
    outputs.push("候选选题");
  }
  if (/完整稿|公众号摘要|备选标题/.test(assistantContent)) {
    outputs.push("公众号完整稿");
  }
  if (/合规检查|风险项|发布建议/.test(assistantContent)) {
    outputs.push("合规检查结果");
  }
  if (!outputs.length) {
    outputs.push("对话建议");
  }
  return outputs;
}

function inferNextAction(assistantContent: string) {
  if (/排版|发布到公众号/.test(assistantContent)) {
    return "检查内容细节后进入排版与发布";
  }
  if (/合规检查|风险项/.test(assistantContent)) {
    return "根据合规建议微调文案后进入排版";
  }
  if (/候选选题|选题/.test(assistantContent)) {
    return "从候选方向中确认一个，再扩成完整稿";
  }
  return "继续围绕当前结果推进下一步";
}

async function appendConversationalFollowup(params: {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  journeyId: string;
  userMessage: string;
  assistantDraft: string;
  projectMemory: Awaited<ReturnType<typeof getJourneyProjectMemory>>;
  currentContent: string;
}) {
  try {
    const followup = await buildFollowupQuestionChain({
      journeyId: params.journeyId,
      userMessage: params.userMessage,
      assistantDraft: params.assistantDraft,
      projectMemory: params.projectMemory,
    });

    if (!followup.question) {
      return params.currentContent;
    }

    const nextContent = `${params.currentContent.trim()}\n\n${followup.question.trim()}`;
    await emitText(params.controller, params.encoder, `\n\n${followup.question.trim()}`);
    return nextContent;
  } catch {
    return params.currentContent;
  }
}

function shouldAutoImportBenchmark(content: string) {
  return /(对标|拆解|导入|跟踪|研究|分析这个号|分析这个公众号|想学这个号)/i.test(content);
}

function detectExplicitBenchmarkName(content: string, trackedAccounts: string[]) {
  const explicit = content.match(/(?:对标|拆解|研究|分析|导入|跟踪|学习)\s*([^\n，。,；;：:]{2,30})/);
  const accountLike = explicit?.[1]?.trim();
  if (accountLike && !/公众号|文章|内容|问题|方向/.test(accountLike)) {
    return accountLike;
  }

  const normalized = normalizeComparisonText(content);
  return trackedAccounts.find((name) => normalized.includes(normalizeComparisonText(name))) || null;
}

function addToolHint(toolName: string, result: Record<string, unknown>): Record<string, unknown> {
  const hints: Record<string, string> = {
    search_hot_topics: "建议接下来调用 search_knowledge_base 检索知识库已有案例，或调用 analyze_journey_data 分析爆款规律。",
    search_wechat_hot_articles: "如果已经找到合适的公众号账号，建议继续导入成对标样本。",
    import_koc_by_name: "账号导入后，建议继续拆解这个号的内容规律或对比差距。",
    analyze_journey_data: "如果需要案例支撑，建议接下来调用 search_knowledge_base 获取详细文章内容。",
    search_knowledge_base: "如果用户还关注热点趋势，建议接下来调用 search_hot_topics；如果需要选题，建议调用 generate_topics。",
  };
  const hint = hints[toolName];
  if (!hint) return result;
  return { ...result, _next_step_hint: hint };
}

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
    if (!title || !articleMarkdown) {
      throw new Error("title and article_markdown are required");
    }

    return runComplianceCheck({
      supabase,
      journeyId,
      userId,
      journey,
      article: {
        title,
        summary,
        title_options: [],
        article_markdown: articleMarkdown,
        reference_note: "",
      },
    });
  }

  const registryEntry = AGENT_TOOL_REGISTRY[toolName as keyof typeof AGENT_TOOL_REGISTRY];
  if (registryEntry?.execute) {
    return registryEntry.execute(args as never, {
      journeyId,
      userId,
      supabase,
      journey,
    });
  }

  throw new Error(`Unsupported tool: ${toolName}`);
}

async function reviseFullArticle(params: {
  supabase: ReturnType<typeof createClient>;
  journeyId: string;
  userId: string;
  journey: ToolContextJourney | null;
  previousArticle: FullArticleToolResult;
  instruction: string;
}) {
  const [userMemory, journeyMemory] = await Promise.all([
    getUserMemory(params.supabase, params.userId),
    getJourneyMemory(params.supabase, params.journeyId),
  ]);

  const text = await llm.chat(
    "你是一个公众号编辑。只输出 JSON，不要任何额外解释，不要使用 Markdown 代码块。",
    `请基于上一版公众号完整稿，按照用户修改意见生成一版新稿。

赛道：${params.journey?.niche_level2 ?? "未知赛道"}
用户修改意见：${params.instruction}

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【上一版标题】
${params.previousArticle.title}

【上一版摘要】
${params.previousArticle.summary}

【上一版正文】
${params.previousArticle.article_markdown}

要求：
1. 保持完整 Markdown 成稿形态
2. 按用户意见实质修改，不要只做表面替换
3. 如果用户要求缩短，控制在原文 50%-70%
4. 如果用户要求更犀利，可以增强观点冲突，但不要贩卖焦虑或做绝对化承诺
5. 同时更新标题、摘要和备选标题

返回 JSON：
{
  "title": "主标题",
  "summary": "公众号摘要",
  "title_options": ["备选标题1", "备选标题2", "备选标题3", "备选标题4", "备选标题5"],
  "article_markdown": "完整 Markdown 正文"
}`
  );

  const parsed = safeParseJson<Omit<FullArticleToolResult, "reference_note">>(text);
  if (parsed?.article_markdown) {
    return {
      title: parsed.title || params.previousArticle.title,
      summary: parsed.summary || params.previousArticle.summary,
      title_options: Array.isArray(parsed.title_options) ? parsed.title_options.slice(0, 5) : [],
      article_markdown: parsed.article_markdown,
      reference_note: params.previousArticle.reference_note,
    };
  }

  return {
    ...params.previousArticle,
    article_markdown: text,
  };
}

async function runComplianceCheck(params: {
  supabase: ReturnType<typeof createClient>;
  journeyId: string;
  userId: string;
  journey: ToolContextJourney | null;
  article: FullArticleToolResult;
}) {
  const ruleIssues = collectRuleBasedComplianceIssues(params.article);
  const [userMemory, journeyMemory] = await Promise.all([
    getUserMemory(params.supabase, params.userId),
    getJourneyMemory(params.supabase, params.journeyId),
  ]);

  const serializedRuleIssues = ruleIssues.length
    ? ruleIssues
        .map((issue, index) =>
          `${index + 1}. [${issue.level}/${issue.risk_type}] ${issue.category} | ${issue.location} | 命中文本：${issue.target_text} | 原因：${issue.reason} | 建议：${issue.suggestion} | 替代：${issue.replacement}`
        )
        .join("\n")
    : "暂无明显规则命中";

  const llmResult = await llm.chat(
    "你是公众号内容合规审校助手。只输出 JSON，不要解释，不要使用 Markdown 代码块。",
    `请检查下面这篇公众号内容在微信生态中的合规和限流风险。

赛道：${params.journey?.niche_level2 ?? "未知赛道"}

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【标题】
${params.article.title}

【摘要】
${params.article.summary || "暂无"}

【正文】
${params.article.article_markdown}

【规则命中初筛】
${serializedRuleIssues}

要求：
1. 同时考虑“违规风险”和“限流风险”
2. 重点检查：绝对化表达、收益承诺、诱导互动、医疗健康、金融投资、政策敏感、夸大宣传、标题党
3. 输出 0-100 分，总分越高越安全
4. 给出发布建议：可发布 / 建议修改后发布 / 不建议发布
5. 每个问题必须包含：等级、风险类型、类别、位置、命中文本、原因、建议、替代表达
6. 如果标题、摘要、CTA 需要更安全版本，也给出替代文本
7. 仅作平台风险提示，不构成法律意见

返回 JSON：
{
  "score": 78,
  "publish_recommendation": "建议修改后发布",
  "overview": "整体表达清晰，但有若干可能触发限流或夸大解读的措辞。",
  "disclaimer": "仅作平台风险提示，不构成法律意见",
  "safer_title": "更安全的标题",
  "safer_summary": "更安全的摘要",
  "safer_cta": "更安全的 CTA",
  "issues": [
    {
      "level": "medium",
      "risk_type": "distribution_risk",
      "category": "绝对化表达",
      "location": "title",
      "target_text": "整个行业完蛋了",
      "reason": "措辞过满，容易被识别为夸张表达。",
      "suggestion": "改成更克制、可验证的判断。",
      "replacement": "这个行业正在被重新洗牌"
    }
  ]
}`
  );

  const parsed = safeParseJson<ComplianceCheckResult>(llmResult);
  const normalized = normalizeComplianceResult(parsed, params.article);

  if (!normalized.issues.length && ruleIssues.length) {
    normalized.issues = ruleIssues;
  } else if (ruleIssues.length) {
    normalized.issues = dedupeComplianceIssues([...ruleIssues, ...normalized.issues]);
  }

  normalized.score = clampComplianceScore(normalized.score, normalized.issues);
  normalized.publish_recommendation = derivePublishRecommendation(
    normalized.publish_recommendation,
    normalized.issues,
    normalized.score
  );
  normalized.disclaimer = normalized.disclaimer || "仅作平台风险提示，不构成法律意见";
  normalized.safer_title = normalized.safer_title || params.article.title;
  normalized.safer_summary = normalized.safer_summary || params.article.summary || "";
  normalized.safer_cta = normalized.safer_cta || suggestSaferCta(params.article.article_markdown);
  normalized.overview = normalized.overview || buildComplianceOverview(normalized.issues, normalized.score);

  return normalized;
}

async function handleNaturalLanguageFollowUp(params: {
  content: string;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  supabase: ReturnType<typeof createClient>;
  conversationId: string;
  journeyId: string;
  messageId: string | null;
  userId: string;
  journey: ToolContextJourney | null;
  recentToolCalls: ToolCallRow[];
}) {
  const selectedIndex = detectTopicSelection(params.content);
  const latestTopicsCall = params.recentToolCalls.find(
    (item) => item.tool_name === "generate_topics" && item.status === "success"
  );

  if (selectedIndex !== null && latestTopicsCall) {
    const result = latestTopicsCall.result as TopicToolResult | null;
    const topic = result?.topics?.[selectedIndex];
    if (topic) {
      await appendJourneyMemory(
        params.supabase,
        params.journeyId,
        "已确认选题",
        `${topic.title}｜${topic.angle}`
      );

      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "generate_full_article",
        label: toolLabel("generate_full_article"),
      });

      const toolLogId = await createToolCallLog(params.supabase, {
        conversationId: params.conversationId,
        journeyId: params.journeyId,
        messageId: params.messageId,
        toolName: "generate_full_article",
        status: "running",
        arguments: { topic_title: topic.title, angle: topic.angle },
        requiresConfirmation: false,
      });

      const article = await runGenerateFullArticle(
        {
          topic_title: topic.title,
          angle: topic.angle,
          style: "克制专业，可以有一点网感",
        },
        {
          journeyId: params.journeyId,
          userId: params.userId,
          supabase: params.supabase,
          journey: params.journey,
        }
      );

      const compliance = await runComplianceCheck({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        article,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "generate_full_article",
        label: toolLabel("generate_full_article"),
        payload: article,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
        payload: compliance as unknown as Record<string, unknown>,
      });

      await finalizeToolCallLog(params.supabase, toolLogId, {
        status: "success",
        result: article,
      });

      const response = formatFullArticleResponse(
        `你选了 **${topic.title}**，我按这个方向写了一版可发布级公众号完整初稿。`,
        article,
        compliance
      );
      await updateProjectCard(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          current_stage: "内容生成",
        },
      });
      await updateJourneyStrategyState(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          confirmed_directions: [topic.title],
          last_generated_asset: "公众号完整稿",
          last_publish_state: "已完成合规检查，待排版发布",
          current_todos: ["根据合规建议微调标题与摘要", "进入排版并准备发布"],
          next_best_action: "确认这版完整稿是否进入排版与发布",
        } as Partial<JourneyStrategyState>,
      });
      await appendStructuredRoundSummary(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        summary: {
          user_intent: "确认选题并扩写成完整稿",
          confirmed_decisions: [`已确认选题：${topic.title}`],
          produced_outputs: ["公众号完整稿", "合规检查结果"],
          open_questions: [],
          next_action: "进入排版，或根据风控建议先微调标题与摘要",
        },
      });
      await emitText(params.controller, params.encoder, response);
      return response;
    }
  }

  const latestDraftCall = params.recentToolCalls.find(
    (item) => item.tool_name === "generate_article_draft" && item.status === "success"
  );

  if (isDraftAccepted(params.content) && latestDraftCall) {
    const result = latestDraftCall.result as DraftToolResult | null;
    if (result?.title) {
      await appendJourneyMemory(
        params.supabase,
        params.journeyId,
        "用户反馈",
        `已采用初稿：${result.title}`
      );

      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "generate_full_article",
        label: toolLabel("generate_full_article"),
      });

      const toolLogId = await createToolCallLog(params.supabase, {
        conversationId: params.conversationId,
        journeyId: params.journeyId,
        messageId: params.messageId,
        toolName: "generate_full_article",
        status: "running",
        arguments: { topic_title: result.title },
        requiresConfirmation: false,
      });

      const article = await runGenerateFullArticle(
        {
          topic_title: result.title,
          angle: "",
          style: "克制专业，可以有一点网感",
        },
        {
          journeyId: params.journeyId,
          userId: params.userId,
          supabase: params.supabase,
          journey: params.journey,
        }
      );

      const compliance = await runComplianceCheck({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        article,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "generate_full_article",
        label: toolLabel("generate_full_article"),
        payload: article,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
        payload: compliance as unknown as Record<string, unknown>,
      });

      await finalizeToolCallLog(params.supabase, toolLogId, {
        status: "success",
        result: article,
      });

      const response = formatFullArticleResponse(
        `收到，我已经把这次偏好记下来了，并基于 **${result.title}** 扩成一版完整公众号初稿。`,
        article,
        compliance
      );
      await updateProjectCard(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          current_stage: "内容生成",
        },
      });
      await updateJourneyStrategyState(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          confirmed_directions: [result.title],
          last_generated_asset: "公众号完整稿",
          last_publish_state: "已完成合规检查，待排版发布",
          current_todos: ["确认是否继续修改", "进入排版与发布流程"],
          next_best_action: "检查完整稿是否需要润色，随后进入排版",
        } as Partial<JourneyStrategyState>,
      });
      await appendStructuredRoundSummary(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        summary: {
          user_intent: "采用骨架稿并扩成完整稿",
          confirmed_decisions: [`采用初稿：${result.title}`],
          produced_outputs: ["公众号完整稿", "合规检查结果"],
          open_questions: [],
          next_action: "确认这版完整稿是否继续修改或直接排版",
        },
      });
      await emitText(params.controller, params.encoder, response);
      return response;
    }
  }

  const latestFullArticleCall = params.recentToolCalls.find(
    (item) => item.tool_name === "generate_full_article" && item.status === "success"
  );

  if (isRevisionRequest(params.content) && latestFullArticleCall) {
    const previousArticle = latestFullArticleCall.result as FullArticleToolResult | null;
    if (previousArticle?.article_markdown) {
      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "revise_full_article",
        label: toolLabel("revise_full_article"),
      });

      const toolLogId = await createToolCallLog(params.supabase, {
        conversationId: params.conversationId,
        journeyId: params.journeyId,
        messageId: params.messageId,
        toolName: "revise_full_article",
        status: "running",
        arguments: { instruction: params.content },
        requiresConfirmation: false,
      });

      const revised = await reviseFullArticle({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        previousArticle,
        instruction: params.content,
      });

      const compliance = await runComplianceCheck({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        article: revised,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "revise_full_article",
        label: toolLabel("revise_full_article"),
        payload: revised,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
        payload: compliance as unknown as Record<string, unknown>,
      });

      await finalizeToolCallLog(params.supabase, toolLogId, {
        status: "success",
        result: revised,
      });

      await appendJourneyMemory(
        params.supabase,
        params.journeyId,
        "用户修改偏好",
        params.content
      );

      const response = formatFullArticleResponse("我按你的修改意见重写了一版：", revised, compliance);
      await updateProjectCard(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          current_stage: "内容迭代",
        },
      });
      await updateJourneyStrategyState(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          last_generated_asset: "重写后的公众号完整稿",
          last_publish_state: "已完成合规检查，待确认发布",
          current_todos: ["确认这版是否满足预期", "进入排版与发布"],
          next_best_action: "检查修改后的完整稿是否可以进入排版",
        } as Partial<JourneyStrategyState>,
      });
      await appendStructuredRoundSummary(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        summary: {
          user_intent: "按要求重写上一版完整稿",
          confirmed_decisions: ["已按当前修改意见重写文章"],
          produced_outputs: ["重写后的完整稿", "最新合规检查结果"],
          open_questions: [],
          next_action: "确认新版是否进入排版，或继续微调",
        },
      });
      await emitText(params.controller, params.encoder, response);
      return response;
    }
  }

  if (isComplianceCheckRequest(params.content) && latestFullArticleCall) {
    const article = latestFullArticleCall.result as FullArticleToolResult | null;
    if (article?.article_markdown) {
      await emitEvent(params.controller, params.encoder, {
        type: "tool_start",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
      });

      const toolLogId = await createToolCallLog(params.supabase, {
        conversationId: params.conversationId,
        journeyId: params.journeyId,
        messageId: params.messageId,
        toolName: "compliance_check",
        status: "running",
        arguments: {
          title: article.title,
          summary: article.summary,
          article_markdown: article.article_markdown,
        },
        requiresConfirmation: false,
      });

      const compliance = await runComplianceCheck({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        article,
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "compliance_check",
        label: toolLabel("compliance_check"),
        payload: compliance as unknown as Record<string, unknown>,
      });

      await finalizeToolCallLog(params.supabase, toolLogId, {
        status: "success",
        result: compliance,
      });

      const response = formatComplianceResponse(compliance);
      await updateProjectCard(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          current_stage: "发布准备",
        },
      });
      await updateJourneyStrategyState(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        patch: {
          last_generated_asset: "合规检查结果",
          last_publish_state: "待根据风控建议微调",
          current_todos: ["按风控建议修改标题或摘要", "确认后进入排版与发布"],
          next_best_action: "根据合规结果修正文案后进入排版",
        } as Partial<JourneyStrategyState>,
      });
      await appendStructuredRoundSummary(params.supabase, {
        journeyId: params.journeyId,
        userId: params.userId,
        summary: {
          user_intent: "单独检查文章合规风险",
          confirmed_decisions: [],
          produced_outputs: ["合规检查结果"],
          open_questions: [],
          next_action: "根据风险项修正文案，再进入排版或发布",
        },
      });
      await emitText(params.controller, params.encoder, response);
      return response;
    }
  }

  return "";
}

function detectTopicSelection(content: string) {
  const text = content.trim();
  if (!/(第[一二三123]|第\s*[123])/.test(text) && !/(就这个|就它|可以|ok|好的)/i.test(text)) {
    return null;
  }

  if (/第\s*(一|1)/.test(text)) return 0;
  if (/第\s*(二|2)/.test(text)) return 1;
  if (/第\s*(三|3)/.test(text)) return 2;
  return null;
}

function isDraftAccepted(content: string) {
  return /(这个可以|就按这个写|这个版本行|可以发|ok|好的|就这样)/i.test(content.trim());
}

function isRevisionRequest(content: string) {
  return /(改|修改|重写|润色|优化|缩短|扩写|更.{0,4}(犀利|专业|克制|口语|有网感|故事化)|开头|结尾|标题|摘要)/i.test(content.trim());
}

function isComplianceCheckRequest(content: string) {
  return /(检查合规|合规检查|会不会违规|平台风险|限流风险|改得更安全|风险提示)/i.test(content.trim());
}

function isLatestTrendRequest(content: string) {
  return /(最新|最近|这周|今天|热点|趋势|风向|发生了什么)/i.test(content.trim());
}

function detectKnowledgeLookupIntent(
  content: string,
  trackedAccounts: string[],
  requestedAccountName?: string | null
) {
  const text = content.trim();
  const normalized = normalizeComparisonText(text);
  const accountMatches = uniqueStrings([
    ...trackedAccounts.filter((name) => normalized.includes(normalizeComparisonText(name))),
    ...(requestedAccountName ? [requestedAccountName] : []),
  ]);
  const articleTitle = extractArticleTitleHint(text);

  const hasKnowledgeSignal =
    (accountMatches.length > 0 || !!articleTitle) &&
    /(文章|写法|风格|为什么|能火|火|拆解|参考|账号|这个号|他的内容|对比|差别|标题|选题|这篇|哪篇|结构)/i.test(text);

  if (!hasKnowledgeSignal) {
    return null;
  }

  return {
    query: articleTitle || accountMatches[0] || text,
    accountNames: accountMatches,
    articleTitle,
  };
}

function normalizeComparisonText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function detectKnowledgeCompareIntent(
  content: string,
  trackedAccounts: string[],
  requestedAccountName?: string | null
) {
  const text = content.trim();
  if (!/(对比|比较|差别|差距|不同|vs|PK|和.*对比|和.*比较)/i.test(text)) {
    return null;
  }

  const normalized = normalizeComparisonText(text);
  const accountNames = uniqueStrings([
    ...trackedAccounts.filter((name) => normalized.includes(normalizeComparisonText(name))),
    ...(requestedAccountName ? [requestedAccountName] : []),
  ]);

  if (accountNames.length < 2) {
    return null;
  }

  return {
    accountNames: accountNames.slice(0, 2),
    query: extractArticleTitleHint(text) || accountNames[0],
  };
}

function extractRequestedAccountName(content: string) {
  const prefixed = content.match(/^\[账号分析请求\]\s*(.+)$/);
  if (prefixed?.[1]) {
    return prefixed[1].trim();
  }

  const explicit = content.match(/(?:分析|拆解|对比|研究)\s*我的号[：: ]?\s*([^\n，。,；;]+)/);
  if (explicit?.[1]) {
    return explicit[1].trim();
  }

  return null;
}

function extractArticleTitleHint(content: string) {
  const match =
    content.match(/《([^》]{2,80})》/) ||
    content.match(/[“"]([^”"\n]{4,80})[”"]/);

  return match?.[1]?.trim() || null;
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

async function getTrackedAccountNames(
  supabase: ReturnType<typeof createClient>,
  journeyId: string
) {
  const { data } = await supabase
    .from("koc_sources")
    .select("account_name")
    .eq("journey_id", journeyId)
    .limit(50);

  return (data ?? [])
    .map((item) => item.account_name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
}

function formatFullArticleResponse(
  prefix: string,
  article: FullArticleToolResult,
  compliance?: ComplianceCheckResult
) {
  const titleOptions = article.title_options.length
    ? article.title_options.map((title, index) => `${index + 1}. ${title}`).join("\n")
    : "暂无";

  const complianceSection = compliance
    ? `\n\n**合规风控**
评分：${compliance.score}/100
发布建议：${compliance.publish_recommendation}
总览：${compliance.overview}

${formatComplianceIssues(compliance.issues)}

如果你愿意，我可以继续帮你：**按风控建议直接重写标题、摘要、CTA，或者把高风险段落改得更安全。**`
    : `\n\n如果你愿意，我可以继续帮你做：**合规检查、风险改写、CTA 优化**。`;

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

${article.article_markdown}

如果你想继续调，我可以按你的要求做：**更犀利一点、缩短一半、重写开头、换标题风格、改成保姆教程风**。${complianceSection}`;
}

function formatComplianceResponse(result: ComplianceCheckResult) {
  return `## 合规检查总览

- **风险评分**：${result.score}/100
- **发布建议**：${result.publish_recommendation}

> ${result.overview}

## 主要风险项

${formatComplianceIssues(result.issues)}

## 更安全的替代表达

### 标题建议
${result.safer_title}

### 摘要建议
${result.safer_summary || "暂无"}

### CTA 建议
${result.safer_cta || "暂无"}

## 提示

${result.disclaimer}

如果你愿意，我可以继续帮你：**按这些建议直接重写整篇文章，或者只改高风险段落。**`;
}

function formatComplianceIssues(issues: ComplianceIssue[]) {
  if (!issues.length) {
    return `未发现明显高风险表达，但仍建议人工再过一遍标题、摘要和 CTA。`;
  }

  return `${issues
  .slice(0, 6)
  .map(
    (issue, index) => `### 风险 ${index + 1}｜${issue.category}
- 风险等级：${levelLabel(issue.level)}｜${riskTypeLabel(issue.risk_type)}
- 命中文本：${issue.target_text}
- 原因：${issue.reason}
- 建议：${issue.suggestion}
- 替代表达：${issue.replacement || "—"}`
  )
  .join("\n\n")}`;
}

function safeParseJson<T>(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function safeParseArgs(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toolLabel(toolName: string) {
  switch (toolName) {
    case "search_hot_topics":
      return "搜索赛道热点";
    case "search_wechat_hot_articles":
      return "搜索公众号爆文";
    case "import_koc_by_name":
      return "导入对标公众号";
    case "analyze_journey_data":
      return "分析知识库";
    case "search_knowledge_base":
      return "检索知识库";
    case "generate_topics":
      return "生成选题";
    case "generate_article_draft":
      return "生成初稿";
    case "generate_full_article":
      return "生成完整稿";
    case "compliance_check":
      return "合规检查";
    case "revise_full_article":
      return "修改完整稿";
    default:
      return toolName;
  }
}

function collectRuleBasedComplianceIssues(article: FullArticleToolResult): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const title = article.title || "";
  const summary = article.summary || "";
  const body = article.article_markdown || "";
  const cta = extractCta(body);

  const targets: Array<{ text: string; location: ComplianceIssue["location"] }> = [
    { text: title, location: "title" },
    { text: summary, location: "summary" },
    { text: body, location: "body" },
    { text: cta, location: "cta" },
  ];

  const rules: Array<{
    category: string;
    risk_type: ComplianceRiskType;
    level: ComplianceLevel;
    pattern: RegExp;
    reason: string;
    suggestion: string;
    replacement: string;
  }> = [
    {
      category: "绝对化表达",
      risk_type: "distribution_risk",
      level: "medium",
      pattern: /(最强|第一|唯一|绝对|一定|必然|全网|彻底|完蛋了|100%)/i,
      reason: "措辞过满，容易被判定为夸大或标题党。",
      suggestion: "改成更克制、可验证的表达。",
      replacement: "正在被重新评估 / 更有可能 / 值得关注",
    },
    {
      category: "收益承诺",
      risk_type: "violation_risk",
      level: "high",
      pattern: /(保证涨粉|保证赚钱|轻松月入|稳定变现|闭眼入|稳赚|翻倍收益)/i,
      reason: "存在明显的收益或结果承诺，平台风险较高。",
      suggestion: "删除承诺式表达，改为经验判断或机会描述。",
      replacement: "更有机会提升转化 / 可能带来更好的效果",
    },
    {
      category: "诱导互动",
      risk_type: "distribution_risk",
      level: "medium",
      pattern: /(转发给|点个在看|点个赞|关注后私信|不转不是|求扩散)/i,
      reason: "存在明显诱导点赞、转发、关注的表达，容易影响分发。",
      suggestion: "改成自然邀请用户交流或收藏。",
      replacement: "如果这篇对你有帮助，欢迎收藏，之后复盘时再回来对照。",
    },
    {
      category: "医疗健康",
      risk_type: "violation_risk",
      level: "high",
      pattern: /(治疗|治愈|包治|药到病除|医学证明|临床验证)/i,
      reason: "涉及医疗健康效果判断，需格外谨慎。",
      suggestion: "避免效果承诺，改成信息分享或经验观察。",
      replacement: "仅作信息参考，具体请咨询专业医生或官方指引",
    },
    {
      category: "金融投资",
      risk_type: "violation_risk",
      level: "high",
      pattern: /(买入|抄底|暴涨|稳赚不赔|收益率|财务自由|投资建议)/i,
      reason: "涉及明确投资指引或收益暗示，平台风险较高。",
      suggestion: "改成市场观察，不给直接投资建议。",
      replacement: "仅分享观察，不构成任何投资建议",
    },
    {
      category: "政策敏感",
      risk_type: "violation_risk",
      level: "high",
      pattern: /(内幕|监管失控|政策黑幕|封杀|国家不让说)/i,
      reason: "容易触发政策和公共议题敏感风险。",
      suggestion: "删除阴谋化表达，改为公开信息层面的描述。",
      replacement: "基于公开信息来看，相关规则仍在变化",
    },
  ];

  for (const rule of rules) {
    for (const target of targets) {
      if (!target.text) continue;
      const match = target.text.match(rule.pattern);
      if (!match) continue;
      issues.push({
        level: rule.level,
        risk_type: rule.risk_type,
        category: rule.category,
        location: target.location,
        target_text: truncate(match[0], 36),
        reason: rule.reason,
        suggestion: rule.suggestion,
        replacement: rule.replacement,
      });
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

function normalizeComplianceResult(
  parsed: ComplianceCheckResult | null,
  article: FullArticleToolResult
): ComplianceCheckResult {
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
  const high = issues.filter((issue) => issue.level === "high").length;
  const medium = issues.filter((issue) => issue.level === "medium").length;
  const low = issues.filter((issue) => issue.level === "low").length;
  const derived = 100 - high * 18 - medium * 10 - low * 4;
  const baseline = Number.isFinite(score) ? score : 88;
  return Math.max(20, Math.min(baseline, derived, 100));
}

function derivePublishRecommendation(
  current: ComplianceCheckResult["publish_recommendation"],
  issues: ComplianceIssue[],
  score: number
): ComplianceCheckResult["publish_recommendation"] {
  if (issues.some((issue) => issue.level === "high" && issue.risk_type === "violation_risk")) {
    return "不建议发布";
  }
  if (issues.some((issue) => issue.level !== "low") || score < 85) {
    return "建议修改后发布";
  }
  return current === "不建议发布" ? "建议修改后发布" : "可发布";
}

function buildComplianceOverview(issues: ComplianceIssue[], score: number) {
  if (!issues.length) {
    return score >= 90
      ? "整体表达较稳，未发现明显高风险措辞，主要保留人工复核标题和 CTA 即可。"
      : "整体风险可控，但仍建议人工复核标题、摘要和 CTA。";
  }
  const high = issues.filter((issue) => issue.level === "high").length;
  const medium = issues.filter((issue) => issue.level === "medium").length;
  if (high > 0) {
    return `存在 ${high} 处高风险表达，建议先改写再发布；另外还有 ${medium} 处可能影响分发的措辞。`;
  }
  return `整体风险可控，但有 ${medium} 处可能引发限流或夸大解读的表达，建议先微调后发布。`;
}

function extractCta(markdown: string) {
  const lines = markdown.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.slice(-2).join(" ");
}

function suggestSaferCta(markdown: string) {
  const cta = extractCta(markdown);
  if (!cta) return "如果这篇内容对你有帮助，欢迎先收藏，之后复盘时再回来对照。";
  return cta
    .replace(/点个在看|点个赞|转发给.+?(?=[，。]|$)/g, "欢迎先收藏")
    .replace(/关注后私信/g, "如果你也在做这件事，欢迎留言交流");
}

function levelLabel(level: ComplianceLevel) {
  switch (level) {
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    default:
      return "低风险";
  }
}

function riskTypeLabel(type: ComplianceRiskType) {
  return type === "violation_risk" ? "违规风险" : "限流风险";
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

async function emitEvent(controller: ReadableStreamDefaultController, encoder: TextEncoder, payload: Record<string, unknown>) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

async function emitText(controller: ReadableStreamDefaultController, encoder: TextEncoder, text: string) {
  const chunks = chunkTextForStreaming(text);
  for (const chunk of chunks) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`));
  }
}

async function streamModelResponse(params: {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  systemPrompt: string;
  messages: LlmMessage[];
  fallback: string;
  forceNoTools?: boolean;
}) {
  let fullContent = "";
  const textEmitter = createSmoothTextEmitter(params.controller, params.encoder);

  await emitEvent(params.controller, params.encoder, {
    type: "assistant_status",
    label: "输出答案中",
  });

  try {
    const effectiveSystemPrompt = params.forceNoTools
      ? params.systemPrompt + "\n\n[重要] 你已经完成了所有必要的工具调用，现在必须直接基于已有信息输出最终回答，不要再调用任何工具。"
      : params.systemPrompt;
    await llm.streamChat({
      systemPrompt: effectiveSystemPrompt,
      messages: params.messages,
      onChunk: (text) => {
        fullContent += text;
        textEmitter.push(text);
      },
    });
    await textEmitter.flush();
  } catch {
    // Fall back to deterministic streaming if provider-side streaming fails.
  }

  if (!fullContent.trim()) {
    fullContent = params.fallback;
    await emitText(params.controller, params.encoder, fullContent);
  }

  return fullContent;
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
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`)
        );
      }
    },
    async flush() {
      if (!buffer) return;
      const chunks = chunkTextForStreaming(buffer);
      buffer = "";
      for (const chunk of chunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`)
        );
      }
    },
  };
}

function extractReadyChunks(text: string) {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= 16) {
      break;
    }

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

function chunkTextForStreaming(text: string) {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const { chunks: readyChunks, remaining: nextRemaining } = extractReadyChunks(remaining);
    if (readyChunks.length === 0) {
      chunks.push(remaining);
      break;
    }
    chunks.push(...readyChunks);
    remaining = nextRemaining;
  }

  return chunks.filter((chunk) => chunk.length > 0);
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

async function persistAssistantMessageAndEmitId(
  supabase: ReturnType<typeof createClient>,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  conversationId: string,
  content: string
) {
  const { data } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      content,
    })
    .select("id")
    .single();

  if (data?.id) {
    await emitEvent(controller, encoder, {
      type: "assistant_message",
      messageId: data.id,
    });
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
    status: string;
    arguments: Record<string, unknown>;
    requiresConfirmation: boolean;
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
        status: payload.status,
        arguments: payload.arguments,
        requires_confirmation: payload.requiresConfirmation,
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
  payload: {
    status: string;
    result?: unknown;
    error?: string;
  }
) {
  if (!id) return;
  try {
    await supabase
      .from("tool_calls")
      .update({
        status: payload.status,
        result: payload.result,
        error: payload.error,
        finished_at: new Date().toISOString(),
      })
      .eq("id", id);
  } catch {
    // Ignore logging failures so chat flow remains available.
  }
}
