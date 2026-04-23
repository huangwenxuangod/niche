# Niche

Niche 是一个面向微信生态内容创作者的 AI 起号助手。用户先选择赛道，导入一批对标 KOC 公众号，系统抓取文章和数据写入 Supabase，然后在聊天里通过 Agent 工具去查热点、查 KOC、分析爆款规律、检索知识库。

## 当前能力

- 旅程创建：选择平台、赛道、内容类型，生成一个创作旅程
- KOC 导入：通过大佳拉搜索和导入公众号，抓取最近文章与互动数据
- Agent 聊天：模型可按需调用工具，再给出自然语言回答
- 工具轨迹：前端显示“正在搜索 / 已分析 / 待确认导入”
- Supabase 知识库：已导入文章可作为当前旅程的结构化知识库被检索

## Agent 工具

当前聊天接口支持以下工具：

- `search_hot_topics`
  作用：搜索当前赛道近几天热点
- `search_koc_accounts`
  作用：搜索值得跟踪的 KOC 账号
- `analyze_journey_data`
  作用：分析当前旅程下已有 KOC、爆款文章、标题规律
- `search_knowledge_base`
  作用：从 Supabase 里的 `knowledge_articles` 检索相关文章、标题和案例
- `import_koc_articles`
  作用：建议导入 KOC 文章到知识库
  说明：这是写操作，前端需要用户确认后才真正执行

## Supabase 知识库说明

当前“知识库”已经能用，但它是“结构化检索版”，不是“向量 RAG 版”。

现在已经做到的：

- KOC 和文章数据会写入 `koc_sources`、`knowledge_articles`
- Agent 可以读取爆款文章、KOC 统计、知识库命中文章
- `search_knowledge_base` 会按标题、摘要、正文做关键词检索
- `analyze_journey_data` 会基于库内文章做规律分析

还没有做到的：

- 没有 embedding
- 没有向量召回
- 没有混合检索
- 没有知识切片和重排

所以当前更准确的说法是：

> 这是一个“可被 Agent 调用的 Supabase 内容知识库”，但还不是完整的向量知识库系统。

如果后面要升级成真正的 RAG，下一步通常是：

1. 给文章生成 embedding
2. 在 `knowledge_articles` 或单独表中存向量
3. 新增 `retrieve_similar_articles` 工具
4. 把关键词检索和向量检索做成混合召回

## 技术栈

- Next.js 16
- React 19
- Supabase
- OpenAI SDK 兼容接口
- 大佳拉 API
- Tavily Search

## 目录结构

```text
app/
  api/
    conversations/
    journeys/
    koc/
  (app)/
  (auth)/
components/
  chat/
  sidebar/
lib/
  llm.ts
  system-prompt.ts
  koc-import.ts
  knowledge-base.ts
  dajiala.ts
  tavily.ts
supabase/
  migrations/
```

## 本地运行

先安装依赖并启动开发环境：

```bash
bun install
bun dev
```

如果你使用 `npm`：

```bash
npm install
npm run dev
```

默认访问：

```text
http://localhost:3000
```

## 环境变量

至少需要这些环境变量：

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
OPENAI_API_KEY=
ARK_MODEL_ID=
DAJIALA_API_KEY=
TAVILY_API_KEY=
```

说明：

- `OPENAI_API_KEY` 和 `ARK_MODEL_ID` 当前用于兼容 OpenAI SDK 的模型调用
- `DAJIALA_API_KEY` 用于搜索和导入公众号数据
- `TAVILY_API_KEY` 用于赛道热点搜索

## 关键接口

- `POST /api/journeys`
  作用：创建旅程并生成首个对话
- `GET /api/koc`
  作用：搜索 KOC 账号
- `POST /api/koc/:id/import`
  作用：导入指定 KOC 和文章
- `POST /api/koc/:id/sync`
  作用：同步已存在 KOC 的文章
- `POST /api/conversations/:id/messages`
  作用：Agent 聊天主入口，返回 SSE 流

更完整的接口文档见 [API_DOCS.md](D:/dev/my-project/niche/API_DOCS.md)。

## 当前实现边界

当前版本优先保证“体验闭环”而不是“架构炫技”：

- 已经有单 Agent + 多工具 + 半自动执行
- 已经支持导入确认和工具轨迹展示
- 已经支持基于 Supabase 的知识检索
- 还没有做多 Agent 调度
- 还没有做真正的向量 RAG
- 还没有做完整的内容发布工作台

## 开发建议

下一步最值得做的通常是：

1. 导入 KOC 后自动继续回答，不要求用户再问一次
2. 把 `search_knowledge_base` 升级成向量召回
3. 增加“选题生成”和“公众号初稿生成”工具
4. 把 `tool_calls` 做成可回放的调试面板
