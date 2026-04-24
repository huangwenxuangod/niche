import { z } from "zod";
import { getJourneyMemory, getUserMemory } from "@/lib/memory";
import { searchJourneyKnowledge } from "@/lib/knowledge-base";
import { llm } from "@/lib/llm";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

type FullArticleToolResult = {
  title: string;
  summary: string;
  title_options: string[];
  article_markdown: string;
  reference_note: string;
};

export const generateFullArticleSchema = z.object({
  topic_title: z.string().describe("选题标题"),
  angle: z.string().optional().describe("切入角度"),
  style: z.string().optional().describe("文风，默认克制专业、略有网感"),
});

export const generateFullArticleToolDefinition: AgentToolDefinition<
  typeof generateFullArticleSchema
> = {
  name: "generate_full_article",
  description:
    "基于已确认选题生成可发布级公众号完整 Markdown 初稿，包含摘要、备选标题和正文",
  schema: generateFullArticleSchema,
};

export async function runGenerateFullArticle(
  args: z.infer<typeof generateFullArticleSchema>,
  context: ToolExecutionContext
) {
  const topicTitle = String(args.topic_title || "").trim();
  if (!topicTitle) {
    throw new Error("topic_title is required");
  }

  const [userMemory, journeyMemory, knowledge] = await Promise.all([
    getUserMemory(context.supabase, context.userId),
    getJourneyMemory(context.supabase, context.journeyId),
    searchJourneyKnowledge(context.supabase, context.journeyId, topicTitle, 5),
  ]);

  const references = knowledge.articles
    .map((item) => `- ${item.title} | ${item.account_name} | 阅读 ${item.read_count} | 摘要：${item.excerpt || "无"}`)
    .join("\n");

  const referenceNote = knowledge.articles.length
    ? `已参考知识库中的 ${knowledge.articles.length} 篇相关文章。`
    : "知识库暂无强相关参考，已按当前赛道和用户记忆生成，建议后续导入更多 KOC 文章增强案例。";

  const text = await llm.chat(
    "你是一个公众号主笔。只输出 JSON，不要任何额外解释，不要使用 Markdown 代码块。",
    `请围绕下面的选题，生成一篇可发布级公众号完整初稿。

赛道：${context.journey?.niche_level2 ?? "未知赛道"}
选题：${topicTitle}
切入角度：${String(args.angle || "从真实问题和可执行经验切入")}
文风：${String(args.style || "克制专业，可以有一点网感")}
默认长度：1200-1800 字

【用户记忆】
${userMemory || "暂无"}

【旅程记忆】
${journeyMemory || "暂无"}

【可参考知识库文章】
${references || "暂无"}

写作要求：
1. 输出完整 Markdown 成稿，不是提纲
2. 结构采用：痛点开场 + 真实案例/现象 + 方法论拆解 + 行动清单 + 总结 CTA
3. 生成 1 个主标题和 5 个备选标题
4. 生成一段 80 字以内的公众号摘要
5. 正文中自然提到可参考案例标题；如果没有参考文章，不要伪造案例
6. 风格克制专业，可以有一点网感，但不要标题党、不要贩卖焦虑
7. 避免绝对化承诺，涉及收益、医疗、金融、政策时要保守表达

返回 JSON：
{
  "title": "主标题",
  "summary": "公众号摘要",
  "title_options": ["备选标题1", "备选标题2", "备选标题3", "备选标题4", "备选标题5"],
  "article_markdown": "完整 Markdown 正文"
}`
  );

  const parsed = safeParseJson<Omit<FullArticleToolResult, "reference_note">>(text);
  if (parsed?.article_markdown) {
    return {
      title: parsed.title || topicTitle,
      summary: parsed.summary || "",
      title_options: Array.isArray(parsed.title_options) ? parsed.title_options.slice(0, 5) : [],
      article_markdown: parsed.article_markdown,
      reference_note: referenceNote,
    };
  }

  return {
    title: topicTitle,
    summary: "",
    title_options: [],
    article_markdown: text,
    reference_note: referenceNote,
  };
}

function safeParseJson<T>(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
