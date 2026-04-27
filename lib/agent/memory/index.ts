/**
 * 记忆系统统一导出
 *
 * 四层记忆架构：
 * 1. 工作记忆（Working Memory）- 当前对话上下文，由 messages 数组管理
 * 2. 情景记忆（Session/Episodic Memory）- 本次任务的执行历史
 * 3. 长期记忆（Long-term Memory）- 用户画像、跨任务知识
 * 4. 技能记忆（Skill Memory）- 工具使用模式、任务模板
 *
 * 本模块提供情景记忆的完整操作，其他层通过 lib/memory.ts 访问
 */

// 情景记忆核心
export {
  // 核心类型
  type StepType,
  type StepRecord,
  type ExecutionPlan,
  type PlanStep,

  // 核心 API
  recordStep,
  recordSteps,
  getSessionSteps,
  getStepsByType,
  clearSessionMemory,

  // 辅助函数
  buildConversationText,
  analyzeToolPatterns,
} from "./session-memory";

// 内存索引（未来扩展）
// export { createVectorIndex, searchSimilar } from "./vector-index";

// 记忆压缩（未来扩展）
// export { compressSession, extractKeyInsights } from "./compression";
