import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";

export const complianceCheckSchema = z.object({
  title: z.string().describe("文章主标题"),
  summary: z.string().describe("文章摘要"),
  article_markdown: z.string().describe("文章 Markdown 正文"),
});

export const complianceCheckToolDefinition: AgentToolDefinition<typeof complianceCheckSchema> = {
  name: "compliance_check",
  description:
    "检查公众号标题、摘要、正文、CTA 的平台合规风险和限流风险，并给出替代表达",
  schema: complianceCheckSchema,
};
