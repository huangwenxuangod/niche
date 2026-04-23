CREATE TABLE IF NOT EXISTS article_layout_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_markdown TEXT NOT NULL,
  rendered_markdown TEXT NOT NULL,
  rendered_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_article_layout_drafts_conversation_id
ON article_layout_drafts(conversation_id);

CREATE INDEX IF NOT EXISTS idx_article_layout_drafts_user_id
ON article_layout_drafts(user_id);

ALTER TABLE article_layout_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "article_layout_drafts_own" ON article_layout_drafts
FOR ALL USING (user_id = (SELECT id FROM users WHERE id = auth.uid()));
