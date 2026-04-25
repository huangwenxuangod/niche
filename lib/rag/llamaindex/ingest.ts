import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARK_EMBEDDING_MODEL, embedBatch } from "@/lib/rag/ark-embeddings";
import { loadKnowledgeArticlesForIndexing, splitArticleIntoChunks } from "@/lib/rag/llamaindex/documents";
import type { IndexableArticle, KnowledgeChunkRecord } from "@/lib/rag/llamaindex/types";

export async function indexKnowledgeArticlesByIds(
  supabase: SupabaseClient,
  articleIds: string[]
) {
  const articles = await loadKnowledgeArticlesForIndexing(supabase, articleIds);
  if (articles.length === 0) {
    return { indexedArticles: 0, indexedChunks: 0 };
  }

  return indexArticles(supabase, articles);
}

export async function indexArticles(
  supabase: SupabaseClient,
  articles: IndexableArticle[]
) {
  let indexedChunks = 0;

  for (const article of articles) {
    indexedChunks += await reindexSingleArticle(supabase, article);
  }

  return {
    indexedArticles: articles.length,
    indexedChunks,
  };
}

async function reindexSingleArticle(
  supabase: SupabaseClient,
  article: IndexableArticle
) {
  const chunks = splitArticleIntoChunks(article);
  if (chunks.length === 0) {
    return 0;
  }

  await clearExistingChunks(supabase, article);

  const embeddings = await embedBatch(chunks.map((chunk) => chunk.chunkText));
  const rows: KnowledgeChunkRecord[] = chunks.map((chunk, index) => ({
    journey_id: article.journey_id,
    source_type: article.source_type,
    source_table: article.source_table,
    source_id: article.source_id,
    account_name: article.account_name,
    article_title: article.article_title,
    publish_time: article.publish_time,
    read_count: article.read_count,
    chunk_index: chunk.chunkIndex,
    chunk_text: chunk.chunkText,
    metadata: article.metadata,
    embedding: embeddings[index] ?? [],
    embedding_model: ARK_EMBEDDING_MODEL,
    content_hash: buildContentHash(article, chunk.chunkText),
  }));

  const { error } = await supabase.from("knowledge_chunks").insert(rows);
  if (error) {
    throw new Error(`写入 knowledge_chunks 失败: ${error.message}`);
  }

  return rows.length;
}

async function clearExistingChunks(supabase: SupabaseClient, article: IndexableArticle) {
  const { error } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("source_table", article.source_table)
    .eq("source_id", article.source_id)
    .eq("embedding_model", ARK_EMBEDDING_MODEL);

  if (error) {
    throw new Error(`清理旧 chunk 失败: ${error.message}`);
  }
}

function buildContentHash(article: IndexableArticle, chunkText: string) {
  return createHash("sha256")
    .update([
      article.source_table,
      article.source_id,
      article.article_title,
      chunkText,
      ARK_EMBEDDING_MODEL,
    ].join("::"))
    .digest("hex");
}
