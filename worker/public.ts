import { Hono } from "hono";
import type { Context } from "hono";
import type { Category, CommentsPayload, NavPage, NavPayload, NavStats, RecentComment } from "../shared/types";
import type { AppEnv } from "./env";
import { createCaptcha, verifyCaptcha } from "./captcha";
import {
  categoryPath,
  clampInt,
  loadSettings,
  mapCategory,
  mapPublicComment,
  mapPublicPage,
  mapSite,
  mapSiteDetail,
  parsePage,
  publicSettings,
  stableCategoryTree,
  visitorHash,
  type PageRow,
  type SiteRow,
} from "./utils";

const publicRoutes = new Hono<AppEnv>();

function aggregateCategoryCounts(nodes: Category[]): void {
  for (const node of nodes) {
    if (!node.children?.length) continue;
    aggregateCategoryCounts(node.children);
    node.siteCount += node.children.reduce((sum, child) => sum + child.siteCount, 0);
  }
}

publicRoutes.get("/health", (context) => {
  return context.json({ ok: true, time: new Date().toISOString() });
});

publicRoutes.get("/nav", async (context) => {
  const db = context.env.DB;
  const [categoryResult, countResult, siteResult, pageResult, settings, siteTotals, viewTotals, commentTotals, linkGroups] =
    await Promise.all([
      db.prepare("SELECT id, name, slug, description, icon, parent_id, sort_order FROM categories ORDER BY sort_order, id").all<{
        id: number;
        name: string;
        slug: string;
        description: string;
        icon: string;
        parent_id: number | null;
        sort_order: number;
      }>(),
      db
        .prepare("SELECT category_id, COUNT(*) AS count FROM sites WHERE is_visible = 1 GROUP BY category_id")
        .all<{ category_id: number; count: number }>(),
      db
        .prepare(
          `SELECT s.*, c.name AS category_name, c.slug AS category_slug
           FROM sites s JOIN categories c ON c.id = s.category_id
           WHERE s.is_visible = 1 ORDER BY s.sort_order, s.id`,
        )
        .all<SiteRow>(),
      db
        .prepare("SELECT id, title, slug, show_in_nav, sort_order FROM pages WHERE is_published = 1 ORDER BY sort_order, id")
        .all<{ id: number; title: string; slug: string; show_in_nav: number; sort_order: number }>(),
      loadSettings(db),
      db
        .prepare(
          "SELECT COUNT(*) AS sites, COALESCE(SUM(views), 0) AS views FROM sites WHERE is_visible = 1",
        )
        .first<{ sites: number; views: number }>(),
      db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN 1 ELSE 0 END), 0) AS today FROM page_views",
        )
        .first<{ today: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM comments WHERE status = 'approved'").first<{ count: number }>(),
      db
        .prepare("SELECT link_status, COUNT(*) AS count FROM sites WHERE is_visible = 1 GROUP BY link_status")
        .all<{ link_status: string; count: number }>(),
    ]);

  const countMap = new Map((countResult.results ?? []).map((row) => [row.category_id, row.count]));
  const categories = (categoryResult.results ?? []).map((row) =>
    mapCategory({ ...row, site_count: countMap.get(row.id) ?? 0 }),
  );
  const tree = stableCategoryTree(categories);
  aggregateCategoryCounts(tree);

  const sites = (siteResult.results ?? []).map(mapSite);
  const tagCounts = new Map<string, number>();
  for (const site of sites) {
    for (const tag of site.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 30)
    .map(([tag]) => tag);

  const links: Record<string, number> = {};
  for (const row of linkGroups.results ?? []) links[row.link_status] = row.count;

  const stats: NavStats = {
    totalSites: siteTotals?.sites ?? sites.length,
    totalViews: siteTotals?.views ?? 0,
    totalComments: commentTotals?.count ?? 0,
    healthyLinks: links.alive ?? 0,
    deadLinks: links.dead ?? 0,
    unknownLinks: links.unknown ?? 0,
    todayViews: viewTotals?.today ?? 0,
  };

  const pages: NavPage[] = (pageResult.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    showInNav: !!row.show_in_nav,
    sortOrder: row.sort_order,
  }));

  const payload: NavPayload = {
    categories: tree,
    sites,
    pages,
    settings: publicSettings(settings),
    stats,
    tags,
  };
  return context.json(payload);
});


publicRoutes.get("/pages/:slug", async (context) => {
  const row = await context.env.DB.prepare(
    "SELECT * FROM pages WHERE slug = ? AND is_published = 1",
  )
    .bind(context.req.param("slug"))
    .first<PageRow>();
  if (!row) return context.json({ error: "没有找到这个页面" }, 404);
  const updated = await context.env.DB.prepare(
    "UPDATE pages SET views = views + 1 WHERE id = ? RETURNING views",
  )
    .bind(row.id)
    .first<{ views: number }>();
  return context.json(mapPublicPage({ ...row, views: updated?.views ?? (row.views ?? 0) + 1 }));
});

