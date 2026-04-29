import test from "node:test";
import assert from "node:assert/strict";

import { buildDeterministicFallback } from "../lib/chat-generation.ts";
import type { PrefetchedContext } from "../lib/chat-runtime.ts";

function createPrefetchedContext(overrides: Partial<PrefetchedContext["data"]>): PrefetchedContext {
  return {
    intent: "general",
    data: overrides,
    topicTitle: undefined,
    topicAngle: undefined,
  };
}

test("publish timing fallback uses best slots", () => {
  const answer = buildDeterministicFallback(
    "publish_timing",
    createPrefetchedContext({
      publishTiming: {
        best_slots: [
          {
            weekday: "周二",
            hour_range: "20:00-22:00",
            reason: "晚间样本表现更强",
          },
        ],
        patterns: ["工作日晚间优于白天"],
      },
    }),
    "什么时候发布更容易起量"
  );

  assert.match(answer, /周二/);
  assert.match(answer, /20:00-22:00/);
});

test("growth fallback uses journey patterns", () => {
  const answer = buildDeterministicFallback(
    "growth_analysis",
    createPrefetchedContext({
      journeyAnalysis: {
        patterns: ["标题具体、收益明确、案例感强"],
      },
    }),
    "分析增长规律"
  );

  assert.match(answer, /增长分析/);
  assert.match(answer, /标题具体/);
});

test("wxvideo fallback uses interaction patterns", () => {
  const answer = buildDeterministicFallback(
    "wxvideo_analysis",
    createPrefetchedContext({
      wxvideoAnalysis: {
        patterns: ["前 3 秒钩子更强的内容更容易起量"],
        migration_suggestion: "适合回写成公众号长文。",
      },
    }),
    "分析视频号样本"
  );

  assert.match(answer, /视频号样本/);
  assert.match(answer, /前 3 秒钩子/);
  assert.match(answer, /公众号长文/);
});
