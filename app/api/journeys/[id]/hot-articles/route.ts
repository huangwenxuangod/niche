import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { dajiala, type DajialaHotArticle } from "@/lib/dajiala";
import { searchHotTopicCandidates } from "@/lib/hot-topic-search";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: journeyId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get journey info
  const { data: journey } = await supabase
    .from("journeys")
    .select("*")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const hotSearch = await searchHotTopicCandidates({
      baseQuery: `${journey.niche_level2} ${journey.niche_level3}`.trim(),
      journey: {
        niche_level1: journey.niche_level1,
        niche_level2: journey.niche_level2,
        niche_level3: journey.niche_level3,
        keywords: journey.keywords ?? [],
      },
      maxResults: 6,
      days: 7,
    });
    const keywords = buildHotArticleKeywords(
      {
        niche_level1: journey.niche_level1,
        niche_level2: journey.niche_level2,
        niche_level3: journey.niche_level3,
        keywords: journey.keywords ?? [],
      },
      hotSearch.topics
    );

    // Step 3: Calculate date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const startTime = formatDate(startDate);
    const endTime = formatDate(endDate);

    // Step 2: Search hot articles with each keyword
    const articleGroups = await Promise.all(
      keywords.map(async (keyword) => {
        try {
          const result = await dajiala.searchHotArticles(keyword, startTime, endTime, "0", "1");
          return result.data ?? [];
        } catch {
          return [];
        }
      })
    );
    const allArticles = articleGroups.flat();

    // Step 3: Deduplicate by wxid (keep the one with highest read_num)
    const uniqueByWxid = new Map<string, DajialaHotArticle>();
    for (const article of allArticles) {
      if (!article.wxid) continue;
      const existing = uniqueByWxid.get(article.wxid);
      if (!existing || article.read_num > existing.read_num) {
        uniqueByWxid.set(article.wxid, article);
      }
    }

    const uniqueArticles = Array.from(uniqueByWxid.values());

    // Step 4: Filter and sort
    const inRange = uniqueArticles.filter(a => a.fans >= 500 && a.fans <= 5000);
    const outOfRange = uniqueArticles.filter(a => a.fans < 500 || a.fans > 5000);

    // Sort by read_num descending
    inRange.sort((a, b) => b.read_num - a.read_num);
    outOfRange.sort((a, b) => b.read_num - a.read_num);

    // Combine: take up to 3 from inRange first, then fill from outOfRange until total 3
    let finalList: DajialaHotArticle[] = [];
    finalList = finalList.concat(inRange.slice(0, 3));
    if (finalList.length < 3) {
      const remaining = 3 - finalList.length;
      finalList = finalList.concat(outOfRange.slice(0, remaining));
    }

    // If still less than 3, take whatever is available
    if (finalList.length === 0) {
      finalList = uniqueArticles.slice(0, 3);
    }

    return NextResponse.json({
      articles: finalList,
      keywords,
      topic_candidates: hotSearch.topics,
      searchPeriod: { start: startTime, end: endTime },
    });
  } catch (err) {
    console.error("Hot articles search failed:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

function buildHotArticleKeywords(
  journey: {
    niche_level1?: string | null;
    niche_level2?: string | null;
    niche_level3?: string | null;
    keywords?: string[] | null;
  },
  topics: Array<{ title: string; excerpt?: string }>
) {
  const baseNiche =
    normalizeKeywordSeed(journey.niche_level2) ||
    normalizeKeywordSeed(journey.niche_level1) ||
    "公众号";
  const contentType = String(journey.niche_level3 || "").trim();
  const customSeed = (journey.keywords ?? [])
    .map((item) => normalizeKeywordSeed(item))
    .find(Boolean);
  const signalTerm = extractSignalTerm(topics);
  const focusTerms = getHotArticleFocusTerms(contentType);

  const primarySeed = customSeed || baseNiche;
  const firstKeyword = `${primarySeed} ${focusTerms[0]}`.trim();
  const secondKeyword = signalTerm
    ? `${baseNiche} ${signalTerm}`.trim()
    : `${baseNiche} ${focusTerms[1]}`.trim();

  return Array.from(
    new Set([firstKeyword, secondKeyword].map((item) => item.replace(/\s+/g, " ").trim()))
  )
    .filter((item) => item.length >= 4)
    .slice(0, 2);
}

function normalizeKeywordSeed(value?: string | null) {
  return String(value || "")
    .replace(/[“”"'《》【】（）()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getHotArticleFocusTerms(contentType?: string) {
  switch (contentType) {
    case "评测型":
      return ["实测评测", "工具对比"];
    case "教程型":
      return ["实操教程", "变现案例"];
    case "观点型":
      return ["趋势观点", "行业变化"];
    case "记录型":
      return ["案例复盘", "成长记录"];
    default:
      return ["爆文案例", "热门趋势"];
  }
}

function extractSignalTerm(topics: Array<{ title: string; excerpt?: string }>) {
  const stopwords = new Set([
    "AI",
    "AIGC",
    "KOC",
    "SEO",
    "PDF",
    "APP",
    "API",
    "URL",
    "SaaS",
    "CSDN",
  ]);

  const counts = new Map<string, number>();
  for (const topic of topics.slice(0, 5)) {
    const matches =
      `${topic.title} ${topic.excerpt || ""}`.match(
        /\b[A-Za-z][A-Za-z0-9-]{2,}(?:\s+[A-Za-z][A-Za-z0-9-]{2,})?\b/g
      ) ?? [];

    for (const rawMatch of matches) {
      const match = rawMatch.trim();
      if (!match || stopwords.has(match)) continue;
      counts.set(match, (counts.get(match) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([term]) => term)
    .find(Boolean);
}
