import test from "node:test";
import assert from "node:assert/strict";
import { buildFallbackMessage } from "../lib/chat-output.ts";

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
