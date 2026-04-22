import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/tavily";
import { tikhub } from "@/lib/tikhub";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: journeyId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("*")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Mark as running (fire-and-forget: return immediately, run in background)
  await supabase
    .from("journeys")
    .update({ init_status: "running" })
    .eq("id", journeyId);

  // Run pipeline in background (don't await)
  runInitPipeline(journeyId, journey, supabase).catch(async (err) => {
    console.error("[init pipeline error]", err);
    await supabase
      .from("journeys")
      .update({ init_status: "error" })
      .eq("id", journeyId);
  });

  return NextResponse.json({ status: "started" });
}

async function runInitPipeline(
  journeyId: string,
  journey: { keywords: string[]; niche_level2: string },
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const keywords: string[] = journey.keywords ?? [];

  // Step 1: Tavily search for WeChat MP articles
  const searchResults = await tavilySearch(keywords, {
    include_domains: ["mp.weixin.qq.com"],
    max_results: 20,
  });

  const seen = new Set<string>();

  // Step 2: For each search result, fetch article detail + identify KOC
  for (const result of searchResults.slice(0, 15)) {
    try {
      const detail = await tikhub.wechatMP.fetchArticleDetail(result.url);
      if (!detail?.data) continue;

      const { account_name, fakeid, title, read_num, publish_time } = detail.data;
      if (!account_name || !fakeid || seen.has(fakeid)) continue;
      seen.add(fakeid);

      // Upsert KOC source
      const { data: koc } = await supabase
        .from("koc_sources")
        .upsert(
          {
            journey_id: journeyId,
            platform: "wechat_mp",
            account_name,
            account_id: fakeid,
            is_manually_added: false,
            last_fetched_at: new Date().toISOString(),
          },
          { onConflict: "journey_id,account_id" }
        )
        .select()
        .single();

      if (koc) {
        // Save article
        await supabase.from("knowledge_articles").upsert(
          {
            journey_id: journeyId,
            koc_source_id: koc.id,
            title: title ?? result.title,
            url: result.url,
            read_count: read_num ?? 0,
            publish_time: publish_time ? new Date(publish_time * 1000).toISOString() : null,
          },
          { onConflict: "journey_id,url" as never }
        );
      }
    } catch {
      // Skip failed articles
    }
  }

  // Step 3: For each discovered KOC, fetch their article list
  const { data: kocList } = await supabase
    .from("koc_sources")
    .select("*")
    .eq("journey_id", journeyId);

  for (const koc of kocList ?? []) {
    if (!koc.account_id) continue;
    try {
      const listData = await tikhub.wechatMP.fetchArticleList(koc.account_id);
      const articles = listData?.data?.article_list ?? [];

      let totalReads = 0;
      let maxReads = 0;
      let count = 0;

      for (const art of articles.slice(0, 20)) {
        const readCount = art.read_num ?? 0;
        totalReads += readCount;
        maxReads = Math.max(maxReads, readCount);
        count++;

        await supabase.from("knowledge_articles").upsert(
          {
            journey_id: journeyId,
            koc_source_id: koc.id,
            title: art.title ?? "",
            url: art.content_url ?? "",
            read_count: readCount,
            publish_time: art.datetime ? new Date(art.datetime * 1000).toISOString() : null,
          },
          { onConflict: "journey_id,url" as never }
        );
      }

      // Update KOC stats
      const avgReads = count > 0 ? Math.round(totalReads / count) : 0;
      await supabase
        .from("koc_sources")
        .update({
          max_read_count: maxReads,
          avg_read_count: avgReads,
          article_count: count,
          last_fetched_at: new Date().toISOString(),
        })
        .eq("id", koc.id);
    } catch {
      // Skip failed KOCs
    }
  }

  // Step 4: Mark viral articles (read_count > avg * 3)
  const { data: stats } = await supabase
    .from("knowledge_articles")
    .select("read_count")
    .eq("journey_id", journeyId);

  if (stats && stats.length > 0) {
    const avg = stats.reduce((s: number, a: any) => s + (a.read_count ?? 0), 0) / stats.length;
    const threshold = avg * 3;

    await supabase
      .from("knowledge_articles")
      .update({ is_viral: true })
      .eq("journey_id", journeyId)
      .gt("read_count", threshold);
  }

  // Step 5: Mark complete
  await supabase
    .from("journeys")
    .update({ knowledge_initialized: true, init_status: "done" })
    .eq("id", journeyId);
}
