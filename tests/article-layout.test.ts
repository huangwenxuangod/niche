import test from "node:test";
import assert from "node:assert/strict";
import {
  extractArticleFromAssistantMessage,
  renderWechatHtml,
} from "../lib/article-layout.ts";

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

test("strips duplicated title and reference note from article body", () => {
  const article = extractArticleFromAssistantMessage(`
# 主标题测试

> 这是一段摘要

## 备选标题
1. 备选一

## 参考说明
知识库暂无强相关参考，已按当前赛道生成。

# 主标题测试

正文第一段。

## 小节

正文第二段。
  `);

  assert.ok(article);
  assert.doesNotMatch(article?.bodyMarkdown ?? "", /^# 主标题测试/m);
  assert.doesNotMatch(article?.bodyMarkdown ?? "", /知识库暂无强相关参考/);
  assert.match(article?.bodyMarkdown ?? "", /正文第一段/);
});

test("renders task list as structured list instead of merged paragraph", () => {
  const html = renderWechatHtml(`
## 行动清单

- [x] 工具选择：优先免费工具
- [x] 受众定位：越精准越好
- [ ] 继续补案例
  `);

  assert.match(html, /<ul/);
  assert.match(html, /✅/);
  assert.match(html, /⬜/);
  assert.doesNotMatch(html, /✅[\s\S]*✅[\s\S]*✅[\s\S]*<\/p>/);
});