publicRoutes.get("/sites/:slug", async (context) => {
  const slug = context.req.param("slug");
  const row = await context.env.DB.prepare(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug
     FROM sites s JOIN categories c ON c.id = s.category_id
     WHERE s.slug = ? AND s.is_visible = 1 AND s.detail_enabled = 1`,
  )
    .bind(slug)
    .first<SiteRow>();
  if (!row) return context.json({ error: "没有找到这个站点" }, 404);
  const path = await categoryPath(context.env.DB, row.category_id);
  return context.json(mapSiteDetail(row, path));
});

publicRoutes.post("/sites/:id/jump", async (context) => {
  const id = Number.parseInt(context.req.param("id"), 10);
  if (!Number.isFinite(id)) return context.json({ error: "无效的站点" }, 400);
  const row = await context.env.DB.prepare(
    "UPDATE sites SET views = views + 1 WHERE id = ? AND is_visible = 1 RETURNING views",
  )
    .bind(id)
    .first<{ views: number }>();
  if (!row) return context.json({ error: "没有找到这个站点" }, 404);
  return context.json({ views: row.views });
});

publicRoutes.post("/views", async (context) => {
  let body: { path?: unknown };
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "无效的请求" }, 400);
  }
  const path = typeof body.path === "string" && body.path.startsWith("/") ? body.path.slice(0, 200) : "/";
  await context.env.DB.prepare("INSERT INTO page_views (path) VALUES (?)").bind(path).run();
  return context.json({ ok: true });
});

publicRoutes.get("/sites/:slug/comments", async (context) => {
  const slug = context.req.param("slug");
  const site = await context.env.DB.prepare(
    "SELECT id FROM sites WHERE slug = ? AND is_visible = 1 AND detail_enabled = 1",
  )
    .bind(slug)
    .first<{ id: number }>();
  if (!site) return context.json({ error: "没有找到这个站点" }, 404);

  const page = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 50, 20);
  const offset = (page - 1) * pageSize;
  const [list, total] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, site_id, page_id, author, website, content, created_at FROM comments
       WHERE site_id = ? AND status = 'approved'
       ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(site.id, pageSize, offset)
      .all<{
        id: number;
        site_id: number | null;
        page_id: number | null;
        author: string;
        website: string;
        content: string;
        created_at: string;
      }>(),
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM comments WHERE site_id = ? AND status = 'approved'")
      .bind(site.id)
      .first<{ count: number }>(),
  ]);
  const payload: CommentsPayload = {
    comments: (list.results ?? []).map(mapPublicComment),
    total: total?.count ?? 0,
    page,
    pageSize,
  };
  return context.json(payload);
});

publicRoutes.get("/pages/:slug/comments", async (context) => {
  const slug = context.req.param("slug");
  const page = await context.env.DB.prepare(
    "SELECT id FROM pages WHERE slug = ? AND is_published = 1",
  )
    .bind(slug)
    .first<{ id: number }>();
  if (!page) return context.json({ error: "没有找到这个页面" }, 404);

  const pageNumber = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 50, 20);
  const offset = (pageNumber - 1) * pageSize;
  const [list, total] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id, site_id, page_id, author, website, content, created_at FROM comments
       WHERE page_id = ? AND status = 'approved'
       ORDER BY datetime(created_at) DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(page.id, pageSize, offset)
      .all<{
        id: number;
        site_id: number | null;
        page_id: number | null;
        author: string;
        website: string;
        content: string;
        created_at: string;
      }>(),
    context.env.DB.prepare("SELECT COUNT(*) AS count FROM comments WHERE page_id = ? AND status = 'approved'")
      .bind(page.id)
      .first<{ count: number }>(),
  ]);
  const payload: CommentsPayload = {
    comments: (list.results ?? []).map(mapPublicComment),
    total: total?.count ?? 0,
    page: pageNumber,
    pageSize,
  };
  return context.json(payload);
});

publicRoutes.get("/recent-comments", async (context) => {
  const limit = clampInt(context.req.query("limit"), 1, 10, 5);
  const rows = await context.env.DB.prepare(
    `SELECT c.id, c.author, c.content, c.created_at,
       CASE WHEN c.site_id IS NOT NULL THEN 'site' ELSE 'page' END AS target_type,
       COALESCE(s.name, p.title) AS target_name,
       COALESCE(s.slug, p.slug) AS target_slug
     FROM comments c
     LEFT JOIN sites s ON s.id = c.site_id
     LEFT JOIN pages p ON p.id = c.page_id
     WHERE c.status = 'approved'
       AND ((c.site_id IS NOT NULL AND s.is_visible = 1)
         OR (c.page_id IS NOT NULL AND p.is_published = 1))
     ORDER BY datetime(c.created_at) DESC, c.id DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: number;
      author: string;
      content: string;
      created_at: string;
      target_type: "site" | "page";
      target_name: string;
      target_slug: string;
    }>();
  const comments: RecentComment[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    author: row.author,
    content: row.content,
    createdAt: row.created_at,
    targetType: row.target_type,
    targetName: row.target_name,
    targetSlug: row.target_slug,
  }));
  return context.json({ comments });
});

