import type { SupabaseClient } from "@supabase/supabase-js";
import { searchJourneyKnowledge } from "@/lib/knowledge-base";

export async function retrieveCompetitorContent(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    query: string;
    limit?: number;
    accountNames?: string[];
  }
) {
  return searchJourneyKnowledge(
    supabase,
    params.journeyId,
    params.query,
    params.limit ?? 6,
    { accountNames: params.accountNames }
  );
}

export async function retrieveTopCompetitorArticles(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    limit?: number;
  }
) {
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("title, read_count, publish_time, koc_sources(account_name)")
    .eq("journey_id", params.journeyId)
    .order("read_count", { ascending: false })
    .limit(params.limit ?? 10);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((item) => {
    const source = Array.isArray(item.koc_sources) ? item.koc_sources[0] : item.koc_sources;
    return {
      title: item.title as string,
      read_count: Number(item.read_count ?? 0),
      publish_time: (item.publish_time as string | null) ?? null,
      account_name: source?.account_name ?? "未知",
    };
  });
}
