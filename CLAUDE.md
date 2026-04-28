# CLAUDE.md - Niche 项目开发者指南

## 快速开始

```bash
bun install
bun dev
```

## 项目简介

Niche 是一个 AI 驱动的内容创作助手，帮助微信公众号创作者：
- 跟踪细分赛道 KOC（大佳啦数据源）
- 搜索热点趋势（Tavily + 大佳啦）
- 分析爆款规律
- 生成选题和初稿
- 文章排版 & 一键发布到微信草稿箱
- 记录创作偏好（四层记忆系统）

## 技术栈

**核心框架**：
- Next.js 16.2.4 + React 19.2.4 (App Router)
- TypeScript 5
- Tailwind CSS 4

**AI/LLM**：
- OpenAI SDK（连接火山引擎 Ark / 豆包 API）
- Anthropic SDK 0.90.0
- 火山引擎豆包深度思考模型

**数据库 & 认证**：
- Supabase (PostgreSQL + RLS + pgvector)
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
knowledge_articles
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
│   │   ├── journey/[id]/dashboard/ # 数据复盘页面
│   │   ├── journey/[id]/koc/     # KOC 管理页面
│   │   ├── profile/              # 用户个人资料
│   │   ├── layout.tsx            # 侧边栏布局
│   │   └── page.tsx              # 首页（自动创建旅程并重定向到对话）
│   ├── (auth)/                   # 登录/注册页面
│   │   └── login/
│   ├── api/                      # API 路由
│   │   ├── conversations/[id]/messages/ # Agent 对话核心（SSE 流式）
│   │   ├── journeys/             # 旅程管理
│   │   ├── koc/                  # KOC 导入/同步
│   │   ├── wechat/               # 微信发布/配置/数据
│   │   ├── memory/               # 记忆系统
│   │   ├── article-layout/       # 文章排版
│   │   └── debug/embedding-probe/ # RAG 向量诊断
│   └── layout.tsx                # 根布局
├── components/                   # React 组件
│   ├── chat/                     # 聊天 UI（ChatArea、ArticleLayoutPanel 等）
│   ├── sidebar/                  # 侧边栏（Sidebar、KOCListPanel、DashboardPanel）
│   └── providers/                # Ant Design 主题 Provider
├── lib/                          # 共享库代码
│   ├── agent/                    # **Agent 系统（OpenClaw 记忆驱动架构）**
│   │   ├── memory/               # 记忆模块
│   │   │   ├── session-memory.ts # 情景记忆核心（工具执行自动记录）
│   │   │   └── index.ts          # 记忆模块统一导出
│   │   ├── runtime/              # 运行时
│   │   │   └── planning.ts       # 规划阶段框架
│   │   ├── retrievers/           # 数据检索器
│   │   │   ├── competitor-content.ts
│   │   │   ├── hot-topics.ts
│   │   │   ├── owned-content.ts
│   │   │   └── semantic-knowledge.ts
│   │   ├── schemas/              # Zod schema 定义
│   │   └── tools/                # Agent 工具定义和实现
│   │       ├── registry.ts       # 工具注册表 + 自动记忆包装器
│   │       ├── helpers.ts        # 工具定义类型转换
│   │       ├── types.ts          # 工具执行上下文类型
│   │       ├── search-hot-topics.ts
│   │       ├── search-wechat-hot-articles.ts
│   │       ├── import-koc-by-name.ts
│   │       ├── analyze-journey-data.ts
│   │       ├── search-knowledge-base.ts
│   │       ├── generate-topics.ts
│   │       ├── generate-full-article.ts
│   │       └── compliance-check.ts
│   ├── llm.ts                    # 豆包 LLM 客户端（OpenAI 兼容）
│   ├── system-prompt.ts          # 系统提示词构建
│   ├── memory.ts                 # 长期记忆系统（用户/旅程/项目记忆）
│   ├── knowledge-base.ts         # 知识库搜索
│   ├── hot-topic-search.ts       # 热点话题搜索
│   ├── dajiala.ts                # 大佳啦 API 客户端
│   ├── wechat-publish.ts         # 微信发布（草稿箱、图片上传）
│   ├── article-layout.ts         # 文章排版引擎（Markdown → 微信 HTML）
│   ├── koc-import.ts             # KOC 导入逻辑
│   ├── data.ts                   # 静态数据（赛道树、内容类型等）
│   └── supabase/                 # Supabase 客户端配置
├── supabase/migrations/          # 数据库迁移文件（16 个）
└── wechat-gateway/               # 微信 API 代理网关（独立 Node.js 服务）
```

## Agent 工具系统（OpenClaw 记忆驱动架构）

### 核心设计原则

1. **记忆即状态** - Agent 的所有执行状态都在记忆中，不在变量里
2. **工具即记忆生产者** - 每次工具执行必须自动记录到情景记忆
3. **规划-执行分离** - 先想明白再干，不是边干边想
4. **错误是可恢复的** - 基于记忆重新规划，不是立即失败

### 核心文件

| 文件 | 说明 |
|------|------|
| `lib/agent/tools/registry.ts` | 工具注册表 + 记忆感知包装器（`wrapWithMemoryLogging`） |
| `lib/agent/memory/session-memory.ts` | 情景记忆核心（步骤类型：thought/plan/tool_call/observation/reflection） |
| `lib/agent/runtime/planning.ts` | OpenClaw 风格规划阶段框架 |
| `lib/agent/tools/helpers.ts` | Zod Schema → OpenAI Tool 转换 |
| `lib/agent/tools/types.ts` | 工具执行上下文类型 |

### 可用工具（8 个）

| 工具名称 | 功能描述 |
|----------|----------|
| `search_hot_topics` | 搜索当前赛道近 N 天热点（Tavily + 大佳啦） |
| `search_wechat_hot_articles` | 用关键词搜索公众号爆文，找优质账号样本 |
| `import_koc_by_name` | 导入明确账号名的对标账号到知识库 |
| `analyze_journey_data` | 分析旅程下 KOC 和爆款文章，提取规律 |
| `search_knowledge_base` | 从知识库检索已导入文章 |
| `generate_topics` | 基于赛道、知识库和记忆生成候选选题 |
| `generate_full_article` | 生成可发布级公众号完整初稿 |
| `compliance_check` | 检查标题、摘要、正文的合规风险 |

### 工具记忆配置

每个工具在注册时声明记忆配置：

```typescript
export interface ToolMemoryConfig {
  recordInput: boolean;    // 是否记录输入
  recordOutput: boolean;   // 是否记录输出
  recordError: boolean;    // 是否记录错误
  extractMemory?: (result: unknown) => Record<string, unknown> | null;
}
```

工具执行时自动通过 `wrapWithMemoryLogging` 记录到 `session_memory` 表。

## 深度思考（Deep Thinking）

项目支持火山引擎豆包模型的深度思考能力：

- 模型在回答前进行多步骤推理分析（Chain of Thought）
- 适合复杂场景：编程、科学推理、Agent 工作流等
- 流式输出已启用，降低深度思考场景下的超时风险

**当前实现**：

- 基于 `lib/llm.ts` 的 OpenAI 兼容流式处理
- SSE 返回的事件类型：`reasoning_start` → `reasoning_chunk` → `reasoning_end`

**工作流程**：

1. 用户发送消息 → API 路由接收
2. 构建系统提示词（注入记忆 + KOC 情报）
3. 流式调用 LLM（`streamChat`）
4. 模型输出思维链（reasoning_content）+ 最终回答
5. SSE 流式返回给前端

## 对话 API 架构

**核心路由**：`app/api/conversations/[id]/messages/route.ts`

**工作流程**：
1. 构建系统提示词（注入 KOC 情报 + 热点 + 记忆）
2. 流式调用 LLM（SSE，NDJSON 多事件类型）
3. 处理工具调用（通过 `AGENT_TOOL_REGISTRY`）
4. 工具执行自动记录到 `session_memory`
5. 捕获记忆并保存到 Supabase

**SSE 事件类型**：

| 事件类型 | 说明 |
|----------|------|
| `text` | 普通文本内容 |
| `reasoning_start` / `reasoning_chunk` / `reasoning_end` | 深度思考过程 |
| `assistant_status` | 助手状态标签 |
| `koc_recommendation_ready` | KOC 推荐数据就绪 |
| `tool_call` / `tool_result` | 工具调用及结果 |

## 记忆系统（四层架构）

### 1. 工作记忆（Working Memory）
- 当前对话的 messages 数组
- 临时上下文，对话结束即释放

### 2. 情景记忆（Session/Episodic Memory）
- 存储在 `session_memory` 表
- 按 conversation_id 分组
- 记录每次工具调用、结果、观察、反思
- 支持从记忆中恢复对话状态

**核心 API**（`lib/agent/memory/session-memory.ts`）：

| 函数 | 功能 |
|------|------|
| `recordStep` | 记录一个步骤到情景记忆 |
| `getSessionSteps` | 获取某个对话的所有步骤 |

**步骤类型**：`thought` | `plan` | `tool_call` | `tool_result` | `observation` | `reflection`

### 3. 长期记忆（Long-term Memory）
- 使用 `lib/memory.ts` 提供的函数：

| 函数 | 功能 |
|------|------|
| `getUserMemory` / `saveUserMemory` | 用户记忆（跨旅程） |
| `getJourneyMemory` / `saveJourneyMemory` | 旅程记忆（项目级） |
| `getJourneyProjectMemory` / `saveJourneyProjectMemory` | 项目记忆（策略卡片） |
| `appendJourneyMemory` | 追加旅程记忆 |
| `captureMessageMemory` | 捕获消息中的记忆 |
| `compactAndSaveMemory` | 合并新事实到现有记忆文档 |

### 4. 技能记忆（Skill Memory）
- 从情景记忆中提取工具使用模式
- 加速相似任务（规划中）

**记忆注入流程**：

```
buildSystemPrompt
    ├── getUserMemory          → 用户全局记忆
    ├── getJourneyMemory       → 当前旅程记忆
    ├── getJourneyProjectMemory → 项目策略卡片
    ├── getSessionSteps        → 情景记忆摘要
    ├── KOC 情报（top 12）
    ├── 爆款文章（top 8）
    └── 热点信息
           ↓
      完整 system prompt → LLM
