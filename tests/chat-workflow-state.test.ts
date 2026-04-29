import test from "node:test";
import assert from "node:assert/strict";

import {
  findLatestFullArticleState,
  findLatestLayoutCandidateFromState,
  findLatestPublishTimingState,
  findLatestTopicsState,
  type LatestFullArticleState,
  type LatestPublishTimingState,
  type LatestTopicsState,
} from "../lib/chat-workflow-state.ts";
import type { StepRecord } from "../lib/agent/memory/session-memory.ts";

function observationStep(value: unknown): StepRecord {
  return {
    id: crypto.randomUUID(),
    type: "observation",
    content: value,
    timestamp: Date.now(),
  };
}

test("finds latest topics workflow state", () => {
  const steps: StepRecord[] = [
    observationStep({
      tool: "workflow_state",
      state: "latest_topics",
      value: {
        topics: [{ index: 1, title: "旧选题" }],
      } satisfies LatestTopicsState,
    }),
    observationStep({
      tool: "workflow_state",
      state: "latest_topics",
      value: {
        topics: [{ index: 1, title: "新选题" }],
      } satisfies LatestTopicsState,
    }),
  ];

  const latest = findLatestTopicsState(steps);
  assert.equal(latest?.topics[0]?.title, "新选题");
});

test("finds latest full article workflow state for layout", () => {
  const steps: StepRecord[] = [
    observationStep({
      tool: "workflow_state",
      state: "latest_full_article",
      value: {
        title: "测试标题",
        content: "# 测试标题\n\n正文内容",
        messageId: "msg-1",
      } satisfies LatestFullArticleState,
    }),
  ];

  const latest = findLatestFullArticleState(steps);
  const layoutCandidate = findLatestLayoutCandidateFromState(steps);

  assert.equal(latest?.title, "测试标题");
  assert.equal(layoutCandidate?.messageId, "msg-1");
  assert.match(layoutCandidate?.content ?? "", /正文内容/);
});

test("finds latest publish timing workflow state", () => {
  const steps: StepRecord[] = [
    observationStep({
      tool: "workflow_state",
      state: "latest_publish_timing",
      value: {
        summary: "建议周二晚间发布",
        best_slots: [{ weekday: "周二", hour_range: "20:00-22:00" }],
      } satisfies LatestPublishTimingState,
    }),
  ];

  const latest = findLatestPublishTimingState(steps);
  assert.equal(latest?.best_slots?.[0]?.weekday, "周二");
});
