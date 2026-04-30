import type { ChatIntent } from "./chat-intent-router.ts";

export type WorkflowPrefetchNode =
  | "journey_analysis"
  | "wxvideo_analysis"
  | "publish_timing"
  | "knowledge_refs"
  | "semantic_refs"
  | "import_koc";

export type WorkflowGenerationKind =
  | "topics_output"
  | "article_output"
  | "fast_generation_output"
  | "timing_output"
  | "growth_output"
  | "wxvideo_output"
  | "video_script_output"
  | "import_analysis_output"
  | "general_output";

export type WorkflowDefinition = {
  intent: ChatIntent;
  historyLimit: number;
  prefetch: WorkflowPrefetchNode[];
  generation: WorkflowGenerationKind;
};

export const CHAT_WORKFLOWS: Record<ChatIntent, WorkflowDefinition> = {
  topics: {
    intent: "topics",
    historyLimit: 2,
    prefetch: ["journey_analysis"],
    generation: "topics_output",
  },
  full_article: {
    intent: "full_article",
    historyLimit: 3,
    prefetch: ["journey_analysis", "knowledge_refs", "semantic_refs"],
    generation: "article_output",
  },
  fast_generation: {
    intent: "fast_generation",
    historyLimit: 1,
    prefetch: [],
    generation: "fast_generation_output",
  },
  publish_timing: {
    intent: "publish_timing",
    historyLimit: 2,
    prefetch: ["publish_timing"],
    generation: "timing_output",
  },
  growth_analysis: {
    intent: "growth_analysis",
    historyLimit: 4,
    prefetch: ["journey_analysis", "wxvideo_analysis", "publish_timing"],
    generation: "growth_output",
  },
  wxvideo_analysis: {
    intent: "wxvideo_analysis",
    historyLimit: 4,
    prefetch: ["wxvideo_analysis", "publish_timing"],
    generation: "wxvideo_output",
  },
  video_script: {
    intent: "video_script",
    historyLimit: 3,
    prefetch: ["wxvideo_analysis"],
    generation: "video_script_output",
  },
  import_koc_analysis: {
    intent: "import_koc_analysis",
    historyLimit: 4,
    prefetch: ["import_koc", "journey_analysis", "publish_timing"],
    generation: "import_analysis_output",
  },
  general: {
    intent: "general",
    historyLimit: 4,
    prefetch: [],
    generation: "general_output",
  },
};

export function getWorkflowForIntent(intent: ChatIntent) {
  return CHAT_WORKFLOWS[intent];
}
