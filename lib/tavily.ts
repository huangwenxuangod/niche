interface TavilySearchOptions {
  max_results?: number;
  days?: number;
  include_domains?: string[];
  exclude_domains?: string[];
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export async function tavilySearch(
  query: string | string[],
  options: TavilySearchOptions = {}
): Promise<TavilyResult[]> {
  const queries = Array.isArray(query) ? query : [query];
  const results: TavilyResult[] = [];

  for (const q of queries) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: q,
        max_results: options.max_results ?? 5,
        days: options.days,
        include_domains: options.include_domains,
        exclude_domains: options.exclude_domains,
      }),
    });

    if (!res.ok) continue;
    const data = await res.json();
    results.push(...(data.results ?? []));
  }

  return results;
}
