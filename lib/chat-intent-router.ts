import { getWorkflowForIntent } from "./chat-workflows.ts";

export type GeneratedTopic = {
  index?: number;
  title?: string;
  angle?: string;
  why_fit_user?: string;
  why_now?: string;
  reference_titles?: string[];
};

export type ConfirmationContext = {
  selectedTopic: GeneratedTopic | null;
  adoptedArticle: { title: string } | null;
  memoryFacts: string[];
};

export type ChatIntent =
  | "topics"
  | "full_article"
  | "fast_generation"
  | "publish_timing"
  | "growth_analysis"
  | "wxvideo_analysis"
  | "video_script"
  | "import_koc_analysis"
  | "general";

export type ControlAction = "open_layout" | null;

export function detectIntent(
  userContent: string,
  confirmationContext: ConfirmationContext
): ChatIntent {
  const normalized = userContent.replace(/\s+/g, "");

  if (confirmationContext.selectedTopic?.title) {
    return "full_article";
  }
  if (/视频脚本|短视频脚本|口播稿|口播脚本/.test(normalized)) {
    return "video_script";
  }
  if (/(写稿|成稿|完整稿|文章|公众号稿|长文)/.test(normalized)) {
    return "full_article";
  }
  if (isFastGenerationRequest(normalized)) {
    return "fast_generation";
  }
  if (/(几点发|什么时候发|发布时间|发文时间|什么时间发更容易起量)/.test(normalized)) {
    return "publish_timing";
  }
  if (/(视频号).*(分析|起量|互动|规律|迁移)/.test(normalized)) {
    return "wxvideo_analysis";
  }
  if (isGrowthAnalysisQuestion(normalized)) {
    return "growth_analysis";
  }
  if (extractExplicitAccountName(userContent)) {
    return "import_koc_analysis";
  }
  if (/(选题|题目|方向|写什么)/.test(normalized)) {
    return "topics";
  }
  return "general";
}

export function detectControlAction(userContent: string): ControlAction {
  const normalized = userContent.replace(/\s+/g, "");
  if (/^(排版|排版一下|去排版|帮我排版|打开排版|进入排版)$/.test(normalized)) {
    return "open_layout";
  }
  return null;
}

export function getHistoryLimitForIntent(intent: ChatIntent) {
  return getWorkflowForIntent(intent).historyLimit;
}

export function extractExplicitAccountName(userContent: string) {
  if (!/(对标|导入|添加)/.test(userContent)) {
    return null;
  }

  const match = userContent.match(/(?:对标|导入(?:一下)?|添加)([^，。！？\n]+)/);
  const candidate = match?.[1]?.trim() || userContent.trim();
  const cleaned = candidate
    .replace(/^(一下|一个|这个|这个号|这个公众号|账号)/, "")
    .replace(/(作为对标|做对标|这个号|这个公众号|公众号|账号)$/i, "")
    .trim();

  return cleaned.length >= 2 ? cleaned : null;
}

export function isGrowthAnalysisQuestion(normalizedText: string) {
  return /(增长规律|爆款规律|标题套路|为什么.*(起量|阅读量高|会爆)|高阅读.*原因|分析对标账号|增长分析)/.test(
    normalizedText
  );
}

export function isFastGenerationRequest(normalizedText: string) {
  return /(再说一遍|重写一下|改写一下|润色一下|换个风格|来个开头|写个开头|随便写|随意写|随意输出|任意风格|任何风格)/.test(
    normalizedText
  );
}
