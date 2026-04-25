@AGENTS.md

# CLAUDE.md - 项目说明

这是 Niche 项目的主要说明文件。

## 快速开始

```bash
npm install
npm run dev
```

## 项目简介

Niche 是一个 AI 驱动的内容创作助手，帮助微信公众号创作者：
- 跟踪细分赛道 KOC（大佳啦数据源）
- 搜索热点趋势（Tavily + 大佳啦）
- 分析爆款规律 & 自有账号诊断
- 生成选题和初稿
- 文章排版 & 一键发布到微信草稿箱
- 记录创作偏好（用户记忆 + 旅程记忆）

详细文档请查看 `memory/project_niche.md`。

## 技术栈

**核心框架**：
- Next.js 16.2.4 + React 19.2.4 (App Router)
- TypeScript 5
- Tailwind CSS 4

**AI/LLM**：
- OpenAI SDK (连接火山引擎 Ark / 豆包 API)
- **LangChain 1.3.4** + LangGraph 1.2.9（Agent 工具编排）
- LangSmith（可观测性/追踪）
- Anthropic SDK 0.90.0

**数据库 & 认证**：
- Supabase (PostgreSQL + RLS)
- @supabase/ssr (Server Components 兼容)

**UI 组件库**：
- Ant Design v6.3.6
- Ant Design X v2.5.0（聊天气泡、会话列表等）
- Sonner v2.0.7（Toast 通知）
- Framer Motion v12.38.0（动画）

**工具库**：
- Zod v4.3.6（Schema 验证）
- Day.js v1.11.20（日期处理）

**数据源**：
- 大佳啦 API（微信公众号数据）
- Tavily（热点搜索）
- TikHub API

## RAG 知识库系统（向量版本）

**核心文件**：

| 文件 | 说明 |
|------|------|
| `lib/rag/llamaindex/types.ts` | 知识库类型定义（source_type、chunk 等） |
| `lib/rag/llamaindex/documents.ts` | LlamaIndex 文档分块（SentenceSplitter） |
| `lib/rag/llamaindex/ingest.ts` | 文章索引（生成 embeddings → knowledge_chunks） |
| `lib/rag/llamaindex/retrieve.ts` | 语义检索（pgvector 相似度搜索） |
| `lib/rag/ark-embeddings.ts` | Ark Embeddings API 客户端 |
| `lib/knowledge-base.ts` | 混合检索（关键词 + 语义召回） |

**数据流程**：

```
knowledge_articles / owned_articles
    ↓
documents.ts: SentenceSplitter (420/60)
    ↓
ark-embeddings.ts: embedBatch (batch limit: 4)
    ↓
knowledge_chunks 表 (vector(1024))
    ↓
retrieve.ts: pgvector 余弦相似度搜索
    ↓
knowledge-base.ts: 混合检索结果
```

**支持的数据源类型**：

- `competitor_account` - 竞品账号（大佳啦导入）
- `wechat_hot_discovery` - 微信热门发现
- `owned_account` - 自有公众号文章

**配置参数**：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `ARK_EMBEDDING_MODEL` | `doubao-embedding-vision-251215` | Ark Embeddings 模型 |
| `ARK_EMBEDDING_DIMENSIONS` | `1024` | 向量维度 |
| `ARK_EMBEDDING_BATCH_LIMIT` | `4` | 批处理大小 |
| SentenceSplitter chunkSize | `420` | 分块字符数 |
| SentenceSplitter chunkOverlap | `60` | 分块重叠字符数 |
| minSimilarity | `0.25` | 语义检索最低相似度 |

## 目录结构

```
niche/
├── app/                          # Next.js App Router
│   ├── (app)/                    # 已认证页面（带侧边栏布局）
│   │   ├── chat/[conversationId]/ # 对话页面
│   │   ├── journey/[id]/koc/     # KOC 管理页面
│   │   ├── journey/new/          # 创建新旅程
│   │   ├── profile/              # 用户个人资料
│   │   └── layout.tsx            # 侧边栏布局
│   ├── (auth)/                   # 登录/注册页面
│   │   └── login/
│   ├── api/                      # API 路由
│   │   ├── conversations/[id]/messages/ # Agent 对话核心（SSE 流式）
│   │   ├── journeys/            # 旅程管理
│   │   ├── koc/                  # KOC 导入/同步
│   │   ├── wechat/               # 微信发布/分析
│   │   ├── memory/               # 记忆系统
│   │   └── article-layout/       # 文章排版
│   └── layout.tsx                # 根布局
├── components/                   # React 组件
│   ├── chat/                     # 聊天 UI（ChatArea、模态框等）
│   ├── sidebar/                  # 侧边栏（Sidebar、KOCListPanel）
│   └── providers/                # Ant Design 主题 Provider
├── lib/                          # 共享库代码
│   ├── agent/                    # **Agent 工具系统（LangChain 架构）**
│   │   ├── models.ts             # LangChain 模型工厂
│   │   ├── tracing.ts            # LangSmith 追踪配置
│   │   ├── chains/               # LangChain 链式调用
│   │   ├── schemas/              # Zod schema 定义
│   │   └── tools/                # Agent 工具定义和实现
│   ├── llm.ts                    # 豆包 LLM 客户端（OpenAI 兼容）
│   ├── system-prompt.ts          # 系统提示词构建
│   ├── memory.ts                 # 记忆系统（用户记忆 + 旅程记忆）
│   ├── knowledge-base.ts         # 知识库搜索
│   ├── hot-topic-search.ts       # 热点话题搜索
│   ├── dajiala.ts                # 大佳啦 API 客户端
│   ├── wechat-publish.ts         # 微信发布（草稿箱、图片上传）
│   ├── wechat-owned-analysis.ts  # 自有公众号分析
│   ├── article-layout.ts         # 文章排版引擎（Markdown → 微信 HTML）
│   ├── koc-import.ts             # KOC 导入逻辑
│   ├── data.ts                   # 静态数据（赛道树、内容类型等）
│   └── supabase/                 # Supabase 客户端配置
└── wechat-gateway/               # 微信 API 代理网关（独立 Node.js 服务）
```

