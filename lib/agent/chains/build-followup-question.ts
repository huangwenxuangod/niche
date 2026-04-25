import { z } from "zod";
import { getFastExtractionModel } from "@/lib/agent/models";
import { buildAgentRunConfig } from "@/lib/agent/tracing";
import type { JourneyProjectMemory } from "@/lib/memory";

const FollowupSchema = z.object({
  question: z.string().nullable(),
  reason: z.string().min(1),
});

export type BuiltFollowup = z.infer<typeof FollowupSchema>;

export async function buildFollowupQuestionChain(params: {
  journeyId: string;
  userMessage: string;
  assistantDraft: string;
  projectMemory: JourneyProjectMemory;
}) {
  const model = getFastExtractionModel().withStructuredOutput(FollowupSchema, {
    name: "BuiltFollowup",
    strict: true,
  });
  const strategy = params.projectMemory.strategy_state;

  return model.invoke(
    `你是一个很自然的内容增长教练。用户已经先提了问题，助手也已经做出初步回答。请补一条非常自然的结尾追问。

【用户消息】
${params.userMessage}

【助手当前回答摘要】
${params.assistantDraft}

【当前记忆】
- 当前焦点词：${strategy.current_focus_keyword || "暂无"}
- 当前对标号：${strategy.current_benchmark_name || "暂无"}
- 当前问题：${strategy.current_problem || "暂无"}

要求：
1. 追问最多 1 句。
2. 语气像顺手推进下一步，不像问卷。
3. 如果用户已经给了明确对标号或明确关键词，可以不追问，question 返回 null。
4. 如果用户还没给对象，优先问"你想讲什么主题"或"你喜欢看哪些内容/哪些号"。`,
    buildAgentRunConfig({
      runName: "build-followup-question",
      tags: ["conversation", "followup"],
      metadata: { journey_id: params.journeyId },
    })
  ) as Promise<BuiltFollowup>;
}