```

## 开发注意事项

1. **使用 Server Components 优先**：Next.js 16 中默认是 Server Components
2. **SSE 流式响应**：对话使用 Server-Sent Events，返回 NDJSON 多事件类型
3. **Supabase RLS**：数据库使用行级安全策略，确保权限正确
4. **OpenClaw 记忆驱动**：新工具自动记录到 `session_memory`，无需手动处理
5. **Ant Design X**：聊天 UI 使用 `@ant-design/x` 组件（Bubble、Conversations、Sender 等）
6. **CSS 变量设计系统**：颜色/字体通过 `globals.css` 中的 CSS 变量定义
7. **微信发布链路**：文章排版 → 草稿保存 → 微信草稿箱发布

## 环境变量

```env
# LLM / API
OPENAI_API_KEY=                      # 火山引擎 Ark / 豆包 API Key
ARK_MODEL_ID=                        # 火山引擎模型端点

# 数据源
DAJIALA_API_KEY=                     # 大佳啦 API Key
TAVILY_API_KEY=                      # Tavily API Key

# 微信
WECHAT_CREDENTIALS_SECRET=            # 微信凭证加密密钥
WECHAT_GATEWAY_URL=                   # 微信网关地址（可选）
WECHAT_GATEWAY_TOKEN=                 # 微信网关 Token（可选）

