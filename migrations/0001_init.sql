-- 锦囊书签 · initial schema
PRAGMA foreign_keys = ON;

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'folder',
  parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_categories_parent ON categories(parent_id, sort_order, id);
CREATE INDEX idx_categories_sort ON categories(sort_order, id);

CREATE TABLE sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  detail_enabled INTEGER NOT NULL DEFAULT 0 CHECK (detail_enabled IN (0, 1)),
  detail_content TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  ai_generated INTEGER NOT NULL DEFAULT 0 CHECK (ai_generated IN (0, 1)),
  link_status TEXT NOT NULL DEFAULT 'unknown' CHECK (link_status IN ('unknown', 'alive', 'warn', 'dead')),
  link_status_code INTEGER,
  link_checked_at TEXT,
  link_latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_sites_category ON sites(category_id, sort_order, id);
CREATE INDEX idx_sites_clicks ON sites(clicks DESC);
CREATE INDEX idx_sites_status ON sites(link_status, link_checked_at);
CREATE INDEX idx_sites_visible ON sites(is_visible, sort_order, id);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'spam')),
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_comments_site ON comments(site_id, status, created_at DESC);
CREATE INDEX idx_comments_status ON comments(status, created_at DESC);
CREATE INDEX idx_comments_rate ON comments(ip_hash, created_at);

CREATE TABLE link_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('unknown', 'alive', 'warn', 'dead')),
  status_code INTEGER,
  latency_ms INTEGER,
  error TEXT,
  trigger TEXT NOT NULL DEFAULT 'manual',
  checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_link_checks_site ON link_checks(site_id, checked_at DESC);
CREATE INDEX idx_link_checks_recent ON link_checks(checked_at DESC);

CREATE TABLE page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  visitor_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_page_views_created ON page_views(created_at);
CREATE INDEX idx_page_views_site ON page_views(site_id, created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO settings (key, value) VALUES
  ('site_name', '锦囊书签'),
  ('site_tagline', '把常用网站，收进一页纸里。'),
  ('site_description', '一份克制、清晰、持续生长的网址收藏。'),
  ('footer_text', '锦囊书签 · 保持好奇，常回来看看。'),
  ('seo_keywords', '导航站,网址导航,网址收藏,极简导航,工具导航'),
  ('github_admins', ''),
  ('ai_provider', 'pollinations'),
  ('ai_model', 'openai'),
  ('ai_base_url', ''),
  ('comments_enabled', '1'),
  ('comment_moderation', '1'),
  ('banned_words', '博彩,赌场,代开发票,办证,加微信,裸聊,色情,成人视频,刷单,返利,USDT,telegram群,推广链接'),
  ('about_content', '# 关于锦囊书签

锦囊书签是一份公开的网址收藏，也是一个安静的上网入口。

我们相信，好的导航不应该制造噪音。它只需要在你想去某个地方时，快速、准确地把你送到。因此这里没有弹窗、没有信息流，只有经过整理的工具、资料与灵感来源。

## 收录原则

- 以长期有用的网站为主，尽量避开短期营销页。
- 每个站点都有简洁说明与标签，方便快速判断。
- 站点介绍与评论仅代表个人观点，不构成任何推荐或担保。

## 关于评论

每个开启介绍页的站点都有独立讨论区。评论需要完成人机验证，并遵守基本的友善交流原则。广告、攻击性内容与垃圾信息会被移除。

## 保持联系

如果你发现链接失效、描述有误，欢迎在对应站点的介绍页留言。这个小小的索引会持续维护、慢慢生长。');

-- Default admin password is never stored: /admin uses GitHub OAuth or local dev login.
