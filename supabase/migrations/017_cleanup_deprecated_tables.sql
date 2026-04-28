-- 清理废弃表：增长分析重构后不再使用的表
-- 这些表在 OpenClaw 架构重构后已被新的工具调用 + session_memory 替代

-- 删除自有公众号同步任务表
DROP TABLE IF EXISTS owned_wechat_sync_jobs CASCADE;

-- 删除自有公众号分析报告表
DROP TABLE IF EXISTS owned_wechat_analysis_reports CASCADE;

-- 删除公众号配置表中的冗余字段（如果存在）
-- 注意：wechat_publish_configs 表保留，用于发布功能