function spamReason(author: string, content: string, bannedWords: string): string | null {
  const haystack = `${author} ${content}`.toLowerCase();
  const banned = bannedWords
    .split(/[,，\n]/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  if (banned.some((word) => haystack.includes(word))) return "内容包含不被允许的词汇";
  const links = content.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (links > 2) return "评论中的链接过多";
  if (/(.)\1{14,}/u.test(content)) return "请避免重复发送相同字符";
  if (/[A-Za-z0-9+/=]{120,}/.test(content)) return "内容格式不正确";
  return null;
}

publicRoutes.post("/sites/:slug/comments", async (context) => {
  const site = await context.env.DB.prepare(
    "SELECT id FROM sites WHERE slug = ? AND is_visible = 1 AND detail_enabled = 1",
  )
    .bind(context.req.param("slug"))
    .first<{ id: number }>();
  if (!site) return context.json({ error: "没有找到这个站点" }, 404);
  return submitComment(context, { siteId: site.id, pageId: null });
});

publicRoutes.post("/pages/:slug/comments", async (context) => {
  const page = await context.env.DB.prepare(
    "SELECT id FROM pages WHERE slug = ? AND is_published = 1",
  )
    .bind(context.req.param("slug"))
    .first<{ id: number }>();
  if (!page) return context.json({ error: "没有找到这个页面" }, 404);
  return submitComment(context, { siteId: null, pageId: page.id });
});

async function submitComment(
  context: Context<AppEnv>,
  target: { siteId: number | null; pageId: number | null },
): Promise<Response> {
  const settings = await loadSettings(context.env.DB);
  if (!settings.commentsEnabled) return context.json({ error: "评论功能暂时关闭" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await context.req.json();
  } catch {
    return context.json({ error: "无效的请求" }, 400);
  }
  if (body.company) return context.json({ error: "提交未通过验证" }, 400);

  const author = String(body.author ?? "").trim();
  const content = String(body.content ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  if (author.length < 1 || author.length > 24) return context.json({ error: "称呼需为 1-24 个字符" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return context.json({ error: "请填写有效的邮箱地址" }, 400);
  }
  if (content.length < 5 || content.length > 800) return context.json({ error: "评论需为 5-800 个字符" }, 400);

  const website = cleanCommentWebsite(body.website);
  if (website === null) return context.json({ error: "个人网址格式不正确" }, 400);

  const startedAt = Number(body.startedAt);
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(startedAt) || elapsed < 2500 || elapsed > 2 * 60 * 60 * 1000) {
    return context.json({ error: "表单已过期，请刷新页面后重试" }, 400);
  }

  const captcha = await verifyCaptcha(context.env, body.captchaToken, body.captchaAnswer);
  if (!captcha.ok) return context.json({ error: captcha.error || "人机验证失败" }, 400);

  const reason = spamReason(author, content, settings.bannedWords);
  if (reason) return context.json({ error: reason }, 400);

  const ipHash = (await visitorHash(context.req.raw, context.env)).slice(0, 24);
  const recent = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM comments WHERE ip_hash = ? AND datetime(created_at) > datetime('now', '-10 minutes')",
  )
    .bind(ipHash)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= 3) return context.json({ error: "提交过于频繁，请稍后再试" }, 429);
  const daily = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM comments WHERE ip_hash = ? AND datetime(created_at) > datetime('now', '-1 day')",
  )
    .bind(ipHash)
    .first<{ count: number }>();
  if ((daily?.count ?? 0) >= 15) return context.json({ error: "今天提交的评论已达上限" }, 429);

  const duplicate = await context.env.DB.prepare(
    "SELECT id FROM comments WHERE ip_hash = ? AND content = ? AND datetime(created_at) > datetime('now', '-10 minutes')",
  )
    .bind(ipHash, content)
    .first();
  if (duplicate) return context.json({ error: "这条评论已经提交过了" }, 409);

  const status = settings.commentModeration ? "pending" : "approved";
  const result = await context.env.DB.prepare(
    "INSERT INTO comments (site_id, page_id, author, email, website, content, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(target.siteId, target.pageId, author, email, website, content, status, ipHash)
    .run();
  const id = Number(result.meta.last_row_id);

  if (status === "approved") {
    const row = await context.env.DB.prepare(
      "SELECT id, site_id, page_id, author, website, content, created_at FROM comments WHERE id = ?",
    )
      .bind(id)
      .first<{
        id: number;
        site_id: number | null;
        page_id: number | null;
        author: string;
        website: string;
        content: string;
        created_at: string;
      }>();
    return context.json({
      ok: true,
      status,
      message: "评论已发布",
      comment: row ? mapPublicComment(row) : undefined,
    });
  }

  return context.json({
    ok: true,
    status,
    message: "评论已提交，审核通过后会显示在这里。",
  });
}

function cleanCommentWebsite(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > 300) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

publicRoutes.get("/captcha", async (context) => {
  const settings = await loadSettings(context.env.DB);
  if (!settings.commentsEnabled) return context.json({ error: "评论功能暂时关闭" }, 403);
  try {
    return context.json(await createCaptcha(context.env));
  } catch (error) {
    console.error("Captcha generation failed", error);
    return context.json({ error: "验证码服务未配置" }, 500);
  }
});

export default publicRoutes;