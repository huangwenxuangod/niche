import test from "node:test";
import assert from "node:assert/strict";
import { extractArticleFromAssistantMessage } from "../lib/article-layout.ts";

test("extracts article from legacy structured output", () => {
  const article = extractArticleFromAssistantMessage(`
**主标题**
测试标题

**公众号摘要**
这是一段摘要

**备选标题**
1. 备选

**完整初稿**
## 开头

这是一段正文。
  `);

  assert.ok(article);
  assert.equal(article?.title, "测试标题");
  assert.equal(article?.summary, "这是一段摘要");
  assert.match(article?.bodyMarkdown ?? "", /这是一段正文/);
});

test("extracts article from direct markdown output", () => {
  const article = extractArticleFromAssistantMessage(`
# 月薪3k新媒体小编：用免费AI工具，1小时产出10套爆款文案模板

> 针对新媒体从业者内容生产效率痛点，拆解免费AI工具的爆款模板化使用方法。

## 备选标题
1. 标题 A
2. 标题 B

## 参考说明
这一部分不应进入排版正文。

## 一、先搞懂

这是一段正文。

## 二、实操步骤

继续写正文。
  `);

  assert.ok(article);
  assert.equal(article?.title, "月薪3k新媒体小编：用免费AI工具，1小时产出10套爆款文案模板");
  assert.equal(
    article?.summary,
    "针对新媒体从业者内容生产效率痛点，拆解免费AI工具的爆款模板化使用方法。"
  );
  assert.doesNotMatch(article?.bodyMarkdown ?? "", /备选标题/);
  assert.doesNotMatch(article?.bodyMarkdown ?? "", /参考说明/);
  assert.match(article?.bodyMarkdown ?? "", /## 一、先搞懂/);
});

test("returns null for non-article assistant content", () => {
  const article = extractArticleFromAssistantMessage("这轮我先帮你分析一下增长机会。");
  assert.equal(article, null);
});
