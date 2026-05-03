import type { ChatIntent } from "./chat-intent-router";

export type ArticleMode = "normal" | "high_leverage_article";

export function isLookupSearchRequest(userContent: string) {
  const text = userContent.replace(/\s+/g, "");
  return /(搜索|搜一下|查一下|找一下|找找|最新新闻|最新动态|新闻|资讯|官网|官方|发布信息|更新日志|release|changelog)/i.test(
    text
  );
}

export function detectArticleMode(
  userContent: string,
  intent: ChatIntent
): ArticleMode {
  if (intent !== "full_article" && intent !== "general") return "normal";
  if (isLookupSearchRequest(userContent)) return "normal";
  const text = userContent.replace(/\s+/g, "");
  if (
    /(爆文|卡兹克|事件解读|深度长文|借.*写|模仿.*写|技术奇点|发布会|OpenAI|Claude|Gemma|DeepMind|workspaceagents|GPT-5\.5)/i.test(
      text
    )
  ) {
    return "high_leverage_article";
  }
  return "normal";
}

export function explicitlyWantsDirectDraft(userContent: string) {
  const text = userContent.replace(/\s+/g, "");
  return /(直接写|直接成稿|直接出稿|现在就写|现在直接写|不要继续分析|别再分析|不要继续挖|直接输出文章|直接给我全文)/.test(
    text
  );
}

export function explicitlyWantsDeepening(userContent: string) {
  const text = userContent.replace(/\s+/g, "");
  return /(继续深入|继续挖|继续分析|先别写|不要急着写|先想清楚|先提炼|继续拆|继续往下挖)/.test(
    text
  );
}
