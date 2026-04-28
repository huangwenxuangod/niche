# Memory Refactor Blueprint

## Goal

把 Niche 从“功能上有记忆”升级为“记忆管理驱动的 Agent 系统”。

这次重构的重点不是再补几个功能，而是统一下面三件事：

1. 哪些数据算记忆，哪些不算
2. 各层记忆的唯一真相源是什么
3. 聊天、工具、RAG、规划如何围绕记忆协同

## Locked Decisions

本蓝图默认采用当前已经确认的方向：

- 优先级：`情景记忆 + 长期记忆` 优先，先服务 `B + C`，再服务 `A`
  - `B`：让 Agent 能恢复上下文和执行状态
  - `C`：让 Agent 能积累策略和经验
  - `A`：让 Agent 更懂用户偏好
- 真相源采用分层方案，不做“一张表包打天下”
- `md` / Markdown 记忆保留，但作为“人可读摘要层”，不是所有原始事实的唯一来源
- 情景记忆先以 `tool_call / tool_result / observation / plan` 为主
- 规划阶段先做“轻量 planning + 可记录 planning step”，不立刻上完整 planner runtime
- 长期记忆采用“两层”
  - 底层：事实
  - 上层：总结
- `tool_calls` 不与 `session_memory` 强行合并
- 知识库检索结果只有在“确认有效”时才进入项目记忆

## Current State Audit

### 1. 目前已经存在的记忆 / 状态系统

#### Working Memory

- 当前对话消息：`messages`
- 请求级上下文：`history + system prompt`

#### Episodic Memory

- `session_memory` 表
- 代码：`lib/agent/memory/session-memory.ts`
- 能力：
  - `recordStep`
  - `recordSteps`
  - `getSessionSteps`
  - `buildConversationText`
  - `analyzeToolPatterns`

#### Long-term Memory

- `user_memories` 表
- 代码：`lib/memory.ts`
- 当前是 Markdown 文本摘要
- 支持：
  - `getUserMemory`
  - `saveUserMemory`
  - `compactAndSaveMemory`

#### Tool Trace / Audit

- `tool_calls` 表
- 当前主要服务于：
  - UI 展示
  - 工具调用结果回放
  - 对话内的“最近一次工具结果”继续使用

#### Knowledge Memory / RAG

- `knowledge_articles`
- `knowledge_chunks`
- `lib/rag/*`
- `lib/knowledge-base.ts`

### 2. 当前系统的主要矛盾

#### 矛盾一：文档目标和实际代码不同步

`CLAUDE.md` 描述的是四层记忆系统，但当前实际主链路里：

- 用户长期记忆只有 `user_memories`
- `journey_memory / journey_project_memory` 在迁移 `015_simplify_memory.sql` 里已被删除
- 对话主入口未完全切到 `AGENT_TOOL_REGISTRY + planningPhase + session_memory` 的统一执行流

#### 矛盾二：记忆来源分散

目前“状态/记忆/可恢复上下文”散落在：

- `messages`
- `tool_calls`
- `session_memory`
- `user_memories`
- `knowledge_articles / knowledge_chunks`

但这些对象的职责边界还没有完全收敛。

#### 矛盾三：项目/旅程记忆缺位

迁移 `015_simplify_memory.sql` 删除了：

- `journey_memories`
- `journey_project_memories`

这让系统只剩：

- 用户全局记忆
- 会话情景记忆

中间缺了非常关键的一层：

- 赛道策略
- 已验证选题模式
- 已确认对标账号策略
- 项目级增长假设

也就是“项目记忆”。

#### 矛盾四：工具执行记录和 Agent 语义记录还没完全统一

当前理想设计是：

- `tool_calls`：产品/界面审计层
- `session_memory`：Agent 语义执行层

但现实里，对话主链仍有部分逻辑绕过 `AGENT_TOOL_REGISTRY`，导致不是所有工具行为都自动落进 `session_memory`。

## Recommended Target Architecture

### Layer 1: Working Memory

职责：

- 当前一轮请求的消息上下文
- 临时推理上下文
- 当前轮工具结果缓存

真相源：

- 运行时内存
- `messages` 仅作为对话持久化，不承担 Agent 状态恢复职责

### Layer 2: Episodic Memory

职责：

- 记录一次对话里的完整执行历史
- 支持恢复、复盘、重试、技能学习

真相源：

- `session_memory`

推荐记录内容：

- `thought`
- `plan`
- `tool_call`
- `tool_result`
- `observation`
- `reflection`

现实建议：

- 第一阶段先确保所有工具调用至少都有 `tool_call + tool_result/observation`
- `thought/reflection` 可以后补，不阻塞主链

### Layer 3: Long-term User Memory

职责：

- 记录跨旅程稳定存在的用户信息
- 给选题和写作风格提供长期约束

真相源：

- `user_memories`

形态：

- Markdown 摘要文档

记录内容：

- 身份与背景
- 赛道与变现
- 风格偏好
- 已确认对标账号
- 历史决策

升级方向：

- 保留 Markdown 摘要
- 后续补一层结构化事实表 `user_memory_facts`
- 由事实生成摘要，而不是只靠摘要本身

### Layer 4: Journey / Project Memory

职责：

- 当前旅程的策略卡片
- 赛道级有效假设
- 已验证选题模式
- 当前项目阶段目标

真相源：

- 建议重新引入 `journey_project_memories`

理由：

- 用户记忆太全局，不适合承载项目策略
- `session_memory` 太短期，不适合承载长期赛道策略
- 项目记忆是 Agent 做“连续创作”的关键层

