import type { SupabaseClient } from "@supabase/supabase-js";
import { dajiala, type DajialaArticleListItem } from "./dajiala";

export async function importKocForJourney(
  supabase: SupabaseClient,
  journeyId: string,
  input: string
) {
  // 使用新的 post_history API 获取账号信息和文章列表
  const postHistory = await dajiala.getPostHistory(input, 1);

  if (!postHistory || !postHistory.mp_ghid) {
    throw new Error("无法获取公众号信息，请检查输入是否正确");
  }

  const ghid = postHistory.mp_ghid;

  // 先检查是否已经添加过
  const { data: existing } = await supabase
    .from("koc_sources")
    .select("id")
    .eq("journey_id", journeyId)
    .eq("account_id", ghid)
    .single();

  if (existing) {
    throw new Error("该公众号已添加");
  }

  // 插入 KOC 记录
  const { data: koc, error: kocError } = await supabase
    .from("koc_sources")
    .insert({
      journey_id: journeyId,
      platform: "wechat_mp",
      account_name: postHistory.mp_nickname || input,
      account_id: ghid,
      ghid: ghid,
      wxid: postHistory.mp_wxid,
      avatar_url: postHistory.head_img,
      is_manually_added: false,
    })
    .select()
    .single();

  if (kocError || !koc) {
    throw kocError ?? new Error("插入 KOC 失败");
  }

  const articles = postHistory.list || [];
  let totalReads = 0;
  let maxReads = 0;
  let articleCount = 0;

  // 遍历文章列表获取详情和数据（最多10篇）
  for (const article of articles.slice(0, 10)) {
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
        // 获取文章阅读、点赞等数据
        const stats = await dajiala.getArticleStats(article.url);
        readCount = stats.read || 0;
        likeCount = stats.zan || 0;
        lookingCount = stats.looking || 0;
        shareCount = stats.share_num || 0;
        collectCount = stats.collect_num || 0;
        commentCount = stats.comment_count || 0;

        // 获取文章详情
        const detail = await dajiala.getArticleDetail(article.url);
        content = detail.content || "";
      }
    } catch {
      // 跳过获取失败的文章，继续处理下一篇
    }

    totalReads += readCount;
    maxReads = Math.max(maxReads, readCount);

    // 判断是否为爆款（阅读≥1万）
    const isViral = readCount >= 10000;

    // 所有文章都保存到数据库（无论是否是爆款）
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

  // 更新 KOC 的统计数据
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
    costMoney: postHistory.cost_money,
    remainMoney: postHistory.remain_money,
    account: {
      name: postHistory.mp_nickname || input,
      ghid: ghid,
      wxid: postHistory.mp_wxid,
    },
    kocId: koc.id,
  };
}
