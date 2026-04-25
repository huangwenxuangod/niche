import { z } from "zod";
import { getStructuredOutputModel } from "@/lib/agent/models";
import { buildAgentRunConfig } from "@/lib/agent/tracing";

const RecommendedKocSchema = z.object({
  keyword: z.string().min(1),
  recommended_accounts: z.array(
    z.object({
      account_name: z.string().min(1),
      wxid: z.string().optional(),
      reason: z.string().min(1),
    })
  ).max(5),
});

export type RecommendedKocResult = z.infer<typeof RecommendedKocSchema>;

type HotArticleInput = {
  mp_nickname?: string;
  wxid?: string;
  title?: string;
  read_num?: number;
  fans?: number;
  pub_time?: string;
};

export async function recommendKocFromHotArticlesChain(params: {
  journeyId: string;
  keyword: string;
  articles: HotArticleInput[];
}) {
  if (!params.articles.length) {
    return {
      keyword: params.keyword,
      recommended_accounts: [],
    };
  }

  const model = getStructuredOutputModel().withStructuredOutput(RecommendedKocSchema, {
    name: "RecommendedKocResult",
    strict: true,
  });

  const articleLines = params.articles
    .slice(0, 12)
    .map((item) => `- 账号：${item.mp_nickname || "未知"} | 标题：${item.title || "未知"} | 阅读：${item.read_num || 0} | 粉丝：${item.fans || 0} | wxid：${item.wxid || "无"}`)
    .join("\n");

  return model.invoke(
    `你是一个公众号对标推荐助手。请基于给定关键词和爆文结果，挑出最值得导入成对标样本的公众号账号。

【关键词】
${params.keyword}

【爆文结果】
${articleLines || "暂无"}

要求：
1. 推荐 1-3 个账号即可。
2. 优先选择围绕该关键词持续发文、内容方向清晰、适合当对标样本的公众号。
3. reason 要说明为什么值得导入。
4. 如果同一个账号出现多次，优先推荐它。`,
    buildAgentRunConfig({
      runName: "recommend-koc-from-hot-articles",
      tags: ["wechat-search", "recommend-koc"],
      metadata: { journey_id: params.journeyId, keyword: params.keyword },
    })
  ) as Promise<RecommendedKocResult>;
}
