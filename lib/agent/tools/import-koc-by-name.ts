import { z } from "zod";
import { importKocForJourney } from "@/lib/koc-import";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const importKocByNameSchema = z.object({
  account_name: z.string().min(1).describe("明确的公众号名称"),
});

export const importKocByNameToolDefinition: AgentToolDefinition<typeof importKocByNameSchema> = {
  name: "import_koc_by_name",
  description: `通过公众号名称导入对标账号，需要识别出公众号名称这一关键词，支持参数：name（公众号名称），并且导入该账号最近3篇文章样本到知识库

重要说明：
- 仅支持通过公众号名称查询
- 如需使用 biz 或 url 方式，请使用其他导入方式
- 调用方式：调用大佳啦 post_history API`,
  schema: importKocByNameSchema,
};

export async function runImportKocByName(
  args: z.infer<typeof importKocByNameSchema>,
  context: ToolExecutionContext
) {
  return importKocForJourney(context.supabase, context.journeyId, args.account_name, {
    sourceType: "explicit_benchmark",
  });
}
