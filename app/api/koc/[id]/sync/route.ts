import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { KOCSource } from "@/lib/data";
import { tikhub } from "@/lib/tikhub";

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
    .single() as { data: KOCSource | null };

  if (!koc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Verify ownership
  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", koc.journey_id)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!koc.account_id && !koc.account_name) {
    return NextResponse.json({ error: "No account identifier" }, { status: 400 });
  }

  try {
    let totalReads = 0;
    let maxReads = 0;
    let articleCount = 0;

    // Fetch articles - try ghid first, then fakeid
    let listData: any = null;
    if (koc.account_id?.startsWith("gh_")) {
      listData = await tikhub.wechatMP.fetchArticleListByGhid(koc.account_id);
    } else if (koc.account_id) {
      listData = await tikhub.wechatMP.fetchArticleListByFakeid(koc.account_id);
    }

    const articles = listData?.data?.article_list || [];

    for (const article of articles.slice(0, 20)) {
      const readCount = article.read_num || 0;
      totalReads += readCount;
      maxReads = Math.max(maxReads, readCount);
      articleCount++;

      // Upsert article into knowledge base
      await supabase.from("knowledge_articles").upsert(
        {
          journey_id: koc.journey_id,
          koc_source_id: koc.id,
          title: article.title || "",
          url: article.content_url || "",
          read_count: readCount,
          publish_time: article.datetime
            ? new Date(article.datetime * 1000).toISOString()
            : null,
          // If you have a content field, you could fetch article detail here too
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
        account_name: listData?.data?.mp_name || koc.account_name,
      })
      .eq("id", kocId);

    return NextResponse.json({ success: true, articleCount });
  } catch (err) {
    console.error("Sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
