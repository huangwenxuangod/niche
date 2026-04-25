import type { SupabaseClient } from "@supabase/supabase-js";
import { searchSemanticKnowledge } from "@/lib/rag/llamaindex/retrieve";

type KnowledgeArticleRow = {
  id: string;
  koc_source_id: string | null;
  title: string;
  digest: string | null;
  content: string | null;
  read_count: number | null;
  publish_time: string | null;
  url: string | null;
  koc_sources: { account_name: string } | { account_name: string }[] | null;
};

export async function searchJourneyKnowledge(
  supabase: SupabaseClient,
  journeyId: string,
  query: string,
  limit = 6,
  options?: {
    accountNames?: string[];
  }
) {
  const keyword = query.trim();
  const accountNames = Array.from(
    new Set((options?.accountNames ?? []).map((name) => name.trim()).filter(Boolean))
  );

  let matchedKocIds: string[] = [];

  if (accountNames.length > 0) {
    const accountOrFilter = accountNames
      .map((name) => `account_name.ilike.%${escapeLike(name)}%`)
      .join(",");

    const { data: matchedKocs } = await supabase
      .from("koc_sources")
      .select("id")
      .eq("journey_id", journeyId)
      .or(accountOrFilter);

    matchedKocIds = (matchedKocs ?? []).map((item) => item.id as string);
  }

  const queries: PromiseLike<{ data: KnowledgeArticleRow[] | null }>[] = [];

  if (matchedKocIds.length > 0) {
    queries.push(
      supabase
        .from("knowledge_articles")
        .select("id, koc_source_id, title, digest, content, read_count, publish_time, url, koc_sources(account_name)")
        .eq("journey_id", journeyId)
        .in("koc_source_id", matchedKocIds)
        .order("read_count", { ascending: false })
        .limit(limit)
    );
  }

  if (keyword) {
    queries.push(
      supabase
        .from("knowledge_articles")
        .select("id, koc_source_id, title, digest, content, read_count, publish_time, url, koc_sources(account_name)")
        .eq("journey_id", journeyId)
        .or(`title.ilike.%${escapeLike(keyword)}%,digest.ilike.%${escapeLike(keyword)}%,content.ilike.%${escapeLike(keyword)}%`)
        .order("read_count", { ascending: false })
        .limit(limit)
    );
  }

  const resultSets = await Promise.all(queries);
  const merged = new Map<string, KnowledgeArticleRow>();

  for (const result of resultSets) {
    for (const article of (result.data ?? []) as KnowledgeArticleRow[]) {
      if (!merged.has(article.id)) {
        merged.set(article.id, article);
      }
    }
  }

  const articles = Array.from(merged.values())
    .sort((a, b) => (b.read_count ?? 0) - (a.read_count ?? 0))
    .slice(0, limit)
    .map((article) => {
    const kocSource = Array.isArray(article.koc_sources)
      ? article.koc_sources[0]
      : article.koc_sources;

    return {
      id: article.id,
      title: article.title,
      digest: article.digest,
      read_count: article.read_count ?? 0,
      publish_time: article.publish_time,
      url: article.url,
      account_name: kocSource?.account_name ?? "未知",
      excerpt: buildExcerpt(article.content || article.digest, keyword),
    };
  });

  if (articles.length >= limit || !keyword) {
    return {
      query: keyword,
      total: articles.length,
      articles,
    };
  }

  try {
    const semanticResults = await searchSemanticKnowledge(supabase, {
      journeyId,
      query: keyword,
      sourceType: "competitor_account",
      topK: limit,
      minSimilarity: 0.25,
    });

    for (const item of semanticResults) {
      if (merged.has(item.source_id)) continue;
      if (
        accountNames.length > 0 &&
        !accountNames.some((name) => item.account_name?.includes(name))
      ) {
        continue;
      }

      merged.set(item.source_id, {
        id: item.source_id,
        koc_source_id: null,
        title: item.article_title ?? "未命名文章",
        digest: null,
        content: item.chunk_text,
        read_count: item.read_count,
        publish_time: item.publish_time,
        url: null,
        koc_sources: item.account_name ? { account_name: item.account_name } : null,
      });
    }
  } catch (error) {
    console.warn("[knowledge-base] semantic fallback failed", error);
  }

  const hybridArticles = Array.from(merged.values())
    .sort((a, b) => (b.read_count ?? 0) - (a.read_count ?? 0))
    .slice(0, limit)
    .map((article) => {
      const kocSource = Array.isArray(article.koc_sources)
        ? article.koc_sources[0]
        : article.koc_sources;

      return {
        id: article.id,
        title: article.title,
        digest: article.digest,
        read_count: article.read_count ?? 0,
        publish_time: article.publish_time,
        url: article.url,
        account_name: kocSource?.account_name ?? "未知",
        excerpt: buildExcerpt(article.content || article.digest, keyword),
      };
    });

  return {
    query: keyword,
    total: hybridArticles.length,
    articles: hybridArticles,
  };
}

function buildExcerpt(content: string | null, keyword: string) {
  if (!content) return "";

  const normalized = content.replace(/\s+/g, " ").trim();
  const index = normalized.toLowerCase().indexOf(keyword.toLowerCase());

  if (index < 0) {
    return normalized.slice(0, 120);
  }

  const start = Math.max(0, index - 30);
  const end = Math.min(normalized.length, index + keyword.length + 70);
  return normalized.slice(start, end);
}

function escapeLike(value: string) {
  return value.replace(/[%_]/g, "");
}
