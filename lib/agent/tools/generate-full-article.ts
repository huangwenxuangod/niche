import { z } from "zod";
import { getJourneyMemory, getUserMemory } from "@/lib/memory";
import { searchJourneyKnowledge } from "@/lib/knowledge-base";
import { retrieveSemanticCompetitorContent } from "@/lib/agent/retrievers/semantic-knowledge";
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
  description: `
【功能】基于已确认选题生成可发布级公众号完整 Markdown 初稿

【触发关键词】写稿、成稿、完整稿、可发布、生成文章、写一篇

【调用前准备】确保已有明确的 topic_title

【功能说明】包含摘要、备选标题和正文

【参数】
- topic_title: 选题标题（必填）
- angle: 切入角度（可选）
- style: 文风（默认克制专业，略有网感）

【示例】
  ✅ "写一篇完整稿"
  ✅ "生成可发布文章"
  ✅ "基于XX选题写稿"
  ❌ "写一个选题" → 应先调用 generate_topics
`,
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

  const semanticReferences = await retrieveSemanticCompetitorContent(
    context.supabase,
    {
      journeyId: context.journeyId,
      query: buildSemanticArticleQuery(topicTitle, args.angle),
      limit: 6,
    }
  ).catch((error) => {
    console.warn("[generate-full-article] semantic retrieval failed:", error);
    return [];
  });

  const references = knowledge.articles
    .map((item) => `- ${item.title} | ${item.account_name} | 阅读 ${item.read_count} | 摘要：${item.excerpt || "无"}`)
    .join("\n");

  const semanticReferenceBlocks = semanticReferences
    .map(
      (item) =>
        `- ${item.account_name || "未知"}｜${item.article_title || "未命名文章"}｜相似度 ${item.similarity.toFixed(2)}｜片段：${trimSemanticChunk(item.chunk_text)}`
    )
    .join("\n");

  const referenceNote = knowledge.articles.length
    ? `已参考知识库中的 ${knowledge.articles.length} 篇相关文章${semanticReferences.length ? `，并补充 ${semanticReferences.length} 段高相关竞品片段` : ""}。`
    : semanticReferences.length
      ? `已补充 ${semanticReferences.length} 段高相关竞品片段作为写作参考。`
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

【语义相关竞品片段】
${semanticReferenceBlocks || "暂无"}

写作要求：
1. 输出完整 Markdown 成稿，不是提纲
2. 结构采用：痛点开场 + 真实案例/现象 + 方法论拆解 + 行动清单 + 总结 CTA
3. 生成 1 个主标题和 5 个备选标题
4. 生成一段 80 字以内的公众号摘要
5. 正文中自然提到可参考案例标题；如果没有参考文章，不要伪造案例
6. 风格克制专业，可以有一点网感，但不要标题党、不要贩卖焦虑
7. 避免绝对化承诺，涉及收益、医疗、金融、政策时要保守表达
8. 如果提供了语义相关竞品片段，优先学习这些片段的结构、表达节奏和讲解顺序，但不要照抄原句

返回 JSON：
{
  "title": "主标题",
  "summary": "公众号摘要",
  "title_options": ["备选标题1", "备选标题2", "备选标题3", "备选标题4", "备选标题5"],
  "article_markdown": "完整 Markdown 正文"
}`,
    { thinkingProfile: "deep" }
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

function buildSemanticArticleQuery(topicTitle: string, angle?: string) {
  return [topicTitle.trim(), String(angle || "").trim()].filter(Boolean).join("\n");
}

function trimSemanticChunk(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}