# Supabase
NEXT_PUBLIC_SUPABASE_URL=            # Supabase URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=       # Supabase 匿名 Key
SUPABASE_SERVICE_ROLE_KEY=           # Supabase Service Role Key
```

更多环境变量说明请参考 `.env.example`。

## 常见任务

### 添加新的 Agent 工具

1. 在 `lib/agent/tools/` 创建工具文件
2. 定义 Zod schema 和工具定义：

```typescript
import { z } from "zod";
import { createToolDefinition } from "./registry";
import type { ToolExecutionContext } from "./types";

export const myToolSchema = z.object({
  param1: z.string().describe("参数说明"),
  param2: z.number().optional().describe("可选参数"),
});

export async function runMyTool(
  args: z.infer<typeof myToolSchema>,
  context: ToolExecutionContext
) {
  // 实现工具逻辑
  return { result: "..." };
}
```

3. 在 `lib/agent/tools/registry.ts` 注册工具：

```typescript
import { myToolSchema, runMyTool } from "./my-tool";

export const AGENT_TOOL_REGISTRY = {
  // ... 其他工具
  my_tool: {
    definition: createToolDefinition(
      "my_tool",
      "工具功能描述",
      myToolSchema,
      { recordInput: true, recordOutput: true }
    ),
    execute: wrapWithMemoryLogging(
      createToolDefinition("my_tool", "工具功能描述", myToolSchema),
      runMyTool
    ),
  },
} as const;
```

工具会自动记录到 `session_memory`，无需额外代码。

### 修改系统提示词

编辑 `lib/system-prompt.ts` 中的 `buildSystemPrompt` 函数。

### 记忆系统操作

使用 `lib/memory.ts` 提供的函数，或直接使用 `lib/agent/memory/session-memory.ts` 记录情景记忆步骤。

### 数据库迁移

```bash
supabase db push
```

当前最新迁移：`016_add_session_memory.sql`
