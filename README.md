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

当前项目采用 **OpenClaw 记忆驱动架构**，核心特征：

- **记忆即状态** - Agent 的所有执行状态都在记忆中，不在变量里
- **工具即记忆生产者** - 每次工具执行自动记录到 `session_memory`
- **规划-执行分离** - `lib/agent/runtime/planning.ts` 提供规划框架
- **四层记忆** - 工作记忆 → 情景记忆 → 长期记忆 → 技能记忆

**核心文件**：

- `lib/agent/tools/registry.ts`
  - 工具注册表 + `wrapWithMemoryLogging` 自动记忆包装器
- `lib/agent/memory/session-memory.ts`
  - 情景记忆核心，记录 thought/plan/tool_call/observation/reflection
- `lib/agent/runtime/planning.ts`
  - OpenClaw 风格规划阶段框架
- `lib/llm.ts`
  - 豆包 LLM 客户端（OpenAI 兼容），流式输出 + 深度思考支持
- `lib/system-prompt.ts`
  - 系统提示词构建，注入 KOC 情报 + 四层记忆 + 热点信息

## Agent 工具

当前聊天接口支持 8 个工具：

- `search_hot_topics` — 搜索当前赛道最值得跟进的增长机会
- `search_wechat_hot_articles` — 用关键词搜索公众号爆文，找优质账号样本
- `import_koc_by_name` — 导入明确账号名的对标账号到知识库
- `analyze_journey_data` — 分析当前旅程下已有对标账号和高表现文章，拆解增长规律
- `search_knowledge_base` — 从知识库检索对标内容、标题和案例
- `generate_topics` — 基于赛道、知识库和用户记忆生成候选选题
- `generate_full_article` — 生成可发布级公众号完整初稿
- `compliance_check` — 检查标题、摘要、正文的合规风险

## 深度思考支持

项目已支持火山引擎豆包模型的深度思考能力：

- 模型可在回答前进行多步骤推理分析（Chain of Thought）
- 适合复杂场景：编程、科学推理、Agent 工作流等
- 流式输出已启用，有效降低深度思考场景下的超时风险
- 模型可根据任务复杂度自主判断是否启用深度思考（auto 模式）

当前实现基于 `lib/llm.ts` 的 OpenAI 兼容流式处理，会自动处理模型的深度思考响应。

## 对标内容库说明

当前”对标内容库”已升级为完整的 **向量 RAG 知识库系统**：

- 对标账号和文章数据写入 `koc_sources`、`knowledge_articles`
- 文章通过 **LlamaIndex SentenceSplitter** 自动分块（420 字符 / 60 重叠）
- 调用 **Ark Embeddings API** 生成 1024 维向量存储到 `knowledge_chunks` 表
- Agent 工具 `search_knowledge_base` 支持 **混合检索**：
  - 关键词检索（标题/摘要/内容 LIKE 匹配）
  - 语义召回（pgvector 余弦相似度搜索）
  - 账号过滤（按指定账号名称筛选）
- `analyze_journey_data` 会基于库内文章做规律分析

### 对标导入策略

为了保证初始化速度、降低单次导入成本，当前每个对标账号默认只同步：

- 最近 `3` 篇文章样本

这条策略同时作用于：

- 新导入对标账号
- 手动同步已有对标账号

## 记忆层说明

当前记忆层采用 **四层架构**：

### 1. 工作记忆（Working Memory）
- 当前对话的 `messages` 数组
- 临时上下文，对话结束即释放

### 2. 情景记忆（Session/Episodic Memory）
- 存储在 `session_memory` 表，按 `conversation_id` 分组
- **核心设计**：每次工具执行自动记录，不可遗漏
- 步骤类型：`thought` | `plan` | `tool_call` | `tool_result` | `observation` | `reflection`
- 支持从记忆中恢复对话状态

### 3. 长期记忆（Long-term Memory）
- **用户全局记忆**：`user_memories` 表（跨旅程共享）
- **旅程记忆**：`journey_memories` 表（项目级）
- **项目记忆**：`journey_project_memories` 表（结构化策略卡片）
- `lib/memory.ts` 提供统一操作接口

### 4. 技能记忆（Skill Memory）
- 从情景记忆中提取工具使用模式
- 加速相似任务（规划中）

**自动沉淀的内容**：
- 用户填写的”我是谁”
- 聊天中明确表达的风格偏好、选题偏好
- 对选题的确认、明确正负反馈

**接入方式**：
- 聊天前读取四层记忆，拼进 system prompt
- “我是谁”页面可直接查看和编辑用户记忆
- 工具执行自动记录到情景记忆，无需手动处理

## 技术栈

- Next.js 16
- React 19
- Supabase
- OpenAI SDK 兼容接口
- OpenClaw 记忆驱动架构
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
    debug/
  (app)/
  (auth)/
components/
  chat/
  sidebar/
lib/
  agent/
    memory/
    runtime/
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

完整技术架构图请查看 `ARCHITECTURE.md`。

## 环境变量

至少需要这些环境变量：

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# LLM / API
OPENAI_API_KEY=
ARK_MODEL_ID=

# 数据源
DAJIALA_API_KEY=
TAVILY_API_KEY=

# 微信
WECHAT_CREDENTIALS_SECRET=
WECHAT_GATEWAY_URL=
WECHAT_GATEWAY_TOKEN=
```

说明：

- `OPENAI_API_KEY` 和 `ARK_MODEL_ID` 用于兼容 OpenAI SDK 的模型调用（连接火山引擎 Ark / 豆包）
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
- `POST /api/wechat/publish`
  作用：保存到公众号草稿箱

更完整的接口文档见 `API_DOCS.md`。

## 当前实现边界

当前版本优先保证”增长体验闭环”：

- 单 Agent + 8 个工具 + 自动记忆记录
- 支持导入对标账号、内容生成、风险检查、排版、发布草稿
- 支持基于 Supabase 的对标内容检索（向量 RAG + 混合检索）
- 采用 OpenClaw 记忆驱动架构（四层记忆 + 规划-执行分离）
- 还没有做完整的多 Agent 调度
- 还没有做完整的跨平台社媒发布矩阵

## 开发建议

下一步最值得做的通常是：

1. 把”自己 vs 对标账号”的差距分析做成结构化结果卡
2. 给增长结果补一层发布后复盘闭环
3. 把发布链路从”草稿箱”继续延伸到正式发布
4. 探索多向量检索（multi-vector）和稀疏向量（sparse embedding）优化
