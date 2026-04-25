import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const analyzeMyAccountSchema = z.object({
  account_name: z.string().min(1).describe("纯公众号名称，不包含任何前缀/后缀（如'我的号'、'分析一下'等），必须只提取账号本身的名称"),
});

export const analyzeMyAccountToolDefinition: AgentToolDefinition<typeof analyzeMyAccountSchema> = {
  name: "analyze_my_account",
  description: `
【功能】分析用户自己的公众号内容，生成增长分析报告

【触发关键词】我的号、我的账号、我的公众号、分析我的、增长分析

【不触发条件】
- "对标 XXX" → 应使用 import_koc_by_name
- "搜索 XXX" → 应使用 search_wechat_hot_articles

【功能说明】导入用户公众号最近的文章，分析标题模式、选题方向、发文节奏，对比竞品给出建议

【参数提取规则】account_name 必须是纯公众号名称：
- 移除前缀：分析、看看、帮我、我的、我的公众号、我的号、我的账号、一下
- 移除后缀：这个号、这个公众号、的公众号、的账号、公众号

【示例】
  用户: "分析一下我的号" → 先询问公众号名称
  用户: "分析我的公众号XX科技" → account_name="XX科技"
  用户: "帮我看看我的账号XX" → account_name="XX"
`,
  schema: analyzeMyAccountSchema,
};

/**
 * 清理公众号名称，移除常见的用户输入前缀和后缀
 */
function cleanAccountName(rawName: string): string {
  let cleaned = rawName.trim();

  // 移除常见前缀
  const prefixes = [
    /^分析一下?/,
    /^看看/,
    /^帮我分析/,
    /^我的公众号/,
    /^我的号/,
    /^我的账号/,
    /^我的/,
  ];
  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, "");
  }

  // 移除常见后缀
  const suffixes = [
    /这个号$/i,
    /这个公众号$/i,
    /的公众号$/i,
    /的账号$/i,
    /公众号$/i,
  ];
  for (const suffix of suffixes) {
    cleaned = cleaned.replace(suffix, "");
  }

  // 再次清理空格
  cleaned = cleaned.trim();

  return cleaned || rawName;
}

export async function runAnalyzeMyAccount(
  args: z.infer<typeof analyzeMyAccountSchema>,
  context: ToolExecutionContext
) {
  const cleanName = cleanAccountName(args.account_name);
  console.log(`[analyze_my_account] Raw: "${args.account_name}" → Cleaned: "${cleanName}"`);

  const { runOwnedWechatAnalysis } = await import("@/lib/wechat-owned-analysis");

  try {
    const result = await runOwnedWechatAnalysis({
      supabase: context.supabase,
      userId: context.userId,
      journeyId: context.journeyId,
      accountName: cleanName,
      wechatConfigId: null, // 使用已有的配置或仅通过名称分析
    });

    return {
      success: true,
      account_name: cleanName,
      article_count: result.articleCount,
      report: result.report,
      message: `已完成对公众号"${cleanName}"的增长分析：\n\n${result.report.message_for_chat}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "账号分析失败",
      hint: "请确认公众号名称是否正确，或者尝试重新分析。",
    };
  }
}
