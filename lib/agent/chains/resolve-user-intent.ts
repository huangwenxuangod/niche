import { z } from "zod";
import { getFastExtractionModel } from "@/lib/agent/models";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

const UserIntentSchema = z.object({
  intent: z.enum([
    "find_direction",
    "find_benchmark",
    "search_wechat_articles",
    "analyze_growth",
    "write_article",
    "general_chat",
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export type ResolvedUserIntent = z.infer<typeof UserIntentSchema>;

export async function resolveUserIntentChain(params: {
  journeyId: string;
  content: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const model = getFastExtractionModel().withStructuredOutput(UserIntentSchema, {
    name: "ResolvedUserIntent",
    strict: true,
  });

  const recentContext = params.recentMessages
    .slice(-4)
    .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`)
    .join("\n");

  return model.invoke(
    `你是一个内容增长助手的意图识别器。请判断用户当前这轮最想做什么。

【最近对话】
${recentContext || "暂无"}

【当前用户消息】
${params.content}

只返回结构化结果。
判断规则：
1. 如果用户想找对标号、分析某个号、导入某个公众号，优先判为 find_benchmark。
2. 如果用户想找公众号爆文、找谁在写某个主题、搜对应公众号内容，判为 search_wechat_articles。
3. 如果用户想找方向、问应该写什么、最近适合讲什么，判为 find_direction。
4. 如果用户明确要分析自己的公众号增长、复盘、看差距，判为 analyze_growth。
5. 如果用户明确要出选题、写稿、改稿，且这轮更偏创作，判为 write_article。
6. 不确定时判为 general_chat。`,
    buildAgentRunConfig({
      runName: "resolve-user-intent",
      tags: ["conversation", "intent"],
      metadata: { journey_id: params.journeyId },
    })
  ) as Promise<ResolvedUserIntent>;
}
