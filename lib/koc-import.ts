import type { SupabaseClient } from "@supabase/supabase-js";
import { dajiala, type DajialaArticleListItem, type DajialaPostHistoryResult } from "./dajiala";
import { indexKnowledgeArticlesByIds } from "@/lib/rag/llamaindex/ingest";

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
  articleIds: string[];
};

type ArticlePayload = {
  journey_id: string;
  koc_source_id: string;
  title: string;
  url: string | null;
  source_url?: string;
  content: string;
  content_html?: string;
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
  source_type: "competitor_account" | "wechat_hot_discovery";
  discovery_keyword?: string;
  discovery_reason?: string;
};

const DEFAULT_IMPORT_ARTICLE_LIMIT = 3;

export async function importKocForJourney(
  supabase: SupabaseClient,
  journeyId: string,
  input: string,
  options?: {
    sourceType?: "explicit_benchmark" | "hot_article_discovery";
    discoveryKeyword?: string;
    discoveryConfidence?: number;
    discoveryReason?: string;
  }
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
      account_name: postHistory.mp_nickname || input,
      account_id: ghid,
      ghid,
      wxid: postHistory.mp_wxid,
      avatar_url: normalizeImageUrl(postHistory.head_img),
      is_manually_added: false,
      source_type: options?.sourceType || "explicit_benchmark",
      discovery_keyword: options?.discoveryKeyword,
      discovery_confidence: options?.discoveryConfidence,
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
    sourceType: options?.sourceType === "hot_article_discovery" ? "wechat_hot_discovery" : "competitor_account",
    discoveryKeyword: options?.discoveryKeyword,
    discoveryReason: options?.discoveryReason,
  });

  await updateKocStats(supabase, koc.id, saveResult);
  await tryIndexKnowledgeArticles(supabase, saveResult.articleIds);

  return {
    success: true,
    articleCount: saveResult.savedCount,
    costMoney: postHistory.cost_money,
    remainMoney: postHistory.remain_money,
    account: {
      name: postHistory.mp_nickname || input,
      ghid,
      wxid: postHistory.mp_wxid,
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

  await supabase
    .from("koc_sources")
    .update({
      account_name: postHistory.mp_nickname || koc.account_name,
      ghid: postHistory.mp_ghid || koc.ghid || koc.account_id,
      wxid: postHistory.mp_wxid || koc.wxid,
      avatar_url: normalizeImageUrl(postHistory.head_img),
    })
    .eq("id", koc.id);

  const saveResult = await saveArticlesToKnowledgeBase({
    supabase,
    journeyId: koc.journey_id,
    kocId: koc.id,
    articles: postHistory.articles,
    limit,
    viralThreshold: Math.max((koc.avg_top_read || 1000) * 10, 10000),
    sourceType: "competitor_account",
  });

  await updateKocStats(supabase, koc.id, saveResult);
  await tryIndexKnowledgeArticles(supabase, saveResult.articleIds);

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
  sourceType,
  discoveryKeyword,
  discoveryReason,
}: {
  supabase: SupabaseClient;
  journeyId: string;
  kocId: string;
  articles: DajialaArticleListItem[];
  limit: number;
  viralThreshold: number;
  sourceType: "competitor_account" | "wechat_hot_discovery";
  discoveryKeyword?: string;
  discoveryReason?: string;
}): Promise<ArticleSaveResult> {
  let totalReads = 0;
  let maxReads = 0;
  let savedCount = 0;
  const articleIds: string[] = [];

  for (const article of articles.slice(0, limit)) {
    let readCount = 0;
    let likeCount = 0;
    let lookingCount = 0;
    let shareCount = 0;
    let collectCount = 0;
    let commentCount = 0;
    let content = "";
    let contentHtml = "";

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
        if (detail.code && detail.code !== 0) {
          console.warn("[koc-import] Article detail returned non-zero code:", {
            url: article.url,
            code: detail.code,
            msg: detail.msg,
          });
        }
        content = detail.content || stripHtml(detail.content_multi_text || "");
        contentHtml = detail.content_multi_text || "";
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
      content_html: contentHtml,
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
      source_type: sourceType,
      discovery_keyword: discoveryKeyword,
      discovery_reason: discoveryReason,
    };

    const articleId = await saveKnowledgeArticle(supabase, payload);

    savedCount++;
    articleIds.push(articleId);
    totalReads += readCount;
    maxReads = Math.max(maxReads, readCount);
  }

  return {
    savedCount,
    totalReads,
    maxReads,
    articleIds,
  };
}

async function saveKnowledgeArticle(
  supabase: SupabaseClient,
  payload: ArticlePayload
) {
  const { data, error } = await supabase
    .from("knowledge_articles")
    .upsert(payload, { onConflict: "journey_id,url" })
    .select("id")
    .single();

  if (!error && data?.id) return data.id as string;

  if (!error) {
    throw new Error(`保存文章失败: ${payload.title || payload.url || "未知文章"} - 未返回文章 ID`);
  }

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
    return existing.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("knowledge_articles")
    .insert(payload)
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`插入文章失败: ${payload.title || payload.url} - ${insertError.message}`);
  }

  if (!inserted?.id) {
    throw new Error(`插入文章失败: ${payload.title || payload.url} - 未返回文章 ID`);
  }

  return inserted.id as string;
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

function assertPostHistorySuccess(postHistory: DajialaPostHistoryResult) {
  if (postHistory.code && postHistory.code !== 200 && postHistory.code !== 0) {
    throw new Error(`API错误: code=${postHistory.code}, msg=${postHistory.msg}`);
  }
}

function normalizeImageUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) return undefined;
  return url.trim().replace(/^http:\/\//, "https://");
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function tryIndexKnowledgeArticles(
  supabase: SupabaseClient,
  articleIds: string[]
) {
  if (articleIds.length === 0) return;

  try {
    await indexKnowledgeArticlesByIds(supabase, articleIds);
  } catch (error) {
    console.warn("[koc-import] Failed to index knowledge articles", {
      articleCount: articleIds.length,
      error,
    });
  }
}
