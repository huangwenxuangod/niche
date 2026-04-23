import type { SupabaseClient } from "@supabase/supabase-js";
import { dajiala, type DajialaAccount, type DajialaArticleListItem, type DajialaPostHistoryResult } from "./dajiala";

type KocSourceForSync = {
  id: string;
  journey_id: string;
  account_name: string | null;
  account_id: string | null;
  ghid?: string | null;
  wxid?: string | null;
  avg_top_read?: number | null;
};

type ArticleSaveResult = {
  savedCount: number;
  totalReads: number;
  maxReads: number;
};

type ArticlePayload = {
  journey_id: string;
  koc_source_id: string;
  title: string;
  url: string | null;
  source_url?: string;
  content: string;
  digest?: string;
  author?: string;
  read_count: number;
  likes_count: number;
  looking_count: number;
  share_count: number;
  collect_count: number;
  comment_count: number;
  copyright_stat?: number;
  is_original: boolean;
  cover_url?: string;
  ip_wording?: string;
  item_show_type?: number;
  real_item_show_type?: number;
  idx?: number;
  msg_daily_idx?: number;
  alias?: string;
  video_page_infos?: unknown;
  publish_time: string | null;
  create_time: string | null;
  is_viral: boolean;
};

const DEFAULT_IMPORT_ARTICLE_LIMIT = 20;

export async function importKocForJourney(
  supabase: SupabaseClient,
  journeyId: string,
  input: string
) {
  const postHistory = await dajiala.getPostHistory(input, 1);

  console.log("[koc-import] Normalized post_history:", {
    account: {
      mp_nickname: postHistory.mp_nickname,
      mp_wxid: postHistory.mp_wxid,
      mp_ghid: postHistory.mp_ghid,
      head_img: postHistory.head_img,
    },
    articleCount: postHistory.articles.length,
  });

  assertPostHistorySuccess(postHistory);

  if (!postHistory.mp_ghid) {
    throw new Error(`无法获取公众号原始ID，API返回: ${JSON.stringify(postHistory.raw)}`);
  }

  const ghid = postHistory.mp_ghid;
  const accountProfile = await findAccountProfile({
    name: postHistory.mp_nickname || input,
    ghid,
    wxid: postHistory.mp_wxid,
  });

  const { data: existing } = await supabase
    .from("koc_sources")
    .select("id")
    .eq("journey_id", journeyId)
    .eq("account_id", ghid)
    .single();

  if (existing) {
    throw new Error("该公众号已添加");
  }

  const { data: koc, error: kocError } = await supabase
    .from("koc_sources")
    .insert({
      journey_id: journeyId,
      platform: "wechat_mp",
      account_name: postHistory.mp_nickname || accountProfile?.name || input,
      account_id: ghid,
      ghid,
      wxid: postHistory.mp_wxid || accountProfile?.wxid,
      biz: accountProfile?.biz,
      fans_count: accountProfile?.fans ?? 0,
      avg_top_read: accountProfile?.avg_top_read ?? 0,
      avg_top_like: accountProfile?.avg_top_like ?? 0,
      week_articles_count: accountProfile?.week_articles ?? 0,
      avatar_url: normalizeImageUrl(postHistory.head_img || accountProfile?.avatar),
      signature: accountProfile?.signature,
      qrcode: normalizeImageUrl(accountProfile?.qrcode),
      customer_type: accountProfile?.customer_type,
      is_manually_added: false,
    })
    .select()
    .single();

  if (kocError || !koc) {
    throw kocError ?? new Error("插入 KOC 失败");
  }

  const saveResult = await saveArticlesToKnowledgeBase({
    supabase,
    journeyId,
    kocId: koc.id,
    articles: postHistory.articles,
    limit: DEFAULT_IMPORT_ARTICLE_LIMIT,
    viralThreshold: 10000,
  });

  await updateKocStats(supabase, koc.id, saveResult);

  return {
    success: true,
    articleCount: saveResult.savedCount,
    costMoney: postHistory.cost_money,
    remainMoney: postHistory.remain_money,
    account: {
      name: postHistory.mp_nickname || accountProfile?.name || input,
      ghid,
      wxid: postHistory.mp_wxid || accountProfile?.wxid,
    },
    kocId: koc.id,
  };
}

export async function syncKocSourceArticles(
  supabase: SupabaseClient,
  koc: KocSourceForSync,
  limit = DEFAULT_IMPORT_ARTICLE_LIMIT
) {
  const postHistory = await dajiala.getPostHistoryByAccount(
    {
      name: koc.account_name,
      wxid: koc.wxid,
      ghid: koc.ghid || koc.account_id,
    },
    1
  );

  assertPostHistorySuccess(postHistory);

  if (!postHistory.articles.length) {
    return {
      success: true,
      articleCount: 0,
      warning: "大佳拉 post_history 未返回文章，已保留原有 KOC 统计，未清零。",
    };
  }

  const accountProfile = await findAccountProfile({
    name: postHistory.mp_nickname || koc.account_name || "",
    ghid: postHistory.mp_ghid || koc.ghid || koc.account_id || undefined,
    wxid: postHistory.mp_wxid || koc.wxid || undefined,
  });
  const accountProfileUpdate = accountProfile
    ? {
        biz: accountProfile.biz,
        fans_count: accountProfile.fans,
        avg_top_read: accountProfile.avg_top_read,
        avg_top_like: accountProfile.avg_top_like,
        week_articles_count: accountProfile.week_articles,
        signature: accountProfile.signature,
        qrcode: normalizeImageUrl(accountProfile.qrcode),
        customer_type: accountProfile.customer_type,
      }
    : {};

  await supabase
    .from("koc_sources")
    .update({
      account_name: postHistory.mp_nickname || accountProfile?.name || koc.account_name,
      ghid: postHistory.mp_ghid || accountProfile?.ghid || koc.ghid || koc.account_id,
      wxid: postHistory.mp_wxid || accountProfile?.wxid || koc.wxid,
      avatar_url: normalizeImageUrl(postHistory.head_img || accountProfile?.avatar),
      ...accountProfileUpdate,
    })
    .eq("id", koc.id);

  const saveResult = await saveArticlesToKnowledgeBase({
    supabase,
    journeyId: koc.journey_id,
    kocId: koc.id,
    articles: postHistory.articles,
    limit,
    viralThreshold: Math.max((koc.avg_top_read || 1000) * 10, 10000),
  });

  await updateKocStats(supabase, koc.id, saveResult);

  return {
    success: true,
    articleCount: saveResult.savedCount,
  };
}

