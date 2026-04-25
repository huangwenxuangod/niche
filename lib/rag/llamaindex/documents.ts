import { Document, SentenceSplitter } from "llamaindex";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IndexableArticle } from "@/lib/rag/llamaindex/types";

const sentenceSplitter = new SentenceSplitter({
  chunkSize: 420,
  chunkOverlap: 60,
});

type KnowledgeArticleRow = {
  id: string;
  journey_id: string;
  title: string | null;
  content: string | null;
  digest: string | null;
  publish_time: string | null;
  read_count: number | null;
  source_type: "competitor_account" | "wechat_hot_discovery";
  discovery_keyword: string | null;
  discovery_reason: string | null;
  koc_sources:
    | { account_name: string | null }
    | { account_name: string | null }[]
    | null;
};

export async function loadKnowledgeArticlesForIndexing(
  supabase: SupabaseClient,
  articleIds: string[]
) {
  const uniqueIds = Array.from(new Set(articleIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [] as IndexableArticle[];
  }

  const { data, error } = await supabase
    .from("knowledge_articles")
    .select(
      "id, journey_id, title, content, digest, publish_time, read_count, source_type, discovery_keyword, discovery_reason, koc_sources(account_name)"
    )
    .in("id", uniqueIds);

  if (error) {
    throw new Error(`加载知识库文章失败: ${error.message}`);
  }

  const rows = ((data ?? []) as KnowledgeArticleRow[])
    .map((row): IndexableArticle | null => {
      const account = Array.isArray(row.koc_sources) ? row.koc_sources[0] : row.koc_sources;
      const content = normalizeArticleContent(row.content ?? row.digest ?? "");
      if (!content) return null;

      return {
        id: row.id,
        journey_id: row.journey_id,
        source_type: row.source_type,
        source_table: "knowledge_articles" as const,
        source_id: row.id,
        account_name: account?.account_name ?? null,
        article_title: row.title ?? "未命名文章",
        content,
        publish_time: row.publish_time,
        read_count: row.read_count,
        metadata: {
          source_type: row.source_type,
          journey_id: row.journey_id,
          account_name: account?.account_name ?? null,
          article_title: row.title ?? "未命名文章",
          publish_time: row.publish_time,
          read_count: row.read_count ?? 0,
          discovery_keyword: row.discovery_keyword,
          discovery_reason: row.discovery_reason,
          content_kind: "article",
        },
      } satisfies IndexableArticle;
    });

  return rows.filter((item): item is IndexableArticle => item !== null);
}

export function buildLlamaDocuments(articles: IndexableArticle[]) {
  return articles.map(
    (article) =>
      new Document({
        id_: article.id,
        text: article.content,
        metadata: article.metadata,
      })
  );
}

export function splitArticleIntoChunks(article: IndexableArticle) {
  const [document] = buildLlamaDocuments([article]);
  const nodes = sentenceSplitter.getNodesFromDocuments([document]);
  return nodes
    .map((node, index) => {
      const text = node.getText().replace(/\s+/g, " ").trim();
      if (!text) return null;

      return {
        chunkIndex: index,
        chunkText: text,
      };
    })
    .filter((item): item is { chunkIndex: number; chunkText: string } => Boolean(item));
}

function normalizeArticleContent(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
