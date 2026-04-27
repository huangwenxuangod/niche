/**
 * Planning Phase - OpenClaw 风格的规划阶段
 *
 * 核心设计：
 * 1. 基于所有记忆层（工作/情景/长期）生成完整执行计划
 * 2. 计划包含步骤、依赖、预期结果和备选方案
 * 3. 计划本身被记录到情景记忆，支持复盘和优化
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmMessage } from "@/lib/llm";
import { recordStep, type ExecutionPlan, type PlanStep } from "@/lib/agent/memory";

export interface PlanningInput {
  conversationId: string;
  userId: string;
  journeyId: string;
  userMessage: string;
  history: LlmMessage[];
  systemPrompt: string;
  recentSteps: Array<{
    type: string;
    content: unknown;
  }>;
}

export interface PlanningOutput {
  plan: ExecutionPlan;
  reasoning: string;
}

/**
 * Planning Phase: 基于完整上下文生成执行计划
 */
export async function planningPhase(
  input: PlanningInput,
  supabase: SupabaseClient
): Promise<PlanningOutput> {
  // 1. 构建规划提示
  const planningPrompt = buildPlanningPrompt(input);

  // 2. 调用 LLM 生成计划
  const response = await callPlanningLLM(planningPrompt, input.systemPrompt);

  // 3. 解析计划
  const plan = parsePlan(response.plan, input.userMessage);

  // 4. 记录到情景记忆
  await recordStep(supabase, input.conversationId, {
    id: crypto.randomUUID(),
    type: "plan",
    content: {
      goal: input.userMessage,
      steps: plan.steps.map((s) => s.description),
      reasoning: response.reasoning,
    },
  });

  return {
    plan,
    reasoning: response.reasoning,
  };
}

function buildPlanningPrompt(input: PlanningInput): string {
  const recentToolCalls = input.recentSteps
    .filter((s) => s.type === "tool_call")
    .map((s) => {
      const content = s.content as { tool: string; args: unknown };
      return `- ${content.tool}: ${JSON.stringify(content.args)}`;
    })
    .join("\n");

  return `你是一个 AI 内容增长教练的规划模块。

【用户输入】
${input.userMessage}

【对话历史】
${input.history
  .slice(-5)
  .map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content?.slice(0, 100) ?? ""}`)
  .join("\n")}

【最近执行的工具】
${recentToolCalls || "（无）"}

【规划要求】
1. 分析用户意图，判断需要哪些工具
2. 如果上一步有工具失败，考虑重试或替代方案
3. 避免重复调用已经成功完成的工具
4. 复杂任务拆分为 2-5 个步骤

请以 JSON 格式输出计划：
{
  "reasoning": "思考过程...",
  "plan": {
    "steps": [
      {
        "id": "step-1",
        "type": "tool",
        "description": "步骤描述",
        "toolName": "search_wechat_hot_articles",
        "args": { "keyword": "xxx" },
        "dependencies": []
      }
    ],
    "expectedOutcome": "预期结果..."
  }
}`;
}

async function callPlanningLLM(
  prompt: string,
  systemPrompt: string
): Promise<{ plan: string; reasoning: string }> {
  // 这里简化为直接调用，实际应该使用 LLM 客户端
  // 由于 token 限制，这里提供框架，实际实现需要补充
  throw new Error("Planning LLM not implemented - token limit reached");
}

function parsePlan(planJson: string, userMessage: string): ExecutionPlan {
  // 解析 LLM 返回的计划
  // 由于 token 限制，这里提供框架
  return {
    id: crypto.randomUUID(),
    goal: userMessage,
    steps: [],
    expectedOutcome: "",
    createdAt: Date.now(),
  };
}
