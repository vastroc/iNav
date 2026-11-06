# AGENTS.md — 锦囊书签 / iNav 二次开发交接

本文件面向 Codex 或其他 AI 编码代理。开始修改前请完整阅读 README、本文件、wrangler.jsonc 和 migrations/。

## 1. 项目定位

一个部署在 Cloudflare Workers + D1 SQLite 上的公开网址导航站：

- 前台：原生 TypeScript + History API + 原生 DOM，无运行时框架。
- 后台：原生 TypeScript + 原生 DOM，入口 /admin，不使用 React。
- 数据：Cloudflare D1；静态资源：Workers Static Assets（./dist）。
- 认证：仅 GitHub OAuth；没有本地快捷登录。
- 构建：Vite；Node.js >= 22.12。
- 生产 Worker 入口：worker/index.ts。

## 2. 快速开始

```bash
npm install
npm run db:migrate
npm run db:seed       # 可选：写入演示数据
npm run dev           # 构建后启动 127.0.0.1:8787
```

单独开发：

```bash
npm run dev:worker    # Workers API + 静态资源（推荐）
npm run dev:ui        # Vite 前台 HMR，API 代理到 8787
```

命令：

```bash
npm run typecheck
npm run build
npm run test:api      # 公开面 API 冒烟检查
npm run db:migrate
npm run db:migrate:remote
npm run db:seed
npm run deploy
```

后台需要 GitHub OAuth。本地创建不被提交的 .dev.vars：

```dotenv
SESSION_SECRET=至少16位随机字符串
SITE_URL=http://127.0.0.1:8787
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
ADMIN_GITHUB_LOGINS=你的GitHub用户名
```

GitHub OAuth App 回调：本地 http://127.0.0.1:8787/api/auth/github/callback；线上 https://你的域名/api/auth/github/callback。

没有 OAuth 时，/admin 只显示 GitHub OAuth 未配置，不存在调试登录入口。

## 3. 生产部署

```bash
npx wrangler login
npx wrangler d1 create inav
```

把 database_id 替换到 wrangler.jsonc，然后：

```bash
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SITE_URL
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ADMIN_GITHUB_LOGINS
# 按需
npx wrangler secret put AI_API_KEY

npm run db:migrate:remote
# 正式站通常不要执行 db:seed:remote
npm run deploy
```

GitHub 仓库提交前确认没有 .dev.vars、.wrangler、dist、node_modules、密钥、本地数据库。

## 4. 代码结构

```text
index.html                 前台入口
admin.html                 后台入口
src/public/main.ts         前台路由、渲染、评论、统计
src/public/styles.css      前台样式
src/admin/main.ts          后台全部逻辑（无框架）
src/lib/markdown.ts        安全 Markdown 子集渲染器
src/lib/categoryIcons.ts   分类图标组 + SVG 精灵引用
src/styles.css             后台样式
worker/index.ts            Hono 入口、安全头、/go、/admin、Cron、sitemap
worker/public.ts           导航、详情、页面、评论、验证码、浏览量
worker/admin.ts            书签/分类/页面/评论/设置/检测/拖拽排序
worker/auth.ts             GitHub OAuth + 签名会话
worker/ai.ts               AI 简介
worker/linkcheck.ts        链接检测
worker/utils.ts            映射、设置、URL/摘要工具
shared/types.ts            共享类型
migrations/                0001–0009
public/                    headers、favicon、robots、Lucide 精灵、theme-init.js
scripts/seed.sql           演示数据
scripts/smoke-api.mjs      公开面 API 冒烟
docs/                      README 截图
```

## 5. 产品决策（不要无意改回）

### 浏览量

- 站点 views = 外链跳转次数，不是详情页访问量。
- 卡片、详情页访问按钮、域名、同分类链接跳转时 POST /api/sites/:id/jump，views +1。
- /go/:id 兼容旧链接，views +1。
- 站点详情页自身访问只写 page_views，不增加站点 views。
- 独立页面访问量在 pages.views；GET /api/pages/:slug 时 +1，显示“该页被浏览 X 次”。
- 关于页“全站浏览”= 所有站点 views 之和，不是 page_views 总数。
- 不记录、不展示单独 clicks；sites.clicks 已在迁移 0008 删除。

### 评论

- 站点详情页与独立页面共用 comments，site_id / page_id 二选一。
- 称呼、邮箱、内容必填；个人网址选填；邮箱不公开。
- 填写网址后评论用户名可点击；评论时间和右栏最近评论支持 #comment-<id>。
- 评论统一进入后台“评论”审核。
- 验证码、蜜罐、IP 摘要、限流、去重、屏蔽词在 worker/public.ts。

### 后台

- 五个标签：书签、分类、独立页面、评论、设置。
- 无概览页；链接检测按钮在书签页顶部。
- 标签栏只有文字，没有描述小字。
- 书签、同级分类、独立页面拖拽排序；表单无排序值输入。
- 关于页固定最后；内容在设置中维护。
- 书签编辑为单层右侧抽屉；详情 Markdown 有预览/返回编辑。
- 标签是胶囊编辑器：已有标签可点选，新标签回车/添加；已选只能删除。
- 分类图标是弹窗选择，130 个本地 Lucide 图标，六组。
- 书签表：真实图标、分类筛选、标签列、状态列；状态徽章可点击重新检测。
- 后台品牌名跟随设置站点名。
- 没有“前台显示/启用详情页”表单开关；新增默认显示+详情，编辑保留原状态。
- 不引入 React、组件库或调试登录。

