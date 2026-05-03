import {
  appendJourneyProjectMemoryItems,
  compactAndSaveJourneyProjectMemory,
  compactAndSaveUserMemory,
} from "@/lib/memory";
import { recordStep, type StepRecord } from "@/lib/agent/memory/session-memory";
import type { ToolExecutionContext } from "@/lib/agent/tools/types";
import type { ConfirmationContext, GeneratedTopic } from "./chat-intent-router";
import type { ChatIntent } from "./chat-intent-router";
import type { PrefetchedContext } from "./chat-runtime";
import {
  findLatestFullArticleState,
  findLatestPublishTimingState,
  findLatestTopicsState,
  findLatestToolResult,
  recordWorkflowState,
} from "./chat-workflow-state";

export async function applyDeterministicMemoryUpdates(
  supabase: ToolExecutionContext["supabase"],
  journeyId: string,
  conversationId: string,
  confirmationContext: ConfirmationContext
) {
  if (confirmationContext.selectedTopic?.title) {
    const topicLine = confirmationContext.selectedTopic.angle
      ? `${confirmationContext.selectedTopic.title}｜角度：${confirmationContext.selectedTopic.angle}`
      : confirmationContext.selectedTopic.title;

    await appendJourneyProjectMemoryItems(
      supabase,
      journeyId,
      "## 已验证选题模式",
      [topicLine]
    );

    await recordStep(supabase, conversationId, {
      id: crypto.randomUUID(),
      type: "observation",
      content: {
        tool: "memory",
        confirmation: "topic_selected",
        topic: confirmationContext.selectedTopic.title,
      },
    });
  }

  if (confirmationContext.adoptedArticle?.title) {
    await appendJourneyProjectMemoryItems(
      supabase,
      journeyId,
      "## 当前策略卡片",
      [`已采纳初稿：《${confirmationContext.adoptedArticle.title}》`]
    );

    await recordStep(supabase, conversationId, {
      id: crypto.randomUUID(),
      type: "observation",
      content: {
        tool: "memory",
        confirmation: "article_adopted",
        title: confirmationContext.adoptedArticle.title,
      },
    });
  }
}

export async function finalizeTurnMemory(params: {
  supabase: ToolExecutionContext["supabase"];
  userId: string;
  conversationId: string;
  journeyId: string;
  userContent: string;
  intent: ChatIntent;
  displayAnswer: string;
  confirmationContext: ConfirmationContext;
}) {
  try {
    await recordStep(params.supabase, params.conversationId, {
      id: crypto.randomUUID(),
      type: "reflection",
      content: {
        answerPreview: params.displayAnswer.slice(0, 240),
        memoryFacts: params.confirmationContext.memoryFacts,
      },
    });

    if (params.confirmationContext.memoryFacts.length) {
      await appendJourneyProjectMemoryItems(
        params.supabase,
        params.journeyId,
        "## 当前增长假设",
        params.confirmationContext.memoryFacts
      );
    }

    const conversationMarkdown = buildMemoryTranscript({
      userContent: params.userContent,
      assistantContent: params.displayAnswer,
      intent: params.intent,
      confirmationContext: params.confirmationContext,
    });

    await Promise.all([
      compactAndSaveUserMemory(
        params.supabase,
        params.userId,
        conversationMarkdown
      ),
      compactAndSaveJourneyProjectMemory(
        params.supabase,
        params.journeyId,
        conversationMarkdown
      ),
    ]);
  } catch (error) {
    console.warn("[messages.route] finalize memory failed", error);
  }
}

export async function recordIntentArtifacts(params: {
  supabase: ToolExecutionContext["supabase"];
  conversationId: string;
  intent: ChatIntent;
  answer: string;
  prefetched: PrefetchedContext;
  assistantMessageId?: string;
}) {
  if (params.intent === "topics") {
    const topics = parseGeneratedTopics(params.answer);
    if (topics.length) {
      await recordStep(params.supabase, params.conversationId, {
        id: crypto.randomUUID(),
        type: "observation",
        content: {
          tool: "generate_topics",
          result: { topics },
        },
      });
      await recordWorkflowState(params.supabase, params.conversationId, "latest_topics", {
        topics,
      });
    }
    return;
  }

  if (params.intent === "full_article") {
    const title = parseArticleTitle(params.answer);
    if (!title) {
      return;
    }
    await recordStep(params.supabase, params.conversationId, {
      id: crypto.randomUUID(),
      type: "observation",
      content: {
        tool: "generate_full_article",
        result: { title },
      },
    });
    await recordWorkflowState(
      params.supabase,
      params.conversationId,
      "latest_full_article",
      {
        title,
        content: params.answer,
        messageId: params.assistantMessageId,
      }
    );
    return;
  }

  if (params.intent === "publish_timing") {
    const publishTiming = params.prefetched.data.publishTiming as
      | {
          best_slots?: Array<{
            weekday?: string;
            hour_range?: string;
            reason?: string;
          }>;
          patterns?: string[];
        }
      | undefined;

    await recordWorkflowState(
      params.supabase,
      params.conversationId,
      "latest_publish_timing",
      {
        summary: params.answer.slice(0, 400),
        best_slots: publishTiming?.best_slots?.slice(0, 3) ?? [],
        patterns: publishTiming?.patterns?.slice(0, 3) ?? [],
      }
    );
  }
}

