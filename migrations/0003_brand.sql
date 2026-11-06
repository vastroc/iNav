-- 锦囊书签 · 品牌名称
UPDATE settings SET value = '锦囊书签' WHERE key = 'site_name';
UPDATE settings SET value = '锦囊书签 · 保持好奇，常回来看看。' WHERE key = 'footer_text';
UPDATE settings SET value = replace(value, '锦囊书签', '锦囊书签') WHERE key = 'about_content';
