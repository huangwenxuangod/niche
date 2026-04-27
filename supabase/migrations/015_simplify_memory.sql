-- 删除 journey_memories 和 journey_project_memories 表
-- 用户记忆统一到 user_memories（markdown 文本）
-- journey 仅作为 koc_sources / knowledge_articles 的数据容器

DROP TABLE IF EXISTS journey_project_memories;
DROP TABLE IF EXISTS journey_memories;

-- 同时清理 user_profiles 表中的 identity_memo 冗余字段
-- （身份信息已合并进 user_memories）
ALTER TABLE user_profiles DROP COLUMN IF EXISTS identity_memo;
