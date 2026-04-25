# Niche 项目技术架构图

## 一、整体架构（Mermaid）

```mermaid
graph TB
    subgraph "前端层 Next.js 16 + React 19"
        UI[ChatArea / Sidebar / Modal 组件]
    end

    subgraph "API 路由层"
        MSG["/api/conversations/{id}/messages/"]
        JOURNEY["/api/journeys/"]
        KOC["/api/koc/"]
        LAYOUT["/api/article-layout/"]
        WECHAT["/api/wechat/"]
        MEMORY["/api/memory/"]
    end

    subgraph "业务逻辑层 lib/"
        LLM[llm.ts LLM 客户端]
        AGENT[agent/ LangChain Agent]
        SYSTEM[system-prompt.ts]
        MEMORY_SYS[memory.ts 记忆系统]
        KB[knowledge-base.ts 知识库]
    end

    subgraph "Agent 工具系统"
        TOOLS[tools/ 工具注册表]
        RUNTIME[runtime.ts 流式处理]
        CHAINS[chains/ LangChain 链]
    end

    subgraph "数据层"
        SUPABASE[(Supabase PostgreSQL)]
        DJLLA[大佳啦 API]
        TIKHUB[TikHub API]
        TAVILY[Tavily API]
        ARK[火山引擎 Ark/豆包]
    end

    subgraph "外部服务"
        WECHAT_EXT[微信 API]
    end

    UI --> MSG
    UI --> JOURNEY
    UI --> KOC
    UI --> LAYOUT
    UI --> WECHAT
    UI --> MEMORY

    MSG --> LLM
    MSG --> AGENT
    MSG --> MEMORY_SYS

    MEMORY --> MEMORY_SYS

    LLM --> RUNTIME
    AGENT --> RUNTIME
    AGENT --> TOOLS
    AGENT --> SYSTEM
    AGENT --> CHAINS

    SYSTEM --> MEMORY_SYS

    RUNTIME --> ARK
    TOOLS --> KB
    TOOLS --> DJLLA
    TOOLS --> TIKHUB
    TOOLS --> TAVILY

    MEMORY_SYS --> SUPABASE
    KB --> SUPABASE
    JOURNEY --> SUPABASE
    KOC --> SUPABASE

    LAYOUT --> SUPABASE
    LAYOUT --> WECHAT_EXT
    WECHAT --> WECHAT_EXT
```

## 二、数据流向图

### 用户消息处理流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as ChatArea
    participant API as /messages 路由
    participant AGENT as Agent 系统
    participant LLM as 豆包 LLM
    participant TOOLS as Agent 工具
    participant DB as Supabase
    participant EXT as 外部 API

    U->>UI: 发送消息
    UI->>API: POST /messages { content }
    API->>DB: 保存用户消息
    API->>DB: 获取对话历史
    API->>AGENT: 构建系统提示词
    API->>AGENT: 处理意图识别

    alt 触发工具调用
        API->>LLM: completeWithTools
        LLM->>API: 返回 tool_calls
        API->>TOOLS: 执行工具
        TOOLS->>EXT: 调用大佳啦/Tavily
        EXT-->>TOOLS: 返回数据
        TOOLS-->>API: 返回结果
        API->>DB: 保存工具调用日志
        API->>LLM: 继续推理（可多轮）
    end

    API->>LLM: streamChat 流式输出
    loop SSE 流式响应
        LLM-->>API: 文本块
        API-->>UI: SSE 事件 { type: "text" }
        UI->>U: 实时显示回答
    end

    API->>DB: 保存助手消息
```

## 三、Agent 工具系统架构

```mermaid
graph LR
    subgraph "工具定义层"
        SCHEMAS[schemas/ Zod Schemas]
        DEFINITIONS[tools/registry.ts 工具注册表]
    end

    subgraph "工具实现层"
        T1[search_hot_topics.ts]
        T2[analyze_journey_data.ts]
        T3[search_knowledge_base.ts]
        T4[generate_topics.ts]
        T5[generate_full_article.ts]
        T6[compliance_check.ts]
    end

    subgraph "执行层"
        RUNTIME[runtime.ts]
        HELPERS[helpers.ts]
    end

    SCHEMAS --> DEFINITIONS
    DEFINITIONS --> T1
    DEFINITIONS --> T2
    DEFINITIONS --> T3
    DEFINITIONS --> T4
    DEFINITIONS --> T5
    DEFINITIONS --> T6

    T1 --> RUNTIME
    T2 --> RUNTIME
    T3 --> RUNTIME
    T4 --> RUNTIME
    T5 --> RUNTIME
    T6 --> RUNTIME

    HELPERS --> RUNTIME
