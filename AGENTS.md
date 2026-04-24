<!-- BEGIN:nextjs-agent-rules -->
# Next.js 代理规则

这是一个 Next.js 16 项目，使用 App Router。在编写代码前，请务必阅读 node_modules/next/dist/docs/ 中的相关指南，并注意弃用警告。

<!-- END:nextjs-agent-rules -->

# Niche 项目代理指南

## 项目概述

Niche 是一个 AI 驱动的内容创作助手，专为微信公众号创作者设计。

**核心技术栈**：
- Next.js 16.2.4 + React 19.2.4 (App Router)
- TypeScript 5
- Supabase (PostgreSQL + RLS)
- Ant Design v6 + Ant Design X v2（聊天气泡、会话列表等）
- CSS 变量设计系统（Editorial Dark / Light 主题）
- OpenAI SDK（连接火山引擎 Ark / 豆包 API）
- **LangChain 1.3.4 + LangGraph 1.2.9**（Agent 工具编排）
- **LangSmith**（可观测性/追踪）
- 大佳啦 API（微信公众号数据）+ Tavily 搜索 + TikHub API

## 代码规范

### 目录结构

```
app/                           # Next.js App Router
├── (app)/                     # 已认证页面（带侧边栏布局）
├── (auth)/                    # 登录/注册页面
└── api/                       # API 路由
    ├── conversations/[id]/messages/  # Agent 对话核心（SSE 流式）
    ├── journeys/              # 旅程管理
    ├── koc/                   # KOC 导入/同步
    ├── wechat/                # 微信发布/分析
    ├── memory/                # 记忆系统
    └── article-layout/        # 文章排版

lib/                           # 共享库代码
├── agent/                     # **Agent 工具系统（LangChain 架构）**
│   ├── models.ts              # LangChain 模型工厂
│   ├── tracing.ts             # LangSmith 追踪配置
│   ├── chains/                # LangChain 链式调用
│   ├── schemas/               # Zod schema 定义
│   └── tools/                 # Agent 工具定义和实现
│       ├── registry.ts        # 工具注册表
│       ├── helpers.ts          # 工具定义类型转换
│       ├── types.ts            # 工具执行上下文
│       ├── search-hot-topics.ts
│       ├── analyze-journey-data.ts
│       ├── search-knowledge-base.ts
│       ├── generate-topics.ts
│       ├── generate-full-article.ts
│       └── compliance-check.ts
├── llm.ts                     # 豆包 LLM 客户端（OpenAI 兼容）
├── system-prompt.ts           # 系统提示词构建
├── memory.ts                  # 记忆系统（用户记忆 + 旅程记忆）
├── knowledge-base.ts          # 知识库搜索
├── hot-topic-search.ts        # 热点话题搜索
├── dajiala.ts                 # 大佳啦 API 客户端
├── wechat-publish.ts           # 微信发布（草稿箱、图片上传）
├── wechat-owned-analysis.ts    # 自有公众号分析
├── article-layout.ts           # 文章排版引擎
├── koc-import.ts               # KOC 导入逻辑
└── data.ts                    # 静态数据（赛道树、内容类型等）

components/
├── chat/                      # 聊天 UI 组件
├── sidebar/                   # 侧边栏组件
└── providers/                 # Ant Design 主题 Provider

wechat-gateway/               # 微信 API 代理网关（独立 Node.js 服务）
```

### 关键文件

| 文件 | 说明 |
|------|------|
| `app/api/conversations/[id]/messages/route.ts` | Agent 对话核心（SSE 流式响应 + 工具调用） |
| `lib/llm.ts` | 豆包 LLM 客户端（streamChat / chat / completeWithTools） |
| `lib/system-prompt.ts` | 系统提示词构建（注入 KOC 情报 + 热点 + 记忆） |
| `lib/memory.ts` | 记忆系统（用户记忆 + 旅程记忆 + 项目记忆） |
| `lib/agent/tools/registry.ts` | Agent 工具注册表 |
| `lib/agent/models.ts` | LangChain 模型工厂 |
| `lib/agent/tracing.ts` | LangSmith 追踪配置 |
| `lib/data.ts` | 静态数据（赛道树、内容类型、平台列表） |
| `lib/dajiala.ts` | 大佳啦 API 客户端 |
| `lib/article-layout.ts` | 文章排版引擎（Markdown → 微信 HTML） |
| `lib/wechat-publish.ts` | 微信发布（草稿箱、图片上传、DataCube 指标） |
| `lib/wechat-owned-analysis.ts` | 自有公众号分析（同步文章 + LLM 分析报告） |
| `lib/koc-import.ts` | KOC 导入逻辑（大佳啦 → Supabase） |
| `lib/knowledge-base.ts` | 知识库搜索 |

## Agent 工具系统

### 架构概览

项目使用 LangChain 进行 Agent 工具编排：

1. **模型工厂**（`lib/agent/models.ts`）
   - `getPrimaryChatModel()` - 主对话模型
   - `getStructuredOutputModel()` - 结构化输出模型
   - `getFastExtractionModel()` - 快速提取模型

