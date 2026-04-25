# API 接口文档

本文档基于当前项目代码生成，覆盖 `app/api` 下所有现有接口，以及登录流程相关的 `app/auth/callback`。

Niche 当前定位为一个面向冷启动 KOC 的 AI 内容增长教练：通过导入对标账号、沉淀对标内容库、分析增长差距、生成增长内容，并辅助完成发布风险检查、发布排版和发布到公众号，把内容增长从“凭感觉试错”变成“有样本、有分析、有执行”的 AI 闭环。

## 基本说明

- 基础地址：本地开发默认是 `http://localhost:3000`
- 认证方式：依赖 Supabase 登录态 Cookie，大部分接口要求用户已登录
- 数据格式：除流式接口外，默认使用 `application/json`
- 错误格式：大多数接口返回 `{ "error": "..." }`

## 接口总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/journeys` | 获取当前用户的旅程列表 |
| `POST` | `/api/journeys` | 创建新旅程并初始化首个对话 |
| `POST` | `/api/journeys/:id/init` | 将旅程标记为知识库初始化完成 |
| `POST` | `/api/journeys/:id/create-conversation` | 为指定旅程创建或获取最新对话 |
| `POST` | `/api/conversations` | 创建新对话 |
| `POST` | `/api/conversations/:id/messages` | 发送消息并获取 AI 流式回复 |
| `GET` | `/api/koc` | KOC 搜索能力已下线 |
| `POST` | `/api/koc` | 手动添加 KOC 账号 |
| `POST` | `/api/koc/:id/sync` | 同步已存在 KOC 的文章和数据 |
| `POST` | `/api/koc/:id/import` | 按 ghid 导入 KOC 及其文章 |
| `GET` | `/api/wechat/config` | 获取当前用户的公众号官方配置 |
| `POST` | `/api/wechat/config` | 保存公众号官方配置 |
| `PUT` | `/api/wechat/config` | 更新公众号官方配置 |
| `GET` | `/api/article-layout?message_id=...` | 获取某条消息的排版草稿 |
| `POST` | `/api/article-layout` | 生成或保存文章排版草稿 |
| `POST` | `/api/wechat/owned-analysis` | 执行增长分析：导入自己的公众号内容并输出结构化结果卡 |
| `GET` | `/auth/callback` | Supabase 登录回调，交换 session |

## 1. 获取旅程列表

### `GET /api/journeys`

获取当前登录用户的全部旅程，按创建时间倒序返回。

### 请求

- 需要登录态 Cookie
- 无请求体

### 成功响应 `200`

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "name": "公众号×AI产品体验",
    "platform": "wechat_mp",
    "niche_level1": "AI与科技",
    "niche_level2": "AI产品体验",
    "niche_level3": "评测型",
    "keywords": ["AI产品体验", "AI工具"],
    "is_active": true,
    "knowledge_initialized": false,
    "init_status": "pending",
    "created_at": "2026-04-23T10:00:00.000Z"
  }
]
```

### 失败响应

- `401`：`{ "error": "Unauthorized" }`

## 2. 创建旅程

### `POST /api/journeys`

创建一个新的内容创作旅程，并自动创建首个对话。

### 请求体

```json
{
  "platform": "wechat_mp",
  "niche_level1": "AI与科技",
  "niche_level2": "AI产品体验",
  "niche_level3": "评测型",
  "identity_memo": "我是转型中的 AI 产品经理，想做公众号"
}
```

### 字段说明

- `platform`：平台，目前主要使用 `wechat_mp`
- `niche_level1`：一级赛道
- `niche_level2`：二级赛道
- `niche_level3`：内容类型
- `identity_memo`：可选，用户身份描述，会写入 `user_profiles`

### 成功响应 `200`

```json
{
  "journey_id": "uuid",
  "conversation_id": "uuid"
}
```

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `500`：`{ "error": "数据库或创建失败原因" }`

### 备注

- 接口内部会调用大模型生成旅程名称和关键词
- 会先将该用户的历史旅程 `is_active` 全部设为 `false`

## 3. 标记旅程初始化完成

### `POST /api/journeys/:id/init`

将指定旅程的 `knowledge_initialized` 标记为 `true`，并设置 `init_status=done`。

### 路径参数

- `id`：旅程 ID

### 请求

- 需要登录态 Cookie
- 无请求体

### 成功响应 `200`

```json
{
  "status": "done"
}
```

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `404`：`{ "error": "Not found" }`

## 4. 为旅程创建或获取对话

### `POST /api/journeys/:id/create-conversation`

如果该旅程已经有对话，则返回最新一条；否则新建一条对话。

### 路径参数

- `id`：旅程 ID

### 请求

- 需要登录态 Cookie
- 无请求体

### 成功响应 `200`

```json
{
  "conversation_id": "uuid"
}
```

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `404`：`{ "error": "Not found" }`
- `500`：`{ "error": "数据库错误" }`

## 5. 创建新对话

### `POST /api/conversations`

为指定旅程创建一条新对话。

### 请求体

```json
{
  "journey_id": "uuid"
}
```

### 成功响应 `200`

返回完整 conversation 记录，例如：

```json
{
  "id": "uuid",
  "journey_id": "uuid",
  "user_id": "uuid",
  "title": null,
  "created_at": "2026-04-23T10:00:00.000Z"
}
```

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `500`：`{ "error": "数据库错误" }`

## 6. 发送消息并获取 AI 回复

### `POST /api/conversations/:id/messages`

向指定对话发送一条用户消息，并通过 SSE 流式返回 AI 回复内容。

### 路径参数

- `id`：对话 ID

### 请求体

```json
{
  "content": "帮我分析一下这个赛道最近的爆款规律"
}
```

### 成功响应 `200`

响应类型：

```text
Content-Type: text/event-stream
```

流式数据格式：

```text
data: {"text":"第一段内容"}

