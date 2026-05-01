import { tavilySearch } from "@/lib/tavily";

export type WebSearchItem = {
  title: string;
  url: string;
  excerpt: string;
  published_date?: string;
  score: number;
};

export async function searchWebContext(params: {
  query: string;
  maxResults?: number;
  days?: number;
}) {
  const query = String(params.query || "").trim();
  if (!query) {
    return {
      query: "",
      results: [] as WebSearchItem[],
    };
  }

  const results = await tavilySearch(query, {
    max_results: Math.max(3, Math.min(6, params.maxResults ?? 4)),
    days: params.days ?? 30,
  });

  const deduped = new Map<string, WebSearchItem>();
  for (const item of results) {
    const key = item.url || item.title;
    if (!key) continue;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      title: item.title,
      url: item.url,
      excerpt: item.content ? item.content.slice(0, 220) : "",
      published_date: item.published_date,
      score: item.score ?? 0,
    });
  }

  return {
    query,
    results: Array.from(deduped.values()).slice(0, params.maxResults ?? 4),
  };
}
