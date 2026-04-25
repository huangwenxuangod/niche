import { z } from "zod";
import { retrieveCompetitorContent } from "@/lib/agent/retrievers/competitor-content";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const searchKnowledgeBaseSchema = z.object({
  query: z.string().describe("检索关键词，比如一个选题、概念或标题方向"),
  limit: z.number().optional().describe("返回结果数，默认 6"),
  account_names: z.array(z.string()).optional().describe("限定账号名范围"),
});

export const searchKnowledgeBaseToolDefinition: AgentToolDefinition<
  typeof searchKnowledgeBaseSchema
> = {
  name: "search_knowledge_base",
  description: `
【功能】从当前旅程已导入到 Supabase 的文章知识库中检索相关文章、标题和案例

【触发关键词】检索、找案例、找标题参考、找历史高表现、查看已有对标

【不触发条件】
- "对标 XXX" → 应先调用 import_koc_by_name
- "搜索 XXX" → 应使用 search_wechat_hot_articles（外部搜索）

【调用建议】如果用户同时问热点或趋势，建议本工具与 search_hot_topics 配合使用

【参数】
- query: 检索关键词（选题、概念、标题方向）
- limit: 返回结果数，默认 6
- account_names: 限定账号名范围（可选）

【示例】
  ✅ "检索关于 AI 的已导入文章"
  ✅ "找对标账号的标题参考"
  ✅ "查看已导入对标的高表现内容"
`,
  schema: searchKnowledgeBaseSchema,
};

export async function runSearchKnowledgeBase(
  args: z.infer<typeof searchKnowledgeBaseSchema>,
  context: ToolExecutionContext
) {
  const query = String(args.query || "").trim();
  if (!query) {
    throw new Error("Knowledge search query is required");
  }

  const limit = Math.min(Number(args.limit || 6), 10);

  return retrieveCompetitorContent(context.supabase, {
    journeyId: context.journeyId,
    query,
    limit,
    accountNames: Array.isArray(args.account_names)
      ? args.account_names.map((item) => String(item)).filter(Boolean)
      : undefined,
  });
}
