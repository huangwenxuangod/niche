import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  ensureJourneyProjectMemory,
  extractOwnedWechatAccountNameFromProjectMemory,
  getJourneyProjectMemory,
  mergeOwnedWechatAccountNameIntoProjectMemory,
  saveJourneyProjectMemory,
} from "@/lib/memory";
import type { WechatDashboardData } from "@/lib/data";
import { dajiala, type DajialaArticleListItem } from "@/lib/dajiala";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const journeyId = searchParams.get("journey_id");

  if (!journeyId) {
    return NextResponse.json({ error: "Missing journey_id" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: journey } = await supabase
    .from("journeys")
    .select("id, primary_koc_source_id")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: ownedProfile } = await supabase
    .from("owned_wechat_profiles")
    .select("id, account_name")
    .eq("journey_id", journeyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const projectMemory = await ensureJourneyProjectMemory(supabase, journeyId);
  const accountName =
    ownedProfile?.account_name || extractOwnedWechatAccountNameFromProjectMemory(projectMemory);

  if (!accountName) {
    return NextResponse.json({
      configured: false,
      account_name: "",
    });
  }

  const articleQuery = supabase
    .from("owned_wechat_articles")
    .select("id, title, publish_time, read_num, like_num, share_num, comment_num, account_name")
    .eq("journey_id", journeyId)
    .order("publish_time", { ascending: false });

  if (ownedProfile?.id) {
    articleQuery.eq("owned_profile_id", ownedProfile.id);
  } else {
    articleQuery.ilike("account_name", `%${accountName}%`);
  }

  const { data: articleRows } = await articleQuery.limit(50);
  const articles = (articleRows ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? "未命名文章"),
    read_num: Number(row.read_num ?? 0),
    like_num: Number(row.like_num ?? 0),
    share_num: Number(row.share_num ?? 0),
    comment_num: Number(row.comment_num ?? 0),
    publish_time: String(row.publish_time ?? new Date().toISOString()),
  }));

  const summary = buildOwnedDashboardSummary(articles);
  const aiInsights = buildOwnedAiInsights(accountName, articles, summary);
  const benchmark = await buildBenchmarkComparison(
    supabase,
    journeyId,
    journey.primary_koc_source_id ?? null,
    summary
  );

  return NextResponse.json({
    configured: true,
    account_name: accountName,
    account: {
      name: accountName,
      avatar_url: null,
    },
    summary,
    articles: [...articles]
      .sort((a, b) => b.read_num - a.read_num)
      .slice(0, 5),
    ai_insights: aiInsights,
    benchmark,
    is_demo: articles.length === 0,
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const journeyId = String(body.journey_id ?? "");
  const accountName = String(body.account_name ?? "").trim();

  if (!journeyId) {
    return NextResponse.json({ error: "Missing journey_id" }, { status: 400 });
  }

  const { data: journey } = await supabase
    .from("journeys")
    .select("id")
    .eq("id", journeyId)
    .eq("user_id", user.id)
    .single();

  if (!journey) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const projectMemory = await getJourneyProjectMemory(supabase, journeyId);
  const merged = mergeOwnedWechatAccountNameIntoProjectMemory(projectMemory, accountName);
  await saveJourneyProjectMemory(supabase, journeyId, merged);

  let importedArticleCount = 0;
  if (accountName) {
    const profileId = await upsertOwnedWechatProfile(supabase, {
      userId: user.id,
      journeyId,
      accountName,
    });
    importedArticleCount = await importOwnedWechatArticlesFromDajiala(supabase, {
      userId: user.id,
      journeyId,
      profileId,
      accountName,
    });
  }

  return NextResponse.json({
    success: true,
    configured: Boolean(accountName),
    account_name: accountName,
    imported_article_count: importedArticleCount,
  });
}

async function upsertOwnedWechatProfile(
  supabase: ReturnType<typeof createClient>,
  params: { userId: string; journeyId: string; accountName: string }
) {
  const { data: existing } = await supabase
    .from("owned_wechat_profiles")
    .select("id")
    .eq("journey_id", params.journeyId)
    .eq("account_name", params.accountName)
    .maybeSingle();

  if (existing?.id) {
    return String(existing.id);
  }

  const { data, error } = await supabase
    .from("owned_wechat_profiles")
    .insert({
      user_id: params.userId,
      journey_id: params.journeyId,
      account_name: params.accountName,
      import_source: "dajiala",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message || "创建公众号档案失败");
  }

  return String(data.id);
}

async function importOwnedWechatArticlesFromDajiala(
  supabase: ReturnType<typeof createClient>,
  params: { userId: string; journeyId: string; profileId: string; accountName: string }
) {
  const postHistory = await dajiala.getPostHistory(params.accountName, 1);
  if (postHistory.code && postHistory.code !== 200 && postHistory.code !== 0) {
    throw new Error(postHistory.msg || `获取公众号历史失败: ${postHistory.code}`);
  }

  const articles = postHistory.articles.slice(0, 8);
  let savedCount = 0;

  for (const article of articles) {
    const payload = await buildOwnedWechatArticlePayload(article, params.accountName);
    const { error } = await supabase
      .from("owned_wechat_articles")
      .upsert(
        {
          user_id: params.userId,
          journey_id: params.journeyId,
          wechat_config_id: null,
          owned_profile_id: params.profileId,
          publish_id: payload.publish_id,
          msg_id: payload.msg_id,
          article_idx: payload.article_idx,
          title: payload.title,
          digest: payload.digest,
          content: payload.content,
          content_html: payload.content_html,
          url: payload.url,
          cover_url: payload.cover_url,
          author: payload.author,
          account_name: payload.account_name,
          publish_time: payload.publish_time,
          read_num: payload.read_num,
          like_num: payload.like_num,
          share_num: payload.share_num,
          comment_num: payload.comment_num,
          favorite_num: payload.favorite_num,
          raw_payload: payload.raw_payload,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "journey_id,url" }
      );

    if (error) {
      throw new Error(`保存公众号文章失败: ${error.message}`);
    }

    savedCount += 1;
  }

  return savedCount;
}

async function buildOwnedWechatArticlePayload(
  article: DajialaArticleListItem,
  accountName: string
) {
  let detailContent = "";
  let detailHtml = "";
  let readNum = 0;
  let likeNum = 0;
  let shareNum = 0;
  let commentNum = 0;
  let favoriteNum = 0;

  if (article.url) {
    const [statsRes, detailRes] = await Promise.allSettled([
      dajiala.getArticleStats(article.url),
      dajiala.getArticleDetail(article.url),
    ]);

    if (statsRes.status === "fulfilled") {
      readNum = statsRes.value.read || 0;
      likeNum = statsRes.value.zan || 0;
      shareNum = statsRes.value.share_num || 0;
      commentNum = statsRes.value.comment_count || 0;
      favoriteNum = statsRes.value.collect_num || 0;
    }

    if (detailRes.status === "fulfilled") {
      detailContent = detailRes.value.content || stripHtml(detailRes.value.content_multi_text || "");
      detailHtml = detailRes.value.content_multi_text || "";
    }
  }

  return {
    publish_id: null,
    msg_id: null,
    article_idx: Number(article.idx ?? 0),
    title: article.title || "未命名文章",
    digest: article.digest || null,
    content: detailContent,
    content_html: detailHtml,
    url: article.url || article.source_url || `owned://${accountName}/${article.title}`,
    cover_url: normalizeImageUrl(article.cover_url),
    author: article.author || null,
    account_name: accountName,
    publish_time: article.post_time ? new Date(article.post_time * 1000).toISOString() : null,
    read_num: readNum,
    like_num: likeNum,
    share_num: shareNum,
    comment_num: commentNum,
    favorite_num: favoriteNum,
    raw_payload: article,
  };
}

function buildOwnedDashboardSummary(
  articles: Array<{
    read_num: number;
    like_num: number;
    share_num: number;
    comment_num: number;
  }>
) {
  const articleCount = articles.length;
  const totalReads = articles.reduce((sum, item) => sum + item.read_num, 0);
  const totalLikes = articles.reduce((sum, item) => sum + item.like_num, 0);
  const totalShares = articles.reduce((sum, item) => sum + item.share_num, 0);
  const totalComments = articles.reduce((sum, item) => sum + item.comment_num, 0);
  const peakReads = articles.reduce((max, item) => Math.max(max, item.read_num), 0);

  return {
    article_count: articleCount,
    total_reads: totalReads,
    avg_reads: articleCount ? Math.round(totalReads / articleCount) : 0,
    avg_likes: articleCount ? Math.round(totalLikes / articleCount) : 0,
    avg_shares: articleCount ? Math.round(totalShares / articleCount) : 0,
    avg_comments: articleCount ? Math.round(totalComments / articleCount) : 0,
    peak_reads: peakReads,
  };
}

function buildOwnedAiInsights(
  accountName: string,
  articles: Array<{ title: string; read_num: number; share_num: number }>,
  summary: WechatDashboardData["summary"]
) {
  if (!articles.length) {
    return `已经为「${accountName}」完成配置，但暂时还没有拉到文章数据。下一步优先确认名称是否准确，或者补一次同步。`;
  }

  const topArticle = [...articles].sort((a, b) => b.read_num - a.read_num)[0];
  const highShareArticle = [...articles].sort((a, b) => b.share_num - a.share_num)[0];

  return [
    `目前已沉淀 ${summary.article_count} 篇文章，平均阅读 ${summary.avg_reads}。`,
    topArticle
      ? `当前阅读表现最强的是《${topArticle.title}》，说明这类表达最容易形成传播势能。`
      : "",
    highShareArticle && highShareArticle.title !== topArticle?.title
      ? `当前分享表现最强的是《${highShareArticle.title}》，说明它更容易触发用户主动转发。`
      : "",
    "后面这里最值得看的不是单篇高低，而是：哪些主题反复有效、哪些表达最像你、哪些内容开始形成长期母题。",
  ]
    .filter(Boolean)
    .join("");
}

async function buildBenchmarkComparison(
  supabase: ReturnType<typeof createClient>,
  journeyId: string,
  primaryKocSourceId: string | null,
  ownedSummary: WechatDashboardData["summary"]
) {
  if (!primaryKocSourceId) {
    return null;
  }

  const { data: koc } = await supabase
    .from("koc_sources")
    .select("account_name, article_count, avg_read_count, max_read_count")
    .eq("id", primaryKocSourceId)
    .maybeSingle();

  if (!koc) {
    return null;
  }

  const benchmarkSummary = {
    article_count: Number(koc.article_count ?? 0),
    avg_reads: Number(koc.avg_read_count ?? 0),
    peak_reads: Number(koc.max_read_count ?? 0),
  };

  const gapSummary: string[] = [];

  if (benchmarkSummary.avg_reads > ownedSummary.avg_reads) {
    gapSummary.push(
      `核心对标的平均阅读更高（${benchmarkSummary.avg_reads} vs ${ownedSummary.avg_reads}），说明你们的稳定传播力还存在差距。`
    );
  } else if (ownedSummary.avg_reads > 0) {
    gapSummary.push(
      `你的平均阅读已经接近或超过核心对标（${ownedSummary.avg_reads} vs ${benchmarkSummary.avg_reads}），下一步更值得看的是峰值和可复制性。`
    );
  }

  if (benchmarkSummary.peak_reads > ownedSummary.peak_reads) {
    gapSummary.push(
      `核心对标的峰值文章更强（${benchmarkSummary.peak_reads} vs ${ownedSummary.peak_reads}），说明它在单篇爆发力和选题卡位上更有优势。`
    );
  }

  if (benchmarkSummary.article_count > ownedSummary.article_count) {
    gapSummary.push(
      `核心对标当前沉淀了更多样本（${benchmarkSummary.article_count} vs ${ownedSummary.article_count}），这意味着它的母题和表达模型更稳定。`
    );
  }

  if (!gapSummary.length) {
    gapSummary.push("你和核心对标已经有可比较的基础了，下一步更该盯的是哪些选题结构和表达判断可以迁移。");
  }

  return {
    account: {
      name: String(koc.account_name ?? "核心对标"),
    },
    summary: benchmarkSummary,
    gap_summary: gapSummary.slice(0, 3),
  };
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

function normalizeImageUrl(url: unknown) {
  if (typeof url !== "string" || !url.trim()) return null;
  return url.trim().replace(/^http:\/\//, "https://");
}
