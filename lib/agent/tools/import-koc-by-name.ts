import { z } from "zod";
import { importKocForJourney } from "@/lib/koc-import";
import { normalizeAccountName } from "@/lib/account-name";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const importKocByNameSchema = z.object({
  account_name: z.string().min(1).describe("纯公众号名称，不包含任何前缀/后缀（如'导入一下'、'这个号'等），必须只提取账号本身的名称"),
});

export const importKocByNameToolDefinition: AgentToolDefinition<typeof importKocByNameSchema> = {
  name: "import_koc_by_name",
  description: `导入对标账号到知识库。当用户说"对标 XXX""导入 XXX""添加 XXX"时，直接调用此工具。

重要使用规则：
- account_name 参数必须是纯公众号名称，不包含任何修饰词
- 例如：用户说"对标数字生命卡兹克"，提取 account_name 为 "数字生命卡兹克"
- 例如：用户说"导入一下量子位"，提取 account_name 为 "量子位"
- 例如：用户说"添加XX作为对标"，提取 account_name 为 "XX"
- 调用方式：调用大佳啦 post_history API，导入最近3篇文章样本到知识库`,
  schema: importKocByNameSchema,
};

/**
 * 清理公众号名称，移除常见的用户输入前缀和后缀
 */
function cleanAccountName(rawName: string): string {
  return normalizeAccountName(rawName) || rawName;
}

export async function runImportKocByName(
  args: z.infer<typeof importKocByNameSchema>,
  context: ToolExecutionContext
) {
  const cleanName = cleanAccountName(args.account_name);
  console.log(`[import_koc_by_name] Raw: "${args.account_name}" → Cleaned: "${cleanName}"`);

  return importKocForJourney(context.supabase, context.journeyId, cleanName, {
    sourceType: "explicit_benchmark",
  });
}
