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
- Ant Design v6 + Ant Design X v2（聊天气泡、会话列表等）
- CSS 变量设计系统（Editorial Dark / Light 主题）
- OpenAI SDK（连接火山引擎 Ark / 豆包 API）
- 大佳啦 API（微信公众号数据）+ Tavily 搜索 + TikHub API

## 代码规范

### 目录结构
- `app/`：Next.js App Router 页面和 API 路由
- `app/(app)/`：已认证页面（带侧边栏布局）
- `app/(auth)/`：登录/注册页面
- `app/api/`：14 个 API 路由（旅程、对话、KOC、记忆、排版、微信发布等）
- `lib/`：共享库代码（LLM、Supabase、API 客户端、工具函数等）
- `components/chat/`：聊天 UI 组件（ChatArea、AccountAnalysisModal、ArticleLayoutPanel）
- `components/sidebar/`：侧边栏组件（Sidebar、KOCListPanel）
- `components/providers/`：Ant Design 主题 Provider
- `wechat-gateway/`：微信 API 代理网关（独立 Node.js 服务）

### 关键文件
- `app/api/conversations/[id]/messages/route.ts`：Agent 对话核心（SSE 流式响应 + 工具调用）
- `lib/llm.ts`：豆包 LLM 客户端（streamChat / chat / completeWithTools）
- `lib/system-prompt.ts`：系统提示词构建（注入 KOC 情报 + 热点 + 记忆）
- `lib/memory.ts`：记忆系统（用户记忆 + 旅程记忆）
- `lib/data.ts`：静态数据（赛道树、内容类型、平台列表）
- `lib/dajiala.ts`：大佳啦 API 客户端（公众号文章、阅读数据、爆款搜索）
- `lib/article-layout.ts`：文章排版引擎（Markdown → 微信 HTML）
- `lib/wechat-publish.ts`：微信发布（草稿箱、图片上传、DataCube 指标）
- `lib/wechat-owned-analysis.ts`：自有公众号分析（同步文章 + LLM 分析报告）
- `lib/koc-import.ts`：KOC 导入逻辑（大佳啦 → Supabase）
- `lib/knowledge-base.ts`：知识库搜索

## 开发时注意事项

1. **使用 Server Components 优先**：Next.js 16 中默认是 Server Components
2. **SSE 流式响应**：对话使用 Server-Sent Events，参考现有实现
3. **Supabase RLS**：数据库使用行级安全策略，确保权限正确
4. **记忆系统**：使用 `lib/memory.ts` 读写 Markdown 记忆
5. **工具调用**：Agent 工具定义在对话 API 路由中
6. **Ant Design X**：聊天 UI 使用 `@ant-design/x` 组件（Bubble、Conversations、Sender 等）
7. **CSS 变量设计系统**：颜色/字体通过 `globals.css` 中的 CSS 变量定义（`--accent`、`--bg-void` 等），支持暗色/亮色主题切换
8. **微信发布链路**：文章排版 → 草稿保存 → 微信草稿箱发布，需配置 `WECHAT_CREDENTIALS_SECRET` 加密密钥

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
