import { tavilySearch } from "./tavily";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function buildSystemPrompt(
  journeyId: string,
  userId: string,
  supabase: SupabaseClient
): Promise<string> {
  const [journeyRes, profileRes, kocRes, viralRes] = await Promise.all([
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
  ]);

  const journey = journeyRes.data;
  if (!journey) return "你是 Niche，一个内容创作 AI 助手。";

  const profile = profileRes.data;
  const kocList = kocRes.data ?? [];
  const viralArticles = viralRes.data ?? [];

  // Get hot topics (last 3 days)
  let hotTopics: { title: string }[] = [];
  if (journey.keywords?.length) {
    try {
      const results = await tavilySearch(journey.keywords[0], { max_results: 5, days: 3 });
      hotTopics = results.slice(0, 5);
    } catch {}
  }

  const platformLabel = journey.platform === "wechat_mp" ? "公众号" : journey.platform;

  return `你是 Niche，一个专为【${journey.niche_level2}】赛道内容创作者设计的 AI 起号教练。
你的风格：直接、有据可查、像一个懂行的朋友，不讲废话，不贩卖焦虑。
用中文回答。用 **粗体** 标注关键建议或数据。

【用户身份】
${profile?.identity_memo ?? "（用户暂未填写身份信息，根据对话内容推断）"}

【当前赛道】
平台：${platformLabel}
方向：${journey.niche_level1} > ${journey.niche_level2}
内容类型：${journey.niche_level3}

【追踪的垂类 KOC（${kocList.length} 位）】
${
  kocList.length > 0
    ? kocList
        .map((k: any) => `- ${k.account_name}：最高阅读 ${fmtNum(k.max_read_count)}，均值 ${fmtNum(k.avg_read_count)}`)
        .join("\n")
    : "（知识库初始化中，暂无 KOC 数据）"
}

【近期赛道爆款内容】
${
  viralArticles.length > 0
    ? viralArticles
        .map((a: any) => {
          const kocSrc = a.koc_sources as { account_name: string }[] | { account_name: string } | null;
          const kocName = Array.isArray(kocSrc) ? (kocSrc[0]?.account_name ?? "未知") : (kocSrc?.account_name ?? "未知");
          return `- 《${a.title}》| ${kocName} | 阅读 ${fmtNum(a.read_count)}`;
        })
        .join("\n")
    : "（暂无爆款数据）"
}

【今日相关热点】
${hotTopics.length > 0 ? hotTopics.map((t) => `- ${t.title}`).join("\n") : "（暂无热点数据）"}

基于以上情报，帮助用户解决内容创作的具体问题。
每次给出建议时，必须结合上方的真实数据，不要泛泛而谈。`;
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n ?? 0);
}
