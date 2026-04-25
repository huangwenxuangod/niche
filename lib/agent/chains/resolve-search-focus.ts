import { z } from "zod";
import { getFastExtractionModel } from "@/lib/agent/models";
import { buildAgentRunConfig } from "@/lib/agent/tracing";
import type { JourneyProjectMemory } from "@/lib/memory";

const SearchFocusSchema = z.object({
  focus_keyword: z.string().nullable(),
  focus_type: z.enum(["product", "topic", "account", "unknown"]),
  confidence: z.number().min(0).max(1),
  search_ready: z.boolean(),
  reason: z.string().min(1),
});

export type ResolvedSearchFocus = z.infer<typeof SearchFocusSchema>;

export async function resolveSearchFocusChain(params: {
  journeyId: string;
  content: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  projectMemory: JourneyProjectMemory;
}) {
  const model = getFastExtractionModel().withStructuredOutput(SearchFocusSchema, {
    name: "ResolvedSearchFocus",
    strict: true,
  });

  const recentContext = params.recentMessages
    .slice(-4)
    .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`)
    .join("\n");
  const strategy = params.projectMemory.strategy_state;

  return model.invoke(
    `你是一个公众号搜索焦点收敛器。请从用户当前问题和最近上下文中，收敛出“唯一一个公众号搜索关键词短语”。

【当前用户消息】
${params.content}

【最近对话】
${recentContext || "暂无"}

【已有记忆】
- 当前问题：${strategy.current_problem || "暂无"}
- 当前焦点词：${strategy.current_focus_keyword || "暂无"}
- 当前对标号：${strategy.current_benchmark_name || "暂无"}
- 用户长期关注：${params.projectMemory.project_card.current_goal || "暂无"}

要求：
1. focus_keyword 只能有一个，允许是一个完整短语，例如“Claude Code 新模型发布”“Claude Design”“GPT代充”。
2. 不要输出两个关键词，不要把“赛道词 + 内容类型 + 泛词”拼成冗余组合。
3. 如果用户还没说清楚，只返回 search_ready=false。
4. 如果用户说的是明确公众号号名，这里 focus_type 可为 account。
5. 只有在可以直接拿去搜公众号内容时，search_ready 才能为 true。`,
    buildAgentRunConfig({
      runName: "resolve-search-focus",
      tags: ["conversation", "search-focus"],
      metadata: { journey_id: params.journeyId },
    })
  ) as Promise<ResolvedSearchFocus>;
}
