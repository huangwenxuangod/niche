import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { dajiala } from "@/lib/dajiala";
import { recommendKocFromHotArticlesChain } from "@/lib/agent/chains/recommend-koc-from-hot-articles";
import { getJourneyProjectMemory, updateJourneyStrategyState } from "@/lib/memory";

interface Params {
  params: Promise<{ id: string }>;
}

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

async function handleSearch(req: NextRequest, journeyId: string) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: journey } = await supabase
    .from("journeys")
    .select("id, user_id")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const requestKeyword =
    req.method === "POST"
      ? String((await req.json()).keyword || "").trim()
      : req.nextUrl.searchParams.get("keyword")?.trim() || "";

  const memory = await getJourneyProjectMemory(supabase, journeyId);
  const keyword = requestKeyword || memory.strategy_state.current_focus_keyword || "";
  if (!keyword) {
    return NextResponse.json(
      { error: "keyword is required", message: "请先通过对话收敛出一个明确关键词。" },
      { status: 400 }
    );
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 6);

  try {
    const result = await dajiala.searchHotArticles(
      keyword,
      formatDate(startDate),
      formatDate(endDate),
      "0",
      "1"
    );
    const deduped = new Map<string, (typeof result.data)[number]>();

    for (const article of result.data ?? []) {
      const dedupeKey = article.wxid || article.url || article.title;
      if (!dedupeKey) continue;
      const existing = deduped.get(dedupeKey);
      if (!existing || (article.read_num || 0) > (existing.read_num || 0)) {
        deduped.set(dedupeKey, article);
      }
    }

    const articles = Array.from(deduped.values())
      .sort((left, right) => (right.read_num || 0) - (left.read_num || 0))
      .slice(0, 12);
    const recommendation = await recommendKocFromHotArticlesChain({
      journeyId,
      keyword,
      articles,
    });

    await updateJourneyStrategyState(supabase, {
      journeyId,
      userId: user.id,
      patch: {
        current_focus_keyword: keyword,
        focus_confidence: Math.max(memory.strategy_state.focus_confidence || 0, 0.7),
        last_search_mode: "wechat_hot_articles",
        last_successful_keyword: keyword,
      },
    });

    return NextResponse.json({
      keyword,
      articles,
      recommended_accounts: recommendation.recommended_accounts,
      searchPeriod: { start: formatDate(startDate), end: formatDate(endDate) },
    });
  } catch (error) {
    console.error("Hot articles search failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id: journeyId } = await params;
  return handleSearch(req, journeyId);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: journeyId } = await params;
  return handleSearch(req, journeyId);
}
