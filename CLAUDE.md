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

### 1. 工具产物直接给用户
像下面这些产物型工具：
- `generate_topics`
- `generate_full_article`

它们的结果应优先直接作为用户输出，而不是再套一层总结模型。

### 2. memory 总结只做后台沉淀
记忆系统的职责是：
- 帮下一轮更懂用户
- 帮策略持续收敛
- 帮工作流保留上下文

不是拿来替代用户最终答案。

### 3. 单 Agent + 快捷路径
当前不是完整多 Agent 调度，而是：
- 单 Agent
- 工具调用
- 高频场景快捷路径

目标是先把主链做稳、做顺。

## 技术栈

- Next.js 16 + React 19
- TypeScript 5
- Supabase + RLS + pgvector
- OpenAI SDK 兼容接口（火山引擎 Ark / 豆包）
- Ant Design + Ant Design X
- Zod
- 大佳啦 API
- Tavily

## 当前核心模块

### 对话主链
- [app/api/conversations/[id]/messages/route.ts](/D:/dev/my-project/niche/app/api/conversations/[id]/messages/route.ts)

职责：
- SSE 输出
- 快捷路径判断
- 工具调用循环
- 用户结果输出
- 后台 memory 沉淀

### 输出拼装
- [lib/chat-output.ts](/D:/dev/my-project/niche/lib/chat-output.ts)

职责：
- 将工具结果转换成最终可见回答
- 避免“工具成功但最后空回答”

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

## 工具清单

当前主工具：
- `search_hot_topics`
- `search_wechat_hot_articles`
- `import_koc_by_name`
- `analyze_journey_data`
- `search_knowledge_base`
- `generate_topics`
- `generate_full_article`

说明：
- `compliance_check` 已不参与聊天主流程
- 不要再把它当主链能力继续扩

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

### Day 1
- 稳定“写稿 -> 排版 -> 发布”
- 确保完整稿直出
- 确保排版入口稳定存在

### Day 2
- 补最小测试：
  - 文章提取
  - 工具结果直出

### Day 3
- 把视频号导入状态接进 KOC 页面
- 让用户能看到“已发现绑定视频号 / 已同步样本”

## 测试

运行：

```bash
npm test
```

当前主要是最小 smoke tests，不是完整测试体系。

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
