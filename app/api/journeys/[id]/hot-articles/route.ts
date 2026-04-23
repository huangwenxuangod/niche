import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { dajiala, type DajialaHotArticle } from "@/lib/dajiala";
import { tavilySearch } from "@/lib/tavily";
import { llm } from "@/lib/llm";

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
    // Step 1: Use Tavily to search recent hot topics in this niche
    const searchQuery = `${journey.niche_level2} ${journey.niche_level3} 最近热点 2025`;
    const tavilyResults = await tavilySearch(searchQuery, { max_results: 8, days: 7 });

    // Step 2: Use LLM to extract 1-2 keywords from search results
    const searchContext = tavilyResults.map(r => `- ${r.title}\n  ${r.content?.substring(0, 150) || ""}`).join("\n");
    const keywordPrompt = `基于以下搜索结果，提取1-2个最热门、最具体的关键词，适合搜索微信公众号爆文。不要用太泛的词（比如"AI科技"），要用具体的热点事件或产品（比如"Claude code"）。用JSON数组返回。

搜索结果：
${searchContext}

赛道：${journey.niche_level1} > ${journey.niche_level2} > ${journey.niche_level3}

只返回JSON数组，不要其他内容，例如：["关键词1"] 或 ["关键词1", "关键词2"]`;

    let keywords: string[] = [];
    try {
      const llmResult = await llm.chat("你是一个关键词提取助手", keywordPrompt);
      const jsonMatch = llmResult.match(/\[[\s\S]*\]/);
      if (jsonMatch) keywords = JSON.parse(jsonMatch[0]);
    } catch {
      // Fallback keywords
    }

    if (keywords.length === 0) {
      keywords = [`${journey.niche_level2} ${journey.niche_level3}`, journey.niche_level3];
    }

    // Step 3: Calculate date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 6);

    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    const startTime = formatDate(startDate);
    const endTime = formatDate(endDate);

    // Step 4: Search hot articles with each keyword
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

    // Step 5: Deduplicate by wxid (keep the one with highest read_num)
    const uniqueByWxid = new Map<string, DajialaHotArticle>();
    for (const article of allArticles) {
      if (!article.wxid) continue;
      const existing = uniqueByWxid.get(article.wxid);
      if (!existing || article.read_num > existing.read_num) {
        uniqueByWxid.set(article.wxid, article);
      }
    }

    let uniqueArticles = Array.from(uniqueByWxid.values());

    // Step 6: Filter and sort
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
      searchPeriod: { start: startTime, end: endTime },
    });
  } catch (err) {
    console.error("Hot articles search failed:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