data: {"text":"第二段内容"}

data: [DONE]
```

### 行为说明

- 会先将用户消息写入 `messages`
- 会读取当前会话最近最多 20 条消息作为上下文
- 如果用户问题命中“选题 / 热点 / 趋势”等关键词，会额外搜索 Tavily 热点结果
- AI 回复结束后，会把完整回复再次写入 `messages`
- 如果是首次对话，会自动用回复前 40 个字符生成对话标题

### 失败响应

- `401`：纯文本 `Unauthorized`
- `404`：纯文本 `Not found`
- 流式过程中报错：会在 SSE 中追加类似

```text
data: {"text":"\n\n[错误：具体错误信息]"}

data: [DONE]
```

## 7. KOC 搜索能力状态

### `GET /api/koc`

KOC 搜索能力已下线，不再调用按条收费的公众号搜索接口。

### 查询参数

- `journey_id`：旅程 ID，必填
- `keyword`：搜索关键词，必填

### 响应

- `400`：`{ "error": "Missing parameters" }`
- `401`：`{ "error": "Unauthorized" }`
- `404`：`{ "error": "Not found" }`
- `410`：`{ "error": "KOC 搜索能力已下线，不再调用按条收费接口" }`

## 8. 手动添加 KOC

### `POST /api/koc`

手动向当前旅程添加一个 KOC 账号。

### 请求体

```json
{
  "journey_id": "uuid",
  "ghid": "ghid_xxx",
  "account_name": "账号名"
}
```

### 字段说明

- `journey_id`：旅程 ID，必填
- `ghid`：公众号唯一标识，可选但建议传
- `account_name`：账号名称，可选

### 成功响应 `200`

返回插入后的 `koc_sources` 记录，例如：

```json
{
  "id": "uuid",
  "journey_id": "uuid",
  "platform": "wechat_mp",
  "account_name": "某公众号",
  "account_id": "ghid_xxx",
  "ghid": "ghid_xxx",
  "is_manually_added": true
}
```

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `404`：`{ "error": "Not found" }`
- `500`：`{ "error": "数据库错误" }`

### 备注

- 当前接口只写入用户显式提供的 `ghid` 和 `account_name`

## 9. 同步已有 KOC 的文章数据

### `POST /api/koc/:id/sync`

对已存在的 KOC 账号重新抓取文章列表、阅读点赞等数据，并更新文章库。

### 路径参数

- `id`：`koc_sources.id`

### 请求

- 需要登录态 Cookie
- 无请求体

### 成功响应 `200`

```json
{
  "success": true,
  "articleCount": 3
}
```

### 行为说明

- 当前最多同步最近 3 篇文章
- 会为每篇文章抓取：
  - 标题、正文、摘要、作者
  - 阅读、点赞、在看、分享、收藏、评论
  - 发布时间、原文链接、封面等
- 会按 `(journey_id, url)` 做 upsert
- 会更新 `koc_sources` 上的统计字段：
  - `max_read_count`
  - `avg_read_count`
  - `article_count`
  - `last_fetched_at`

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `403`：`{ "error": "Forbidden" }`
- `404`：`{ "error": "Not found" }`
- `400`：`{ "error": "No account identifier" }`
- `500`：`{ "error": "Sync failed" }`

## 10. 导入 KOC 及文章

### `POST /api/koc/:id/import`

根据 `ghid` 导入一个 KOC 账号，并抓取其最近文章到知识库。

### 路径参数

- `id`：这里的 `id` 实际上是 `ghid`

### 请求体

```json
{
  "journey_id": "uuid"
}
```

### 成功响应 `200`

```json
{
  "success": true,
  "articleCount": 3
}
```

### 行为说明

- 会根据传入的账号标识直接抓取最近 3 篇文章并写入 `knowledge_articles`
- 同时更新 KOC 统计字段

### 失败响应

- `401`：`{ "error": "Unauthorized" }`
- `404`：`{ "error": "Not found" }` 或 `{ "error": "Account not found" }`
- `500`：`{ "error": "Import failed" }`

## 11. 获取公众号官方配置

### `GET /api/wechat/config`

获取当前登录用户已经保存的公众号官方配置。

### 成功响应 `200`

```json
{
  "config": {
    "id": "uuid",
    "app_id": "wx123..."
  }
}
```

## 12. 保存或更新公众号官方配置

### `POST /api/wechat/config`
### `PUT /api/wechat/config`

用于保存或更新当前用户的公众号 `AppID / AppSecret`，后续可用于：

- 保存到公众号草稿箱
- 增长分析时尽量补官方表现数据

### 请求体

```json
{
  "app_id": "wx123",
  "app_secret": "xxxxx"
}
```

## 13. 文章排版草稿

### `GET /api/article-layout?message_id=...`

获取某条消息对应的文章排版草稿。

### `POST /api/article-layout`

支持两类主要行为：

1. `mode=optimize`
   - 基于标题、摘要、正文生成默认公众号排版草稿
2. 保存草稿
   - 保存 `source_markdown / rendered_markdown / rendered_html`

### 备注

- 预览区会对正文做额外净化，避免把风控文本、尾巴提示语、破损 `:::cta` 等脏内容带进公众号预览

## 14. 增长分析

### `POST /api/wechat/owned-analysis`

执行“增长分析”主链路。

### 请求体

```json
{
  "journey_id": "uuid",
  "account_name": "我的公众号名称",
  "app_id": "可选",
  "app_secret": "可选"
}
```

### 行为说明

- `account_name` 是主输入，用于导入自己的公众号内容主体
- `app_id / app_secret` 是增强输入，用于尽量补公众号官方表现数据
- 如果官方接口不可用，增长分析不会直接失败，而会降级为“内容主体分析”
- 自己的公众号内容与竞品内容分开存储，不会混入 `knowledge_articles`

### 成功响应 `200`

```json
{
  "success": true,
  "job_id": "uuid",
  "report_id": "uuid",
  "article_count": 3,
  "metric_count": 0,
  "analysis_meta": {
    "source_mode": "content_only",
    "official_config_present": true,
    "official_metrics_enabled": false,
    "warnings": [
      "公众号官方接口暂时不可用，当前结果以内容主体分析为主。"
    ]
  },
  "report": {
    "summary": {},
    "content_overview": {},
    "top_articles": [],
    "competitor_gap": {},
    "next_actions": [],
    "message_for_chat": "..."
  }
}
```

### 结果说明

- `analysis_meta.source_mode`
  - `content_only`：仅使用公众号内容主体分析
  - `mixed`：内容主体 + 官方数据增强
- `warnings`
  - 用于说明当前分析的降级原因或数据来源说明

## 15. 登录回调

### `GET /auth/callback`

Supabase 邮箱登录或 OAuth 回调接口，用来把 `code` 交换成 session，并重定向回首页。

### 查询参数

- `code`：Supabase 回调 code

### 成功行为

- 调用 `supabase.auth.exchangeCodeForSession(code)`
- 之后重定向到站点根路径 `/`

### 响应

- `302` 或框架对应的重定向响应

## 典型调用流程

### 旅程初始化流程

1. `POST /api/journeys` 创建旅程
2. `POST /api/koc/:ghid/import` 导入账号和文章
3. `POST /api/journeys/:id/create-conversation` 获取对话
4. `POST /api/conversations/:id/messages` 开始聊天

### 已有 KOC 的手动管理流程

1. `POST /api/koc` 手动添加账号
2. `POST /api/koc/:id/sync` 同步文章数据

## 当前接口设计上的注意点

- `/api/koc/:id/import` 的 `:id` 实际传的是 `ghid`，语义上和 `/api/koc/:id/sync` 不一致，后续建议改名或补文档说明
- `/api/conversations/:id/messages` 是 SSE 流，前端不能按普通 JSON 接口处理
- 当前接口没有统一的响应 envelope，例如没有统一使用 `{ code, message, data }`
- 认证依赖 Supabase Cookie，不适合直接拿来做开放平台 API
