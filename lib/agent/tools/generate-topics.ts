import { z } from "zod";
import { getJourneyMemory, getUserMemory } from "@/lib/memory";
import { llm } from "@/lib/llm";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

type TopicToolResult = {
  topics: Array<{
    index: number;
    title: string;
    angle: string;
    why_fit_user: string;
    why_now: string;
    reference_titles: string[];
  }>;
};

export const generateTopicsSchema = z.object({
  count: z.number().optional().describe("选题数量，默认 3"),
  goal: z.string().optional().describe("例如公众号选题、本周选题"),
  timeframe: z.string().optional().describe("例如今天、本周"),
});

export const generateTopicsToolDefinition: AgentToolDefinition<typeof generateTopicsSchema> = {
  name: "generate_topics",
  description:
    "基于当前赛道、知识库和用户记忆生成 3 个适合当前用户的选题。建议在调用本工具前，先调用 search_hot_topics 和 analyze_journey_data 收集最新热点和爆款规律，这样生成的选题更有时效性和针对性。",
  schema: generateTopicsSchema,
};

export async function runGenerateTopics(
  args: z.infer<typeof generateTopicsSchema>,
  context: ToolExecutionContext
) {
  const count = Math.min(Number(args.count || 3), 5);
  const goal = String(args.goal || "公众号选题");
  const timeframe = String(args.timeframe || "本周");

  const [userMemory, journeyMemory, topArticlesRes] = await Promise.all([
    getUserMemory(context.supabase, context.userId),
    getJourneyMemory(context.supabase, context.journeyId),
    context.supabase
      .from("knowledge_articles")
      .select("title, read_count")
      .eq("journey_id", context.journeyId)
      .order("read_count", { ascending: false })
      .limit(8),
  ]);

  const references = (topArticlesRes.data ?? [])
    .map((item: { title: string; read_count: number | null }) => `- ${item.title} | 阅读 ${item.read_count ?? 0}`)
    .join("\n");

  const text = await llm.chat(
    "你是一个选题策划助手，只输出 JSON，不要任何额外解释。",
    `请基于以下信息，生成 ${count} 个适合当前用户的${goal}。

时间范围：${timeframe}
赛道：${context.journey?.niche_level2 ?? "未知赛道"}

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【知识库中的高阅读文章】
${references || "暂无"}

返回 JSON：
{
  "topics": [
    {
      "index": 1,
      "title": "选题标题",
      "angle": "切入角度",
      "why_fit_user": "为什么适合这个用户",
      "why_now": "为什么现在值得写",
      "reference_titles": ["参考标题1", "参考标题2"]
    }
  ]
}`,
    { thinkingProfile: "default" }
  );

  const parsed = safeParseJson<TopicToolResult>(text);
  if (parsed?.topics?.length) return parsed;

  return { topics: [] };
}

function safeParseJson<T>(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