### 前台

- 顶部导航、详情页、独立页面 1220px；首页三栏 1440px。
- 首页左/右栏 215px；右侧是独立白色卡片。
- 移动端品牌/导航居中，字号放大；标签完整换行不裁切。
- 移动端排序为“排序：”+三个胶囊，不加大外框。
- 移动端分类按钮是右下角小号悬浮按钮；页脚链接右对齐。
- 页脚版权居中，不显示站点数/浏览量。
- 卡片标签溢出时 2.5 秒往返轮播；触屏可横向滑动。
- AI 生成简介必须在卡片和详情显示“AI 生成”。

## 6. 数据库

- categories：多级分类、icon、parent_id、sort_order。
- sites：分类、名称、slug、url、描述、图标/截图、tags JSON、detail_content、sort_order、views、is_visible、ai_generated、链接状态与检测元数据、时间戳；没有 clicks。
- pages：title、slug、excerpt、content、show_in_nav、is_published、sort_order、views、时间戳。
- comments：site_id/page_id 二选一、author、email、website、content、status、ip_hash、created_at、updated_at；没有 user_agent。
- page_views：id、path、created_at；没有 site_id/visitor_hash。
- link_checks：检测历史。
- settings：站点/关于/SEO/评论/AI/管理员配置。

迁移：0005 统一评论；0007 浏览口径 + pages.views；0008 删除 clicks；0009 删除 page_views.site_id、page_views.visitor_hash、comments.user_agent。

sites.detail_enabled 保留为功能性标志，演示数据全部为 1；如果未来确定永远只有详情页，可单独迁移删除，但必须同步修改 public/admin 查询。

## 7. API

公开：

- GET /api/health
- GET /api/nav
- GET /api/sites/:slug
- GET /api/sites/:slug/comments
- GET /api/pages/:slug（累加 pages.views）
- GET /api/pages/:slug/comments
- GET /api/recent-comments?limit=4
- GET /api/captcha
- POST /api/sites/:slug/comments
- POST /api/pages/:slug/comments
- POST /api/sites/:id/jump
- POST /api/views（只写 page_views）
- GET /go/:id（views+1）
- GET /sitemap.xml

后台（需 OAuth 会话）：

- GET/POST /api/admin/sites；GET/PUT/DELETE /api/admin/sites/:id
- POST /api/admin/sites/:id/generate-description
- POST /api/admin/sites/:id/check
- POST /api/admin/check-all
- GET/POST /api/admin/categories；PUT/DELETE /api/admin/categories/:id
- GET/POST /api/admin/pages；GET/PUT/DELETE /api/admin/pages/:id
- GET/PATCH/DELETE /api/admin/comments
- GET/PUT /api/admin/settings
- POST /api/admin/reorder，type: sites|categories|pages
- 无 /api/admin/overview

## 8. 安全约束

- 仅 GitHub OAuth；没有 DEV_LOGIN / 本地快捷登录。
- SESSION_SECRET 至少 16 字符，缺失时认证抛错。
- 管理写请求校验 Origin（SITE_URL 或当前 origin）。
- Cookie：HttpOnly、SameSite=Lax、HTTPS Secure。
- SQL 全部参数化；用户内容转义；Markdown 先转义 HTML。
- CSP：script-src 'self'；主题脚本 public/theme-init.js，不要重新加 inline script。
- public/_headers 与 Worker admin 响应设置 CSP/HSTS/XFO/COOP/Permissions-Policy。
- 站点 URL 限制 http(s)，拒绝本地/内网。
- 评论邮箱不进入公开返回。

## 9. 验证状态

- npm run build 通过（worker + client typecheck + Vite）。
- npm run test:api 公开面通过（9 项）。
- 已验证后台书签 CRUD、分类/页面编辑、标签编辑器、Markdown 预览、图标弹窗、分类筛选、拖拽排序、状态检测、设置保存。
- npm audit --omit=dev：0 漏洞。

## 10. 不要重新引入

- React、React Router、lucide-react。
- dev-login 或 DEV_LOGIN/ENVIRONMENT 配置。
- sites.clicks 或后台点击统计。
- 表单里的排序值输入。
- 概览页。
- 把站点 views 改成详情页 PV。
- 把邮箱/个人网址公开。
- HTML inline script（违反 CSP）。
- 在仓库提交 .dev.vars、.wrangler、dist、node_modules、密钥。

## 11. 已知边界

- 演示数据只在 scripts/seed.sql；实际 D1 数据不在源码包内。
- wrangler.jsonc 的 database_id 是占位值，部署前必须替换。
- 截图依赖 mShots/image.thum.io，可能失败或慢。
- 站点图标使用 Google gstatic CN 或手填 URL，失败显示首字母。
- AI 简介依赖外部服务，可能限流。
- scripts/smoke-api.mjs 只覆盖公开面；后台自动化需要 OAuth 会话。
- 图标精灵来自 Lucide，许可证在 public/category-icons.LICENSE.txt。
