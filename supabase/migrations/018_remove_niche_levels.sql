-- 删除 journeys 表中不再需要的 niche_level 字段
-- 这些字段在自动创建旅程时造成 not_null_violation 错误

ALTER TABLE journeys
  DROP COLUMN IF EXISTS niche_level1,
  DROP COLUMN IF EXISTS niche_level2,
  DROP COLUMN IF EXISTS niche_level3;