async function saveArticlesToKnowledgeBase({
  supabase,
  journeyId,
  kocId,
  articles,
  limit,
  viralThreshold,
}: {
  supabase: SupabaseClient;
  journeyId: string;
  kocId: string;
  articles: DajialaArticleListItem[];
  limit: number;
  viralThreshold: number;
}): Promise<ArticleSaveResult> {
  let totalReads = 0;
  let maxReads = 0;
  let savedCount = 0;

  for (const article of articles.slice(0, limit)) {
    let readCount = 0;
    let likeCount = 0;
    let lookingCount = 0;
    let shareCount = 0;
    let collectCount = 0;
    let commentCount = 0;
    let content = "";

    if (article.url) {
      try {
        const stats = await dajiala.getArticleStats(article.url);
        readCount = stats.read || 0;
        likeCount = stats.zan || 0;
        lookingCount = stats.looking || 0;
        shareCount = stats.share_num || 0;
        collectCount = stats.collect_num || 0;
        commentCount = stats.comment_count || 0;
      } catch (err) {
        console.warn("[koc-import] Failed to fetch article stats:", article.url, err);
      }

      try {
        const detail = await dajiala.getArticleDetail(article.url);
        content = detail.content || "";
      } catch (err) {
        console.warn("[koc-import] Failed to fetch article detail:", article.url, err);
      }
    }

    const payload: ArticlePayload = {
      journey_id: journeyId,
      koc_source_id: kocId,
      title: article.title || "",
      url: article.url || null,
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
      is_original: article.copyright_stat === 1 || article.original === 1,
      cover_url: normalizeImageUrl(article.cover_url),
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
      is_viral: readCount >= viralThreshold,
    };

    await saveKnowledgeArticle(supabase, payload);

    savedCount++;
    totalReads += readCount;
    maxReads = Math.max(maxReads, readCount);
  }

  return {
    savedCount,
    totalReads,
    maxReads,
  };
}

async function saveKnowledgeArticle(
  supabase: SupabaseClient,
  payload: ArticlePayload
) {
  const { error } = await supabase.from("knowledge_articles").upsert(
    payload,
    { onConflict: "journey_id,url" }
  );

  if (!error) return;

  if (error.code !== "42P10" || !payload.url) {
    throw new Error(`保存文章失败: ${payload.title || payload.url || "未知文章"} - ${error.message}`);
  }

  console.warn("[koc-import] Missing unique constraint for knowledge_articles(journey_id,url), falling back to select/update/insert.");

  const { data: existing, error: findError } = await supabase
    .from("knowledge_articles")
    .select("id")
    .eq("journey_id", payload.journey_id)
    .eq("url", payload.url)
    .maybeSingle();

  if (findError) {
    throw new Error(`查询已有文章失败: ${payload.title || payload.url} - ${findError.message}`);
  }

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("knowledge_articles")
      .update(payload)
      .eq("id", existing.id);

    if (updateError) {
      throw new Error(`更新文章失败: ${payload.title || payload.url} - ${updateError.message}`);
    }
    return;
  }

  const { error: insertError } = await supabase
    .from("knowledge_articles")
    .insert(payload);

  if (insertError) {
    throw new Error(`插入文章失败: ${payload.title || payload.url} - ${insertError.message}`);
  }
}

async function updateKocStats(
  supabase: SupabaseClient,
  kocId: string,
  saveResult: ArticleSaveResult
) {
  const avgReads = saveResult.savedCount > 0
    ? Math.round(saveResult.totalReads / saveResult.savedCount)
    : 0;

  const { error } = await supabase
    .from("koc_sources")
    .update({
      max_read_count: saveResult.maxReads,
      avg_read_count: avgReads,
      article_count: saveResult.savedCount,
      last_fetched_at: new Date().toISOString(),
    })
    .eq("id", kocId);

  if (error) {
    throw new Error(`更新 KOC 统计失败: ${error.message}`);
  }
}

async function findAccountProfile({
  name,
  ghid,
  wxid,
}: {
  name: string;
  ghid?: string;
  wxid?: string;
}) {
  try {
    const accounts = await dajiala.searchAccounts(name, 1, 10);
    return accounts.find((account) => isSameAccount(account, { name, ghid, wxid })) ?? accounts[0];
  } catch (err) {
    console.warn("[koc-import] Failed to enrich account profile:", name, err);
    return null;
  }
}

function isSameAccount(
  account: DajialaAccount,
  target: { name: string; ghid?: string; wxid?: string }
) {
  return account.ghid === target.ghid ||
    account.wxid === target.wxid ||
    account.name === target.name;
}

function assertPostHistorySuccess(postHistory: DajialaPostHistoryResult) {
  if (postHistory.code && postHistory.code !== 200 && postHistory.code !== 0) {
    throw new Error(`API错误: code=${postHistory.code}, msg=${postHistory.msg}`);
  }
}

function normalizeImageUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) return undefined;
  return url.trim().replace(/^http:\/\//, "https://");
}
