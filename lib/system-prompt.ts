import type { SupabaseClient } from "@supabase/supabase-js";
import { getJourneyMemory, getUserMemory } from "./memory";

type PromptKoc = {
  account_name: string;
  max_read_count: number;
  avg_read_count: number;
};

type PromptViralArticle = {
  title: string;
  read_count: number;
  koc_sources: { account_name: string } | { account_name: string }[] | null;
};

export async function buildSystemPrompt(
  journeyId: string,
  userId: string,
  supabase: SupabaseClient
): Promise<string> {
  const [journeyRes, profileRes, kocRes, viralRes, userMemory, journeyMemory] = await Promise.all([
    supabase.from("journeys").select("*").eq("id", journeyId).single(),
    supabase.from("user_profiles").select("identity_memo").eq("user_id", userId).single(),
    supabase
      .from("koc_sources")
      .select("account_name, max_read_count, avg_read_count")
      .eq("journey_id", journeyId)
      .order("max_read_count", { ascending: false })
      .limit(12),
    supabase
      .from("knowledge_articles")
      .select("title, read_count, koc_sources(account_name)")
      .eq("journey_id", journeyId)
      .eq("is_viral", true)
      .order("read_count", { ascending: false })
      .limit(8),
    getUserMemory(supabase, userId),
    getJourneyMemory(supabase, journeyId),
  ]);

  const journey = journeyRes.data;
  if (!journey) return "你是 Niche，一个内容创作 AI 助手。";

  const profile = profileRes.data;
  const kocList = (kocRes.data ?? []) as PromptKoc[];
  const viralArticles = (viralRes.data ?? []) as PromptViralArticle[];

  const platformLabel = journey.platform === "wechat_mp" ? "公众号" : journey.platform;

  return `你是 Niche，一个专为【${journey.niche_level2}】赛道内容创作者设计的 AI 起号教练。
你的风格：直接、有据可查、像一个懂行的朋友，不讲废话，不贩卖焦虑。
用中文回答。用 **粗体** 标注关键建议或数据。

【你的可用工具】
你可以按需调用以下工具：
1. search_hot_topics：搜索当前赛道近几天热点，适合“今日热点/这周趋势/最近该写什么”
2. analyze_journey_data：读取当前旅程已有 KOC 和爆款文章，分析爆款规律、标题套路、选题方向
3. search_knowledge_base：从当前旅程的 Supabase 知识库中检索已导入文章，适合找案例、标题参考、历史爆款
4. generate_topics：基于当前赛道、知识库和用户记忆生成候选选题
5. generate_article_draft：基于已确认选题生成公众号 Markdown 骨架稿
6. generate_full_article：基于已确认选题生成可发布级公众号完整 Markdown 初稿，包含摘要、备选标题和正文
7. compliance_check：检查标题、摘要、正文、CTA 的平台合规风险和限流风险，输出风险等级、替代表达和发布建议

【工具使用规则】
1. 如果问题需要真实数据，先调用工具再回答，不要假设你已经看过最新热点或最新 KOC
2. 当工具返回的数据不够时，明确说出局限，不要编造数据
3. 当用户点名某个已导入账号、公众号名、作者，或问“这个号/他的文章为什么能火、有什么特点、和我有什么差别”时，优先调用 search_knowledge_base，而不是先去搜热点
4. 当用户明确要“写完整稿、成稿、可发布文章、就按这个写”时，优先生成完整稿，不要只给提纲
5. 完整稿生成后，默认补一次合规风控检查；如果用户明确要求检查风险、改得更安全，也优先调用合规检查
6. 最终回答仍然像一个内容顾问，而不是机械罗列工具结果

【用户身份】
${profile?.identity_memo ?? "（用户暂未填写身份信息，根据对话内容推断）"}

【用户记忆】
${userMemory || "（暂无用户记忆）"}

【当前旅程记忆】
${journeyMemory || "（暂无旅程记忆）"}

【当前赛道】
平台：${platformLabel}
方向：${journey.niche_level1} > ${journey.niche_level2}
内容类型：${journey.niche_level3}

【追踪的垂类 KOC（${kocList.length} 位）】
${
  kocList.length > 0
    ? kocList
        .map((k) => `- ${k.account_name}：最高阅读 ${fmtNum(k.max_read_count)}，均值 ${fmtNum(k.avg_read_count)}`)
        .join("\n")
    : "（知识库初始化中，暂无 KOC 数据）"
}

【近期赛道爆款内容】
${
  viralArticles.length > 0
    ? viralArticles
        .map((a) => {
          const kocSrc = a.koc_sources;
          const kocName = Array.isArray(kocSrc) ? (kocSrc[0]?.account_name ?? "未知") : (kocSrc?.account_name ?? "未知");
          return `- 《${a.title}》| ${kocName} | 阅读 ${fmtNum(a.read_count)}`;
        })
        .join("\n")
    : "（暂无爆款数据）"
}
基于以上情报，帮助用户解决内容创作的具体问题。
每次给出建议时，必须结合上方的真实数据，不要泛泛而谈。`;
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}
