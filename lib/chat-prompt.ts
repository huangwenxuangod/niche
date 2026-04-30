import type { LlmMessage } from "./llm";
import type { ChatIntent, ConfirmationContext } from "./chat-intent-router";
import type { JourneySnapshot, PrefetchedContext } from "./chat-runtime";
import { trimText } from "./chat-runtime";

export function buildCompactPrompt(params: {
  intent: ChatIntent;
  journey: JourneySnapshot;
  userMemory: string;
  projectMemory: string;
  prefetched: PrefetchedContext;
}) {
  if (params.intent === "fast_generation") {
    return [
      "你是 Niche，一个中文写作助手。",
      "直接开始完成用户要的内容，不解释过程，不复述任务。",
      "不要先说“好的”“下面是”“这里有一篇”。",
      "第一行就进入正文、改写结果或用户要的最终内容。",
    ].join("\n");
  }

  const userCard = compactMarkdownCard(params.userMemory, 320);
  const projectCard = compactMarkdownCard(params.projectMemory, 420);
  const dataCard = compactJsonCard(params.prefetched.data, 2600);
  const platform = params.journey?.platform || "wechat_mp";
  const keywords = (params.journey?.keywords ?? []).join("、") || "暂无";

  const intentInstruction = getIntentInstruction(params.intent, params.prefetched);

  return [
    "你是 Niche，一个直接、克制、会做内容策略的中文内容增长助手。",
    "你的任务不是编排工具，而是基于已经准备好的数据，直接生成最终可用答案。",
    "要求：只回答用户真正要的结果，不解释内部流程，不暴露系统思考，不输出 memory 标签。",
    `当前平台：${platform}`,
    `当前关键词：${keywords}`,
    "",
    "【用户卡】",
    userCard,
    "",
    "【项目卡】",
    projectCard,
    "",
    "【已准备的数据】",
    dataCard,
    "",
    "【本轮目标】",
    intentInstruction,
  ].join("\n");
}

export function buildModelMessages(params: {
  userContent: string;
  confirmationContext: ConfirmationContext;
  intent: ChatIntent;
  prefetched: PrefetchedContext;
  history: Array<{ role: string; content: string }>;
}): LlmMessage[] {
  const recentHistory = params.history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-4)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: trimText(message.content, 600),
    }));

  const finalUserPrompt = buildUserPromptContent(
    params.userContent,
    params.confirmationContext,
    params.intent,
    params.prefetched
  );

  return [
    ...recentHistory,
    {
      role: "user",
      content: finalUserPrompt,
    },
  ];
}

function buildUserPromptContent(
  userContent: string,
  confirmationContext: ConfirmationContext,
  intent: ChatIntent,
  prefetched: PrefetchedContext
) {
  const notes: string[] = [];

  if (confirmationContext.selectedTopic?.title) {
    notes.push(
      `用户刚确认了选题《${confirmationContext.selectedTopic.title}》${confirmationContext.selectedTopic.angle ? `，切入角度是：${confirmationContext.selectedTopic.angle}` : ""}。请直接继续写稿。`
    );
  }

  if (confirmationContext.adoptedArticle?.title) {
    notes.push(
      `用户刚确认采用上一版初稿《${confirmationContext.adoptedArticle.title}》。请简短确认，不要重新写全文。`
    );
  }

  if (intent === "full_article" && prefetched.topicTitle) {
    notes.push(`本轮写作主题：${prefetched.topicTitle}`);
    if (prefetched.topicAngle) {
      notes.push(`本轮写作角度：${prefetched.topicAngle}`);
    }
  }

  return [userContent, notes.length ? `【系统补充】\n${notes.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

function getIntentInstruction(intent: ChatIntent, prefetched: PrefetchedContext) {
  switch (intent) {
    case "topics":
      return [
        "直接输出 3 个可执行选题。",
        "格式固定：每个选题用 `### 1. 标题` 这种三级标题开头，然后依次给出“切入角度 / 为什么适合你 / 为什么现在值得写 / 参考标题”。",
        "不要输出 JSON，不要加前言废话。",
      ].join("\n");
    case "full_article":
      return [
        `直接输出完整 Markdown 长文，主题是《${prefetched.topicTitle || "未命名选题"}》。`,
        "格式固定：第一行 `# 标题`，第二行 `> 摘要`，后面直接是正文。",
        "不要输出“备选标题”“参考说明”“说明文字”，只给可排版正文。",
      ].join("\n");
    case "fast_generation":
      return [
        "直接完成用户要求的生成、改写、续写或润色。",
        "不要解释你要做什么，不要加开场白。",
        "如果用户要长文，直接从正文第一句开始写。",
      ].join("\n");
    case "publish_timing":
      return [
        "直接给发布时间建议。",
        "先给结论，再列 2-3 个最佳时间段，再说明样本是否足够。",
        "如果样本不够，明确说样本不足，不要硬编规律。",
      ].join("\n");
    case "growth_analysis":
      return [
        "像增长顾问一样给出结论。",
        "先回答“为什么起量 / 哪些规律最重要”，再给 3 条可执行建议。",
        "优先引用已准备数据里的规律，不要空泛谈方法论。",
      ].join("\n");
    case "wxvideo_analysis":
      return [
        "直接总结视频号样本的互动规律。",
        "先给结论，再列出高互动内容共性，最后补一句对公众号内容的启发。",
      ].join("\n");
    case "video_script":
      return [
        "基于已准备的视频号样本，直接输出一版可录制的视频脚本。",
        "格式：# 标题、## 开场钩子、## 主体脚本、## 结尾 CTA。",
        "正文要短句、口语化、适合口播。",
      ].join("\n");
    case "import_koc_analysis":
      return [
        "用户刚导入了对标账号，请直接给导入后的价值判断。",
        "先说这个号值不值得跟，再总结爆款规律，最后给 2 条最适合当前账号的学习建议。",
      ].join("\n");
    case "general":
    default:
      return "基于已有上下文直接回答用户问题，简洁、明确、有帮助。";
  }
}

function compactMarkdownCard(markdown: string, maxLength: number) {
  const cleaned = markdown
    .replace(/^#.*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (!cleaned) return "（暂无）";
  return trimText(cleaned, maxLength);
}

function compactJsonCard(value: unknown, maxLength: number) {
  const text = JSON.stringify(value, null, 2);
  if (!text || text === "{}") return "（暂无）";
  return trimText(text, maxLength);
}
