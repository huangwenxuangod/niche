import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/rag/ark-embeddings";
import type { SemanticKnowledgeResult } from "@/lib/rag/llamaindex/types";

type MatchKnowledgeChunkRow = {
  id: string;
  source_id: string;
  source_type: "competitor_account" | "wechat_hot_discovery" | "owned_account";
  source_table: string;
  account_name: string | null;
  article_title: string | null;
  chunk_text: string;
  similarity: number | null;
  metadata: Record<string, unknown> | null;
  publish_time: string | null;
  read_count: number | null;
};

export async function searchSemanticKnowledge(
  supabase: SupabaseClient,
  params: {
    journeyId: string;
    query: string;
    sourceType?: "competitor_account" | "wechat_hot_discovery" | "owned_account";
    accountNames?: string[];
    topK?: number;
    minSimilarity?: number;
  }
) {
  const query = params.query.trim();
  if (!query) {
    return [] as SemanticKnowledgeResult[];
  }

  const embedding = await embedQuery(query);
  const filter = buildMetadataFilter(params);
  const { data, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: embedding,
    match_count: params.topK ?? 8,
    filter,
  });

  if (error) {
    throw new Error(`语义检索失败: ${error.message}`);
  }

  return ((data ?? []) as MatchKnowledgeChunkRow[])
    .filter((item) => (item.similarity ?? 0) >= (params.minSimilarity ?? 0.2))
    .map((item) => ({
      id: item.id,
      source_id: item.source_id,
      source_type: item.source_type,
      source_table: item.source_table,
      account_name: item.account_name,
      article_title: item.article_title,
      chunk_text: item.chunk_text,
      similarity: Number(item.similarity ?? 0),
      metadata: item.metadata ?? {},
      publish_time: item.publish_time,
      read_count: item.read_count,
    }));
}

function buildMetadataFilter(params: {
  journeyId: string;
  sourceType?: "competitor_account" | "wechat_hot_discovery" | "owned_account";
}) {
  const filter: Record<string, unknown> = {
    journey_id: params.journeyId,
  };

  if (params.sourceType) {
    filter.source_type = params.sourceType;
  }

  return filter;
}
