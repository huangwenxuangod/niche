import type { SupabaseClient } from "@supabase/supabase-js";
import { llm } from "@/lib/llm";
import { decryptWechatSecret, fetchWechatAccessToken } from "@/lib/wechat-publish";

const FREEPUBLISH_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/batchget";
const DATACUBE_ARTICLE_SUMMARY_URL = "https://api.weixin.qq.com/datacube/getarticlesummary";
const DATACUBE_ARTICLE_TOTAL_URL = "https://api.weixin.qq.com/datacube/getarticletotal";

type WechatConfigRow = {
  id: string;
  app_id: string;
  app_secret_encrypted: string;
  account_name: string | null;
};

type OwnedWechatArticleRecord = {
  publishId: string;
  msgId: string | null;
  articleIdx: number;
  title: string;
  digest: string;
  content: string;
  contentHtml: string;
  url: string;
  coverUrl: string | null;
  author: string | null;
  accountName: string | null;
  publishTime: string | null;
  rawPayload: Record<string, unknown>;
};

type ArticleMetric = {
  key: string;
  title: string | null;
  readNum: number;
  likeNum: number;
  shareNum: number;
  commentNum: number;
  favoriteNum: number;
};

type SyncedOwnedArticle = {
  title: string;
  digest: string | null;
  publish_time: string | null;
  read_num: number;
  like_num: number;
  share_num: number;
  comment_num: number;
  favorite_num: number;
  author: string | null;
  account_name: string | null;
};

type OwnedAnalysisReport = {
  summary: {
    account_name: string;
    article_count_30d: number;
    avg_read: number;
    best_article_title: string | null;
  };
  content_overview: {
    posting_pattern: string;
    title_pattern: string;
    best_topics: string[];
  };
  top_articles: Array<{
    title: string;
    read_num: number;
    publish_time: string | null;
    reason: string;
  }>;
  competitor_gap: {
    overview: string;
    topic_gap: string[];
    title_gap: string[];
    structure_gap: string[];
  };
  next_actions: string[];
  message_for_chat: string;
};

