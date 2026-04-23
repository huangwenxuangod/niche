WITH ranked_articles AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY journey_id, url
      ORDER BY fetched_at DESC NULLS LAST, id DESC
    ) AS row_num
  FROM knowledge_articles
  WHERE url IS NOT NULL
    AND url <> ''
)
DELETE FROM knowledge_articles
WHERE id IN (
  SELECT id
  FROM ranked_articles
  WHERE row_num > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_articles_journey_url_unique
ON knowledge_articles(journey_id, url);
