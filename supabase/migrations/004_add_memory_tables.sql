-- User memories table
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Journey memories table
CREATE TABLE IF NOT EXISTS journey_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID REFERENCES journeys(id) ON DELETE CASCADE UNIQUE,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_journey_memories_journey_id ON journey_memories(journey_id);

-- RLS Policies
ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_memories_own" ON user_memories FOR ALL USING (
  user_id = (SELECT id FROM users WHERE id = auth.uid())
);
CREATE POLICY "journey_memories_own" ON journey_memories FOR ALL USING (
  journey_id IN (SELECT id FROM journeys WHERE user_id = auth.uid())
);
