# CLAUDE.md - Niche 开发者指南

## 快速开始

```bash
bun install
bun dev
```

## 项目简介

Niche 是一个面向微信公众号创作者的 AI 内容工作台。

当前最稳定的产品主链：

1. 导入对标公众号
2. 分析爆款规律
3. 生成选题
4. 生成完整稿
5. 进入排版
6. 发布到公众号草稿箱

项目已经开始接入“公众号导入后自动发现绑定视频号”的能力。

## 当前架构原则

### 1. 工作流驱动架构（Workflow-Driven）
当前采用**意图路由 + 工作流定义 + 单次模型调用**的架构模式：
- `chat-intent-router` —— 识别用户意图（topics/full_article/fast_generation 等）
- `chat-workflows` —— 每个意图对应预定义的工作流（historyLimit + prefetch + generation）
- `chat-generation` —— 单次流式模型调用生成最终输出

### 2. 数据预取与提示词构建分离
- `chat-prefetch` —— 在工作流定义的阶段并行执行数据预取
- `chat-prompt` —— 根据预取数据动态构建 compact prompt
- `chat-runtime` —— 统一运行时类型定义

### 3. 产物直出原则
产物型工作流（topics、full_article 等）的结果直接作为模型输出，不经过二次加工或总结层。

### 4. 记忆只做后台沉淀
- `chat-memory-finalize` —— 对话结束后异步写入长期记忆
- `chat-workflow-state` —— 关键工作流状态（latest_topics、latest_full_article 等）持久化到 session_memory
- 记忆系统不直接参与当前轮次的回答生成

## 技术栈

- Next.js 16 + React 19
- TypeScript 5
- Supabase + RLS + pgvector
- OpenAI SDK 兼容接口（火山引擎 Ark / 豆包）
- Ant Design + Ant Design X
- Zod
- 大佳啦 API
- Tavily

## 对话架构（新）

当前采用**工作流驱动架构（Workflow-Driven Architecture）**：

```
用户消息
    ↓
chat-intent-router → 识别意图 (topics/full_article/fast_generation...)
    ↓
chat-workflows → 获取工作流定义 (historyLimit + prefetch + generation)
    ↓
chat-prefetch → 并行执行数据预取
    ↓
chat-prompt → 构建 compact prompt
    ↓
单次模型流式调用 → 直出结果
    ↓
chat-output → 格式化输出
    ↓
chat-memory-finalize → 异步沉淀记忆
chat-workflow-state → 持久化工作流状态
```

### 核心模块

| 模块 | 职责 |
|------|------|
| `chat-intent-router.ts` | 意图识别、控制动作检测、历史长度配置 |
| `chat-workflows.ts` | 工作流定义（13种意图的全配置） |
| `chat-generation.ts` | 单次流式生成、确定性降级响应 |
| `chat-prefetch.ts` | 数据预取并行执行、工具调用观测 |
| `chat-prompt.ts` | Compact prompt 构建、意图指令生成 |
| `chat-runtime.ts` | 共享类型定义（PrefetchedContext, JourneySnapshot等） |
| `chat-output.ts` | 输出格式化、fallback 消息构建 |
| `chat-memory-finalize.ts` | 异步记忆沉淀（user_memories, journey_project_memories） |
| `chat-workflow-state.ts` | 工作流状态持久化（latest_topics/latest_full_article等） |

### 工作流定义示例

```typescript
// CHAT_WORKFLOWS[ intent -> definition ]
topics: {
  intent: "topics",
  historyLimit: 2,
  prefetch: ["journey_analysis"],
  generation: "topics_output"
}

full_article: {
  intent: "full_article",
  historyLimit: 3,
  prefetch: ["journey_analysis", "knowledge_refs", "semantic_refs"],
  generation: "article_output"
}
```

### 已移除的模块

- `lib/agent/tools/compliance-check.ts` —— 合规检查不再参与主流程
- `lib/agent/tools/registry.ts` —— 旧版工具注册表
- `lib/system-prompt.ts` —— 系统提示词已拆分到 chat-prompt.ts

## 当前核心模块

### 对话架构（新 Workflow-Driven）