2. **工具注册表**（`lib/agent/tools/registry.ts`）
   - 所有 Agent 工具在此注册
   - 生成 OpenAI 兼容的工具定义

3. **工具类型系统**（`lib/agent/tools/`）
   - `helpers.ts` - Zod Schema → OpenAI Tool 转换
   - `types.ts` - 工具执行上下文类型

4. **LangSmith 追踪**（`lib/agent/tracing.ts`）
   - `buildAgentRunConfig()` - 配置追踪元数据

### 可用工具

| 工具名称 | Schema | 功能 |
|----------|--------|------|
| `search_hot_topics` | query, days, max_results | 搜索当前赛道近 N 天热点（Tavily + 大佳啦） |
| `analyze_journey_data` | focus (viral_patterns/koc_summary/topic_generation) | 分析旅程下 KOC 和爆款文章，提取规律 |
| `search_knowledge_base` | query, limit, account_names | 从知识库检索已导入文章 |
| `generate_topics` | count, goal, timeframe | 基于赛道、知识库和记忆生成候选选题 |
| `generate_full_article` | topic_title, angle, style | 生成可发布级公众号完整初稿 |
| `compliance_check` | title, summary, article_markdown | 检查标题、摘要、正文的合规风险 |

### LangChain 链

| 链 | 功能 | 文件 |
|----|------|------|
| `growth-analysis` | 增长分析（结构化输出） | `lib/agent/chains/growth-analysis.ts` |

## 开发时注意事项

1. **使用 Server Components 优先**：Next.js 16 中默认是 Server Components
2. **SSE 流式响应**：对话使用 Server-Sent Events，参考 `app/api/conversations/[id]/messages/route.ts`
3. **Supabase RLS**：数据库使用行级安全策略，确保权限正确
4. **记忆系统**：使用 `lib/memory.ts` 读写 Markdown 记忆
5. **LangChain 集成**：新工具优先使用 LangChain 模式，支持结构化输出和追踪
6. **Ant Design X**：聊天 UI 使用 `@ant-design/x` 组件（Bubble、Conversations、Sender 等）
7. **CSS 变量设计系统**：颜色/字体通过 `globals.css` 中的 CSS 变量定义，支持暗色/亮色主题切换
8. **微信发布链路**：文章排版 → 草稿保存 → 微信草稿箱发布，需配置 `WECHAT_CREDENTIALS_SECRET` 加密密钥

## 常见任务

### 添加新的 Agent 工具

1. 在 `lib/agent/tools/` 创建工具文件
2. 定义 Zod schema 和工具定义：
```typescript
import { z } from "zod";
import type { AgentToolDefinition } from "./helpers";
import type { ToolExecutionContext } from "./types";

export const myToolSchema = z.object({
  param1: z.string().describe("参数说明"),
  param2: z.number().optional().describe("可选参数"),
});

export const myToolDefinition: AgentToolDefinition<typeof myToolSchema> = {
  name: "my_tool",
  description: "工具功能描述",
  schema: myToolSchema,
};

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
import { myToolDefinition, runMyTool } from "./my-tool";

export const AGENT_TOOL_REGISTRY = {
  // ... 其他工具
  my_tool: {
    definition: myToolDefinition,
    execute: runMyTool,
  },
} as const;
```

### 添加新的 LangChain 链

1. 在 `lib/agent/chains/` 创建链文件
2. 使用结构化输出模型：
```typescript
import { getStructuredOutputModel } from "@/lib/agent/models";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

export async function runMyChain(params: { /* 参数 */ }) {
  const model = getStructuredOutputModel().withStructuredOutput(
    MySchema,
    { name: "MyOutput", strict: true }
  );

  return model.invoke(
    prompt,
    buildAgentRunConfig({
      runName: "my-chain",
      tags: ["my-tag"],
      metadata: { /* 自定义元数据 */ },
    })
  );
}
```

### 修改系统提示词

编辑 `lib/system-prompt.ts` 中的 `buildSystemPrompt` 函数。

### 记忆系统操作

使用 `lib/memory.ts` 提供的函数：

| 函数 | 功能 |
|------|------|
| `getUserMemory` / `saveUserMemory` | 用户记忆（跨旅程） |
| `getJourneyMemory` / `saveJourneyMemory` | 旅程记忆（项目级） |
| `getJourneyProjectMemory` / `saveJourneyProjectMemory` | 项目记忆（策略卡片） |
| `appendJourneyMemory` | 追加旅程记忆 |
| `captureMessageMemory` | 捕获消息中的记忆 |

## 环境变量

```env
# LLM / API
OPENAI_API_KEY=                      # 火山引擎 Ark / 豆包 API Key
ARK_MODEL_ID=                        # 火山引擎模型端点

# LangSmith（可选）
LANGSMITH_TRACING=true               # 启用 LangSmith 追踪
LANGSMITH_API_KEY=                   # LangSmith API Key

# 微信
WECHAT_CREDENTIALS_SECRET=            # 微信凭证加密密钥

# Supabase
NEXT_PUBLIC_SUPABASE_URL=            # Supabase URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=       # Supabase 匿名 Key
SUPABASE_SERVICE_ROLE_KEY=           # Supabase Service Role Key
```