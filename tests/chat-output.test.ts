import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackMessage, buildToolBasedAnswer } from "../lib/chat-output.ts";
import type { LlmMessage } from "../lib/llm.ts";

test("uses generate_full_article tool result as final answer", () => {
  const messages: LlmMessage[] = [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "generate_full_article",
            arguments: "{}",
          },
        },
      ],
    } as LlmMessage,
    {
      role: "tool",
      tool_call_id: "tool-1",
      content: JSON.stringify({
        title: "测试标题",
        summary: "测试摘要",
        title_options: ["备选一", "备选二"],
        article_markdown: "## 正文\n\n这是一段正文。",
        reference_note: "参考说明",
      }),
    } as LlmMessage,
  ];

  const answer = buildToolBasedAnswer(messages, "给我写一篇完整稿");

  assert.match(answer, /^# 测试标题/m);
  assert.match(answer, /^> 测试摘要/m);
  assert.match(answer, /## 备选标题/);
  assert.match(answer, /## 正文/);
});

test("uses generate_topics result directly", () => {
  const messages: LlmMessage[] = [
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "tool-2",
          type: "function",
          function: {
            name: "generate_topics",
            arguments: "{}",
          },
        },
      ],
    } as LlmMessage,
    {
      role: "tool",
      tool_call_id: "tool-2",
      content: JSON.stringify({
        topics: [
          {
            index: 1,
            title: "选题一",
            angle: "角度一",
            why_fit_user: "适合你",
            why_now: "现在值得写",
            reference_titles: ["参考 A"],
          },
        ],
      }),
    } as LlmMessage,
  ];

  const answer = buildToolBasedAnswer(messages, "给我3个选题");

  assert.match(answer, /选题一/);
  assert.match(answer, /切入角度：角度一/);
  assert.match(answer, /你可以直接回复“第一个可以”/);
});

test("writing fallback is explicit", () => {
  assert.equal(
    buildFallbackMessage("给我写一篇完整稿"),
    "这轮写稿结果没有成功整理出来，请重新触发一次写稿。"
  );
  assert.equal(
    buildFallbackMessage("分析一下这个账号"),
    "这轮我拿到了部分数据，但还没成功组织成有效回答。"
  );
});
