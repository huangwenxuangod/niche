import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { llm, type LlmMessage, type LlmTool } from "@/lib/llm";
import { tavilySearch } from "@/lib/tavily";
import { dajiala } from "@/lib/dajiala";
import { searchJourneyKnowledge } from "@/lib/knowledge-base";
import { appendJourneyMemory, captureMessageMemory, ensureJourneyMemory, getJourneyMemory, getUserMemory } from "@/lib/memory";

type ConversationHistoryEntry = {
  role: "user" | "assistant";
  content: string;
};

type ToolContextJourney = {
  keywords?: string[];
  niche_level2?: string;
};

type AnalyzedArticle = {
  title: string | null;
  read_count: number | null;
  is_viral: boolean | null;
  publish_time: string | null;
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

type ToolCallRow = {
  id: string;
  tool_name: string;
  status: string;
  result: Record<string, unknown> | null;
  created_at: string;
};

const AGENT_TOOLS: LlmTool[] = [
  {
    type: "function",
    function: {
      name: "search_hot_topics",
      description: "搜索当前赛道近 3 天热点，适合回答热点、趋势、选题相关问题",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词，优先使用当前赛道关键词" },
          days: { type: "number", description: "搜索最近几天，默认 3" },
          max_results: { type: "number", description: "返回结果数，默认 5" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_koc_accounts",
      description: "搜索适合跟踪的公众号/KOC 账号",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "账号搜索关键词，通常是赛道关键词" },
          page: { type: "number", description: "页码，默认 1" },
          page_size: { type: "number", description: "每页条数，默认 12" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_journey_data",
      description: "分析当前旅程下已有 KOC 和爆款文章，适合回答爆款规律、标题套路、选题建议",
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            enum: ["viral_patterns", "koc_summary", "topic_generation"],
            description: "分析重点",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description: "从当前旅程已导入到 Supabase 的文章知识库中检索相关文章、标题和案例",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索关键词，比如一个选题、概念或标题方向" },
          limit: { type: "number", description: "返回结果数，默认 6" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_topics",
      description: "基于当前赛道、知识库和用户记忆生成 3 个适合当前用户的选题",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "选题数量，默认 3" },
          goal: { type: "string", description: "例如公众号选题、本周选题" },
          timeframe: { type: "string", description: "例如今天、本周" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_article_draft",
      description: "基于已确认选题生成公众号 Markdown 骨架稿",
      parameters: {
        type: "object",
        properties: {
          topic_title: { type: "string", description: "选题标题" },
          angle: { type: "string", description: "切入角度" },
          format: { type: "string", description: "输出格式，默认 wechat_article_outline" },
        },
        required: ["topic_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_full_article",
      description: "基于已确认选题生成可发布级公众号完整 Markdown 初稿，包含摘要、备选标题和正文",
      parameters: {
        type: "object",
        properties: {
          topic_title: { type: "string", description: "选题标题" },
          angle: { type: "string", description: "切入角度" },
          style: { type: "string", description: "文风，默认克制专业、略有网感" },
        },
        required: ["topic_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_koc_articles",
      description: "建议导入某个 KOC 的文章到知识库。注意：这是写操作，必须等待用户确认。",
      parameters: {
        type: "object",
        properties: {
          ghid: { type: "string", description: "公众号 ghid" },
          account_name: { type: "string", description: "账号名称" },
          reason: { type: "string", description: "推荐导入理由" },
        },
        required: ["ghid"],
      },
    },
  },
];

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
        const messages: LlmMessage[] = ((history ?? []) as ConversationHistoryEntry[]).map((m) => ({
          role: m.role,
          content: m.content,
        }));

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
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          await supabase.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullContent,
          });
          return;
        }

        for (let step = 0; step < 3; step++) {
          let shouldStopAfterTool = false;
          const completion = await llm.completeWithTools({
            systemPrompt,
            messages,
            tools: AGENT_TOOLS,
          });

          if (!completion.toolCalls.length) {
            fullContent = completion.content || "我已经整理好了当前可用信息，但这次没有拿到额外结果。";
            await emitText(controller, encoder, fullContent);
            break;
          }

          messages.push({
            role: "assistant",
            content: completion.content || "",
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
              status: toolCall.function.name === "import_koc_articles" ? "requires_confirmation" : "running",
              arguments: args,
              requiresConfirmation: toolCall.function.name === "import_koc_articles",
            });

            if (toolCall.function.name === "import_koc_articles") {
              const pendingImport = {
                status: "requires_confirmation",
                ghid: String(args.ghid || ""),
                account_name: String(args.account_name || ""),
                reason: String(args.reason || "这个账号和当前赛道相关，适合加入知识库"),
                journey_id: conv.journey_id,
              };

              await emitEvent(controller, encoder, {
                type: "tool_requires_confirmation",
                toolName: toolCall.function.name,
                label: toolLabel(toolCall.function.name),
                toolCallId: toolLogId,
                payload: pendingImport,
              });

              await finalizeToolCallLog(supabase, toolLogId, {
                status: "requires_confirmation",
                result: pendingImport,
              });

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(pendingImport),
              });
              continue;
            }

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

              await finalizeToolCallLog(supabase, toolLogId, {
                status: "success",
                result,
              });

              if (toolCall.function.name === "generate_full_article") {
                fullContent = formatFullArticleResponse(
                  "我按你的要求写了一版可发布级公众号完整初稿。",
                  result as FullArticleToolResult
                );
                await emitText(controller, encoder, fullContent);
                shouldStopAfterTool = true;
              }

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
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
        }

        if (!fullContent) {
          fullContent = "我已经完成这轮查询，但还需要你再问我一次，我会基于这些结果继续给出建议。";
          await emitText(controller, encoder, fullContent);
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: fullContent,
        });

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
  if (toolName === "search_hot_topics") {
    const query = String(args.query || journey?.keywords?.[0] || journey?.niche_level2 || "");
    const maxResults = normalizeNumber(args.max_results, 5);
    const days = normalizeNumber(args.days, 3);
    const results = await tavilySearch(query, { max_results: maxResults, days });
    return {
      query,
      topics: results.map((item) => ({
        title: item.title,
        url: item.url,
        published_date: item.published_date,
      })),
    };
  }

  if (toolName === "search_koc_accounts") {
    const keyword = String(args.keyword || journey?.keywords?.[0] || journey?.niche_level2 || "");
    const page = normalizeNumber(args.page, 1);
    const pageSize = normalizeNumber(args.page_size, 12);
    const results = await dajiala.searchAccounts(keyword, page, Math.min(pageSize, 20));
    let filtered = results.filter((k) => k.fans >= 500 && k.fans <= 10000);
    if (!filtered.length) {
      filtered = results.filter((k) => k.fans >= 100 && k.fans <= 50000);
    }
    return {
      keyword,
      accounts: filtered.slice(0, 8).map((account) => ({
        name: account.name,
        ghid: account.ghid,
        fans: account.fans,
        avg_top_read: account.avg_top_read,
        avg_top_like: account.avg_top_like,
        avatar: account.avatar,
      })),
    };
  }

  if (toolName === "analyze_journey_data") {
    const focus = String(args.focus || "viral_patterns");
    const { data: kocs } = await supabase
      .from("koc_sources")
      .select("account_name, max_read_count, avg_read_count")
      .eq("journey_id", journeyId)
      .order("max_read_count", { ascending: false })
      .limit(10);

    const { data: articles } = await supabase
      .from("knowledge_articles")
      .select("title, read_count, is_viral, publish_time")
      .eq("journey_id", journeyId)
      .order("read_count", { ascending: false })
      .limit(12);

    const titles = ((articles ?? []) as AnalyzedArticle[]).map((item) => item.title || "");
    const titlePatterns = summarizeTitlePatterns(titles);

    return {
      focus,
      koc_count: kocs?.length ?? 0,
      article_count: articles?.length ?? 0,
      top_kocs: (kocs ?? []).slice(0, 5),
      top_articles: (articles ?? []).slice(0, 6),
      patterns: titlePatterns,
    };
  }

  if (toolName === "search_knowledge_base") {
    const query = String(args.query || "").trim();
    if (!query) {
      throw new Error("Knowledge search query is required");
    }

    return searchJourneyKnowledge(
      supabase,
      journeyId,
      query,
      Math.min(normalizeNumber(args.limit, 6), 10)
    );
  }

  if (toolName === "generate_topics") {
    const count = Math.min(normalizeNumber(args.count, 3), 5);
    return generateTopics({
      supabase,
      journeyId,
      userId,
      journey,
      count,
      goal: String(args.goal || "公众号选题"),
      timeframe: String(args.timeframe || "本周"),
    });
  }

  if (toolName === "generate_article_draft") {
    const topicTitle = String(args.topic_title || "").trim();
    if (!topicTitle) {
      throw new Error("topic_title is required");
    }

    return generateArticleDraft({
      supabase,
      journeyId,
      userId,
      journey,
      topicTitle,
      angle: String(args.angle || ""),
    });
  }

  if (toolName === "generate_full_article") {
    const topicTitle = String(args.topic_title || "").trim();
    if (!topicTitle) {
      throw new Error("topic_title is required");
    }

    return generateFullArticle({
      supabase,
      journeyId,
      userId,
      journey,
      topicTitle,
      angle: String(args.angle || ""),
      style: String(args.style || "克制专业，可以有一点网感"),
    });
  }

  throw new Error(`Unsupported tool: ${toolName}`);
}

