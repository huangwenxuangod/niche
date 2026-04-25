import type { SupabaseClient } from "@supabase/supabase-js";
import { searchSemanticKnowledge } from "@/lib/rag/llamaindex/retrieve";

export async function retrieveSemanticCompetitorContent(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    query: string;
    limit?: number;
  }
) {
  return searchSemanticKnowledge(supabase, {
    journeyId: params.journeyId,
    query: params.query,
    sourceType: "competitor_account",
    topK: params.limit ?? 6,
  });
}
