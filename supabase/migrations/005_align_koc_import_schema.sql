ALTER TABLE koc_sources
ADD COLUMN IF NOT EXISTS wxid TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_articles'
      AND column_name = 'comments_count'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'knowledge_articles'
      AND column_name = 'comment_count'
  ) THEN
    ALTER TABLE knowledge_articles RENAME COLUMN comments_count TO comment_count;
  END IF;
END $$;
