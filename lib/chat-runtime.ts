import type { ChatIntent } from "./chat-intent-router.ts";

export type JourneySnapshot = {
  keywords?: string[];
  platform?: string | null;
} | null;

export type PrefetchedContext = {
  intent: ChatIntent;
  topicTitle?: string;
  topicAngle?: string;
  keyword?: string;
  data: Record<string, unknown>;
};

export type DeterministicToolName =
  | "analyze_journey_data"
  | "analyze_wxvideo_data"
  | "analyze_publish_timing"
  | "import_koc_by_name";

export type PerfLogger = {
  elapsed: () => number;
  mark: (stage: string) => void;
};

export function trimText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}
