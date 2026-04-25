import { z } from "zod";
import { dajiala } from "@/lib/dajiala";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const searchWechatHotArticlesSchema = z.object({
  keyword: z.string().min(1).describe("唯一的公众号搜索关键词短语，例如 Claude Code 新模型发布"),
  days: z.number().min(1).max(30).optional().describe("搜索最近几天，默认 7"),
});

export const searchWechatHotArticlesToolDefinition: AgentToolDefinition<typeof searchWechatHotArticlesSchema> = {
  name: "search_wechat_hot_articles",
  description: `
【功能】搜索公众号爆文与优质样本账号

【触发关键词】搜索、找、看看、爆文、爆款、优质

【不触发条件】
- "对标 XXX" → 应使用 import_koc_by_name
- "导入 XXX" → 应使用 import_koc_by_name
- "我的号"/"我的账号" → 应使用 analyze_my_account

【限制】只允许传入一个唯一关键词短语，不要拼两个 query

【参数】
- keyword: 唯一的公众号搜索关键词短语（如 "Claude code，gpt5.5发布"）
- days: 搜索最近几天，默认 7

【示例】
  ✅ " Claude Code 新模型"
  ✅ " AI"
  ❌ "对标数字生命卡兹克" → 应使用 import_koc_by_name
`,
  schema: searchWechatHotArticlesSchema,
};

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

export async function runSearchWechatHotArticles(
  args: z.infer<typeof searchWechatHotArticlesSchema>,
  context: ToolExecutionContext
) {
  void context;
  const keyword = String(args.keyword || "").trim();
  if (!keyword) {
    throw new Error("keyword is required");
  }

  const days = Number.isFinite(Number(args.days)) ? Math.max(1, Number(args.days)) : 7;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.max(days - 1, 0));

  const result = await dajiala.searchHotArticles(
    keyword,
    formatDate(startDate),
    formatDate(endDate),
    "0",
    "1"
  );
  const deduped = new Map<string, (typeof result.data)[number]>();

  for (const article of result.data ?? []) {
    const dedupeKey = article.wxid || article.url || article.title;
    if (!dedupeKey) continue;
    const existing = deduped.get(dedupeKey);
    if (!existing || (article.read_num || 0) > (existing.read_num || 0)) {
      deduped.set(dedupeKey, article);
    }
  }

  const articles = Array.from(deduped.values())
    .sort((left, right) => (right.read_num || 0) - (left.read_num || 0))
    .slice(0, 12);

  return {
    keyword,
    articles,
    searchPeriod: {
      start: formatDate(startDate),
      end: formatDate(endDate),
    },
  };
}