function summarizeTitlePatterns(titles: string[]) {
  const patterns: string[] = [];
  if (titles.some((title) => /\d/.test(title))) {
    patterns.push("爆款标题里经常出现数字，说明清单型和方法型内容更容易吸引点击");
  }
  if (titles.some((title) => /怎么|如何/.test(title))) {
    patterns.push("标题偏实操导向，用户更在意可执行的方法，而不是纯观点");
  }
  if (titles.some((title) => /避坑|踩坑|误区/.test(title))) {
    patterns.push("风险提醒和避坑类选题有明显吸引力，适合做经验总结");
  }
  if (!patterns.length) {
    patterns.push("现有爆款标题更分散，建议优先围绕实操、清单、复盘这三类方向测试");
  }
  return patterns;
}

function normalizeNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function generateTopics(params: {
  supabase: ReturnType<typeof createClient>;
  journeyId: string;
  userId: string;
  journey: ToolContextJourney | null;
  count: number;
  goal: string;
  timeframe: string;
}) {
  const [userMemory, journeyMemory, topArticlesRes] = await Promise.all([
    getUserMemory(params.supabase, params.userId),
    getJourneyMemory(params.supabase, params.journeyId),
    params.supabase
      .from("knowledge_articles")
      .select("title, read_count")
      .eq("journey_id", params.journeyId)
      .order("read_count", { ascending: false })
      .limit(8),
  ]);

  const references = (topArticlesRes.data ?? [])
    .map((item: { title: string; read_count: number | null }) => `- ${item.title} | 阅读 ${item.read_count ?? 0}`)
    .join("\n");

  const text = await llm.chat(
    "你是一个选题策划助手，只输出 JSON，不要任何额外解释。",
    `请基于以下信息，生成 ${params.count} 个适合当前用户的${params.goal}。

时间范围：${params.timeframe}
赛道：${params.journey?.niche_level2 ?? "未知赛道"}

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【知识库中的高阅读文章】
${references || "暂无"}

返回 JSON：
{
  "topics": [
    {
      "index": 1,
      "title": "选题标题",
      "angle": "切入角度",
      "why_fit_user": "为什么适合这个用户",
      "why_now": "为什么现在值得写",
      "reference_titles": ["参考标题1", "参考标题2"]
    }
  ]
}`
  );

  const parsed = safeParseJson<TopicToolResult>(text);
  if (parsed?.topics?.length) return parsed;

  return {
    topics: [],
  };
}

