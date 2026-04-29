import { buildFallbackMessage } from "./chat-output.ts";
import type { ChatIntent } from "./chat-intent-router.ts";
import type { PrefetchedContext } from "./chat-runtime.ts";
import type { LlmMessage } from "./llm.ts";

export async function streamSingleModelAnswer(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  send: (payload: Record<string, unknown>) => void;
}) {
  let text = "";
  const { streamChat } = await import("./llm.ts");

  for await (const chunk of streamChat({
    systemPrompt: params.systemPrompt,
    messages: params.messages,
  })) {
    if (chunk.type === "text" && chunk.content) {
      text += chunk.content;
      params.send({ type: "text", text: chunk.content });
    }
  }

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