建议最小表结构：

```sql
create table journey_project_memories (
  journey_id uuid primary key references journeys(id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);
```

初期仍然使用 Markdown 内容即可。

### Knowledge Memory (Not Long-term Preference Memory)

职责：

- 提供内容案例、爆款模式、参考文章

真相源：

- `knowledge_articles`
- `knowledge_chunks`

说明：

知识库不是“用户记忆”，也不是“情景记忆”。
它属于 Agent 的外部知识上下文层。

## Source of Truth Matrix

| 信息类型 | 真相源 | 用途 |
|---|---|---|
| 当前轮消息 | `messages` + request context | 对话上下文 |
| 工具执行历史 | `session_memory` | 恢复、复盘、技能学习 |
| 工具 UI 事件 | `tool_calls` | 前端展示、审计 |
| 用户全局偏好 | `user_memories` | 选题/风格长期约束 |
| 当前旅程策略 | `journey_project_memories` | 项目级连续创作 |
| 文章与案例知识 | `knowledge_articles + knowledge_chunks` | RAG / 检索 |

## What To Keep / What To Change

### Keep

- `lib/agent/memory/session-memory.ts`
- `lib/agent/tools/registry.ts`
- `lib/rag/*`
- `tool_calls`
- `user_memories` Markdown 摘要机制

### Change

- `lib/memory.ts`
  - 从“只管 user memory”升级为“长期记忆门面层”
  - 包括：
    - `getUserMemory`
    - `getJourneyProjectMemory`
    - `compactAndSaveUserMemory`
    - `compactAndSaveJourneyProjectMemory`

- 对话主入口
  - 收敛到：
    - `planningPhase`
    - `AGENT_TOOL_REGISTRY`
    - `session_memory`
  - 减少 ad-hoc 工具分支

### Remove or Deprecate Gradually

- 任何绕过 `AGENT_TOOL_REGISTRY` 的工具调用
- 把 `tool_calls` 当作“长期记忆”的用法
- 把知识库命中直接写进用户记忆的冲动

## Migration Plan

### Phase 1: Stabilize Memory Boundaries

目标：

- 不大改产品行为
- 先把记忆边界理顺

任务：

1. 确认 `session_memory` 是情景记忆唯一来源
2. 确认 `user_memories` 是用户长期记忆唯一来源
3. 重新引入 `journey_project_memories`
4. 在 `lib/memory.ts` 中统一长期记忆接口
5. 更新 `system-prompt.ts`，显式注入：
   - user memory
   - journey project memory
   - episodic summary

验收标准：

- 不再把项目级策略硬塞进 `user_memories`
- 不再把 `tool_calls` 当作长期记忆使用

### Phase 2: Route Orchestration Refactor

目标：

- 对话主链收敛到统一 Agent 执行流

任务：

1. 聊天入口先进入 `planningPhase`
2. 根据 plan 执行 `AGENT_TOOL_REGISTRY`
3. 所有工具统一经 `wrapWithMemoryLogging`
4. 工具结果同步写：
   - `tool_calls`
   - `session_memory`

验收标准：

- 任意工具调用都能在 `session_memory` 里回放
- 新工具不需要手写一套记录逻辑

### Phase 3: Long-term Memory Extraction

目标：

- 从“对话后全量压缩”升级为“事实提取 + 摘要更新”

任务：

1. 定义 `memory facts` 提取 schema
2. 工具执行后优先提取结构化事实
3. 定期把事实压缩成 Markdown 摘要

验收标准：

- 长期记忆更稳定
- 记忆更容易纠错
- 用户偏好不再完全依赖一次性大模型压缩

### Phase 4: Skill Memory

目标：

- 从情景记忆中学习工具使用模式

任务：

1. 基于 `analyzeToolPatterns` 提取重复模式
2. 总结为技能建议或工具链模板
3. 在 planning 阶段优先参考技能记忆

## Immediate Refactor Order

推荐从这里开始，不要跳步：

1. 重新引入 `journey_project_memories`
2. 重写 `lib/memory.ts` 为统一长期记忆门面
3. 让 `system-prompt.ts` 注入三类上下文：
   - user memory
   - project memory
   - episodic summary
4. 把聊天主入口统一到 `planningPhase + AGENT_TOOL_REGISTRY`
5. 清理所有绕过 registry 的工具逻辑

## Risks

### 风险 1：边改边保兼容，导致双轨状态长期共存

解决：

- 每一层只允许一个主真相源
- 过渡期间可以兼容读，但只能从一个地方写

### 风险 2：Markdown 记忆过于自由，长期不可控

解决：

- Markdown 保留为摘要层
- 后续补结构化事实层

### 风险 3：session_memory 记录太粗，无法恢复复杂状态

解决：

- 先确保工具调用全量记录
- 再逐步增加 `plan / reflection`

## Definition of Done

当以下条件满足时，可以认为记忆管理重构第一阶段完成：

1. 用户长期记忆、项目记忆、情景记忆职责完全清楚
2. 对话主链所有工具调用都自动进入 `session_memory`
3. `system-prompt` 同时注入：
   - 用户长期记忆
   - 项目记忆
   - 情景记忆摘要
4. `tool_calls` 只承担 UI / 审计职责
5. 知识库检索不再被当作用户偏好记忆

## Next Action

下一步最值得直接动手的是：

**第一步：重新引入 `journey_project_memories`，并重写 `lib/memory.ts` 作为统一长期记忆门面。**

这是整个重构的最小支点。
