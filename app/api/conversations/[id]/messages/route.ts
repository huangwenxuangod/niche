import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { llm } from "@/lib/llm";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: conversationId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { content } = await req.json();

  // Verify conversation belongs to user
  const { data: conv } = await supabase
    .from("conversations")
    .select("*, journeys(*)")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .single();

  if (!conv) return new Response("Not found", { status: 404 });

  // Save user message
  await supabase.from("messages").insert({
    conversation_id: conversationId,
    role: "user",
    content,
  });

  // Load conversation history (last 20 messages)
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20);

  // Build system prompt with journey context
  const systemPrompt = await buildSystemPrompt(conv.journey_id, user.id, supabase);

  // Stream response
  const encoder = new TextEncoder();
  let fullContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messages = (history ?? []).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        await llm.streamChat({
          systemPrompt,
          messages,
          onChunk(text) {
            fullContent += text;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          },
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        // Save assistant message + auto-title conversation
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: fullContent,
        });

        // Auto-generate title on first assistant reply
        if (!conv.title || conv.title === "新对话" || conv.title === "第一次对话") {
          const title = fullContent.slice(0, 40).replace(/\n/g, " ");
          await supabase
            .from("conversations")
            .update({ title })
            .eq("id", conversationId);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: `\n\n[错误：${errMsg}]` })}\n\n`)
        );
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
