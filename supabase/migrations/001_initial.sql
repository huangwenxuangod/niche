-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Identity profile (global, cross-journey)
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  identity_memo TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Journeys
CREATE TABLE IF NOT EXISTS journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('wechat_mp', 'xiaohongshu', 'wechat_channels')),
  niche_level1 TEXT NOT NULL,
  niche_level2 TEXT NOT NULL,
  niche_level3 TEXT NOT NULL,
  keywords JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT FALSE,
  knowledge_initialized BOOLEAN DEFAULT FALSE,
  init_status TEXT DEFAULT 'pending' CHECK (init_status IN ('pending', 'running', 'done', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KOC sources
CREATE TABLE IF NOT EXISTS koc_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_id TEXT,
  max_read_count INT DEFAULT 0,
  avg_read_count INT DEFAULT 0,
  article_count INT DEFAULT 0,
  is_manually_added BOOLEAN DEFAULT FALSE,
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(journey_id, account_id)
);

-- Knowledge articles
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  koc_source_id UUID REFERENCES koc_sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  content_summary TEXT,
  read_count INT DEFAULT 0,
  publish_time TIMESTAMPTZ,
  is_viral BOOLEAN DEFAULT FALSE,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tool_used TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_journeys_user_id ON journeys(user_id);
CREATE INDEX IF NOT EXISTS idx_journeys_is_active ON journeys(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_koc_sources_journey_id ON koc_sources(journey_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_journey_id ON knowledge_articles(journey_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_viral ON knowledge_articles(journey_id, is_viral);
CREATE INDEX IF NOT EXISTS idx_conversations_journey_id ON conversations(journey_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- RLS Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE koc_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can only access their own data
CREATE POLICY "users_own_data" ON users FOR ALL USING (auth.uid() = id);
CREATE POLICY "user_profiles_own" ON user_profiles FOR ALL USING (
  user_id = (SELECT id FROM users WHERE id = auth.uid())
);
CREATE POLICY "journeys_own" ON journeys FOR ALL USING (
  user_id = (SELECT id FROM users WHERE id = auth.uid())
);
CREATE POLICY "koc_sources_own" ON koc_sources FOR ALL USING (
  journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid())
);
CREATE POLICY "knowledge_articles_own" ON knowledge_articles FOR ALL USING (
  journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid())
);
CREATE POLICY "conversations_own" ON conversations FOR ALL USING (
  user_id = auth.uid()
);
CREATE POLICY "messages_own" ON messages FOR ALL USING (
  conversation_id IN (SELECT id FROM conversations WHERE user_id = auth.uid())
);

-- Function to sync auth.users -> public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
