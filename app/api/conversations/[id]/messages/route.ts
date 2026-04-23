import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { llm, type LlmMessage, type LlmTool } from "@/lib/llm";
import { tavilySearch } from "@/lib/tavily";
import { dajiala } from "@/lib/dajiala";

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

  const { data: userMessage } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      content,
    })
    .select("id")
    .single();

  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

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

        for (let step = 0; step < 3; step++) {
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
                supabase,
                journey: (conv.journeys ?? null) as ToolContextJourney | null,
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
  supabase,
  journey,
}: {
  toolName: string;
  args: Record<string, unknown>;
  journeyId: string;
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
