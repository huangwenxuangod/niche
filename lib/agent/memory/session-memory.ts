/**
 * 情景记忆模块 - OpenClaw 风格记忆驱动的核心
 *
 * 设计哲学：
 * 1. 工具执行必须自动记录，不可遗漏
 * 2. 记忆分层：工作记忆（短期）→ 情景记忆（中期）→ 长期记忆（永久）
 * 3. 从记忆中恢复状态，而不是从变量中恢复
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// 类型定义
// ============================================================================

export type StepType =
  | 'thought'      // 思考过程
  | 'plan'         // 执行计划
  | 'tool_call'    // 工具调用意图
  | 'tool_result'  // 工具执行结果
  | 'observation'  // 观察/反思
  | 'reflection';  // 任务完成后的反思

export interface StepRecord {
  id: string;
  type: StepType;
  content: unknown;
  timestamp: number;
}

export interface PlanStep {
  id: string;
  type: 'tool' | 'llm' | 'user_input';
  description: string;
  toolName?: string;
  args?: Record<string, unknown>;
  dependencies: string[];
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  expectedOutcome: string;
  fallback?: ExecutionPlan;
  createdAt: number;
}

// ============================================================================
// 核心 API
// ============================================================================

/**
 * 记录步骤到情景记忆
 *
 * 使用场景：
 * - 工具调用前：记录调用意图
 * - 工具执行后：记录结果或错误
 * - 规划阶段：记录生成的计划
 * - 反思阶段：记录总结和学到的经验
 */
export async function recordStep(
  supabase: SupabaseClient,
  conversationId: string,
  step: Omit<StepRecord, 'timestamp'>
): Promise<void> {
  await supabase.from('session_memory').insert({
    conversation_id: conversationId,
    step_type: step.type,
    content: step.content,
    created_at: new Date().toISOString(),
  });
}

/**
 * 批量记录步骤（用于批量操作后统一写入）
 */
export async function recordSteps(
  supabase: SupabaseClient,
  conversationId: string,
  steps: Array<Omit<StepRecord, 'timestamp'>>
): Promise<void> {
  const now = new Date().toISOString();
  await supabase.from('session_memory').insert(
    steps.map((step) => ({
      conversation_id: conversationId,
      step_type: step.type,
      content: step.content,
      created_at: now,
    }))
  );
}

/**
 * 获取本次对话的所有步骤
 *
 * 用途：
 * - 规划阶段：了解已完成的步骤，避免重复
 * - 错误恢复：分析失败原因，生成备选方案
 * - 总结阶段：复盘整个执行过程
 */
export async function getSessionSteps(
  supabase: SupabaseClient,
  conversationId: string | undefined
): Promise<StepRecord[]> {
  if (!conversationId) return [];

  const { data } = await supabase
    .from('session_memory')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.step_type as StepType,
    content: row.content,
    timestamp: new Date(row.created_at).getTime(),
  }));
}

/**
 * 获取特定类型的步骤
 */
export async function getStepsByType(
  supabase: SupabaseClient,
  conversationId: string,
  type: StepType
): Promise<StepRecord[]> {
  const { data } = await supabase
    .from('session_memory')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('step_type', type)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.step_type as StepType,
    content: row.content,
    timestamp: new Date(row.created_at).getTime(),
  }));
}

/**
 * 清除会话记忆（用于调试或用户重置）
 */
export async function clearSessionMemory(
  supabase: SupabaseClient,
  conversationId: string
): Promise<void> {
  await supabase
    .from('session_memory')
    .delete()
    .eq('conversation_id', conversationId);
}

// ============================================================================
// 辅助函数：从步骤中提取信息
// ============================================================================

/**
 * 构建对话文本（用于长期记忆压缩）
 */
export function buildConversationText(steps: StepRecord[]): string {
  const lines: string[] = [];

  for (const step of steps) {
    if (step.type === 'tool_call') {
      const content = step.content as { tool: string; args: unknown };
      lines.push(`[Tool Call] ${content.tool}: ${JSON.stringify(content.args)}`);
    } else if (step.type === 'tool_result') {
      const content = step.content as { tool: string; result: unknown };
      lines.push(`[Result] ${content.tool}: ${JSON.stringify(content.result).slice(0, 200)}`);
    } else if (step.type === 'observation') {
      const content = step.content as { tool: string; error?: string };
      if (content.error) {
        lines.push(`[Error] ${content.tool}: ${content.error}`);
      }
    }
  }

  return lines.join('\n\n');
}

/**
 * 分析工具使用模式（用于技能记忆）
 */
export function analyzeToolPatterns(steps: StepRecord[]): Array<{
  tool: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  avgResponseTime?: number;
}> {
  const stats = new Map<string, {
    calls: number;
    successes: number;
    errors: number;
  }>();

  for (const step of steps) {
    if (step.type === 'tool_call') {
      const content = step.content as { tool: string };
      const stat = stats.get(content.tool) || { calls: 0, successes: 0, errors: 0 };
      stat.calls++;
      stats.set(content.tool, stat);
    } else if (step.type === 'tool_result') {
      const content = step.content as { tool: string; result: unknown };
      const stat = stats.get(content.tool);
      if (stat) stat.successes++;
    } else if (step.type === 'observation') {
      const content = step.content as { tool: string; error?: string };
      if (content.error) {
        const stat = stats.get(content.tool);
        if (stat) stat.errors++;
      }
    }
  }

  return Array.from(stats.entries()).map(([tool, stat]) => ({
    tool,
    callCount: stat.calls,
    successCount: stat.successes,
    errorCount: stat.errors,
  }));
}
