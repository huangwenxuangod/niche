# Niche

Niche 是一个面向冷启动 KOC 的 AI 内容增长教练。

从 0 到 1 最缺的不是努力，而是一个真正懂增长的内容教练。Niche 通过导入对标账号、沉淀对标内容库、分析增长差距、生成增长内容，并辅助完成发布风险检查、发布排版和发布到公众号，把原本依赖经验和试错的内容增长过程，变成一条可执行、可复用、可落地的 AI 增长闭环。

当前定位：

- 目标用户：0-100 粉丝阶段、缺少冷启动机会的普通 KOC
- 核心价值：帮用户找方向、拆对标、补差距，并快速产出可发布内容
- 产品形态：社媒通用，公众号先落地

## 当前能力

- 旅程创建：选择平台、赛道、内容类型，建立一条内容增长旅程
- 导入对标账号：通过公众号名称、文章链接等方式导入样本账号
- 对标内容库：将已导入账号的文章和数据沉淀为结构化样本库
- 增长分析：输入自己的公众号名称，导入自己的内容主体，并尽量补官方表现数据，输出“我的号概况 + 自己 vs 对标 + 下一步建议”
- 增长机会搜索：搜索当前赛道值得跟进的话题方向
- 生成增长内容：基于赛道、对标内容库和用户记忆生成完整稿
- 发布风险检查：自动识别高风险表达并给出替代建议
- 发布排版：将内容整理成更适合公众号阅读和发布的版式
- 发布到公众号：通过官方 API + 固定 IP 网关保存到公众号草稿箱

## 当前工程架构

当前项目已经开始从“自研单体 Agent”迁移到 **LangChain 生态链路**：

- `lib/agent/models.ts`
  - 统一模型初始化，兼容当前 Ark / OpenAI SDK 风格调用
- `lib/agent/tools/*`
  - 核心工具开始从聊天主路由拆出，逐步脱离 `route.ts`
- `lib/agent/retrievers/*`
  - 对标内容、自己的公众号内容、热点、项目脑记忆已抽成独立检索层
- `lib/agent/chains/*`
  - 增长分析结果卡、项目脑更新、本轮结论已经开始走 LangChain 结构化输出
- `lib/agent/graphs/owned-wechat-analysis.ts`
  - `增长分析` 已作为第一条 LangGraph 试点 workflow 落地

当前迁移状态：

- `chat / streamChat / completeWithTools` 已开始走 LangChain 兼容 runtime
- 主聊天 UI 与现有 API 路由仍保持兼容，不做大爆破重构
- LangSmith tracing 环境位已接入，配置后可直接追踪主链和增长分析链

## Agent 工具

当前聊天接口支持以下工具：

- `search_hot_topics`
  作用：搜索当前赛道最值得跟进的增长机会
- `analyze_journey_data`
  作用：分析当前旅程下已有对标账号和高表现文章，拆解增长规律
- `search_knowledge_base`
  作用：从 Supabase 里的 `knowledge_articles` 检索对标内容、标题和案例

## 对标内容库说明

当前“对标内容库”已经能用，但它是“结构化检索版”，不是“向量 RAG 版”。

现在已经做到的：

- 对标账号和文章数据会写入 `koc_sources`、`knowledge_articles`
- Agent 可以读取高表现文章、账号统计、内容库命中文章
- `search_knowledge_base` 会按标题、摘要、正文做关键词检索
- `analyze_journey_data` 会基于库内文章做规律分析

还没有做到的：

- 没有 embedding
- 没有向量召回
- 没有混合检索
- 没有知识切片和重排

所以当前更准确的说法是：

> 这是一个“可被 Agent 调用的 Supabase 对标内容库”，但还不是完整的向量知识库系统。

### 对标导入策略

为了保证初始化速度、降低单次导入成本，当前每个对标账号默认只同步：

- 最近 `3` 篇文章样本

这条策略同时作用于：

- 新导入对标账号
- 手动同步已有对标账号

## 记忆层说明

当前记忆层采用“Markdown 文件 + Prompt 注入”的轻量方案。

- 用户全局记忆：`memory/users/{user_id}.md`
- 旅程局部记忆：`memory/journeys/{journey_id}.md`

