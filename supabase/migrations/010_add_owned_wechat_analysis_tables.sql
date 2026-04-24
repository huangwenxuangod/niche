CREATE TABLE IF NOT EXISTS owned_wechat_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  wechat_config_id UUID NOT NULL REFERENCES wechat_publish_configs(id) ON DELETE CASCADE,
  publish_id TEXT,
  msg_id TEXT,
  article_idx INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  digest TEXT,
  content TEXT,
  content_html TEXT,
  url TEXT NOT NULL,
  cover_url TEXT,
  author TEXT,
  account_name TEXT,
  publish_time TIMESTAMPTZ,
  read_num INTEGER DEFAULT 0,
  like_num INTEGER DEFAULT 0,
  share_num INTEGER DEFAULT 0,
  comment_num INTEGER DEFAULT 0,
  favorite_num INTEGER DEFAULT 0,
  is_best_performing BOOLEAN DEFAULT FALSE,
  raw_payload JSONB,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS owned_wechat_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  wechat_config_id UUID NOT NULL REFERENCES wechat_publish_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'error')),
  step TEXT,
  articles_synced INTEGER DEFAULT 0,
  metrics_synced INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS owned_wechat_analysis_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id UUID NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  sync_job_id UUID REFERENCES owned_wechat_sync_jobs(id) ON DELETE SET NULL,
  summary JSONB NOT NULL,
  content_overview JSONB,
  top_articles JSONB,
  competitor_gap JSONB,
  next_actions JSONB,
  message_for_chat TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_owned_wechat_articles_journey_url_unique
ON owned_wechat_articles(journey_id, url);

CREATE INDEX IF NOT EXISTS idx_owned_wechat_articles_journey_id
ON owned_wechat_articles(journey_id);

CREATE INDEX IF NOT EXISTS idx_owned_wechat_sync_jobs_journey_id
ON owned_wechat_sync_jobs(journey_id);

CREATE INDEX IF NOT EXISTS idx_owned_wechat_analysis_reports_journey_id
ON owned_wechat_analysis_reports(journey_id);

ALTER TABLE owned_wechat_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE owned_wechat_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owned_wechat_analysis_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owned_wechat_articles_own" ON owned_wechat_articles
FOR ALL USING (
  journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid())
);

CREATE POLICY "owned_wechat_sync_jobs_own" ON owned_wechat_sync_jobs
FOR ALL USING (
  journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid())
);

CREATE POLICY "owned_wechat_analysis_reports_own" ON owned_wechat_analysis_reports
FOR ALL USING (
  journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid())
);
