CREATE TABLE IF NOT EXISTS wechat_publish_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  account_name TEXT,
  app_id TEXT NOT NULL,
  app_secret_encrypted TEXT NOT NULL,
  default_author TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wechat_publish_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_layout_draft_id UUID NOT NULL REFERENCES article_layout_drafts(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  cover_image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft_saved' CHECK (status IN ('draft_saved', 'error')),
  draft_media_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wechat_publish_jobs_user_id
ON wechat_publish_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_wechat_publish_jobs_draft_id
ON wechat_publish_jobs(article_layout_draft_id);

ALTER TABLE wechat_publish_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wechat_publish_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wechat_publish_configs_own" ON wechat_publish_configs
FOR ALL USING (user_id = (SELECT id FROM users WHERE id = auth.uid()));

CREATE POLICY "wechat_publish_jobs_own" ON wechat_publish_jobs
FOR ALL USING (user_id = (SELECT id FROM users WHERE id = auth.uid()));
