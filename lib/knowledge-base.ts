import type { SupabaseClient } from "@supabase/supabase-js";

type KnowledgeArticleRow = {
  id: string;
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
  limit = 6
) {
  const keyword = query.trim();

  const { data } = await supabase
    .from("knowledge_articles")
    .select("id, title, digest, content, read_count, publish_time, url, koc_sources(account_name)")
    .eq("journey_id", journeyId)
    .or(`title.ilike.%${escapeLike(keyword)}%,digest.ilike.%${escapeLike(keyword)}%,content.ilike.%${escapeLike(keyword)}%`)
    .order("read_count", { ascending: false })
    .limit(limit);

  const articles = ((data ?? []) as KnowledgeArticleRow[]).map((article) => {
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
      excerpt: buildExcerpt(article.content, keyword),
    };
  });

  return {
    query: keyword,
    total: articles.length,
    articles,
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
