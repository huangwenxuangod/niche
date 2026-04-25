import { z } from "zod";
import { retrieveHotTopics } from "@/lib/agent/retrievers/hot-topics";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const searchHotTopicsSchema = z.object({
  query: z.string().describe("搜索关键词，优先使用当前赛道关键词"),
  days: z.number().optional().describe("搜索最近几天，默认 3"),
  max_results: z.number().optional().describe("返回结果数，默认 5"),
});

export const searchHotTopicsToolDefinition: AgentToolDefinition<typeof searchHotTopicsSchema> = {
  name: "search_hot_topics",
  description:
    "搜索当前赛道近 3 天热点，适合回答热点、趋势、选题相关问题。调用本工具后，通常还需要调用 search_knowledge_base 用热点关键词检索已有案例，或调用 analyze_journey_data 分析爆款规律，以提供更完整的建议。",
  schema: searchHotTopicsSchema,
};

function normalizeNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function runSearchHotTopics(
  args: z.infer<typeof searchHotTopicsSchema>,
  context: ToolExecutionContext
) {
  const query = String(
    args.query || context.journey?.keywords?.[0] || context.journey?.niche_level2 || ""
  );
  const maxResults = normalizeNumber(args.max_results, 5);
  const days = normalizeNumber(args.days, 3);

  return retrieveHotTopics({
    baseQuery: query,
    journey: context.journey
      ? {
          keywords: context.journey.keywords,
          niche_level1: context.journey.niche_level1 ?? undefined,
          niche_level2: context.journey.niche_level2 ?? undefined,
          niche_level3: context.journey.niche_level3 ?? undefined,
        }
      : null,
    maxResults,
    days,
  });
}
