# Niche

Niche 是一个面向微信公众号创作者的 AI 内容工作台，当前最稳定的主链是：

`导入对标账号 -> 分析规律 -> 生成选题 -> 生成完整稿 -> 排版 -> 发布到公众号草稿箱`

## 当前产品定位

- 目标用户：公众号冷启动和早期增长阶段的创作者
- 核心价值：把“找方向、拆对标、写内容、排版发布”做成一条连续工作流
- 当前落地平台：微信公众号
- 扩展中：自动发现并导入绑定视频号

## 当前已实现能力

### 1. 对标账号与知识库
- 通过公众号名称、`ghid`、文章链接导入对标账号
- 默认同步最近 3 篇文章样本
- 文章入库到 `knowledge_articles`
- 支持关键词检索 + 向量召回的混合知识库检索

### 2. 聊天 Agent
- Pattern-first + 单次模型流式生成
- 高频意图走显式路由：
  - `topics`
  - `full_article`
  - `publish_timing`
  - `growth_analysis`
  - `wxvideo_analysis`
  - `video_script`
  - `import_koc_analysis`
- 数据准备在模型前完成，记忆沉淀放到后台
- SSE 流式响应
- 高频意图有快捷路径和本地短路，减少无意义多轮规划

### 3. 内容生产工作流
- 生成选题
- 生成完整公众号稿件
- 识别完整稿并进入排版工作台
- 渲染为微信公众号可用 HTML
- 保存到公众号草稿箱

### 4. 记忆系统
- `session_memory`：工具执行与会话情景记忆
- `user_memories`：用户长期记忆
- `journey_project_memories`：旅程级策略记忆

关键原则：
- 用户看到的最终输出，优先直接来自工具产物
- memory 总结只做后台沉淀，不参与最终输出链

### 5. 视频号增量接入
- 导入公众号后，若存在 `ghid`，后台会自动尝试发现绑定视频号
- 已实现：
  - 发现绑定视频号
  - 拉取视频号作品列表
  - 拉取互动指标
  - 存入 `wxvideo_sources` / `wxvideo_posts`

## 当前主链

### 写稿主链
1. 用户提问
2. 意图路由决定工作流
3. 预取必要数据
4. 单次模型真流式生成最终结果
5. 用户可直接进入排版
6. 排版后保存到公众号草稿箱
7. 本轮记忆在后台沉淀

### 公众号导入主链
1. 输入公众号名称 / `ghid` / 文章链接
2. 调大佳啦公众号接口导入样本账号
3. 同步文章与基础表现数据
4. 写入 `koc_sources` / `knowledge_articles`
5. 若存在 `ghid`，后台继续发现并导入绑定视频号

## 技术栈

- Next.js 16
- React 19
- TypeScript 5
- Supabase + RLS + pgvector
- OpenAI SDK 兼容接口（连接火山引擎 Ark / 豆包）
- Ant Design / Ant Design X
- Tavily
- 大佳啦 API
- 微信草稿箱发布链路

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
  dajiala.ts
  hot-topic-search.ts
  knowledge-base.ts
  koc-import.ts
  llm.ts
  memory.ts
  wechat-publish.ts
  wxvideo-import.ts
supabase/
  migrations/
wechat-gateway/
```

## 本地运行

```bash
bun install
bun dev
```

如使用 npm：

```bash
npm install
npm run dev
```

## 测试

当前项目补的是最小 smoke tests：

```bash
npm test
```

主要覆盖：
- 完整稿提取
- 意图路由
- 主链 fallback 逻辑

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

## 关键接口

- `POST /api/journeys`
  - 创建旅程与首个对话
- `POST /api/koc/import`
  - 导入对标公众号
- `POST /api/koc/:id/sync`
  - 同步已导入对标账号内容
- `POST /api/koc/:id/import-bound-wxvideo`
  - 手动触发绑定视频号发现与导入
- `POST /api/conversations/:id/messages`
  - 聊天主入口，返回 SSE
- `POST /api/wechat/publish`
  - 保存到公众号草稿箱

## 当前边界

当前版本优先保证“内容工作流闭环”，不是万能 Agent。

更准确地说，它现在最擅长的是：
- 导入对标账号
- 提炼增长规律
- 给出可写的选题
- 生成完整稿
- 进入排版与发布

暂时还不是：
- 完整多 Agent 编排系统
- 完整多平台发布矩阵
- 自动化复盘系统

## 下一步最值得做

1. 让视频号导入和分析在产品页面里可见
2. 继续补写稿主链的测试覆盖
3. 做“公众号内容 -> 视频号内容”的联动分析
