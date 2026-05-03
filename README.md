# Niche

Niche 现在更准确的定位，不再是“AI 内容工作台”，而是一个：

# 写作前台 + 单核心对标 + 我的公众号复盘 + 认知记忆

它服务的不是“如何调用更多工具”，而是：

- 帮创作者写
- 帮创作者研究一个值得长期学习的对象
- 帮创作者沉淀自己的认知和内容资产
- 帮创作者用自己的公众号数据持续复盘

一句话概括：

> 你负责写，系统负责记住你、看透一个核心对标，并把这些东西慢慢长成你的内容资产。

---

## 当前产品定位

Niche 当前的真实产品形态是：

- **前台是写作**：用户主要通过对话和写作推进内容，而不是操作复杂流程
- **核心对标只有一个**：不再强调多 KOC 列表管理，而是围绕一个核心对象长期深挖
- **我的公众号是复盘入口**：先看自己的内容表现，再把复盘沉淀成知识
- **我的认知是长期母本**：系统持续把每轮对话中的判断、经历、问题、主题提炼进 memory

适用用户：

- 微信公众号创作者
- 正在冷启动或增长爬坡阶段的个人创作者 / KOC
- 想研究某个强对标账号，但不想只停留在表面模仿的人
- 想一边写、一边形成自己的长期内容资产的人

---

## 当前产品主线

Niche 现在最稳定的主线已经从旧版的：

```text
导入对标账号 -> 分析规律 -> 生成选题 -> 生成完整稿 -> 排版 -> 发布
```

逐步收敛成：

```text
写作 / 提问
-> 判断是否需要继续深入
-> 必要时补核心对标 / 自己历史内容 / web search
-> 生成分析结果或文章
-> 排版 / 发布
-> 本轮认知精华进入 memory
-> 我的公众号复盘继续反哺后续写作
```

这个变化很关键：

- 不再默认“用户一说写，就立刻成稿”
- 更强调“先搞清楚你到底想说什么”
- 更强调“你自己的内容、判断、复盘”会逐渐进入系统上下文

---

## 当前产品原则

### 1. 写作是前台

用户感知里，Niche 首先是一个写作系统，而不是工具集合。

### 2. 工具全部后台化

分析、搜索、知识检索、对标导入、发布时间分析等能力仍然存在，但不再作为前台主叙事。

### 3. 单核心对标优先

产品强调围绕一个核心对象长期研究：

- 它为什么能爆
- 它的爆款逻辑是什么
- 你真正能学什么

### 4. 我的公众号偏复盘层，底层是知识层

前台是内容复盘，底层是把自己的文章变成后续写作可用的知识。

### 5. memory 是核心能力

每轮对话都尽量提炼：

- 本轮认知精华
- 候选判断
- 候选未想透问题
- 候选关键经历
- 候选长期主题
- 候选对标启发

让系统越来越懂这个用户，而不是只记流程结果。

### 6. 少规则，强 prompt

系统尽量避免越来越复杂的显式意图链路。

当前方向是：

- 保留少量 heuristic 兜底
- 主要通过 prompt 让 AI 主动判断
- 当用户表达明显空时，只问一句最关键的问题

---

## 当前已实现能力

### 1. 核心对标

- 支持通过公众号名称、文章链接等导入对标账号
- `journeys.primary_koc_source_id` 支持单核心对标
- 侧边栏已从 KOC 列表心智收敛为“核心对标”
- 分析核心对标时，系统优先回答：
  - 它为什么能爆
  - 它的爆款逻辑是什么
  - 你能学什么

相关文件：

- `components/sidebar/KOCListPanel.tsx`
- `app/api/koc/import/route.ts`
- `lib/koc-import.ts`
- `lib/chat-prompt.ts`

### 2. 我的公众号

- 可配置自己的公众号名称
- 配置后会像导入 KOC 一样同步自己的文章与统计
- 写入 `owned_wechat_profiles` / `owned_wechat_articles`
- “我的公众号”详情页支持：
  - 基础复盘
  - Top articles
  - AI insights
  - 与核心对标的对照复盘

相关文件：

- `components/sidebar/DashboardPanel.tsx`
- `app/api/wechat/dashboard/route.ts`
- `app/(app)/journey/[id]/dashboard/page.tsx`

### 3. 我的认知

- 用户长期 memory 已从“身份配置”逐渐转成“认知母本”
- memory 主要围绕：
  - 我反复在意的问题
  - 我目前形成的判断
  - 我还没想透的问题
  - 我的关键经历
  - 我的长期主题
  - 当前核心对标
  - 我从核心对标学到的可迁移资产

相关文件：

- `lib/memory.ts`
- `app/(app)/profile/page.tsx`
- `app/(app)/profile/IdentityForm.tsx`

### 4. prompt 驱动主动提问

