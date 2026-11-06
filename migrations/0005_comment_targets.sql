-- Unified comments for sites and standalone pages, plus public commenter fields.
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'spam')),
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((site_id IS NOT NULL AND page_id IS NULL) OR (site_id IS NULL AND page_id IS NOT NULL))
);

INSERT INTO comments_new (id, site_id, page_id, author, email, website, content, status, ip_hash, user_agent, created_at, updated_at)
SELECT id, site_id, NULL, author, '', '', content, status, ip_hash, user_agent, created_at, updated_at FROM comments;

DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;

CREATE INDEX idx_comments_site ON comments(site_id, status, created_at DESC);
CREATE INDEX idx_comments_page ON comments(page_id, status, created_at DESC);
CREATE INDEX idx_comments_status ON comments(status, created_at DESC);
CREATE INDEX idx_comments_rate ON comments(ip_hash, created_at);