```

## 四、数据库 Schema 关系

```mermaid
erDiagram
    users ||--o{ user_profiles : has
    users ||--o{ journeys : owns
    users ||--o{ user_memories : has

    journeys ||--o{ conversations : has
    journeys ||--o{ koc_sources : tracks
    journeys ||--o{ journey_memories : has
    journeys ||--o{ journey_project_memories : has
    journeys ||--o{ article_layout_drafts : drafts
    journeys ||--o{ wechat_publish_configs : configures

    conversations ||--o{ messages : contains
    conversations ||--o{ tool_calls : logs

    koc_sources ||--o{ knowledge_articles : contributes

    users ||--o{ wechat_publish_configs : configures
    wechat_publish_configs ||--o{ wechat_publish_jobs : creates
    wechat_publish_jobs ||--o{ article_layout_drafts : uses

    users ||--o{ owned_wechat_sync_jobs : creates
    users ||--o{ owned_wechat_analysis_reports : has
```

## 五、关键模块详细关系

### LLM 调用链路

```
用户消息
    │
    ▼
┌───────────────────────────────────────┐
│  app/api/conversations/[id]/messages/ │
│  - 意图识别 (resolveUserIntentChain)   │
│  - 焦点解析 (resolveSearchFocusChain)  │
│  - 自然语言跟进处理                     │
│  - 工具执行循环                         │
└───────────────────────────────────────┘
    │
    ├──────────────────────────────────┐
    │                                  │
    ▼                                  ▼
┌───────────────┐            ┌─────────────────┐
│ lib/llm.ts    │            │ lib/agent/      │
│ (统一接口)    │            │                 │
│               │            │                 │
│ - streamChat  │◄───────────┤ models.ts       │
│ - chat        │            │ - 模型工厂      │
│ - complete    │            │ - ChatOpenAI    │
└───────────────┘            └─────────────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │ runtime.ts      │
                            │                 │
                            │ - streamText    │
                            │ - invokeText    │
                            │ - invokeTools   │
                            └─────────────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │ 火山引擎 Ark    │
                            │ Chat API        │
                            │                 │
                            │ 深度思考 (可选) │
                            └─────────────────┘
```

### 知识库架构

```
┌─────────────────────────────────────────────────────┐
│                  知识库系统                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌──────────────┐      ┌────────────────────┐     │
│  │ koc_sources  │      │ knowledge_articles │     │
│  │              │      │                    │     │
│  │ - 账号名     │◄────►│ - 标题             │     │
│  │ - ghid       │      │ - 内容             │     │
│  │ - 粉丝数     │      │ - 阅读数           │     │
│  │ - 头像       │      │ - HTML             │     │
│  └──────────────┘      │ - 全文搜索向量     │     │
│                        │                    │     │
│                        └────────────────────┘     │
│                                   │                │
│                                   ▼                │
│                        ┌────────────────────┐     │
│                        │ knowledge-base.ts  │     │
│                        │                    │     │
│                        │ - pgvector 搜索    │     │
│                        │ - 全文搜索         │     │
│                        │ - 账号过滤         │     │
│                        └────────────────────┘     │
│                                                     │
│  数据源：                                          │
│  • 大佳啦 API → 知识库同步                         │
│  • TikHub API → 补充数据                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## 六、技术栈清单

### 前端
| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16.2.4 | App Router 框架 |
| React | 19.2.4 | UI 库 |
| TypeScript | 5.x | 类型系统 |
| Ant Design | 6.3.6 | UI 组件库 |
| Ant Design X | 2.5.0 | 聊天组件 |
| Tailwind CSS | 4.x | 样式系统 |
| Day.js | 1.11.20 | 日期处理 |
| Sonner | 2.0.7 | Toast 通知 |

### 后端
| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | - | 运行时 |
| LangChain | 1.3.4 | Agent 框架 |
| LangGraph | 1.2.9 | 工作流编排 |
| OpenAI SDK | - | API 客户端 |
| Zod | 4.3.6 | Schema 验证 |

### 数据与基础设施
| 技术 | 用途 |
|------|------|
| Supabase PostgreSQL | 主数据库 |
| pgvector | 向量搜索 |
| 火山引擎 Ark | LLM API |
| 大佳啦 API | 微信公众号数据 |
| TikHub API | 微信数据补充 |
| Tavily API | 网络搜索 |
| LangSmith | 可观测性 |

### 微信生态
| 组件 | 说明 |
|------|------|
| wechat-publish.ts | 微信草稿箱发布 |
| wechat-owned-analysis.ts | 自有公众号分析 |
| article-layout.ts | Markdown → 微信 HTML |
| wechat-gateway/ | 可选的微信 API 代理 |

## 七、核心设计模式

### 1. Server Components 优先
```
页面: Server Component
  ├─ 加载初始数据
  └─ 客户端交互组件 (Client Component)
```

### 2. SSE 流式响应
```
API → ReadableStream → SSE Events → UI 实时更新
```

### 3. Agent 工具模式
```
Schema → Definition → Execution → Result
```

### 4. 记忆系统
```
用户记忆 + 旅程记忆 + 项目记忆 → 动态注入系统提示词
```

### 5. RLS 行级安全
```
Supabase RLS → 用户数据隔离
```
