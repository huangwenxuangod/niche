import test from "node:test";
import assert from "node:assert/strict";

import {
  detectControlAction,
  detectIntent,
  extractExplicitAccountName,
  getHistoryLimitForIntent,
  type ConfirmationContext,
} from "../lib/chat-intent-router.ts";

const emptyConfirmation: ConfirmationContext = {
  selectedTopic: null,
  adoptedArticle: null,
  memoryFacts: [],
};

test("routes publish timing requests to publish_timing intent", () => {
  assert.equal(
    detectIntent("什么时候发布更容易起量", emptyConfirmation),
    "publish_timing"
  );
});

test("routes explicit article writing requests to full_article intent", () => {
  assert.equal(detectIntent("帮我写一篇完整稿", emptyConfirmation), "full_article");
});

test("routes selected topic confirmation to full_article intent", () => {
  assert.equal(
    detectIntent("第一个可以", {
      selectedTopic: { title: "AI工具实操指南" },
      adoptedArticle: null,
      memoryFacts: ["确认选题：AI工具实操指南"],
    }),
    "full_article"
  );
});

test("detects local layout control action", () => {
  assert.equal(detectControlAction("排版一下"), "open_layout");
  assert.equal(detectControlAction("给我三个选题"), null);
});

test("extracts explicit account name from import style message", () => {
  assert.equal(extractExplicitAccountName("对标数字生命卡兹克"), "数字生命卡兹克");
});

test("uses short history windows for production intents", () => {
  assert.equal(getHistoryLimitForIntent("publish_timing"), 2);
  assert.equal(getHistoryLimitForIntent("full_article"), 3);
  assert.equal(getHistoryLimitForIntent("growth_analysis"), 4);
});
