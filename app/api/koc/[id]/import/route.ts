import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { dajiala } from "@/lib/dajiala";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: ghid } = await params;
  const { journey_id } = await req.json();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify journey ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("*")
    .eq("id", journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // First search for the account to get basic info
    // Try with journey keywords first, or fallback to ghid
    const searchKeyword = journey.keywords?.[0] || ghid;
    const searchResults = await dajiala.searchAccounts(searchKeyword, 1, 50);
    const account = searchResults.find((r: any) => r.ghid === ghid);

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Insert KOC source
    const { data: koc, error: kocError } = await supabase
      .from("koc_sources")
      .insert({
        journey_id,
        platform: "wechat_mp",
        account_name: account.name,
        account_id: account.ghid,
        ghid: account.ghid,
        biz: account.biz,
        fans_count: account.fans,
        avg_top_read: account.avg_top_read,
        avg_top_like: account.avg_top_like,
        week_articles_count: account.week_articles,
        avatar_url: account.avatar,
        is_manually_added: false,
      })
      .select()
      .single();

    if (kocError) throw kocError;

    // Fetch articles
    const articles = await dajiala.getArticleList(ghid, 1);
    let totalReads = 0;
    let maxReads = 0;
    let articleCount = 0;

    for (const article of articles.slice(0, 20)) {
      articleCount++;
      let readCount = 0;
      let likeCount = 0;
      let content = "";
      let isOriginal = false;

      // Try to get stats and content
      try {
        if (article.url) {
          const stats = await dajiala.getArticleStats(article.url);
          readCount = stats.read || 0;
          likeCount = stats.zan || 0;

          const detail = await dajiala.getArticleDetail(article.url);
          content = detail.content || "";
        }
      } catch {
        // Skip content/stats if fail, still save basic article info
      }

      totalReads += readCount;
      maxReads = Math.max(maxReads, readCount);

      // Determine if viral (threshold: 10x average top read or >10k)
      const viralThreshold = Math.max(account.avg_top_read * 10, 10000);
      const isViral = readCount >= viralThreshold;

      // Upsert article
      await supabase.from("knowledge_articles").upsert(
        {
          journey_id,
          koc_source_id: koc.id,
          title: article.title || "",
          url: article.url || "",
          content,
          read_count: readCount,
          likes_count: likeCount,
          comments_count: 0,
          share_count: 0,
          collect_count: 0,
          is_original: article.original === 1,
          cover_url: article.cover_url,
          publish_time: article.post_time
            ? new Date(article.post_time * 1000).toISOString()
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
      .eq("id", koc.id);

    return NextResponse.json({ success: true, articleCount });
  } catch (err) {
    console.error("Import failed:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
