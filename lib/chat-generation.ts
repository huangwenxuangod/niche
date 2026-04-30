import { buildFallbackMessage } from "./chat-output.ts";
import type { ChatIntent } from "./chat-intent-router.ts";
import type { PrefetchedContext } from "./chat-runtime.ts";
import type { LlmMessage } from "./llm.ts";

export async function streamSingleModelAnswer(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  send: (payload: Record<string, unknown>) => void;
  getElapsed?: () => number;
}) {
  let text = "";
  let pending = "";
  let lastFlushAt = Date.now();
  let chunkIndex = 0;
  let firstTextAt: number | null = null;
  let lastTextAt: number | null = null;
  const { streamChat } = await import("./llm.ts");

  const flushPending = () => {
    if (!pending) return;
    const now = Date.now();
    if (firstTextAt === null) {
      firstTextAt = now;
    }
    chunkIndex += 1;
    const debug = {
      chunkIndex,
      emittedAt: now,
      elapsed: params.getElapsed?.() ?? null,
      sinceFirstText: now - firstTextAt,
      sincePrevText: lastTextAt === null ? null : now - lastTextAt,
      textLength: pending.length,
      preview: pending.slice(0, 32),
    };
    text += pending;
    console.info("[chat.stream][server_chunk]", debug);
    params.send({ type: "text", text: pending, debug });
    pending = "";
    lastFlushAt = Date.now();
    lastTextAt = now;
  };

  const shouldFlush = (chunkText: string) => {
    if (!pending) return false;
    if (pending.length >= 40) return true;
    if (/\n{2,}$/.test(pending)) return true;
    if (/[。！？!?：:\n]$/.test(pending) && pending.length >= 18) return true;
    if (Date.now() - lastFlushAt >= 80 && pending.length >= 12) return true;
    if (chunkText.startsWith("###") || chunkText.startsWith("####")) return true;
    return false;
  };

  for await (const chunk of streamChat({
    systemPrompt: params.systemPrompt,
    messages: params.messages,
  })) {
    if (chunk.type === "reasoning_start") {
      params.send({ type: "reasoning_start" });
      continue;
    }

    if (chunk.type === "reasoning_chunk" && chunk.content) {
      params.send({ type: "reasoning_chunk", text: chunk.content });
      continue;
    }

    if (chunk.type === "reasoning_end") {
      params.send({ type: "reasoning_end" });
      continue;
    }

    if (chunk.type === "text" && chunk.content) {
      pending += chunk.content;
      if (shouldFlush(chunk.content)) {
        flushPending();
      }
    }
  }

  flushPending();

  return text.trim();
}

export function buildDeterministicFallback(
  intent: ChatIntent,
  prefetched: PrefetchedContext,
  userContent: string
) {
  if (intent === "publish_timing") {
    const publishTiming = prefetched.data.publishTiming as
      | {
          best_slots?: Array<{
            weekday?: string;
            hour_range?: string;
            reason?: string;
          }>;
          patterns?: string[];
        }
      | undefined;
    if (publishTiming?.best_slots?.length) {
      return [
        "我先根据当前样本做了一版发布时间判断。",
        ...publishTiming.best_slots.slice(0, 3).map(
          (slot, index) =>
            `${index + 1}. **${slot.weekday || "未知"} ${slot.hour_range || ""}**：${slot.reason || "这个时段样本表现更强。"}`
        ),
        ...(publishTiming.patterns ?? []).slice(0, 2),
      ].join("\n\n");
    }
  }

  if (intent === "growth_analysis") {
    const journeyAnalysis = prefetched.data.journeyAnalysis as
      | { patterns?: string[] }
      | undefined;
    if (journeyAnalysis?.patterns?.length) {
      return [
        "我先基于当前已导入样本做了一版增长分析。",
        ...journeyAnalysis.patterns
          .slice(0, 3)
          .map((pattern, index) => `${index + 1}. ${pattern}`),
      ].join("\n\n");
    }
  }

  if (intent === "wxvideo_analysis" || intent === "video_script") {
    const wxvideoAnalysis = prefetched.data.wxvideoAnalysis as
      | { patterns?: string[]; migration_suggestion?: string }
      | undefined;
    if (wxvideoAnalysis?.patterns?.length) {
      return [
        "我已经先把当前视频号样本过了一遍。",
        ...wxvideoAnalysis.patterns
          .slice(0, 3)
          .map((pattern, index) => `${index + 1}. ${pattern}`),
        wxvideoAnalysis.migration_suggestion || "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  }

  return buildFallbackMessage(userContent);
}
