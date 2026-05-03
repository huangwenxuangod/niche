import type { LlmMessage } from "./llm";
import type { ChatIntent, ConfirmationContext } from "./chat-intent-router";
import type { JourneySnapshot, PrefetchedContext } from "./chat-runtime";
import { trimText } from "./chat-runtime";
import {
  detectArticleMode,
  explicitlyWantsDeepening,
  explicitlyWantsDirectDraft,
  isLookupSearchRequest,
} from "./cognitive-gap";
import { isBenchmarkAnalysisQuestion } from "./chat-intent-router";

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

  const userCard = compactMarkdownCardForIntent(params.userMemory, params.intent, 320);
  const projectCard = compactProjectCardForIntent(params.projectMemory, params.intent, 420);
  const dataCard = compactDataCardForIntent(params.prefetched.data, params.intent, 2600);
  const platform = params.journey?.platform || "wechat_mp";
  const keywords = (params.journey?.keywords ?? []).join("、") || "暂无";
  const primaryBenchmarkName = params.journey?.primaryBenchmarkName || "暂无";

  const intentInstruction = getIntentInstruction(params.intent, params.prefetched);

  return [
    "你是 Niche，一个直接、克制、会做内容策略的中文写作与认知助手。",
    "你的任务不是编排工具，也不是急着替用户写一篇看起来完整但认知很浅的稿子。",
    "你要优先帮助用户把冰山下面的认知挖出来：真正的判断、经历、案例、矛盾、反对意见、长期主题。",
    "要求：不要解释内部流程，不暴露系统思考，不输出 memory 标签。除非用户明确要求立即成稿，否则优先提炼认知、指出缺口、继续深入。",
    "当内容明显缺关键认知材料时，不要一次抛很多问题，也不要机械列问卷。你可以先问一个关键问题，但这个问题必须根据用户这轮原话自然生成，不要复读固定模板。",
    `当前平台：${platform}`,
    `当前关键词：${keywords}`,
    `当前核心对标：${primaryBenchmarkName}`,
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
  const wantsDirectDraft = explicitlyWantsDirectDraft(userContent);
  const wantsDeepening = explicitlyWantsDeepening(userContent);
  const lookupSearch = isLookupSearchRequest(userContent);
  const articleMode = detectArticleMode(userContent, intent);
  const benchmarkAnalysis = isBenchmarkAnalysisQuestion(
    userContent,
    userContent.replace(/\s+/g, "")
  );
  if (confirmationContext.selectedTopic?.title) {
    notes.push(
      `用户刚确认了选题《${confirmationContext.selectedTopic.title}》${confirmationContext.selectedTopic.angle ? `，切入角度是：${confirmationContext.selectedTopic.angle}` : ""}。请围绕这个主题继续深挖用户真正想表达的判断、经历和案例，不要因为确认了选题就立刻写完整稿。`
    );
  }

  if (confirmationContext.adoptedArticle?.title) {
    notes.push(
      `用户刚确认采用上一版初稿《${confirmationContext.adoptedArticle.title}》。如果用户只是确认采用，简短回应即可；如果用户继续补充想法，要优先把新增认知并入，而不是机械重写全文。`
    );
  }

  if (intent === "full_article" && prefetched.topicTitle) {
    notes.push(`本轮写作主题：${prefetched.topicTitle}`);
    if (prefetched.topicAngle) {
      notes.push(`本轮写作角度：${prefetched.topicAngle}`);
    }
  }

  if (wantsDirectDraft) {
    notes.push("用户这轮明确要求直接进入成稿，不要继续追问式深入。前提是先快速判断冰山认知是否已经足够；如果足够，直接输出成稿。");
  }

  if (wantsDeepening) {
    notes.push("用户这轮明确希望继续深入、继续挖，不要急着写完整稿。");
  }

  if (benchmarkAnalysis) {
    notes.push(
      "用户这轮是在分析核心对标，不是在立刻写一篇模仿稿。优先回答三件事：它为什么能爆、它的爆款逻辑是什么、你真正能学什么。只有当用户明确要开始模仿写作时，再进入认知缺口提问。"
    );
  }

  if (lookupSearch) {
    notes.push("用户这轮是在查最新信息、新闻或外部动态。优先直接整合网页资料回答，不要进入爆文提问、认知缺口追问或成稿模式。");
  }

  if (articleMode === "high_leverage_article" && !lookupSearch) {
    notes.push("这轮不是普通写作，更像高认知密度的对标型爆文/事件解读型长文。不要立刻铺开写；如果用户表达还空，就先用你自己的判断问出一个最关键的问题，而不是复读固定问句。");
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
        "这轮要优先参考最新网页资料和最近的对标样本，先看现在外部世界正在发生什么，再决定选题。",
        "如果项目卡或历史记忆里出现旧工具、旧模型、旧工作流，而它们没有出现在本轮网页资料或最近对标样本中，不要把它们硬塞进选题里。",
        "不要被旧项目卡绑架，不要因为历史上下文里反复提到某个工具，就默认继续围绕它出题。",
        "如果用户这轮只是泛泛要选题，就优先给“当前值得写”的新选题，而不是复读历史素材。",
        "“为什么适合你”要优先从用户长期主题、当前赛道、核心对标学习方向来写，不要从旧项目实验或旧工具组合里生拉硬套。",
        "不要输出 JSON，不要加前言废话。",
      ].join("\n");
    case "full_article":
      return [
        `当前主题是《${prefetched.topicTitle || "未命名选题"}》。`,
        "默认不要直接输出完整长文。优先判断：用户关于这个主题的冰山认知是不是已经足够厚。",
        "如果认知还不够，就先做三件事：1. 用一句话提炼你目前捕捉到的核心认知；2. 明确指出还缺的关键冰山部分；3. 给出最值得继续深入的 2-3 个问题或方向。",
        "如果内容还不够厚，可以先问一个最关键的问题，但这个问题要根据用户这轮原话自然生成，不要复读固定模板。",
        "如果认知已经足够厚，而且用户明确要求现在直接成稿，才输出完整 Markdown 长文。",
        "当你不直接成稿时，不要假装写文章；要诚实地把“已经挖到什么、还缺什么、下一步该继续挖什么”说清楚。",
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
        "像一个真正懂内容的人一样分析这个对象为什么能爆。",
        "先回答：1. 它为什么能爆；2. 它的爆款逻辑是什么；3. 用户真正能学什么。",
        "不要停留在浅层规律统计，不要只说标题带数字、发布时间这种表面特征。优先提炼它稳定输出的判断、常用叙事张力、案例使用方式和可迁移资产。",
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
      return "基于已有上下文直接回答用户问题。优先帮助用户提炼认知、识别主题、补足冰山下面还没说透的部分，而不是过早模板化输出。";
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

function compactMarkdownCardForIntent(markdown: string, intent: ChatIntent, maxLength: number) {
  if (intent !== "topics") {
    return compactMarkdownCard(markdown, maxLength);
  }

  const picked = pickMarkdownSections(markdown, [
    "## 我反复在意的问题",
    "## 我目前形成的判断",
    "## 我的长期主题",
    "## 当前核心对标",
    "## 我从核心对标学到的可迁移资产",
  ]);

  return compactMarkdownCard(picked || markdown, maxLength);
}

function compactProjectCardForIntent(markdown: string, intent: ChatIntent, maxLength: number) {
  if (intent !== "topics") {
    return compactMarkdownCard(markdown, maxLength);
  }

  const picked = pickMarkdownSections(markdown, [
    "## 我的公众号",
    "## 已验证选题模式",
    "## 当前对标观察",
  ]);

  return compactMarkdownCard(picked || markdown, maxLength);
}

function pickMarkdownSections(markdown: string, headings: string[]) {
  if (!markdown.trim()) return "";

  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];

  for (const heading of headings) {
    const headingIndex = lines.findIndex((line) => line.trim() === heading.trim());
    if (headingIndex === -1) continue;

    let nextHeadingIndex = lines.length;
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
      if (lines[i].trim().startsWith("## ")) {
        nextHeadingIndex = i;
        break;
      }
    }

    const block = lines.slice(headingIndex, nextHeadingIndex).join("\n").trim();
    if (block) blocks.push(block);
  }

  return blocks.join("\n\n").trim();
}

