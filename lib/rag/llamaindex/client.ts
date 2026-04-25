import { SupabaseVectorStore } from "@llamaindex/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createKnowledgeVectorStore(supabase: SupabaseClient) {
  return new SupabaseVectorStore({
    client: supabase,
    table: "knowledge_chunks",
  });
}
