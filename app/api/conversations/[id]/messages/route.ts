import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildFallbackMessage } from "@/lib/chat-output";
import { ensureJourneyProjectMemory, getUserMemory } from "@/lib/memory";
import { getSessionSteps } from "@/lib/agent/memory/session-memory";
import type { ToolExecutionContext } from "@/lib/agent/tools/types";
import {
  detectControlAction,
  detectIntent,
  getHistoryLimitForIntent,
} from "@/lib/chat-intent-router";
import {
  findLatestLayoutCandidate,
  findLatestLayoutCandidateFromState,
} from "@/lib/chat-workflow-state";
import { prefetchIntentContext } from "@/lib/chat-prefetch";
import { buildCompactPrompt, buildModelMessages } from "@/lib/chat-prompt";
import { createPerfLogger } from "@/lib/chat-perf";
import {
  buildDeterministicFallback,
  streamSingleModelAnswer,
} from "@/lib/chat-generation";
import {
  applyDeterministicMemoryUpdates,
  buildConfirmationContext,
  finalizeTurnMemory,
  recordIntentArtifacts,
} from "@/lib/chat-memory-finalize";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type JourneyRow = {
  id: string;
  platform: string | null;
  keywords: string[] | null;
};

type ConversationRow = {
  id: string;
  title: string;
  journey_id: string;
  journeys: JourneyRow | JourneyRow[] | null;
};

