-- koc_sources 加字段
ALTER TABLE koc_sources ADD COLUMN fans_count INTEGER DEFAULT 0;
ALTER TABLE koc_sources ADD COLUMN ghid TEXT;
ALTER TABLE koc_sources ADD COLUMN biz TEXT;
ALTER TABLE koc_sources ADD COLUMN avg_top_read INTEGER DEFAULT 0;
ALTER TABLE koc_sources ADD COLUMN avg_top_like INTEGER DEFAULT 0;
ALTER TABLE koc_sources ADD COLUMN week_articles_count INTEGER DEFAULT 0;
ALTER TABLE koc_sources ADD COLUMN avatar_url TEXT;

-- knowledge_articles 加字段
ALTER TABLE knowledge_articles ADD COLUMN content TEXT;
ALTER TABLE knowledge_articles ADD COLUMN likes_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_articles ADD COLUMN comments_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_articles ADD COLUMN share_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_articles ADD COLUMN collect_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_articles ADD COLUMN is_original BOOLEAN DEFAULT FALSE;
ALTER TABLE knowledge_articles ADD COLUMN cover_url TEXT;
