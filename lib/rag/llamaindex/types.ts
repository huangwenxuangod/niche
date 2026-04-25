export type KnowledgeChunkSourceType =
  | "competitor_account"
  | "wechat_hot_discovery"
  | "owned_account";

export type IndexableArticle = {
  id: string;
  journey_id: string;
  source_type: KnowledgeChunkSourceType;
  source_table: "knowledge_articles" | "owned_wechat_articles";
  source_id: string;
  account_name: string | null;
  article_title: string;
  content: string;
  publish_time: string | null;
  read_count: number | null;
  metadata: Record<string, unknown>;
};

export type KnowledgeChunkRecord = {
  journey_id: string;
  source_type: KnowledgeChunkSourceType;
  source_table: "knowledge_articles" | "owned_wechat_articles";
  source_id: string;
  account_name: string | null;
  article_title: string;
  publish_time: string | null;
  read_count: number | null;
  chunk_index: number;
  chunk_text: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  embedding_model: string;
  content_hash: string;
};

export type SemanticKnowledgeResult = {
  id: string;
  source_id: string;
  source_type: KnowledgeChunkSourceType;
  source_table: string;
  account_name: string | null;
  article_title: string | null;
  chunk_text: string;
  similarity: number;
  metadata: Record<string, unknown>;
  publish_time: string | null;
  read_count: number | null;
};
