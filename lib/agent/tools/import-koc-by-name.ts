import { z } from "zod";
import { importKocForJourney } from "@/lib/koc-import";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const importKocByNameSchema = z.object({
  account_name: z.string().min(1).describe("明确的公众号名称"),
});

export const importKocByNameToolDefinition: AgentToolDefinition<typeof importKocByNameSchema> = {
  name: "import_koc_by_name",
  description: "当用户明确说出要对标的公众号名字时，直接导入该账号最近 3 篇文章样本到知识库。",
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
