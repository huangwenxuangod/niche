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
    const keywords = hotSearch.queries.slice(0, 3);

    // Step 3: Calculate date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const startTime = formatDate(startDate);
    const endTime = formatDate(endDate);

    // Step 2: Search hot articles with each keyword
    let allArticles: DajialaHotArticle[] = [];

    for (const keyword of keywords.slice(0, 3)) {
      try {
        const result = await dajiala.searchHotArticles(keyword, startTime, endTime, "0", "1");
        if (result.data && result.data.length > 0) {
          allArticles = allArticles.concat(result.data);
        }
      } catch {
        // Continue with next keyword
      }
    }

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