## Agent 工具系统（LangChain 架构）

### 核心文件

| 文件 | 说明 |
|------|------|
| `lib/agent/models.ts` | LangChain 模型工厂（主模型、结构化输出、快速提取） |
| `lib/agent/tracing.ts` | LangSmith 追踪配置 |
| `lib/agent/runtime.ts` | LangChain 流式处理和工具调用执行层 |
| `lib/agent/tools/registry.ts` | Agent 工具注册表 |
| `lib/agent/tools/helpers.ts` | 工具定义类型转换（Zod → OpenAI Tool） |
| `lib/agent/tools/types.ts` | 工具执行上下文类型 |

### 可用工具

| 工具名称 | 功能描述 |
|----------|----------|
| `search_hot_topics` | 搜索当前赛道近 N 天热点（Tavily + 大佳啦） |
| `analyze_journey_data` | 分析旅程下 KOC 和爆款文章，提取规律 |
| `search_knowledge_base` | 从知识库检索已导入文章 |
| `generate_topics` | 基于赛道、知识库和记忆生成候选选题 |
| `generate_full_article` | 生成可发布级公众号完整初稿 |
| `compliance_check` | 检查标题、摘要、正文的合规风险 |

### LangChain 链

- `lib/agent/chains/growth-analysis.ts` - 增长分析链（结构化输出）

### 深度思考（Deep Thinking）

项目支持火山引擎豆包模型的深度思考能力：

- 模型在回答前进行多步骤推理分析（Chain of Thought）
- 适合复杂场景：编程、科学推理、Agent 工作流等
- 流式输出已启用，降低深度思考场景下的超时风险

**当前实现**：

- 基于 LangChain 的流式处理（`lib/agent/runtime.ts`）
- 模型可根据任务复杂度自主判断是否启用深度思考（auto 模式）

**工作流程**：

1. 用户发送消息 → API 路由接收
2. 构建系统提示词（注入记忆 + KOC 情报）
3. LangChain 流式调用 LLM
4. 模型输出思维链（reasoning_content）+ 最终回答
5. SSE 流式返回给前端

## 对话 API 架构

**核心路由**：`app/api/conversations/[id]/messages/route.ts`

**工作流程**：
1. 构建系统提示词（注入 KOC 情报 + 热点 + 记忆）
2. 流式调用 LLM（SSE）
3. 处理工具调用（通过 `AGENT_TOOL_REGISTRY`）
4. 捕获记忆并保存到 Supabase

## 记忆系统

使用 `lib/memory.ts` 提供的函数：

| 函数 | 功能 |
|------|------|
| `getUserMemory` / `saveUserMemory` | 用户记忆（跨旅程） |
| `getJourneyMemory` / `saveJourneyMemory` | 旅程记忆（项目级） |
| `getJourneyProjectMemory` / `saveJourneyProjectMemory` | 项目记忆（策略卡片） |
| `appendJourneyMemory` | 追加旅程记忆 |
| `captureMessageMemory` | 捕获消息中的记忆 |

## 开发注意事项

1. **使用 Server Components 优先**：Next.js 16 中默认是 Server Components
2. **SSE 流式响应**：对话使用 Server-Sent Events，参考现有实现
3. **Supabase RLS**：数据库使用行级安全策略，确保权限正确
4. **LangChain 集成**：新工具优先使用 LangChain 模式，支持结构化输出和追踪
5. **Ant Design X**：聊天 UI 使用 `@ant-design/x` 组件（Bubble、Conversations、Sender 等）
6. **CSS 变量设计系统**：颜色/字体通过 `globals.css` 中的 CSS 变量定义
7. **微信发布链路**：文章排版 → 草稿保存 → 微信草稿箱发布

## 环境变量

```env
OPENAI_API_KEY=                      # 火山引擎 Ark / 豆包 API Key
ARK_MODEL_ID=                        # 火山引擎模型端点
LANGSMITH_TRACING=true               # 启用 LangSmith 追踪（可选）
LANGSMITH_API_KEY=                   # LangSmith API Key（可选）
```

更多环境变量说明请参考 README.md。

## 常见任务

### 添加新的 Agent 工具

1. 在 `lib/agent/tools/` 创建工具文件
2. 定义 Zod schema 和工具定义
3. 实现 `run{ToolName}` 函数
4. 在 `lib/agent/tools/registry.ts` 注册工具

### 添加新的 LangChain 链

1. 在 `lib/agent/chains/` 创建链文件
2. 使用 `getStructuredOutputModel()` 创建结构化输出模型
3. 使用 `buildAgentRunConfig()` 配置追踪
4. 调用 `model.invoke()` 执行

### 修改系统提示词

编辑 `lib/system-prompt.ts` 中的 `buildSystemPrompt` 函数。

### 记忆系统操作

使用 `lib/memory.ts` 提供的函数。