export async function POST(req: NextRequest, { params }: RouteContext) {
  const startTime = Date.now();
  const { id: conversationId } = await params;
  const { content } = await req.json();

  if (!conversationId || conversationId === "undefined") {
    return new Response("Conversation id is required", { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const perf = createPerfLogger(startTime);

      send({ type: "assistant_status", label: "理解问题中", elapsed: perf.elapsed() });

      try {
        const cookieStore = await cookies();
        const supabase = createClient(cookieStore);

        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        perf.mark("auth_ready");

        if (authError || !user) {
          throw new Error(authError?.message || "Unauthorized");
        }

        const { data: conv, error: convError } = await supabase
          .from("conversations")
          .select("id, title, journey_id, journeys(id, platform, keywords)")
          .eq("id", conversationId)
          .eq("user_id", user.id)
          .single();
        perf.mark("conversation_loaded");

        if (convError) {
          throw new Error(`Conversation query failed: ${convError.message}`);
        }
        if (!conv) {
          throw new Error("Conversation not found");
        }

        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "user",
          content,
        });
        perf.mark("user_message_saved");

        send({ type: "assistant_status", label: "整理上下文中", elapsed: perf.elapsed() });

        const sessionStepsBeforeTurn = await getSessionSteps(supabase, conversationId);
        perf.mark("session_loaded");

        const conversation = conv as ConversationRow;
        const conversationJourney = conversation.journeys;
        const journeyRow = Array.isArray(conversationJourney)
          ? (conversationJourney[0] ?? null)
          : (conversationJourney ?? null);
        const journey = journeyRow
          ? {
              keywords: journeyRow.keywords ?? undefined,
              platform: journeyRow.platform ?? undefined,
            }
          : null;

        const toolContext: ToolExecutionContext = {
          journeyId: conversation.journey_id,
          userId: user.id,
          supabase,
          journey,
          conversationId,
        };

        const confirmationContext = buildConfirmationContext(content, sessionStepsBeforeTurn);
        await applyDeterministicMemoryUpdates(
          supabase,
          conversation.journey_id,
          conversationId,
          confirmationContext
        );
        perf.mark("deterministic_memory_updates");

        const controlAction = detectControlAction(content);
        if (controlAction === "open_layout") {
          const layoutFromState = findLatestLayoutCandidateFromState(sessionStepsBeforeTurn);
          const recentMessagesRes = await supabase
            .from("messages")
            .select("id, role, content")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
            .limit(24);
          const layoutCandidate =
            layoutFromState && layoutFromState.content
              ? layoutFromState
              : findLatestLayoutCandidate(recentMessagesRes.data ?? []);
          send({
            type: "workflow_action",
            action: "open_layout",
            payload: layoutCandidate ?? {},
          });

          const layoutReply = layoutCandidate
            ? "我已经把最近一版完整稿交给排版工作台了，你可以直接开始调整样式。"
            : "我还没找到可排版的完整稿，先让我给你生成一版正文再进入排版。";

          const { data: assistantMessage, error: assistantMessageError } = await supabase
            .from("messages")
            .insert({
              conversation_id: conversationId,
              role: "assistant",
              content: layoutReply,
            })
            .select("id")
            .single();

          if (assistantMessageError) {
            throw new Error(
              `Create assistant message failed: ${assistantMessageError.message}`
            );
          }

          send({ type: "assistant_message", messageId: assistantMessage.id });
          send({ type: "assistant_status", label: "输出答案中", elapsed: perf.elapsed() });
          send({ type: "text", text: layoutReply });
          send({ type: "assistant_status", label: "已完成", elapsed: perf.elapsed() });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const intent = detectIntent(content, confirmationContext);
        const historyLimit = getHistoryLimitForIntent(intent);
        const historyRes = await supabase
          .from("messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(Math.max(historyLimit + 4, 6));
        perf.mark("context_loaded");

        const prefetched =
          intent === "fast_generation"
            ? { intent, data: {} }
            : await prefetchIntentContext({
                intent,
                userContent: content,
                confirmationContext,
                context: toolContext,
                send,
                perf,
              });
        perf.mark("prefetch_completed");

        const [userMemory, projectMemory] =
          intent === "fast_generation"
            ? ["", ""]
            : await Promise.all([
                getUserMemory(supabase, user.id),
                ensureJourneyProjectMemory(supabase, conversation.journey_id),
              ]);
        perf.mark("memory_cards_loaded");

        const systemPrompt = buildCompactPrompt({
          intent,
          journey,
          userMemory,
          projectMemory,
          prefetched,
        });

        const modelMessages = buildModelMessages({
          userContent: content,
          confirmationContext,
          intent,
          prefetched,
          history: (historyRes.data ?? []).slice(-historyLimit),
        });

        const { data: assistantMessage, error: assistantMessageError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: "",
          })
          .select("id")
          .single();

        if (assistantMessageError || !assistantMessage?.id) {
          throw new Error(
            `Create assistant message failed: ${
              assistantMessageError?.message || "unknown error"
            }`
          );
        }

        send({ type: "assistant_message", messageId: assistantMessage.id });
        send({ type: "assistant_status", label: "输出答案中", elapsed: perf.elapsed() });

        let finalAnswer = await streamSingleModelAnswer({
          systemPrompt,
          messages: modelMessages,
          send,
          getElapsed: () => perf.elapsed(),
        });
        perf.mark("single_model_stream_completed");

        if (!finalAnswer.trim()) {
          finalAnswer = buildDeterministicFallback(intent, prefetched, content);
          if (finalAnswer.trim()) {
            send({ type: "text", text: finalAnswer });
          }
          perf.mark("fallback_output_used");
        }

        const displayAnswer = finalAnswer.trim() || buildFallbackMessage(content);

        await supabase
          .from("messages")
          .update({ content: displayAnswer })
          .eq("id", assistantMessage.id);
        perf.mark("assistant_message_updated");

        await recordIntentArtifacts({
          supabase,
          conversationId,
          intent,
          answer: displayAnswer,
          prefetched,
          assistantMessageId: assistantMessage.id,
        });
        perf.mark("intent_artifacts_recorded");

        send({ type: "assistant_status", label: "已完成", elapsed: perf.elapsed() });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));

        void finalizeTurnMemory({
          supabase,
          conversationId,
          journeyId: conversation.journey_id,
          displayAnswer,
          confirmationContext,
        });
      } catch (error) {
        console.error("[messages.route] request failed", error);
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