| 模块 | 文件 | 职责 |
|------|------|------|
| Intent Router | [lib/chat-intent-router.ts](/D:/dev/my-project/niche/lib/chat-intent-router.ts) | 识别 10 种用户意图，控制动作检测 |
| Workflow Registry | [lib/chat-workflows.ts](/D:/dev/my-project/niche/lib/chat-workflows.ts) | 定义 10 种工作流（historyLimit + prefetch + generation） |
| Prefetch Engine | [lib/chat-prefetch.ts](/D:/dev/my-project/niche/lib/chat-prefetch.ts) | 并行执行数据预取，工具调用观测 |
| Prompt Builder | [lib/chat-prompt.ts](/D:/dev/my-project/niche/lib/chat-prompt.ts) | Compact prompt 构建，意图指令生成 |
| Generation Engine | [lib/chat-generation.ts](/D:/dev/my-project/niche/lib/chat-generation.ts) | 单次流式模型调用，确定性降级响应 |
| Output Formatter | [lib/chat-output.ts](/D:/dev/my-project/niche/lib/chat-output.ts) | 输出格式化，fallback 消息构建 |
| Memory Finalizer | [lib/chat-memory-finalize.ts](/D:/dev/my-project/niche/lib/chat-memory-finalize.ts) | 异步沉淀长期记忆 |
| Workflow State | [lib/chat-workflow-state.ts](/D:/dev/my-project/niche/lib/chat-workflow-state.ts) | 工作流状态持久化 |
| Runtime Types | [lib/chat-runtime.ts](/D:/dev/my-project/niche/lib/chat-runtime.ts) | 共享类型定义 |

### API 路由
- [app/api/conversations/[id]/messages/route.ts](/D:/dev/my-project/niche/app/api/conversations/[id]/messages/route.ts) —— SSE 输出，工作流编排

### 文章提取与排版
- [lib/article-layout.ts](/D:/dev/my-project/niche/lib/article-layout.ts)
- [components/chat/ArticleLayoutPanel.tsx](/D:/dev/my-project/niche/components/chat/ArticleLayoutPanel.tsx)

职责：
- 从 assistant 消息中提取完整稿
- 转成可排版 Markdown / 微信 HTML

### 记忆系统
- [lib/memory.ts](/D:/dev/my-project/niche/lib/memory.ts)
- [lib/agent/memory/session-memory.ts](/D:/dev/my-project/niche/lib/agent/memory/session-memory.ts)

当前层次：
- `session_memory`
- `user_memories`
- `journey_project_memories`

### 公众号 / 视频号导入
- [lib/koc-import.ts](/D:/dev/my-project/niche/lib/koc-import.ts)
- [lib/wxvideo-import.ts](/D:/dev/my-project/niche/lib/wxvideo-import.ts)
- [lib/dajiala.ts](/D:/dev/my-project/niche/lib/dajiala.ts)

## 预取节点清单（Deterministic Prefetch Nodes）

当前工作流预取节点（在 `chat-prefetch.ts` 中实现）：

| 节点名称 | 对应工具 | 说明 |
|----------|----------|------|
| `journey_analysis` | `analyze_journey_data` | 分析旅程样本数据 |
| `wxvideo_analysis` | `analyze_wxvideo_data` | 分析视频号样本数据 |
| `publish_timing` | `analyze_publish_timing` | 分析最佳发布时间 |
| `knowledge_refs` | `searchJourneyKnowledge` | 检索知识库 |
| `semantic_refs` | `retrieveSemanticCompetitorContent` | 语义检索竞品内容 |
| `import_koc` | `import_koc_by_name` | 导入对标账号 |

说明：
- `compliance_check` 已不参与聊天主流程
- 预取节点在工作流定义中配置，由 `chat-prefetch.ts` 统一调度

## 视频号接入现状

当前已经支持：
- 从已导入公众号拿到 `ghid`
- 调 `history_by_ghid` 发现绑定视频号
- 拉视频号作品列表
- 拉互动指标
- 写入 `wxvideo_sources` / `wxvideo_posts`

对应文件：
- [lib/wxvideo-import.ts](/D:/dev/my-project/niche/lib/wxvideo-import.ts)
- [supabase/migrations/020_add_wxvideo_tables.sql](/D:/dev/my-project/niche/supabase/migrations/020_add_wxvideo_tables.sql)

## 当前最重要的开发方向

### Day 1 - 工作流架构稳定
- 确保 10 种意图工作流全部可运行
- 验证 `full_article` 主链（写稿→排版→发布）
- 确保 `topics`、`fast_generation` 高频意图稳定

### Day 2 - 测试覆盖
- 意图路由测试（`chat-intent-router.test.ts`）
- 工作流状态测试（`latest_topics`、`latest_full_article` 存取）
- 生成模块测试（`chat-generation.test.ts`）

### Day 3 - 视频号能力补全
- 把视频号导入状态接进 KOC 页面
- 让用户能看到”已发现绑定视频号 / 已同步样本”
- 验证 `wxvideo_analysis`、`video_script` 工作流

## 测试

运行：

```bash
npm test
```

当前主要是最小 smoke tests，不是完整测试体系。

### 新增测试文件

- `tests/chat-generation.test.ts` —— 生成模块测试
- `tests/chat-intent-router.test.ts` —— 意图路由测试

## 环境变量

```env
OPENAI_API_KEY=
ARK_MODEL_ID=

DAJIALA_API_KEY=
TAVILY_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

WECHAT_CREDENTIALS_SECRET=
WECHAT_GATEWAY_URL=
WECHAT_GATEWAY_TOKEN=
```
