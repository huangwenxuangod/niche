import { getStructuredOutputModel } from "@/lib/agent/models";
import { GrowthAnalysisReportSchema, type GrowthAnalysisStructuredOutput } from "@/lib/agent/schemas/growth-analysis";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

type TopArticleInput = {
  title: string;
  read_num: number;
  publish_time: string | null;
};

type CompetitorArticleInput = {
  title: string;
  read_count: number | null;
  account_name: string | null;
};

export async function runGrowthAnalysisChain(params: {
  journeyId: string;
  accountName: string;
  articleCount30d: number;
  avgRead: number;
  competitorAvgRead: number;
  postingPattern: string;
  ownTitlePattern: string;
  competitorTitlePattern: string;
  bestArticles: TopArticleInput[];
  competitorArticles: CompetitorArticleInput[];
}) {
  const model = getStructuredOutputModel("enabled").withStructuredOutput(
    GrowthAnalysisReportSchema,
    {
      name: "GrowthAnalysisReport",
      strict: true,
    }
  );

  const prompt = `你是一个微信公众号增长分析助手，请只基于给定数据输出结构化复盘结论。

【分析对象】
公众号：${params.accountName}
近 30 篇文章数：${params.articleCount30d}
平均阅读：${params.avgRead}
竞品平均阅读：${params.competitorAvgRead}
发文节奏：${params.postingPattern}
我的标题风格：${params.ownTitlePattern}
竞品标题风格：${params.competitorTitlePattern}

【我的高表现文章】
${params.bestArticles.map((item) => `- ${item.title} | 阅读 ${item.read_num} | 发布时间 ${item.publish_time || "未知"}`).join("\n")}

【竞品高表现文章】
${params.competitorArticles.map((item) => `- ${item.title} | ${item.account_name || "未知"} | 阅读 ${item.read_count ?? 0}`).join("\n")}

请遵循这些要求：
1. 结论必须可执行，不要空泛。
2. topic_gap / title_gap / structure_gap 每项给 2-4 条。
3. next_actions 给 3 条以内，必须可以直接执行。
4. top_articles 的 reason 要解释为什么它表现好。`;

  return model.invoke(prompt, buildAgentRunConfig({
    runName: "growth-analysis-report",
    tags: ["growth-analysis", "structured-output"],
    metadata: {
      journey_id: params.journeyId,
      account_name: params.accountName,
    },
  })) as Promise<GrowthAnalysisStructuredOutput>;
}