function compactJsonCard(value: unknown, maxLength: number) {
  const text = JSON.stringify(value, null, 2);
  if (!text || text === "{}") return "（暂无）";
  return trimText(text, maxLength);
}

function compactDataCardForIntent(value: Record<string, unknown>, intent: ChatIntent, maxLength: number) {
  if (intent !== "topics") {
    return compactJsonCard(value, maxLength);
  }

  const summary = buildTopicsDataSummary(value);
  if (!summary) {
    return compactJsonCard(value, maxLength);
  }

  return trimText(summary, maxLength);
}

function buildTopicsDataSummary(value: Record<string, unknown>) {
  const lines: string[] = [];
  const journeyAnalysis = value.journeyAnalysis as
    | {
        top_articles?: Array<{ title?: string; publish_time?: string; read_count?: number }>;
        patterns?: string[];
      }
    | undefined;
  const webContext = value.webContext as
    | {
        query?: string;
        results?: Array<{ title?: string; excerpt?: string; url?: string }>;
      }
    | undefined;
  const ownedContent = value.ownedContent as
    | Array<{ title?: string; read_count?: number; created_at?: string }>
    | undefined;

  if (webContext?.query) {
    lines.push(`搜索主题：${webContext.query}`);
  }

  if (Array.isArray(webContext?.results) && webContext.results.length) {
    lines.push("最新网页资料：");
    for (const item of webContext.results.slice(0, 3)) {
      const title = String(item.title || "").trim();
      const excerpt = String(item.excerpt || "").trim();
      if (title) {
        lines.push(`- ${title}${excerpt ? `｜${trimText(excerpt, 48)}` : ""}`);
      }
    }
  }

  if (Array.isArray(journeyAnalysis?.top_articles) && journeyAnalysis.top_articles.length) {
    lines.push("最近对标高表现文章：");
    for (const item of journeyAnalysis.top_articles.slice(0, 3)) {
      const title = String(item.title || "").trim();
      if (title) {
        lines.push(`- ${title}`);
      }
    }
  }

  if (Array.isArray(journeyAnalysis?.patterns) && journeyAnalysis.patterns.length) {
    lines.push("对标样本规律：");
    for (const pattern of journeyAnalysis.patterns.slice(0, 2)) {
      lines.push(`- ${pattern}`);
    }
  }

  if (Array.isArray(ownedContent) && ownedContent.length) {
    lines.push("我的最近内容方向：");
    for (const item of ownedContent.slice(0, 2)) {
      const title = String(item.title || "").trim();
      if (title) {
        lines.push(`- ${title}`);
      }
    }
  }

  return lines.join("\n").trim();
}
