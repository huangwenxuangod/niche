import { getFastExtractionModel } from "@/lib/agent/models";
import {
  ProjectMemoryUpdateSchema,
  type ProjectMemoryUpdateStructuredOutput,
} from "@/lib/agent/schemas/project-memory-update";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

export async function runProjectMemoryCaptureChain(params: {
  journeyId: string;
  userId: string;
  content: string;
}) {
  const model = getFastExtractionModel().withStructuredOutput(ProjectMemoryUpdateSchema, {
    name: "ProjectMemoryUpdate",
    strict: true,
  });

  const prompt = `你是一个项目记忆提取助手。请从下面这段用户消息里，只提取“应该写入项目档案卡或旅程策略状态”的内容。

用户消息：
${params.content}

提取原则：
1. 只提取“明确确认”的信息，不要臆测。
2. project_card_patch 适合放：定位、目标用户、平台策略、当前阶段、当前目标、内容风格等。
3. strategy_patch 适合放：已确认对标、已确认方向、当前内容策略、当前问题、当前焦点词、对标账号、搜索模式、当前阻塞、待办、下一步等。
4. 如果消息只是闲聊或没有明确项，就返回空 patch。
5. distribution_channels / confirmed_benchmarks / confirmed_directions / current_blockers / current_todos 用数组。
6. current_focus_keyword 只能是一个唯一关键词短语，不能是两个 query。
7. 用中文返回结构化对象，不要额外解释。`;

  return model.invoke(
    prompt,
    buildAgentRunConfig({
      runName: "project-memory-capture",
      tags: ["project-memory", "structured-output"],
      metadata: {
        journey_id: params.journeyId,
        user_id: params.userId,
      },
    })
  ) as Promise<ProjectMemoryUpdateStructuredOutput>;
}
