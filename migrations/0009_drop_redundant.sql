-- Remove diagnostic columns that are no longer read anywhere.
DROP INDEX IF EXISTS idx_page_views_site;
ALTER TABLE page_views DROP COLUMN site_id;
ALTER TABLE page_views DROP COLUMN visitor_hash;
ALTER TABLE comments DROP COLUMN user_agent;
