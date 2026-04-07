-- Add per-token-class breakdown columns so we can show input/output/cache
-- usage and accurate cost (mirrors what claude-usage extracts from JSONLs).
-- Old rows keep token_count + cost_usd; new rows populate everything.

ALTER TABLE sessions ADD COLUMN input_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN output_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN cache_creation_tokens INTEGER;