async function generateArticleDraft(params: {
  supabase: ReturnType<typeof createClient>;
  journeyId: string;
  userId: string;
  journey: ToolContextJourney | null;
  topicTitle: string;
  angle: string;
}) {
  const [userMemory, journeyMemory, knowledge] = await Promise.all([
    getUserMemory(params.supabase, params.userId),
    getJourneyMemory(params.supabase, params.journeyId),
    searchJourneyKnowledge(params.supabase, params.journeyId, params.topicTitle, 4),
  ]);

  const references = knowledge.articles
    .map((item) => `- ${item.title} | ${item.account_name} | 阅读 ${item.read_count}`)
    .join("\n");

  const draftMarkdown = await llm.chat(
    "你是一个公众号写作助手。输出必须是 Markdown 骨架稿，不要输出 JSON，不要解释。",
    `请围绕下面的选题，生成一篇公众号 Markdown 骨架稿。

赛道：${params.journey?.niche_level2 ?? "未知赛道"}
选题：${params.topicTitle}
切入角度：${params.angle || "从真实问题和可执行经验切入"}

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【可参考知识库文章】
${references || "暂无"}

要求：
1. 输出 Markdown
2. 只写骨架稿，不要写成完整长文
3. 必须包含：标题、导语、3-4 个主体小节、结尾总结、CTA
4. 风格直接、克制、像懂行朋友，不要空话
5. 排版适合公众号阅读`
  );

  return {
    title: params.topicTitle,
    draft_markdown: draftMarkdown,
  };
}

