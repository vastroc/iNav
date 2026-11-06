-- About page copy now covers standalone page comments.
UPDATE settings
SET value = replace(value, '每个开启介绍页的站点都有独立讨论区', '每个站点和独立页面都有独立讨论区')
WHERE key = 'about_content';

UPDATE settings
SET value = replace(value, '欢迎在对应站点的介绍页留言', '欢迎在对应站点或页面的讨论区留言')
WHERE key = 'about_content';
