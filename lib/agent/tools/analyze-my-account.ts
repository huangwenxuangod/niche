import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const analyzeMyAccountSchema = z.object({
  account_name: z.string().min(1).describe("纯公众号名称，不包含任何前缀/后缀（如'我的号'、'分析一下'等），必须只提取账号本身的名称"),
});

export const analyzeMyAccountToolDefinition: AgentToolDefinition<typeof analyzeMyAccountSchema> = {
  name: "analyze_my_account",
  description: `分析用户自己的公众号内容，生成增长分析报告。

重要使用规则：
- account_name 参数必须是纯公众号名称，不包含任何修饰词
- 例如：用户说"分析一下我的号"或"帮我看看我的账号"，需要先询问用户的公众号名称
- 例如：用户说"分析我的公众号XX科技"，提取 account_name 为 "XX科技"
- 功能：导入用户公众号最近的文章，分析标题模式、选题方向、发文节奏，对比竞品给出建议`,
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