- 不再默认一上来就完整成稿
- 对高认知密度写作，系统会优先判断当前缺哪层认知材料
- 当用户表达明显空时，优先只问一句最关键的问题
- 用户明确说“直接写”时，可以跳过提问，直接成稿

相关文件：

- `lib/chat-prompt.ts`
- `lib/cognitive-gap.ts`

### 5. web search 补知识

- 当遇到明显的事件缺口、陌生名词、最近/最新动态等场景时，会自动补网页资料
- “热点搜索”心智已逐渐收敛为更通用的 `web_search`

相关文件：

- `lib/chat-prefetch.ts`
- `lib/web-search.ts`

### 6. 自己的文章进入写作上下文

- `owned_wechat_articles` 已进入写作预取链
- 后续写作和分析不只看对标内容，也会看用户自己的历史文章

相关文件：

- `lib/agent/retrievers/owned-content.ts`
- `lib/chat-prefetch.ts`

### 7. 排版与发布

- 支持文章结构识别
- 支持公众号 HTML 排版
- 支持保存到公众号草稿箱

相关文件：

- `lib/article-layout.ts`
- `components/chat/ArticleLayoutPanel.tsx`
- `lib/wechat-publish.ts`

---

## 当前信息架构

当前前台更适合被理解为 4 个核心区：

### 1. 写作区

主屏，负责：

- 写作
- 继续深入
- 生成分析结果或文章

### 2. 核心对标

负责：

- 当前研究对象是谁
- 它为什么能爆
- 它的爆款逻辑是什么
- 你能学什么

### 3. 我的公众号

负责：

- 我自己的文章表现
- 我 vs 核心对标的差距
- 哪些内容反复有效

### 4. 我的认知

负责：

- 沉淀长期主题、判断、经历、问题
- 形成认知母本

---

## 关键数据对象

### 对标相关

- `journeys`
- `koc_sources`
- `knowledge_articles`
- `knowledge_chunks`

### 自己的公众号

- `owned_wechat_profiles`
- `owned_wechat_articles`

### 记忆

- `session_memory`
- `user_memories`
- `journey_project_memories`

### 视频号（已接底座）

- `wxvideo_sources`
- `wxvideo_posts`

---

## 当前技术栈

- Next.js 16
- React 19
- TypeScript 5
- Supabase + RLS + pgvector
- OpenAI SDK 兼容接口（当前连接火山引擎 Ark / 豆包）
- Ant Design / Ant Design X
- Tavily / web search
- 大佳啦 API
- 微信草稿箱发布链路

---

## 核心目录

```text
app/
  api/
    conversations/
    journeys/
    koc/
    article-layout/
    wechat/
    memory/
components/
  chat/
  sidebar/
lib/
  agent/
  article-layout.ts
  chat-generation.ts
  chat-intent-router.ts
  chat-memory-finalize.ts
  chat-output.ts
  chat-prefetch.ts
  chat-prompt.ts
  chat-runtime.ts
  chat-workflow-state.ts
  chat-workflows.ts
  cognitive-gap.ts
  dajiala.ts
  knowledge-base.ts
  koc-import.ts
  llm.ts
  memory.ts
  web-search.ts
  wechat-publish.ts
  wxvideo-import.ts
supabase/
  migrations/
wechat-gateway/
```

---

## 本地运行

```bash
bun install
bun dev
```

或：

```bash
npm install
npm run dev
```

---

## 测试

当前仍以最小 smoke tests 为主：

```bash
npm test
```

建议继续优先补的测试：

- 核心对标逻辑
- 我的公众号导入与 dashboard 数据组装
- cognitive gap / prompt 行为回归
- full_article 不误记 latest_full_article

---

## 环境变量

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

OPENAI_API_KEY=
ARK_MODEL_ID=

DAJIALA_API_KEY=
TAVILY_API_KEY=

WECHAT_CREDENTIALS_SECRET=
WECHAT_GATEWAY_URL=
WECHAT_GATEWAY_TOKEN=
```

---

## 当前边界

当前版本最擅长的是：

- 围绕一个核心对标做分析
- 沉淀用户自己的公众号内容
- 在写作中逐步积累 memory
- 在需要时直接生成成稿并排版发布

当前还不应该把自己讲成：

- 完整多 Agent 编排平台
- 完整多平台发布矩阵
- 完整自动增长系统

---

## 当前最值得继续做

1. 把 `README / ARCHITECTURE` 与新产品世界观完全统一
2. 做“核心对标详情页”，把研究一个对象这件事做深
3. 把“我的公众号”从复盘页继续做成知识层入口
4. 把自己高表现文章的规律反向写进 memory / 写作上下文
5. 继续简化显式 intent 复杂度，让 prompt 驱动更稳定

---

## 当前版本最准确的一句话

> Niche 是一个以写作为前台、以单核心对标为参照、以我的公众号为复盘入口、以 memory 为认知核心的创作者系统。
