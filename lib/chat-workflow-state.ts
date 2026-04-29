import type { SupabaseClient } from "@supabase/supabase-js";
import { recordStep, type StepRecord } from "./agent/memory/session-memory.ts";

export type WorkflowStateKey =
  | "latest_topics"
  | "latest_full_article"
  | "latest_publish_timing";

export type LatestTopicsState = {
  topics: Array<{
    index?: number;
    title?: string;
  }>;
};

export type LatestFullArticleState = {
  title?: string;
  content: string;
  messageId?: string;
};

export type LatestPublishTimingState = {
  summary: string;
  best_slots?: Array<{
    weekday?: string;
    hour_range?: string;
    reason?: string;
  }>;
  patterns?: string[];
};

export async function recordWorkflowState(
  supabase: SupabaseClient,
  conversationId: string,
  key: WorkflowStateKey,
  value: unknown
) {
  await recordStep(supabase, conversationId, {
    id: crypto.randomUUID(),
    type: "observation",
    content: {
      tool: "workflow_state",
      state: key,
      value,
    },
  });
}

export function findLatestWorkflowState<T>(
  sessionSteps: StepRecord[],
  key: WorkflowStateKey
) {
  for (let index = sessionSteps.length - 1; index >= 0; index -= 1) {
    const step = sessionSteps[index];
    if (step.type !== "observation") {
      continue;
    }

    const content = step.content as {
      tool?: string;
      state?: WorkflowStateKey;
      value?: T;
    };

    if (content.tool === "workflow_state" && content.state === key && content.value) {
      return content.value;
    }
  }

  return null;
}

export function findLatestTopicsState(sessionSteps: StepRecord[]) {
  return findLatestWorkflowState<LatestTopicsState>(sessionSteps, "latest_topics");
}

export function findLatestFullArticleState(sessionSteps: StepRecord[]) {
  return findLatestWorkflowState<LatestFullArticleState>(
    sessionSteps,
    "latest_full_article"
  );
}

export function findLatestPublishTimingState(sessionSteps: StepRecord[]) {
  return findLatestWorkflowState<LatestPublishTimingState>(
    sessionSteps,
    "latest_publish_timing"
  );
}

export function findLatestToolResult<T>(sessionSteps: StepRecord[], toolName: string) {
  for (let index = sessionSteps.length - 1; index >= 0; index -= 1) {
    const step = sessionSteps[index];
    if (step.type !== "observation") {
      continue;
    }

    const content = step.content as {
      tool?: string;
      result?: T;
      error?: string;
    };

    if (content.tool === toolName && content.result && !content.error) {
      return content.result;
    }
  }

  return null;
}

export function findLatestLayoutCandidate(
  messages: Array<{ id: string; role: string; content: string }>
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    if (/^#\s+.+/m.test(message.content)) {
      return {
        messageId: message.id,
        content: message.content,
      };
    }
  }

  return null;
}

export function findLatestLayoutCandidateFromState(sessionSteps: StepRecord[]) {
  const latestArticle = findLatestFullArticleState(sessionSteps);
  if (!latestArticle?.content?.trim()) {
    return null;
  }

  return {
    messageId: latestArticle.messageId ?? "",
    content: latestArticle.content,
  };
}
