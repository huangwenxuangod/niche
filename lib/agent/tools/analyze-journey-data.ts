import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

type AnalyzedArticle = {
  title: string | null;
  read_count: number | null;
  is_viral: boolean | null;
  publish_time: string | null;
};

export const analyzeJourneyDataSchema = z.object({
  focus: z
    .enum(["viral_patterns", "koc_summary", "topic_generation"])
    .optional()
    .describe("分析重点"),
});

export const analyzeJourneyDataToolDefinition: AgentToolDefinition<
  typeof analyzeJourneyDataSchema
> = {
  name: "analyze_journey_data",
  description: `
【功能】分析当前旅程下已有 KOC 和爆款文章

【触发关键词】爆款规律、标题套路、选题、分析对标、分析已导入

【不触发条件】
- "对标 XXX" → 应先调用 import_koc_by_name
- "搜索 XXX" → 应使用 search_wechat_hot_articles 或 search_knowledge_base

【调用建议】调用本工具后，如果用户还提到具体账号或案例，建议再调用 search_knowledge_base 获取详细文章内容做支撑

【参数】
- focus: 分析重点，可选值：viral_patterns（爆款规律）、koc_summary（KOC 总结）、topic_generation（选题生成）

【示例】
  ✅ "分析一下已导入对标账号的爆款规律"
  ✅ "总结对标账号的标题套路"
  ✅ "基于对标生成选题建议"
  ❌ "分析数字生命卡兹克" → 应先导入再分析
`,
  schema: analyzeJourneyDataSchema,
};

export async function runAnalyzeJourneyData(
  args: z.infer<typeof analyzeJourneyDataSchema>,
  context: ToolExecutionContext
) {
  const focus = String(args.focus || "viral_patterns");
  const { data: kocs } = await context.supabase
    .from("koc_sources")
    .select("account_name, max_read_count, avg_read_count")
    .eq("journey_id", context.journeyId)
    .order("max_read_count", { ascending: false })
    .limit(10);

  const { data: articles } = await context.supabase
    .from("knowledge_articles")
    .select("title, read_count, is_viral, publish_time")
    .eq("journey_id", context.journeyId)
    .order("read_count", { ascending: false })
    .limit(12);

  const titles = ((articles ?? []) as AnalyzedArticle[]).map((item) => item.title || "");
  const titlePatterns = summarizeTitlePatterns(titles);

  return {
    focus,
    koc_count: kocs?.length ?? 0,
    article_count: articles?.length ?? 0,
    top_kocs: (kocs ?? []).slice(0, 5),
    top_articles: (articles ?? []).slice(0, 6),
    patterns: titlePatterns,
  };
}

function summarizeTitlePatterns(titles: string[]) {
  const patterns: string[] = [];
  if (titles.some((title) => /\d/.test(title))) {
    patterns.push("爆款标题里经常出现数字，说明清单型和方法型内容更容易吸引点击");
  }
  if (titles.some((title) => /怎么|如何/.test(title))) {
    patterns.push("标题偏实操导向，用户更在意可执行的方法，而不是纯观点");
  }
  if (titles.some((title) => /避坑|踩坑|误区/.test(title))) {
    patterns.push("风险提醒和避坑类选题有明显吸引力，适合做经验总结");
  }
  if (!patterns.length) {
    patterns.push("现有爆款标题更分散，建议优先围绕实操、清单、复盘这三类方向测试");
  }
  return patterns;
}
