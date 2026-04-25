import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";

export const complianceCheckSchema = z.object({
  title: z.string().describe("文章主标题"),
  summary: z.string().describe("文章摘要"),
  article_markdown: z.string().describe("文章 Markdown 正文"),
});

export const complianceCheckToolDefinition: AgentToolDefinition<typeof complianceCheckSchema> = {
  name: "compliance_check",
  description: `
【功能】检查公众号标题、摘要、正文、CTA 的平台合规风险和限流风险

【触发关键词】合规检查、风险检查、检查风险、限流风险、敏感词

【不触发条件】
- 仅用于已生成的文章内容，不用于生成内容
- 不用于搜索或检索

【输出】风险等级、替代表达、发布建议

【参数】
- title: 文章主标题
- summary: 文章摘要
- article_markdown: 文章 Markdown 正文

【示例】
  ✅ "检查这篇文章的合规性"
  ✅ "帮我看看有没有限流风险"
`,
  schema: complianceCheckSchema,
};