async function generateFullArticle(params: {
  supabase: ReturnType<typeof createClient>;
  journeyId: string;
  userId: string;
  journey: ToolContextJourney | null;
  topicTitle: string;
  angle: string;
  style: string;
}) {
  const [userMemory, journeyMemory, knowledge] = await Promise.all([
    getUserMemory(params.supabase, params.userId),
    getJourneyMemory(params.supabase, params.journeyId),
    searchJourneyKnowledge(params.supabase, params.journeyId, params.topicTitle, 5),
  ]);

  const references = knowledge.articles
    .map((item) => `- ${item.title} | ${item.account_name} | 阅读 ${item.read_count} | 摘要：${item.excerpt || "无"}`)
    .join("\n");

  const referenceNote = knowledge.articles.length
    ? `已参考知识库中的 ${knowledge.articles.length} 篇相关文章。`
    : "知识库暂无强相关参考，已按当前赛道和用户记忆生成，建议后续导入更多 KOC 文章增强案例。";

  const text = await llm.chat(
    "你是一个公众号主笔。只输出 JSON，不要任何额外解释，不要使用 Markdown 代码块。",
    `请围绕下面的选题，生成一篇可发布级公众号完整初稿。

赛道：${params.journey?.niche_level2 ?? "未知赛道"}
选题：${params.topicTitle}
切入角度：${params.angle || "从真实问题和可执行经验切入"}
文风：${params.style}
默认长度：1200-1800 字

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【可参考知识库文章】
${references || "暂无"}

写作要求：
1. 输出完整 Markdown 成稿，不是提纲
2. 结构采用：痛点开场 + 真实案例/现象 + 方法论拆解 + 行动清单 + 总结 CTA
3. 生成 1 个主标题和 5 个备选标题
4. 生成一段 80 字以内的公众号摘要
5. 正文中自然提到可参考案例标题；如果没有参考文章，不要伪造案例
6. 风格克制专业，可以有一点网感，但不要标题党、不要贩卖焦虑
7. 避免绝对化承诺，涉及收益、医疗、金融、政策时要保守表达

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
      title: parsed.title || params.topicTitle,
      summary: parsed.summary || "",
      title_options: Array.isArray(parsed.title_options) ? parsed.title_options.slice(0, 5) : [],
      article_markdown: parsed.article_markdown,
      reference_note: referenceNote,
    };
  }

  return {
    title: params.topicTitle,
    summary: "",
    title_options: [],
    article_markdown: text,
    reference_note: referenceNote,
  };
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

      const article = await generateFullArticle({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        topicTitle: topic.title,
        angle: topic.angle,
        style: "克制专业，可以有一点网感",
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "generate_full_article",
        label: toolLabel("generate_full_article"),
        payload: article,
      });

      await finalizeToolCallLog(params.supabase, toolLogId, {
        status: "success",
        result: article,
      });

      const response = formatFullArticleResponse(
        `你选了 **${topic.title}**，我按这个方向写了一版可发布级公众号完整初稿。`,
        article
      );
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

      const article = await generateFullArticle({
        supabase: params.supabase,
        journeyId: params.journeyId,
        userId: params.userId,
        journey: params.journey,
        topicTitle: result.title,
        angle: "",
        style: "克制专业，可以有一点网感",
      });

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "generate_full_article",
        label: toolLabel("generate_full_article"),
        payload: article,
      });

      await finalizeToolCallLog(params.supabase, toolLogId, {
        status: "success",
        result: article,
      });

      const response = formatFullArticleResponse(
        `收到，我已经把这次偏好记下来了，并基于 **${result.title}** 扩成一版完整公众号初稿。`,
        article
      );
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

      await emitEvent(params.controller, params.encoder, {
        type: "tool_result",
        toolName: "revise_full_article",
        label: toolLabel("revise_full_article"),
        payload: revised,
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

      const response = formatFullArticleResponse("我按你的修改意见重写了一版：", revised);
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

function formatFullArticleResponse(prefix: string, article: FullArticleToolResult) {
  const titleOptions = article.title_options.length
    ? article.title_options.map((title, index) => `${index + 1}. ${title}`).join("\n")
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

${article.article_markdown}

如果你想继续调，我可以按你的要求做：**更犀利一点、缩短一半、重写开头、换标题风格、改成保姆教程风**。`;
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
    case "search_koc_accounts":
      return "搜索 KOC";
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
    case "revise_full_article":
      return "修改完整稿";
    case "import_koc_articles":
      return "导入 KOC";
    default:
      return toolName;
  }
}

async function emitEvent(controller: ReadableStreamDefaultController, encoder: TextEncoder, payload: Record<string, unknown>) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

async function emitText(controller: ReadableStreamDefaultController, encoder: TextEncoder, text: string) {
  const chunks = text.match(/.{1,24}/g) ?? [text];
  for (const chunk of chunks) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: chunk })}\n\n`));
  }
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
