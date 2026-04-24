import { getStructuredOutputModel } from "@/lib/agent/models";
import {
  RoundSummarySchema,
  type RoundSummaryStructuredOutput,
} from "@/lib/agent/schemas/round-summary";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

export async function runRoundSummaryChain(params: {
  journeyId: string;
  userId: string;
  userIntent: string;
  confirmedDecisions: string[];
  producedOutputs: string[];
  openQuestions: string[];
  nextAction: string;
}) {
  const model = getStructuredOutputModel().withStructuredOutput(RoundSummarySchema, {
    name: "RoundSummary",
    strict: true,
  });

  const prompt = `你是一个项目助手，请把本轮结果整理成稳定、克制、可回填到项目记忆里的结构化结论。

【用户意图】
${params.userIntent}

【候选已确认决策】
${params.confirmedDecisions.join("\n") || "暂无"}

【候选产出结果】
${params.producedOutputs.join("\n") || "暂无"}

【候选未决问题】
${params.openQuestions.join("\n") || "暂无"}

【候选下一步】
${params.nextAction}

要求：
1. user_intent 保持简洁，不要超过 40 字。
2. confirmed_decisions / produced_outputs / open_questions 只保留最重要的内容。
3. next_action 必须是一个清晰的下一步，不要空泛。
4. 如果候选内容明显为空，就返回空数组，但 next_action 仍需给出。`;

  return model.invoke(
    prompt,
    buildAgentRunConfig({
      runName: "round-summary",
      tags: ["project-memory", "round-summary", "structured-output"],
      metadata: {
        journey_id: params.journeyId,
        user_id: params.userId,
      },
    })
  ) as Promise<RoundSummaryStructuredOutput>;
}
