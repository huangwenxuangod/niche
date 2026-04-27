-- 情景记忆表：记录本次对话的所有执行步骤
-- 这是 OpenClaw 风格记忆驱动的核心：工具执行自动记录，支持复盘和重试

CREATE TABLE session_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL CHECK (step_type IN ('thought', 'plan', 'tool_call', 'tool_result', 'observation', 'reflection')),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引：快速查询某个对话的执行历史
CREATE INDEX idx_session_memory_conversation ON session_memory(conversation_id, created_at);
CREATE INDEX idx_session_memory_type ON session_memory(step_type) WHERE step_type IN ('tool_call', 'tool_result');

-- 启用 RLS
ALTER TABLE session_memory ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能访问自己对话的情景记忆
CREATE POLICY session_memory_access ON session_memory
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      JOIN journeys j ON c.journey_id = j.id
      WHERE c.id = session_memory.conversation_id
      AND j.user_id = auth.uid()
    )
  );

-- 注释说明
COMMENT ON TABLE session_memory IS '情景记忆：记录单次对话中的完整执行历史，包括规划、工具调用、结果和反思。用于支持复盘、重试和技能学习。';
COMMENT ON COLUMN session_memory.step_type IS '步骤类型：thought(思考), plan(规划), tool_call(工具调用), tool_result(工具结果), observation(观察), reflection(反思)';
