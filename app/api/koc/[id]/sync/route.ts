import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { KOCSource } from "@/lib/data";
import { dajiala } from "@/lib/dajiala";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id: kocId } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get KOC source
  const { data: koc } = await supabase
    .from("koc_sources")
    .select("*")
    .eq("id", kocId)
    .single() as { data: KOCSource & { ghid?: string; avg_top_read?: number } | null };

  if (!koc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("id, keywords")
    .eq("id", koc.journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const ghid = koc.ghid || koc.account_id;
  if (!ghid) {
    return NextResponse.json({ error: "No account identifier" }, { status: 400 });
  }

  try {
    let totalReads = 0;
    let maxReads = 0;
    let articleCount = 0;

    // Fetch articles from dajiala
    const articles = await dajiala.getArticleList(ghid, 1);

    for (const article of articles.slice(0, 20)) {
      articleCount++;
      let readCount = 0;
      let likeCount = 0;
      let lookingCount = 0;
      let shareCount = 0;
      let collectCount = 0;
      let commentCount = 0;
      let content = "";

      // Try to get stats and content
      try {
        if (article.url) {
          const stats = await dajiala.getArticleStats(article.url);
          readCount = stats.read || 0;
          likeCount = stats.zan || 0;
          lookingCount = stats.looking || 0;
          shareCount = stats.share_num || 0;
          collectCount = stats.collect_num || 0;
          commentCount = stats.comment_count || 0;

          const detail = await dajiala.getArticleDetail(article.url);
          content = detail.content || "";
        }
      } catch {
        // Skip content/stats if fail
      }

      totalReads += readCount;
      maxReads = Math.max(maxReads, readCount);

      // Determine if viral
      const viralThreshold = Math.max((koc.avg_top_read || 1000) * 10, 10000);
      const isViral = readCount >= viralThreshold;

      // Upsert article with all fields
      await supabase.from("knowledge_articles").upsert(
        {
          journey_id: koc.journey_id,
          koc_source_id: koc.id,
          title: article.title || "",
          url: article.url || "",
          source_url: article.source_url,
          content,
          digest: article.digest,
          author: article.author,
          read_count: readCount,
          likes_count: likeCount,
          looking_count: lookingCount,
          share_count: shareCount,
          collect_count: collectCount,
          comment_count: commentCount,
          copyright_stat: article.copyright_stat,
          is_original: article.copyright_stat === 1,
          cover_url: article.cover_url,
          ip_wording: article.ip_wording,
          item_show_type: article.item_show_type,
          real_item_show_type: article.real_item_show_type,
          idx: article.idx,
          msg_daily_idx: article.msg_daily_idx,
          alias: article.alias,
          video_page_infos: article.video_page_infos,
          publish_time: article.post_time
            ? new Date(article.post_time * 1000).toISOString()
            : null,
          create_time: article.create_time
            ? new Date(article.create_time * 1000).toISOString()
            : null,
          is_viral: isViral,
        },
        { onConflict: "journey_id,url" as any }
      );
    }

    // Update KOC stats
    const avgReads = articleCount > 0 ? Math.round(totalReads / articleCount) : 0;
    await supabase
      .from("koc_sources")
      .update({
        max_read_count: maxReads,
        avg_read_count: avgReads,
        article_count: articleCount,
        last_fetched_at: new Date().toISOString(),
      })
      .eq("id", kocId);

    return NextResponse.json({ success: true, articleCount });
  } catch (err) {
    console.error("Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
