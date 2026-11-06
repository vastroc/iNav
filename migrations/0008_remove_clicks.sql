-- Click counts are retired; site views are the only jump counter.
DROP INDEX IF EXISTS idx_sites_clicks;
ALTER TABLE sites DROP COLUMN clicks;
