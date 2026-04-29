import { appendJourneyProjectMemoryItems } from "@/lib/memory";
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
  conversationId: string;
  journeyId: string;
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
    const title = parseArticleTitle(params.answer) || params.prefetched.topicTitle || "未命名文章";
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