当前会自动沉淀的内容：

- 用户填写的“我是谁”
- 聊天中明确表达的风格偏好
- 聊天中明确表达的选题偏好
- 对选题的确认
- 明确正负反馈

当前接入方式：

- 聊天前会读取用户记忆和旅程记忆
- 两份记忆会直接拼进 system prompt
- “我是谁”页面可以直接查看和编辑用户记忆 markdown

这是一版实现快、可见性强的记忆层。后续如果要升级，可以把 markdown 记忆进一步结构化，或者迁移到数据库与向量检索结合。

### 项目级记忆（新增）

除原有 Markdown 记忆外，当前已经增加一层 **结构化项目脑**：

- `journey_project_memories`
  - 项目档案卡
  - 旅程策略状态
  - 本轮结论

这层记忆会在：

- 用户明确确认定位 / 目标 / 平台策略时更新
- 生成选题、完整稿、合规检查、增长分析等关键节点后更新

它的作用不是替代聊天记忆，而是让系统更清楚：

- 这个项目是什么
- 当前做到哪一步
- 下一步最该做什么

## 技术栈

- Next.js 16
- React 19
- Supabase
- OpenAI SDK 兼容接口
- LangChain / LangGraph / LangSmith
- 大佳拉 API
- Tavily Search
- 微信官方 API + 固定 IP 转发网关

## 目录结构

```text
app/
  api/
    conversations/
    journeys/
    koc/
    wechat/
  (app)/
  (auth)/
components/
  chat/
  sidebar/
lib/
  agent/
    chains/
    graphs/
    models.ts
    retrievers/
    schemas/
    tools/
  llm.ts
  memory.ts
  system-prompt.ts
  koc-import.ts
  knowledge-base.ts
  dajiala.ts
  tavily.ts
  wechat-publish.ts
wechat-gateway/
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
WECHAT_CREDENTIALS_SECRET=
WECHAT_GATEWAY_URL=
WECHAT_GATEWAY_TOKEN=
```

说明：

- `OPENAI_API_KEY` 和 `ARK_MODEL_ID` 当前用于兼容 OpenAI SDK 的模型调用
- `DAJIALA_API_KEY` 用于导入公众号文章数据，建立对标内容库
- `TAVILY_API_KEY` 用于增长机会搜索
- `WECHAT_CREDENTIALS_SECRET` 用于加密保存公众号配置
- `WECHAT_GATEWAY_URL` / `WECHAT_GATEWAY_TOKEN` 用于通过固定 IP 网关调用微信官方 API

## 关键接口

- `POST /api/journeys`
  作用：创建旅程并生成首个对话
- `POST /api/koc/import`
  作用：导入指定对标账号和文章（当前默认只同步 3 篇）
- `POST /api/koc/:id/sync`
  作用：同步已存在对标账号的文章（当前默认只同步 3 篇）
- `POST /api/conversations/:id/messages`
  作用：Agent 聊天主入口，返回 SSE 流
- `POST /api/wechat/owned-analysis`
  作用：增长分析入口，导入自己的公众号内容并生成结构化结果卡
- `POST /api/wechat/publish`
  作用：保存到公众号草稿箱

更完整的接口文档见 `API_DOCS.md`。

## 当前实现边界

当前版本优先保证“增长体验闭环”而不是“架构炫技”：

- 已经有单 Agent + 多工具 + 半自动执行
- 已经支持导入对标账号、增长分析、内容生成、风险检查、排版、发布草稿
- 已经支持基于 Supabase 的结构化对标内容检索
- 已经开始接入 LangChain 生态，并将增长分析作为第一条 LangGraph 试点链路
- 还没有做完整的多 Agent 调度
- 还没有做真正的向量 RAG
- 还没有做完整的跨平台社媒发布矩阵

## 开发建议

下一步最值得做的通常是：

1. 把“自己 vs 对标账号”的差距分析做成结构化结果卡
2. 把 `search_knowledge_base` 升级成向量召回
3. 给增长结果补一层发布后复盘闭环
4. 把发布链路从“草稿箱”继续延伸到正式发布