export async function runOwnedWechatAnalysis(params: {
  supabase: SupabaseClient;
  userId: string;
  journeyId: string;
}) {
  const config = await getWechatConfig(params.supabase, params.userId);
  if (!config) {
    throw new Error("请先填写并保存公众号配置。");
  }

  const accessToken = await fetchWechatAccessToken(
    config.app_id,
    decryptWechatSecret(config.app_secret_encrypted)
  );

  const syncJob = await createSyncJob(params.supabase, {
    userId: params.userId,
    journeyId: params.journeyId,
    wechatConfigId: config.id,
  });

  try {
    await updateSyncJob(params.supabase, syncJob.id, {
      status: "running",
      step: "fetching_articles",
    });

    const publishedArticles = await fetchWechatPublishedArticles(accessToken);

    await updateSyncJob(params.supabase, syncJob.id, {
      step: "fetching_metrics",
      articles_synced: publishedArticles.length,
    });

    const metrics = await fetchWechatArticleMetrics(accessToken, 30);
    const metricMatches = buildMetricsMap(metrics);
    const syncedArticles = publishedArticles.map((article) => mergeArticleMetrics(article, metricMatches));

    await updateSyncJob(params.supabase, syncJob.id, {
      step: "saving_articles",
      metrics_synced: metrics.length,
    });

    await saveOwnedWechatArticles(params.supabase, {
      userId: params.userId,
      journeyId: params.journeyId,
      wechatConfigId: config.id,
      articles: syncedArticles,
    });

    await updateSyncJob(params.supabase, syncJob.id, {
      step: "building_report",
    });

    const report = await buildOwnedWechatAnalysisReport(params.supabase, {
      journeyId: params.journeyId,
      userId: params.userId,
      accountName: config.account_name || syncedArticles[0]?.accountName || "已绑定公众号",
    });

    const { data: savedReport, error: reportError } = await params.supabase
      .from("owned_wechat_analysis_reports")
      .insert({
        user_id: params.userId,
        journey_id: params.journeyId,
        sync_job_id: syncJob.id,
        summary: report.summary,
        content_overview: report.content_overview,
        top_articles: report.top_articles,
        competitor_gap: report.competitor_gap,
        next_actions: report.next_actions,
        message_for_chat: report.message_for_chat,
      })
      .select("id")
      .single();

    if (reportError) {
      throw new Error(reportError.message);
    }

    await updateSyncJob(params.supabase, syncJob.id, {
      status: "success",
      step: "done",
      finished_at: new Date().toISOString(),
    });

    return {
      jobId: syncJob.id,
      reportId: savedReport.id,
      articleCount: syncedArticles.length,
      metricCount: metrics.length,
      report,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "同步公众号数据失败";
    await updateSyncJob(params.supabase, syncJob.id, {
      status: "error",
      step: "error",
      error_message: message,
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

async function getWechatConfig(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("wechat_publish_configs")
    .select("id, app_id, app_secret_encrypted, account_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as WechatConfigRow | null;
}

async function createSyncJob(
  supabase: SupabaseClient,
  payload: { userId: string; journeyId: string; wechatConfigId: string }
) {
  const { data, error } = await supabase
    .from("owned_wechat_sync_jobs")
    .insert({
      user_id: payload.userId,
      journey_id: payload.journeyId,
      wechat_config_id: payload.wechatConfigId,
      status: "pending",
      step: "queued",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "创建同步任务失败");
  }

  return data;
}

async function updateSyncJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>
) {
  await supabase
    .from("owned_wechat_sync_jobs")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function fetchWechatPublishedArticles(accessToken: string) {
  const articles: OwnedWechatArticleRecord[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const count = 20;

  for (let page = 0; page < 3; page += 1) {
    const res = await fetch(`${FREEPUBLISH_BATCHGET_URL}?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offset, count, no_content: 0 }),
    });

    if (!res.ok) {
      throw new Error(`拉取已发布文章失败：${res.status}`);
    }

    const payload = (await res.json()) as Record<string, unknown>;
    if (typeof payload.errcode === "number" && payload.errcode !== 0) {
      throw new Error(String(payload.errmsg || "拉取已发布文章失败"));
    }

    const items = Array.isArray(payload.item) ? payload.item : [];
    if (!items.length) break;

    for (const item of items) {
      const record = normalizePublishedArticle(item as Record<string, unknown>);
      if (!record) continue;
      if (seen.has(record.url)) continue;
      seen.add(record.url);
      articles.push(record);
    }

    offset += items.length;
    if (items.length < count) break;
  }

  return articles;
}

function normalizePublishedArticle(item: Record<string, unknown>): OwnedWechatArticleRecord | null {
  const outerPublishId = pickString(item, ["publish_id", "article_id", "publishId"]);
  const outerUpdateTime = pickNumber(item, ["update_time", "publish_time", "publishTime"]);
  const candidates = Array.isArray(item.article_detail)
    ? item.article_detail
    : Array.isArray(item.articles)
      ? item.articles
      : item.article_detail && typeof item.article_detail === "object"
        ? [item.article_detail]
        : typeof item === "object"
          ? [item]
          : [];

  const candidate = candidates.find((entry) => typeof entry === "object") as Record<string, unknown> | undefined;
  if (!candidate) return null;

  const title = pickString(candidate, ["title"]);
  if (!title) return null;

  const articleIdx = pickNumber(candidate, ["idx", "article_idx"], 0);
  const publishId = outerPublishId || pickString(candidate, ["article_id", "publish_id"]) || `${title}-${articleIdx}`;
  const url =
    pickString(candidate, ["url", "content_url", "content_source_url"]) ||
    `wechat://publish/${publishId}/${articleIdx}`;

  const contentHtml =
    pickString(candidate, ["content", "article_content", "content_html"]) || "";

  return {
    publishId,
    msgId: pickString(candidate, ["msg_id", "msgid"]),
    articleIdx,
    title,
    digest: pickString(candidate, ["digest", "desc"], "") || "",
    content: htmlToText(contentHtml),
    contentHtml,
    url,
    coverUrl: pickString(candidate, ["thumb_url", "cover_url", "pic_url"]),
    author: pickString(candidate, ["author"]),
    accountName: pickString(candidate, ["nickname", "account_name"]),
    publishTime: unixToIso(outerUpdateTime || pickNumber(candidate, ["update_time", "publish_time"])),
    rawPayload: item,
  };
}

async function fetchWechatArticleMetrics(accessToken: string, days: number) {
  const range = buildDateRange(days);
  const [summaryRows, totalRows] = await Promise.all([
    postWechatJson(DATACUBE_ARTICLE_SUMMARY_URL, accessToken, range),
    postWechatJson(DATACUBE_ARTICLE_TOTAL_URL, accessToken, range),
  ]);

  const allRows = [...extractMetricRows(summaryRows), ...extractMetricRows(totalRows)];
  return allRows;
}

async function postWechatJson(
  url: string,
  accessToken: string,
  payload: Record<string, unknown>
) {
  const res = await fetch(`${url}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`拉取公众号统计失败：${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (typeof data.errcode === "number" && data.errcode !== 0) {
    throw new Error(String(data.errmsg || "拉取公众号统计失败"));
  }

  return data;
}

function buildDateRange(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return {
    begin_date: formatWechatDate(start),
    end_date: formatWechatDate(end),
  };
}

function extractMetricRows(payload: Record<string, unknown>) {
  const rows = Array.isArray(payload.list)
    ? payload.list
    : Array.isArray(payload.details)
      ? payload.details
      : Array.isArray(payload.article_detail)
        ? payload.article_detail
        : [];

  return rows
    .map((row) => normalizeMetricRow(row as Record<string, unknown>))
    .filter((row): row is ArticleMetric => row !== null);
}

function normalizeMetricRow(row: Record<string, unknown>): ArticleMetric | null {
  const title = pickString(row, ["title", "msg_title"]);
  const normalizedKey = (pickString(row, ["msgid", "msg_id", "title"]) || title || "").trim();
  if (!normalizedKey) return null;

  return {
    key: normalizeComparisonText(normalizedKey),
    title: title ?? null,
    readNum: pickNumber(row, ["int_page_read_count", "read_num", "read_count"]),
    likeNum: pickNumber(row, ["like_count", "old_like_count"]),
    shareNum: pickNumber(row, ["share_count", "share_user"]),
    commentNum: pickNumber(row, ["comment_count"]),
    favoriteNum: pickNumber(row, ["add_to_fav_count", "fav_num", "favorite_num"]),
  };
}

function buildMetricsMap(metrics: ArticleMetric[]) {
  const map = new Map<string, ArticleMetric>();

  for (const metric of metrics) {
    if (!map.has(metric.key) || map.get(metric.key)!.readNum < metric.readNum) {
      map.set(metric.key, metric);
    }
    if (metric.title) {
      const titleKey = normalizeComparisonText(metric.title);
      if (!map.has(titleKey) || map.get(titleKey)!.readNum < metric.readNum) {
        map.set(titleKey, metric);
      }
    }
  }

  return map;
}

function mergeArticleMetrics(article: OwnedWechatArticleRecord, metricsMap: Map<string, ArticleMetric>) {
  const metric =
    metricsMap.get(normalizeComparisonText(article.msgId || "")) ||
    metricsMap.get(normalizeComparisonText(article.title));

  return {
    ...article,
    readNum: metric?.readNum ?? 0,
    likeNum: metric?.likeNum ?? 0,
    shareNum: metric?.shareNum ?? 0,
    commentNum: metric?.commentNum ?? 0,
    favoriteNum: metric?.favoriteNum ?? 0,
  };
}

async function saveOwnedWechatArticles(
  supabase: SupabaseClient,
  params: {
    userId: string;
    journeyId: string;
    wechatConfigId: string;
    articles: Array<OwnedWechatArticleRecord & {
      readNum: number;
      likeNum: number;
      shareNum: number;
      commentNum: number;
      favoriteNum: number;
    }>;
  }
) {
  if (!params.articles.length) return;

  const topRead = Math.max(...params.articles.map((article) => article.readNum), 0);

  const rows = params.articles.map((article) => ({
    user_id: params.userId,
    journey_id: params.journeyId,
    wechat_config_id: params.wechatConfigId,
    publish_id: article.publishId || null,
    msg_id: article.msgId,
    article_idx: article.articleIdx,
    title: article.title,
    digest: article.digest || null,
    content: article.content || null,
    content_html: article.contentHtml || null,
    url: article.url,
    cover_url: article.coverUrl,
    author: article.author,
    account_name: article.accountName,
    publish_time: article.publishTime,
    read_num: article.readNum,
    like_num: article.likeNum,
    share_num: article.shareNum,
    comment_num: article.commentNum,
    favorite_num: article.favoriteNum,
    is_best_performing: topRead > 0 && article.readNum === topRead,
    raw_payload: article.rawPayload,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("owned_wechat_articles")
    .upsert(rows, { onConflict: "journey_id,url" });

  if (error) {
    throw new Error(error.message);
  }
}

async function buildOwnedWechatAnalysisReport(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    userId: string;
    accountName: string;
  }
) {
  const [ownedArticlesRes, competitorArticlesRes, competitorKocsRes] = await Promise.all([
    supabase
      .from("owned_wechat_articles")
      .select("title, digest, publish_time, read_num, like_num, share_num, comment_num, favorite_num, author, account_name")
      .eq("journey_id", params.journeyId)
      .order("publish_time", { ascending: false })
      .limit(30),
    supabase
      .from("knowledge_articles")
      .select("title, read_count, publish_time, koc_sources(account_name)")
      .eq("journey_id", params.journeyId)
      .order("read_count", { ascending: false })
      .limit(20),
    supabase
      .from("koc_sources")
      .select("account_name, avg_read_count, max_read_count")
      .eq("journey_id", params.journeyId)
      .order("avg_read_count", { ascending: false })
      .limit(12),
  ]);

  const ownedArticles = (ownedArticlesRes.data ?? []) as SyncedOwnedArticle[];
  if (!ownedArticles.length) {
    throw new Error("还没有同步到自己的公众号文章，请稍后重试。");
  }

  const articleCount30d = ownedArticles.length;
  const avgRead = Math.round(
    ownedArticles.reduce((sum, item) => sum + (item.read_num ?? 0), 0) / Math.max(articleCount30d, 1)
  );
  const bestArticles = [...ownedArticles]
    .sort((a, b) => (b.read_num ?? 0) - (a.read_num ?? 0))
    .slice(0, 3);

  const postingPattern = describePostingPattern(ownedArticles);
  const ownTitlePattern = summarizeTitlePatterns(ownedArticles.map((item) => item.title));
  const competitorAvgRead = Math.round(
    (((competitorKocsRes.data ?? []) as Array<{ avg_read_count: number | null }>).reduce(
      (sum, item) => sum + (item.avg_read_count ?? 0),
      0
    )) / Math.max((competitorKocsRes.data ?? []).length, 1)
  );

  const bestTopics = bestArticles.map((item) => item.title).slice(0, 3);

  const competitorTitles = ((competitorArticlesRes.data ?? []) as Array<{
    title: string;
    read_count: number | null;
    koc_sources: { account_name: string } | { account_name: string }[] | null;
  }>).map((item) => item.title);
  const competitorTitlePattern = summarizeTitlePatterns(competitorTitles);

  const rawSummary = await llm.chat(
    "你是内容复盘助手，只输出 JSON，不要解释，不要 Markdown 代码块。",
    `请根据下面的数据，输出一个结构化复盘报告。

公众号：${params.accountName}
近 30 篇文章数：${articleCount30d}
平均阅读：${avgRead}
竞品平均阅读：${competitorAvgRead}
发文节奏：${postingPattern}
我的标题风格：${ownTitlePattern}
竞品标题风格：${competitorTitlePattern}

【我的高表现文章】
${bestArticles.map((item) => `- ${item.title} | 阅读 ${item.read_num} | 发布时间 ${item.publish_time || "未知"}`).join("\n")}

【竞品高表现文章】
${((competitorArticlesRes.data ?? []) as Array<{ title: string; read_count: number | null; koc_sources: { account_name: string } | { account_name: string }[] | null }>)
  .slice(0, 6)
  .map((item) => {
    const koc = Array.isArray(item.koc_sources) ? item.koc_sources[0] : item.koc_sources;
    return `- ${item.title} | ${koc?.account_name ?? "未知"} | 阅读 ${item.read_count ?? 0}`;
  })
  .join("\n")}

请返回 JSON：
{
  "content_overview": {
    "posting_pattern": "一句话描述发文节奏",
    "title_pattern": "一句话描述标题风格",
    "best_topics": ["主题1", "主题2", "主题3"]
  },
  "top_articles": [
    {
      "title": "文章标题",
      "read_num": 1000,
      "publish_time": "2026-04-24T00:00:00.000Z",
      "reason": "为什么这篇表现好"
    }
  ],
  "competitor_gap": {
    "overview": "一句话总结差距",
    "topic_gap": ["差距1", "差距2"],
    "title_gap": ["差距1", "差距2"],
    "structure_gap": ["差距1", "差距2"]
  },
  "next_actions": ["建议1", "建议2", "建议3"]
}`
  );

  const parsed = safeParseJson<{
    content_overview?: OwnedAnalysisReport["content_overview"];
    top_articles?: OwnedAnalysisReport["top_articles"];
    competitor_gap?: OwnedAnalysisReport["competitor_gap"];
    next_actions?: string[];
  }>(rawSummary);

  const topArticles = parsed?.top_articles?.length
    ? parsed.top_articles.slice(0, 3)
    : bestArticles.map((item, index) => ({
        title: item.title,
        read_num: item.read_num,
        publish_time: item.publish_time,
        reason:
          index === 0
            ? "这篇表现最好，说明当前账号对这个题材或表达方式的受众反馈最强。"
            : "这篇进入高表现区，说明这个方向值得继续做结构化复用。",
      }));

  const report: OwnedAnalysisReport = {
    summary: {
      account_name: params.accountName,
      article_count_30d: articleCount30d,
      avg_read: avgRead,
      best_article_title: topArticles[0]?.title ?? null,
    },
    content_overview: parsed?.content_overview ?? {
      posting_pattern: postingPattern,
      title_pattern: ownTitlePattern,
      best_topics: bestTopics,
    },
    top_articles: topArticles,
    competitor_gap: parsed?.competitor_gap ?? {
      overview:
        competitorAvgRead > avgRead
          ? "竞品整体阅读表现更强，说明你的选题聚焦或标题抓力还有提升空间。"
          : "你的平均表现已经接近当前竞品，下一步更值得优化结构稳定性和可复制性。",
      topic_gap: ["竞品更集中在高讨论度话题，你的内容分布还偏散。"] ,
      title_gap: ["竞品标题更强调观点冲突、方法论或强结论感。"] ,
      structure_gap: ["你的高表现文章可以继续沉淀成更稳定的开头钩子和 CTA 结构。"] ,
    },
    next_actions: parsed?.next_actions?.length
      ? parsed.next_actions.slice(0, 3)
      : [
          "围绕最近表现最好的主题，再做 2-3 篇同方向延展内容。",
          "把标题从描述型改成更明确的观点/方法型表达。",
          "固定开头钩子和结尾 CTA，形成可复用模板。",
        ],
    message_for_chat: "",
  };

  report.message_for_chat = buildChatSummary(report);
  return report;
}

function buildChatSummary(report: OwnedAnalysisReport) {
  const topArticles = report.top_articles
    .map((item, index) => `${index + 1}. ${item.title}｜阅读 ${item.read_num}`)
    .join("\n");

  return `这是我刚同步出来的公众号复盘结果，请基于这些真实数据继续给我建议：

【账号概况】
- 近 30 篇文章数：${report.summary.article_count_30d}
- 平均阅读：${report.summary.avg_read}
- 当前最强文章：${report.summary.best_article_title || "暂无"}

【内容概况】
- 发文节奏：${report.content_overview.posting_pattern}
- 标题风格：${report.content_overview.title_pattern}
- 高表现主题：${report.content_overview.best_topics.join("、") || "暂无"}

【表现最好的文章】
${topArticles}

【我和竞品的差距】
- 总体判断：${report.competitor_gap.overview}
- 选题差距：${report.competitor_gap.topic_gap.join("；")}
- 标题差距：${report.competitor_gap.title_gap.join("；")}
- 结构差距：${report.competitor_gap.structure_gap.join("；")}

【下一步建议】
${report.next_actions.map((item, index) => `${index + 1}. ${item}`).join("\n")}`;
}

function describePostingPattern(articles: SyncedOwnedArticle[]) {
  const dates = articles
    .map((item) => (item.publish_time ? new Date(item.publish_time).getTime() : null))
    .filter((time): time is number => typeof time === "number")
    .sort((a, b) => b - a);

  if (dates.length < 2) {
    return "当前样本较少，建议继续同步更多文章后再判断固定发文节奏。";
  }

  const gaps = dates.slice(0, Math.min(dates.length - 1, 9)).map((time, index) =>
    Math.max(1, Math.round((time - dates[index + 1]) / 86400000))
  );
  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

  if (avgGap <= 2) {
    return "发文频率较高，基本保持 1-2 天一更，适合做连续追热点或系列内容。";
  }
  if (avgGap <= 5) {
    return "发文节奏中等，基本维持每周 1-3 篇，更适合精选型输出。";
  }
  return "发文节奏偏稀疏，建议提升更新稳定性，否则难以形成内容记忆。";
}

function summarizeTitlePatterns(titles: string[]) {
  if (!titles.length) {
    return "样本不足，暂时看不出稳定标题模式。";
  }

  const hasNumbers = titles.some((title) => /\d/.test(title));
  const hasQuestions = titles.some((title) => /[？?]/.test(title));
  const hasMethodWords = titles.some((title) => /(如何|怎么|为什么|实测|教程|终极|保姆)/.test(title));
  const hasStrongOpinion = titles.some((title) => /(完蛋|黑暗森林|别再|不要|真相|到底)/.test(title));

  const features = [];
  if (hasNumbers) features.push("经常用数字组织信息");
  if (hasQuestions) features.push("会用疑问句制造点击欲");
  if (hasMethodWords) features.push("偏方法论或实测导向");
  if (hasStrongOpinion) features.push("带一点强观点和冲突感");

  if (!features.length) {
    return "整体偏直接陈述型标题，点击动机主要靠主题本身，而不是包装张力。";
  }

  return `标题整体 ${features.join("，")}。`;
}

function formatWechatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function pickString(
  source: Record<string, unknown>,
  keys: string[],
  fallback: string | null = null
) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function pickNumber(source: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = source[key];
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }
  return fallback;
}

function unixToIso(value: number) {
  if (!value) return null;
  const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(milliseconds).toISOString();
}

function normalizeComparisonText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function safeParseJson<T>(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
