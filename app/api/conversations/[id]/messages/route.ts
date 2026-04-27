import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { streamChat, type LlmMessage } from "@/lib/llm";
import { getUserMemory } from "@/lib/memory";
import { recordStep } from "@/lib/agent/memory";

// Tool definitions for the LLM
const tools = [
  {
    type: "function" as const,
    function: {
      name: "search_hot_topics",
      description: "搜索当前赛道近几天热点",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          days: { type: "number" },
          max_results: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_wechat_hot_articles",
      description: "用关键词搜索公众号爆文，找优质账号样本",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          days: { type: "number" },
          max_results: { type: "number" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "import_koc_by_name",
      description: "导入明确账号名的对标账号到知识库",
      parameters: {
        type: "object",
        properties: {
          account_name: { type: "string" },
        },
        required: ["account_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_topics",
      description: "基于赛道、知识库和记忆生成候选选题",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number" },
          goal: { type: "string" },
          timeframe: { type: "string" },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_full_article",
      description: "生成可发布级公众号完整初稿",
      parameters: {
        type: "object",
        properties: {
          topic_title: { type: "string" },
          angle: { type: "string" },
          style: { type: "string" },
        },
        required: ["topic_title"],
      },
    },
  },
];

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const { id: conversationId, content } = await req.json();

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Fetch conversation and journey data
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, title, journey_id, journeys(*)")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .single();

  if (!conv) return new Response("Not found", { status: 404 });

  // Save user message
  await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content });

  // Load message history
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(24);

  // Build system prompt with KOC data and memory
  const systemPrompt = await buildSystemPrompt(
    conv.journey_id,
    user.id,
    supabase,
    conversationId
  );

  // Convert history to LLM messages format
  const messages: LlmMessage[] = (history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Create streaming response with true async iteration
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send immediate acknowledgment - first byte within 50ms
      controller.enqueue(
        encoder.encode(JSON.stringify({
          type: "status",
          label: "思考中...",
          elapsed: Date.now() - startTime
        }) + "\n")
      );

      try {
        // Stream from LLM with true async iteration
        for await (const chunk of streamChat({
          systemPrompt,
          messages,
          tools
        })) {
          // Stream each chunk immediately to client
          controller.enqueue(
            encoder.encode(JSON.stringify(chunk) + "\n")
          );

          // Record tool calls to session memory
          if (chunk.type === "tool_call" && conversationId) {
            await recordStep(supabase, conversationId, {
              id: crypto.randomUUID(),
              type: "tool_call",
              content: chunk,
            });
          }
        }
      } catch (error) {
        // Stream error to client
        controller.enqueue(
          encoder.encode(JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown error"
          }) + "\n")
        );
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
