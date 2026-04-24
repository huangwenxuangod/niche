import { z } from "zod";
import { searchJourneyKnowledge } from "@/lib/knowledge-base";
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
  description:
    "从当前旅程已导入到 Supabase 的文章知识库中检索相关文章、标题和案例。如果用户同时问热点或趋势，建议本工具与 search_hot_topics 配合使用：先搜知识库已有案例，再搜最新热点，综合给出建议。",
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

  return searchJourneyKnowledge(context.supabase, context.journeyId, query, limit, {
    accountNames: Array.isArray(args.account_names)
      ? args.account_names.map((item) => String(item)).filter(Boolean)
      : undefined,
  });
}
