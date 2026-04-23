<!-- BEGIN:nextjs-agent-rules -->
# Next.js 代理规则

这是一个 Next.js 16 项目，使用 App Router。在编写代码前，请务必阅读 node_modules/next/dist/docs/ 中的相关指南，并注意弃用警告。

<!-- END:nextjs-agent-rules -->

# Niche 项目代理指南

## 项目概述

Niche 是一个 AI 驱动的内容创作助手，专为微信公众号创作者设计。

**核心技术栈**：
- Next.js 16 + React 19 (App Router)
- TypeScript
- Supabase (PostgreSQL + RLS)
- Tailwind CSS + HeroUI
- OpenAI SDK (连接火山引擎 Ark)
- Tavily 搜索 + 大佳啦 API

## 代码规范

### 目录结构
- `app/`：Next.js App Router 页面和 API 路由
- `lib/`：共享库代码，包括 API 客户端、工具函数等
- `components/`：React 组件（如果有的话）

### 关键文件
- `app/api/conversations/[id]/messages/route.ts`：Agent 对话核心（SSE 流式响应）
- `lib/llm.ts`：LLM 客户端
- `lib/memory.ts`：记忆系统
- `lib/system-prompt.ts`：系统提示词构建
- `lib/data.ts`：静态数据（赛道、内容类型等）

## 开发时注意事项

1. **使用 Server Components 优先**：Next.js 16 中默认是 Server Components
2. **SSE 流式响应**：对话使用 Server-Sent Events，参考现有实现
3. **Supabase RLS**：数据库使用行级安全策略，确保权限正确
4. **记忆系统**：使用 `lib/memory.ts` 读写 Markdown 记忆文件
5. **工具调用**：Agent 工具定义在对话 API 路由中

## 常见任务

### 添加新的 Agent 工具
在 `app/api/conversations/[id]/messages/route.ts` 中的 `AGENT_TOOLS` 数组添加工具定义，并在 `executeTool` 函数中实现逻辑。

### 修改系统提示词
编辑 `lib/system-prompt.ts` 中的 `buildSystemPrompt` 函数。

### 记忆系统操作
使用 `lib/memory.ts` 提供的函数：
- `getUserMemory` / `saveUserMemory`
- `getJourneyMemory` / `saveJourneyMemory`
- `appendJourneyMemory`
- `captureMessageMemory`
