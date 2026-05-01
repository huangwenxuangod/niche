import { z } from "zod";
import { getUserMemory } from "@/lib/memory";
import { chat } from "@/lib/llm";
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
  description: `
【功能】基于当前赛道、知识库和用户记忆生成适合当前用户的选题

【触发关键词】选题、推荐选题、给我选题、生成选题

【调用建议】建议在调用本工具前，先补网页资料（web_search）并分析对标样本（analyze_journey_data）

【参数】
- count: 选题数量，默认 3
- goal: 选题目标（如公众号选题、本周选题）
- timeframe: 时间范围（如今天、本周）

【示例】
  ✅ "给我3个选题"
  ✅ "推荐本周的选题"
  ✅ "生成公众号选题"
`,
  schema: generateTopicsSchema,
};

export async function runGenerateTopics(
  args: z.infer<typeof generateTopicsSchema>,
  context: ToolExecutionContext
) {
  const count = Math.min(Number(args.count || 3), 5);
  const goal = String(args.goal || "公众号选题");
  const timeframe = String(args.timeframe || "本周");

  const [userMemory, topArticlesRes] = await Promise.all([
    getUserMemory(context.supabase, context.userId),
    context.supabase
      .from("knowledge_articles")
      .select("title, read_count")
      .eq("journey_id", context.journeyId)
      .order("read_count", { ascending: false })
      .limit(8),
  ]);

  const compactMemory = compactUserMemory(userMemory);
  const topArticles = (topArticlesRes.data ?? []).slice(0, 5);
  const references = topArticles
    .map(
      (item: { title: string; read_count: number | null }) =>
        `- ${trimText(item.title, 36)} | 阅读 ${item.read_count ?? 0}`
    )
    .join("\n");

  const text = await chat({
    systemPrompt:
      "你是一个选题策划助手。只输出合法 JSON，不要 markdown，不要解释，不要思考过程。",
    userContent: `请生成 ${count} 个适合当前用户的${goal}。

时间范围：${timeframe}
平台：${context.journey?.platform || "公众号"}
赛道关键词：${(context.journey?.keywords ?? []).join("、") || "暂无"}

【用户记忆】
${compactMemory || "暂无"}

【高阅读参考标题】
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
  });

  const parsed = safeParseJson<TopicToolResult>(text);
  if (parsed?.topics?.length) return parsed;

  return { topics: buildDeterministicTopics({ count, timeframe, topArticles, journeyKeywords: context.journey?.keywords ?? [] }) };
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

function compactUserMemory(memory: string) {
  return trimText(
    memory
      .replace(/^#.*$/gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim(),
    600
  );
}

function trimText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function buildDeterministicTopics(params: {
  count: number;
  timeframe: string;
  topArticles: Array<{ title: string; read_count: number | null }>;
  journeyKeywords: string[];
}): TopicToolResult["topics"] {
  const baseKeyword =
    params.journeyKeywords.find((item) => item && item.trim())?.trim() || "AI工具";
  const articleTitles = params.topArticles.map((item) => item.title).filter(Boolean);
  const templates = [
    {
      title: `${params.timeframe}可做：${baseKeyword}最值得试的3种实操用法`,
      angle: `从真实使用场景切入，讲清楚 ${baseKeyword} 在内容生产或效率提升里的具体价值`,
    },
    {
      title: `实测复盘：${baseKeyword}怎么帮普通人更快做出结果`,
      angle: `用实测和案例拆解 ${baseKeyword} 的具体收益，避免空泛介绍`,
    },
    {
      title: `${baseKeyword}现在最容易出圈的5个内容切口`,
      angle: `从选题角度整理 ${baseKeyword} 当前更容易被点击、收藏和转发的方向`,
    },
  ];

  return templates.slice(0, params.count).map((item, index) => ({
    index: index + 1,
    title: item.title,
    angle: item.angle,
    why_fit_user: `贴合当前旅程关键词“${baseKeyword}”，更容易和你已有的内容方向保持一致。`,
    why_now: `这类内容在${params.timeframe}更容易结合近期工具更新、真实案例或效率需求切入。`,
    reference_titles: articleTitles.slice(0, 2),
  }));
}