export function buildConfirmationContext(
  userContent: string,
  sessionSteps: StepRecord[]
): ConfirmationContext {
  const latestTopicsState = findLatestTopicsState(sessionSteps);
  const selectedTopic = detectTopicSelection(
    userContent,
    latestTopicsState ?? findLatestToolResult<{ topics?: GeneratedTopic[] }>(sessionSteps, "generate_topics")
  );
  const latestArticleState = findLatestFullArticleState(sessionSteps);
  const latestArticle =
    latestArticleState ??
    findLatestToolResult<{ title?: string }>(sessionSteps, "generate_full_article");
  const adoptedArticle = detectArticleAcceptance(userContent, latestArticle);

  const latestPublishTiming = findLatestPublishTimingState(sessionSteps);

  const memoryFacts = [
    selectedTopic?.title ? `确认选题：${selectedTopic.title}` : "",
    adoptedArticle?.title ? `采用初稿：${adoptedArticle.title}` : "",
    latestPublishTiming?.best_slots?.[0]
      ? `最近发布时间判断：${latestPublishTiming.best_slots[0].weekday || "未知"} ${latestPublishTiming.best_slots[0].hour_range || ""}`.trim()
      : "",
  ].filter(Boolean);

  return {
    selectedTopic,
    adoptedArticle,
    memoryFacts,
  };
}

function detectTopicSelection(
  userContent: string,
  latestTopics: { topics?: GeneratedTopic[] } | null
) {
  const topics = Array.isArray(latestTopics?.topics) ? latestTopics.topics : [];
  if (!topics.length) {
    return null;
  }

  const normalized = userContent.replace(/\s+/g, "");
  const index = resolveSelectionIndex(normalized);
  if (index === null) {
    return null;
  }

  return topics[index] ?? null;
}

function detectArticleAcceptance(
  userContent: string,
  latestArticle: { title?: string } | null
) {
  if (!latestArticle?.title) {
    return null;
  }

  const normalized = userContent.trim().toLowerCase();
  if (/^(这个可以|这个版本可以|这个版本行|就按这个写|就按这个来|ok|okay|可以|行|好)$/.test(normalized)) {
    return { title: latestArticle.title };
  }

  return null;
}

function resolveSelectionIndex(normalizedText: string) {
  const patterns: Array<[RegExp, number]> = [
    [/(我选|选|就要|就用|用|第)(第?1个|第?一个|第一)/, 0],
    [/(我选|选|就要|就用|用|第)(第?2个|第?二个|第二)/, 1],
    [/(我选|选|就要|就用|用|第)(第?3个|第?三个|第三)/, 2],
    [/^(1|一)$|^第?1个$|^第?一个$/, 0],
    [/^(2|二)$|^第?2个$|^第?二个$/, 1],
    [/^(3|三)$|^第?3个$|^第?三个$/, 2],
  ];

  for (const [pattern, index] of patterns) {
    if (pattern.test(normalizedText)) {
      return index;
    }
  }

  return null;
}

