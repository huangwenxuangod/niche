import type { SupabaseClient } from "@supabase/supabase-js";
import { dajiala, type DajialaAccount } from "./dajiala";

export async function importKocForJourney(
  supabase: SupabaseClient,
  journeyId: string,
  ghid: string,
  searchKeyword: string
) {
  const searchResults = await dajiala.searchAccounts(searchKeyword || ghid, 1, 50);
  const account = searchResults.find((r: DajialaAccount) => r.ghid === ghid);

  if (!account) {
    throw new Error("Account not found");
  }

  const { data: koc, error: kocError } = await supabase
    .from("koc_sources")
    .insert({
      journey_id: journeyId,
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
      qrcode: account.qrcode,
      customer_type: account.customer_type,
      signature: account.signature,
      is_manually_added: false,
    })
    .select()
    .single();

  if (kocError || !koc) {
    throw kocError ?? new Error("Insert koc failed");
  }

  const articles = await dajiala.getArticleList(ghid, 1);
  let totalReads = 0;
  let maxReads = 0;
  let articleCount = 0;

  for (const article of articles.slice(0, 20)) {
    articleCount++;
    let readCount = 0;
    let likeCount = 0;
    let lookingCount = 0;
    let shareCount = 0;
    let collectCount = 0;
    let commentCount = 0;
    let content = "";

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
      // Skip article details if third-party API is partially unavailable.
    }

    totalReads += readCount;
    maxReads = Math.max(maxReads, readCount);

    const viralThreshold = Math.max((account.avg_top_read || 1000) * 10, 10000);
    const isViral = readCount >= viralThreshold;

    await supabase.from("knowledge_articles").upsert(
      {
        journey_id: journeyId,
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
      { onConflict: "journey_id,url" }
    );
  }

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

  return {
    success: true,
    articleCount,
    account: {
      name: account.name,
      ghid: account.ghid,
    },
    kocId: koc.id,
  };
}