function parseGeneratedTopics(answer: string): GeneratedTopic[] {
  const matches = Array.from(answer.matchAll(/###\s*(\d+)\.\s*(.+)/g));
  return matches.slice(0, 5).map((match, index) => ({
    index: Number(match[1] || index + 1),
    title: (match[2] || "").trim(),
  }));
}

function parseArticleTitle(answer: string) {
  const match = answer.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function buildMemoryTranscript(params: {
  userContent: string;
  assistantContent: string;
  intent: ChatIntent;
  confirmationContext: ConfirmationContext;
}) {
  const signals = [
    params.confirmationContext.selectedTopic?.title
      ? `已确认选题：${params.confirmationContext.selectedTopic.title}${params.confirmationContext.selectedTopic.angle ? `｜角度：${params.confirmationContext.selectedTopic.angle}` : ""}`
      : "",
    params.confirmationContext.adoptedArticle?.title
      ? `已采用初稿：${params.confirmationContext.adoptedArticle.title}`
      : "",
  ].filter(Boolean);

  const extracted = extractMemoryHighlights(
    params.userContent,
    params.assistantContent
  );

  return [
    "# 本轮写作记录",
    "",
    `- intent: ${params.intent}`,
    ...(signals.length ? signals.map((item) => `- ${item}`) : []),
    ...(extracted.summary.length ? ["", "## 本轮认知精华", ...extracted.summary.map((item) => `- ${item}`)] : []),
    ...(extracted.judgments.length ? ["", "## 候选判断", ...extracted.judgments.map((item) => `- ${item}`)] : []),
    ...(extracted.openQuestions.length ? ["", "## 候选未想透问题", ...extracted.openQuestions.map((item) => `- ${item}`)] : []),
    ...(extracted.experiences.length ? ["", "## 候选关键经历", ...extracted.experiences.map((item) => `- ${item}`)] : []),
    ...(extracted.themes.length ? ["", "## 候选长期主题", ...extracted.themes.map((item) => `- ${item}`)] : []),
    ...(extracted.benchmarkLearnings.length
      ? ["", "## 候选对标启发", ...extracted.benchmarkLearnings.map((item) => `- ${item}`)]
      : []),
    "",
    "## 用户原话",
    params.userContent.trim() || "（空）",
    "",
    "## 助手本轮回应",
    params.assistantContent.trim() || "（空）",
  ].join("\n");
}

function extractMemoryHighlights(userContent: string, assistantContent: string) {
  const userSentences = splitSentences(userContent);
  const assistantSentences = splitSentences(assistantContent);
  const combined = [...userSentences, ...assistantSentences];

  const judgments = dedupePreserveOrder(
    combined.filter((line) =>
      /(我认为|我觉得|我判断|真正的问题是|本质上|核心是|说白了|我反对|我最反对|根本不是|不是.+而是)/.test(
        line
      )
    )
  ).slice(0, 4);

  const openQuestions = dedupePreserveOrder(
    combined.filter(
      (line) =>
        /[？?]$/.test(line) ||
        /(还没想透|没想清楚|需要继续想|值得继续追问|先别急着写|最关键的问题)/.test(line)
    )
  ).slice(0, 4);

  const experiences = dedupePreserveOrder(
    combined.filter((line) =>
      /(我自己|我踩过|我吃过亏|我发现|我观察到|我试过|我的经历|我之前|让我最烦|我最受不了)/.test(
        line
      )
    )
  ).slice(0, 4);

  const themes = dedupePreserveOrder(
    combined.flatMap((line) => inferThemeCandidates(line))
  ).slice(0, 5);

  const benchmarkLearnings = dedupePreserveOrder(
    combined.filter((line) =>
      /(对标|卡兹克|可迁移|值得学|不能抄|核心对标|真正该学|资产)/.test(line)
    )
  ).slice(0, 4);

  const summary = dedupePreserveOrder(
    [
      judgments[0],
      openQuestions[0] ? `当前最值得继续挖的问题：${stripTrailingPunctuation(openQuestions[0])}` : "",
      experiences[0] ? `和用户真实经历最相关的一句：${stripTrailingPunctuation(experiences[0])}` : "",
      benchmarkLearnings[0]
        ? `和核心对标最相关的一句：${stripTrailingPunctuation(benchmarkLearnings[0])}`
        : "",
    ].filter(Boolean) as string[]
  ).slice(0, 4);

  return {
    summary,
    judgments,
    openQuestions,
    experiences,
    themes,
    benchmarkLearnings,
  };
}

function splitSentences(text: string) {
  return text
    .split(/\r?\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?])/))
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .filter((line) => line !== "（空）")
    .filter((line) => line.length >= 6)
    .slice(0, 40);
}

function inferThemeCandidates(line: string) {
  const themes: string[] = [];
  if (/(留存|坚持|持续写|长期产出)/.test(line)) themes.push("创作者留存");
  if (/(隐性知识|没说透|认知|判断)/.test(line)) themes.push("隐性知识挖掘");
  if (/(对标|卡兹克|模仿|不能抄|资产)/.test(line)) themes.push("核心对标与资产转化");
  if (/(AI工具|工具崇拜|工作流|模型)/.test(line)) themes.push("AI 工具与工作流认知");
  if (/(公众号|写作|爆文|选题|长文)/.test(line)) themes.push("公众号写作与爆文逻辑");
  return themes;
}

function dedupePreserveOrder(items: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = stripTrailingPunctuation(item).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function stripTrailingPunctuation(text: string) {
  return text.replace(/[。！？!?；;：:]+$/g, "").trim();
}
