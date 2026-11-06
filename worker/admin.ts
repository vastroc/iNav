import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  AdminCategory,
  AdminComment,
  AdminSettingsPayload,
  AdminSite,
  AiProvider,
  PaginatedAdminSites,
  SiteSettings,
} from "../shared/types";
import type { AppEnv } from "./env";
import { aiKeysStatus, defaultModel, generateDescription } from "./ai";
import { checkOneSite, checkSites } from "./linkcheck";
import {
  categoryDescendants,
  clampInt,
  githubOauthConfigured,
  int,
  loadSettings,
  makeSlug,
  mapAdminCategory,
  mapAdminComment,
  mapAdminPage,
  mapAdminSite,
  normalizeUrl,
  nowIso,
  parsePage,
  parseTags,
  tagsToJson,
  uniqueSlug,
  bool,
  type PageRow,
  type SiteRow,
} from "./utils";

const adminRoutes = new Hono<AppEnv>();

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502;

function fail(message: string, status: ErrorStatus = 400): never {
  throw new HTTPException(status, { message });
}

async function jsonBody(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("无效的请求内容");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    fail("请求内容不是有效的 JSON");
  }
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function text(value: unknown, max: number, label: string, required = false): string {
  const result = String(value ?? "").trim();
  if (required && !result) fail(`${label}不能为空`);
  if (result.length > max) fail(`${label}不能超过 ${max} 个字符`);
  return result;
}

function parseId(context: Context<AppEnv>): number {
  const id = Number.parseInt(context.req.param("id") ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) fail("无效的 ID");
  return id;
}

function parseProvider(value: unknown): AiProvider | null {
  return value === "pollinations" || value === "openai" || value === "deepseek" || value === "gemini" ? value : null;
}

function cleanAssetUrl(value: unknown, label: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw.slice(0, 500);
  const normalized = normalizeUrl(raw);
  if (!normalized) fail(`${label}必须是 http(s) 链接或站内相对路径`);
  return normalized;
}

async function findSiteRow(db: D1Database, id: number): Promise<SiteRow | null> {
  return db
    .prepare(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug
       FROM sites s JOIN categories c ON c.id = s.category_id WHERE s.id = ?`,
    )
    .bind(id)
    .first<SiteRow>();
}

async function categoryExists(db: D1Database, id: number): Promise<boolean> {
  return Boolean(await db.prepare("SELECT id FROM categories WHERE id = ?").bind(id).first());
}

adminRoutes.get("/sites", async (context) => {
  const db = context.env.DB;
  const page = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 100, 20);
  const q = (context.req.query("q") ?? "").trim().slice(0, 80);
  const status = context.req.query("status") ?? "all";
  const link = context.req.query("link") ?? "all";
  const category = Number.parseInt(context.req.query("category") ?? "", 10);
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];

  if (q) {
    const like = `%${q}%`;
    conditions.push("(s.name LIKE ? OR s.url LIKE ? OR s.description LIKE ? OR s.tags LIKE ?)");
    bindings.push(like, like, like, like);
  }
  if (status === "visible") conditions.push("s.is_visible = 1");
  if (status === "hidden") conditions.push("s.is_visible = 0");
  if (link === "alive" || link === "warn" || link === "dead" || link === "unknown") {
    conditions.push("s.link_status = ?");
    bindings.push(link);
  }
  if (Number.isFinite(category) && category > 0) {
    const all = await db.prepare("SELECT id, parent_id FROM categories").all<{ id: number; parent_id: number | null }>();
    const ids = categoryDescendants(
      (all.results ?? []).map((row) => ({ id: row.id, parentId: row.parent_id })),
      category,
    );
    if (ids.size) {
      conditions.push(`s.category_id IN (${[...ids].map(() => "?").join(",")})`);
      bindings.push(...ids);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM sites s ${where}`).bind(...bindings).first<{ count: number }>();
  const rows = await db
    .prepare(
      `SELECT s.*, c.name AS category_name, c.slug AS category_slug
       FROM sites s JOIN categories c ON c.id = s.category_id
       ${where} ORDER BY s.sort_order, s.id LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, (page - 1) * pageSize)
    .all<SiteRow>();
  const payload: PaginatedAdminSites = {
    sites: (rows.results ?? []).map(mapAdminSite),
    total: count?.count ?? 0,
    page,
    pageSize,
  };
  return context.json(payload);
});

adminRoutes.get("/sites/:id", async (context) => {
  const row = await findSiteRow(context.env.DB, parseId(context));
  if (!row) return context.json({ error: "站点不存在" }, 404);
  return context.json(mapAdminSite(row));
});

adminRoutes.post("/sites", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const name = text(body.name, 80, "站点名称", true);
  const rawUrl = text(body.url, 500, "网址", true);
  const url = normalizeUrl(rawUrl);
  if (!url) fail("网址无效，或指向了不允许的本地地址");
  const categoryId = int(body.categoryId, 0);
  if (!categoryId || !(await categoryExists(db, categoryId))) fail("请选择有效的分类");

  let slug = text(body.slug, 80, "路径");
  if (!slug) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    slug = makeSlug(host || name, "site");
  }
  slug = await uniqueSlug(db, "sites", slug);

  const iconUrl = cleanAssetUrl(body.iconUrl, "图标地址");
  const screenshotUrl = cleanAssetUrl(body.screenshotUrl, "截图地址");
  const tags = tagsToJson(body.tags);
  const detailEnabled = body.detailEnabled === undefined ? true : bool(body.detailEnabled);
  const detailContent = text(body.detailContent, 40000, "详情介绍");
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, 0)
    : (await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM sites").first<{ next: number }>())?.next ?? 10;
  const isVisible = body.isVisible === undefined ? true : bool(body.isVisible);
  const settings = await loadSettings(db);

  let description = text(body.description, 1200, "站点描述");
  let aiGenerated = false;
  let warning: string | undefined;
  if (!description && body.generateAi !== false) {
    try {
      const category = await db.prepare("SELECT name FROM categories WHERE id = ?").bind(categoryId).first<{ name: string }>();
      const generated = await generateDescription(context.env, settings, {
        name,
        url,
        categoryName: category?.name,
        tags: parseTags(tags),
      });
      description = generated.description;
      aiGenerated = true;
    } catch (error) {
      warning = error instanceof Error ? error.message : "AI 生成失败";
    }
  }

  const result = await db
    .prepare(
      `INSERT INTO sites
       (category_id, name, slug, url, description, icon_url, screenshot_url, tags, detail_enabled, detail_content, sort_order, is_visible, ai_generated, link_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`,
    )
    .bind(
      categoryId,
      name,
      slug,
      url,
      description,
      iconUrl,
      screenshotUrl,
      tags,
      detailEnabled ? 1 : 0,
      detailContent,
      sortOrder,
      isVisible ? 1 : 0,
      aiGenerated ? 1 : 0,
      nowIso(),
      nowIso(),
    )
    .run();
  const row = await findSiteRow(db, Number(result.meta.last_row_id));
  if (row) {
    context.executionCtx.waitUntil(
      checkOneSite(context.env, { id: row.id, name: row.name, url: row.url }, "create").catch((error) => {
        console.error("Automatic link check after create failed", error);
      }),
    );
  }
  return context.json({ site: row ? mapAdminSite(row) : null, warning }, 201);
});

adminRoutes.put("/sites/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const existing = await findSiteRow(db, id);
  if (!existing) return context.json({ error: "站点不存在" }, 404);
  const body = await jsonBody(context);

  const name = has(body, "name") ? text(body.name, 80, "站点名称", true) : existing.name;
  let url = existing.url;
  if (has(body, "url")) {
    const normalized = normalizeUrl(text(body.url, 500, "网址", true));
    if (!normalized) fail("网址无效，或指向了不允许的本地地址");
    url = normalized;
  }
  const categoryId = has(body, "categoryId") ? int(body.categoryId, 0) : existing.category_id;
  if (!categoryId || !(await categoryExists(db, categoryId))) fail("请选择有效的分类");

  let slug = existing.slug;
  if (has(body, "slug")) {
    const requested = text(body.slug, 80, "路径") || existing.slug;
    slug = await uniqueSlug(db, "sites", requested, id);
  }
  const iconUrl = has(body, "iconUrl") ? cleanAssetUrl(body.iconUrl, "图标地址") : existing.icon_url;
  const screenshotUrl = has(body, "screenshotUrl")
    ? cleanAssetUrl(body.screenshotUrl, "截图地址")
    : existing.screenshot_url;
  const tags = has(body, "tags") ? tagsToJson(body.tags) : existing.tags;
  const detailEnabled = has(body, "detailEnabled") ? bool(body.detailEnabled) : !!existing.detail_enabled;
  const detailContent = has(body, "detailContent")
    ? text(body.detailContent, 40000, "详情介绍")
    : existing.detail_content ?? "";
  const sortOrder = has(body, "sortOrder") ? clampInt(body.sortOrder, -100000, 100000, existing.sort_order) : existing.sort_order;
  const isVisible = has(body, "isVisible") ? bool(body.isVisible) : !!existing.is_visible;
  const settings = await loadSettings(db);

  let description = has(body, "description") ? text(body.description, 1200, "站点描述") : existing.description;
  let aiGenerated = !!existing.ai_generated;
  let warning: string | undefined;
  if (!description && body.generateAi !== false) {
    try {
      const category = await db.prepare("SELECT name FROM categories WHERE id = ?").bind(categoryId).first<{ name: string }>();
      const generated = await generateDescription(context.env, settings, {
        name,
        url,
        categoryName: category?.name,
        tags: parseTags(tags),
        currentDescription: existing.description,
      });
      description = generated.description;
      aiGenerated = true;
    } catch (error) {
      warning = error instanceof Error ? error.message : "AI 生成失败";
    }
  } else if (has(body, "description") && description !== existing.description) {
    aiGenerated = false;
  }

  await db
    .prepare(
      `UPDATE sites SET category_id = ?, name = ?, slug = ?, url = ?, description = ?, icon_url = ?, screenshot_url = ?, tags = ?,
       detail_enabled = ?, detail_content = ?, sort_order = ?, is_visible = ?, ai_generated = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      categoryId,
      name,
      slug,
      url,
      description,
      iconUrl,
      screenshotUrl,
      tags,
      detailEnabled ? 1 : 0,
      detailContent,
      sortOrder,
      isVisible ? 1 : 0,
      aiGenerated ? 1 : 0,
      nowIso(),
      id,
    )
    .run();
  const row = await findSiteRow(db, id);
  if (row) {
    context.executionCtx.waitUntil(
      checkOneSite(context.env, { id: row.id, name: row.name, url: row.url }, "update").catch((error) => {
        console.error("Automatic link check after update failed", error);
      }),
    );
  }
  return context.json({ site: row ? mapAdminSite(row) : null, warning });
});

adminRoutes.delete("/sites/:id", async (context) => {
  const id = parseId(context);
  const result = await context.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return context.json({ error: "站点不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.post("/sites/:id/generate-description", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const row = await findSiteRow(db, id);
  if (!row) return context.json({ error: "站点不存在" }, 404);
  const body = await jsonBody(context);
  const provider = body.provider === undefined ? undefined : parseProvider(body.provider);
  if (body.provider !== undefined && !provider) fail("未知的 AI 服务");
  const settings = await loadSettings(db);
  try {
    const generated = await generateDescription(
      context.env,
      settings,
      {
        name: row.name,
        url: row.url,
        categoryName: row.category_name,
        tags: parseTags(row.tags),
        currentDescription: row.description,
      },
      provider ? { provider } : undefined,
    );
    await db
      .prepare("UPDATE sites SET description = ?, ai_generated = 1, updated_at = ? WHERE id = ?")
      .bind(generated.description, nowIso(), id)
      .run();
    return context.json(generated);
  } catch (error) {
    return context.json(
      { error: "AI 生成失败", detail: error instanceof Error ? error.message : String(error) },
      502,
    );
  }
});

adminRoutes.post("/sites/:id/check", async (context) => {
  const row = await findSiteRow(context.env.DB, parseId(context));
  if (!row) return context.json({ error: "站点不存在" }, 404);
  const result = await checkOneSite(context.env, { id: row.id, name: row.name, url: row.url }, "manual");
  return context.json(result);
});

adminRoutes.post("/check-all", async (context) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await context.req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const limit = clampInt(body.limit, 1, 20, 15);
  const rows = await context.env.DB.prepare(
    `SELECT id, name, url FROM sites
     ORDER BY CASE WHEN link_checked_at IS NULL THEN 0 ELSE 1 END, datetime(link_checked_at) ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: number; name: string; url: string }>();
  const results = await checkSites(context.env, rows.results ?? [], "manual", 4);
  return context.json({ results, checked: results.length });
});

adminRoutes.get("/categories", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM sites s WHERE s.category_id = c.id) AS direct_site_count
     FROM categories c ORDER BY c.sort_order, c.id`,
  ).all<{
    id: number;
    name: string;
    slug: string;
    description: string;
    icon: string;
    parent_id: number | null;
    sort_order: number;
    direct_site_count: number;
  }>();
  const categories = (rows.results ?? []).map(mapAdminCategory);
  for (const category of categories) {
    const ids = categoryDescendants(
      categories.map((item) => ({ id: item.id, parentId: item.parentId })),
      category.id,
    );
    category.totalSiteCount = categories
      .filter((item) => ids.has(item.id))
      .reduce((sum, item) => sum + item.directSiteCount, 0);
  }
  return context.json({ categories });
});

adminRoutes.post("/categories", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const name = text(body.name, 40, "分类名称", true);
  const parentId = body.parentId === null || body.parentId === undefined || body.parentId === "" ? null : int(body.parentId, 0);
  if (parentId !== null && !(await categoryExists(db, parentId))) fail("上级分类不存在");
  const requestedSlug = text(body.slug, 60, "分类路径");
  const slug = await uniqueSlug(db, "categories", requestedSlug || name, undefined);
  const description = text(body.description, 300, "分类描述");
  const icon = text(body.icon, 30, "分类图标") || "folder";
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, 0)
    : (await db
        .prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM categories WHERE parent_id IS ?")
        .bind(parentId)
        .first<{ next: number }>())?.next ?? 10;
  const result = await db
    .prepare(
      "INSERT INTO categories (name, slug, description, icon, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(name, slug, description, icon, parentId, sortOrder, nowIso(), nowIso())
    .run();
  const id = Number(result.meta.last_row_id);
  const row = await db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM sites s WHERE s.category_id = c.id) AS direct_site_count
       FROM categories c WHERE c.id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      name: string;
      slug: string;
      description: string;
      icon: string;
      parent_id: number | null;
      sort_order: number;
      direct_site_count: number;
    }>();
  return context.json({ category: row ? mapAdminCategory(row) : null }, 201);
});

adminRoutes.put("/categories/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const existing = await db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first<{
    id: number;
    name: string;
    slug: string;
    description: string;
    icon: string;
    parent_id: number | null;
    sort_order: number;
  }>();
  if (!existing) return context.json({ error: "分类不存在" }, 404);
  const body = await jsonBody(context);
  const name = has(body, "name") ? text(body.name, 40, "分类名称", true) : existing.name;
  const description = has(body, "description") ? text(body.description, 300, "分类描述") : existing.description;
  const icon = has(body, "icon") ? text(body.icon, 30, "分类图标") || "folder" : existing.icon;
  const sortOrder = has(body, "sortOrder") ? clampInt(body.sortOrder, -100000, 100000, existing.sort_order) : existing.sort_order;
  let parentId = has(body, "parentId")
    ? body.parentId === null || body.parentId === "" || body.parentId === undefined
      ? null
      : int(body.parentId, 0)
    : existing.parent_id;

  if (parentId !== null) {
    if (!(await categoryExists(db, parentId))) fail("上级分类不存在");
    const all = await db.prepare("SELECT id, parent_id FROM categories").all<{ id: number; parent_id: number | null }>();
    const descendants = categoryDescendants(
      (all.results ?? []).map((row) => ({ id: row.id, parentId: row.parent_id })),
      id,
    );
    if (descendants.has(parentId)) fail("不能把分类移动到它自己或子分类下面");
  }
  let slug = existing.slug;
  if (has(body, "slug")) {
    const requested = text(body.slug, 60, "分类路径") || existing.slug;
    slug = await uniqueSlug(db, "categories", requested, id);
  }
  await db
    .prepare(
      "UPDATE categories SET name = ?, slug = ?, description = ?, icon = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
    )
    .bind(name, slug, description, icon, parentId, sortOrder, nowIso(), id)
    .run();
  return context.json({ ok: true });
});

adminRoutes.delete("/categories/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const children = await db.prepare("SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?").bind(id).first<{ count: number }>();
  const sites = await db.prepare("SELECT COUNT(*) AS count FROM sites WHERE category_id = ?").bind(id).first<{ count: number }>();
  if ((children?.count ?? 0) > 0) return context.json({ error: "请先移动或删除子分类" }, 409);
  if ((sites?.count ?? 0) > 0) return context.json({ error: "请先移动或删除该分类下的站点" }, 409);
  const result = await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return context.json({ error: "分类不存在" }, 404);
  return context.json({ ok: true });
});


adminRoutes.get("/pages", async (context) => {
  const rows = await context.env.DB.prepare(
    "SELECT * FROM pages ORDER BY sort_order, id",
  ).all<PageRow>();
  return context.json({ pages: (rows.results ?? []).map(mapAdminPage) });
});

adminRoutes.get("/pages/:id", async (context) => {
  const row = await context.env.DB.prepare("SELECT * FROM pages WHERE id = ?")
    .bind(parseId(context))
    .first<PageRow>();
  if (!row) return context.json({ error: "页面不存在" }, 404);
  return context.json(mapAdminPage(row));
});

adminRoutes.post("/pages", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const title = text(body.title, 80, "页面标题", true);
  let slug = text(body.slug, 80, "页面路径");
  if (!slug) slug = makeSlug(title, "page");
  slug = await uniqueSlug(db, "pages", slug);
  const excerpt = text(body.excerpt, 300, "页面摘要");
  const content = text(body.content, 100000, "页面内容");
  const showInNav = body.showInNav === undefined ? true : bool(body.showInNav);
  const isPublished = body.isPublished === undefined ? true : bool(body.isPublished);
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, 0)
    : (await db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM pages").first<{ next: number }>())?.next ?? 10;
  const result = await db
    .prepare(
      `INSERT INTO pages (title, slug, excerpt, content, show_in_nav, is_published, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(title, slug, excerpt, content, showInNav ? 1 : 0, isPublished ? 1 : 0, sortOrder, nowIso(), nowIso())
    .run();
  const row = await db.prepare("SELECT * FROM pages WHERE id = ?")
    .bind(Number(result.meta.last_row_id))
    .first<PageRow>();
  return context.json({ page: row ? mapAdminPage(row) : null }, 201);
});

adminRoutes.put("/pages/:id", async (context) => {
  const db = context.env.DB;
  const id = parseId(context);
  const existing = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first<PageRow>();
  if (!existing) return context.json({ error: "页面不存在" }, 404);
  const body = await jsonBody(context);
  const title = has(body, "title") ? text(body.title, 80, "页面标题", true) : existing.title;
  let slug = existing.slug;
  if (has(body, "slug")) {
    const requested = text(body.slug, 80, "页面路径") || existing.slug;
    slug = await uniqueSlug(db, "pages", requested, id);
  }
  const excerpt = has(body, "excerpt") ? text(body.excerpt, 300, "页面摘要") : existing.excerpt;
  const content = has(body, "content") ? text(body.content, 100000, "页面内容") : existing.content;
  const showInNav = has(body, "showInNav") ? bool(body.showInNav) : !!existing.show_in_nav;
  const isPublished = has(body, "isPublished") ? bool(body.isPublished) : !!existing.is_published;
  const sortOrder = has(body, "sortOrder")
    ? clampInt(body.sortOrder, -100000, 100000, existing.sort_order)
    : existing.sort_order;
  await db.prepare(
    `UPDATE pages SET title = ?, slug = ?, excerpt = ?, content = ?, show_in_nav = ?, is_published = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(title, slug, excerpt, content, showInNav ? 1 : 0, isPublished ? 1 : 0, sortOrder, nowIso(), id)
    .run();
  const row = await db.prepare("SELECT * FROM pages WHERE id = ?").bind(id).first<PageRow>();
  return context.json({ page: row ? mapAdminPage(row) : null });
});

adminRoutes.delete("/pages/:id", async (context) => {
  const result = await context.env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(parseId(context)).run();
  if (!result.meta.changes) return context.json({ error: "页面不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.get("/comments", async (context) => {
  const db = context.env.DB;
  const status = context.req.query("status") ?? "all";
  const q = (context.req.query("q") ?? "").trim().slice(0, 80);
  const page = parsePage(context.req.query("page"), 1);
  const pageSize = clampInt(context.req.query("pageSize"), 1, 100, 20);
  const conditions: string[] = [];
  const bindings: Array<string | number> = [];
  if (status === "pending" || status === "approved" || status === "spam") {
    conditions.push("cm.status = ?");
    bindings.push(status);
  }
  if (q) {
    const like = `%${q}%`;
    conditions.push("(cm.author LIKE ? OR cm.content LIKE ? OR s.name LIKE ? OR p.title LIKE ?)");
    bindings.push(like, like, like, like);
  }
  const joins = "LEFT JOIN sites s ON s.id = cm.site_id LEFT JOIN pages p ON p.id = cm.page_id";
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await db
    .prepare(`SELECT COUNT(*) AS count FROM comments cm ${joins} ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await db
    .prepare(
      `SELECT cm.*, CASE WHEN cm.site_id IS NOT NULL THEN 'site' ELSE 'page' END AS target_type,
         COALESCE(s.name, p.title) AS target_name, COALESCE(s.slug, p.slug) AS target_slug
       FROM comments cm ${joins} ${where}
       ORDER BY CASE cm.status WHEN 'pending' THEN 0 ELSE 1 END, datetime(cm.created_at) DESC LIMIT ? OFFSET ?`,
    )
    .bind(...bindings, pageSize, (page - 1) * pageSize)
    .all<{
      id: number;
      site_id: number | null;
      page_id: number | null;
      target_type: "site" | "page";
      target_name: string;
      target_slug: string;
      author: string;
      email: string;
      website: string;
      content: string;
      status: string;
      ip_hash: string;
      created_at: string;
    }>();
  return context.json({
    comments: (rows.results ?? []).map(mapAdminComment),
    total: count?.count ?? 0,
    page,
    pageSize,
  });
});

adminRoutes.patch("/comments/:id", async (context) => {
  const id = parseId(context);
  const body = await jsonBody(context);
  const status = body.status;
  if (status !== "pending" && status !== "approved" && status !== "spam") fail("无效的评论状态");
  const result = await context.env.DB.prepare("UPDATE comments SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, nowIso(), id)
    .run();
  if (!result.meta.changes) return context.json({ error: "评论不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.delete("/comments/:id", async (context) => {
  const result = await context.env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(parseId(context)).run();
  if (!result.meta.changes) return context.json({ error: "评论不存在" }, 404);
  return context.json({ ok: true });
});

adminRoutes.get("/settings", async (context) => {
  const settings = await loadSettings(context.env.DB);
  const payload: AdminSettingsPayload = {
    settings,
    aiKeys: aiKeysStatus(context.env),
    githubOauthConfigured: githubOauthConfigured(context.env),
  };
  return context.json(payload);
});

const SETTING_FIELDS: Record<string, keyof SiteSettings> = {
  site_name: "siteName",
  site_tagline: "siteTagline",
  site_description: "siteDescription",
  footer_text: "footerText",
  about_content: "aboutContent",
  seo_keywords: "seoKeywords",
  github_admins: "githubAdmins",
  ai_provider: "aiProvider",
  ai_model: "aiModel",
  ai_base_url: "aiBaseUrl",
  comments_enabled: "commentsEnabled",
  comment_moderation: "commentModeration",
  banned_words: "bannedWords",
};

adminRoutes.put("/settings", async (context) => {
  const db = context.env.DB;
  const body = await jsonBody(context);
  const currentSettings = await loadSettings(db);
  const updates: Array<[string, string]> = [];

  // Keys are stored in snake_case; map from the camelCase request body.
  for (const [dbKey, camelKey] of Object.entries(SETTING_FIELDS)) {
    if (!has(body, camelKey)) continue;
    const value = body[camelKey];
    if (dbKey === "comments_enabled" || dbKey === "comment_moderation") {
      updates.push([dbKey, bool(value) ? "1" : "0"]);
    } else if (dbKey === "ai_provider") {
      const provider = parseProvider(value);
      if (!provider) fail("未知的 AI 服务");
      updates.push([dbKey, provider]);
    } else if (dbKey === "ai_base_url") {
      const raw = String(value ?? "").trim();
      if (raw) {
        const url = normalizeUrl(raw);
        if (!url) fail("AI 接口地址必须是 http(s) 链接");
        updates.push([dbKey, url.replace(/\/$/, "")]);
      } else {
        updates.push([dbKey, ""]);
      }
    } else if (dbKey === "github_admins") {
      const admins = String(value ?? "")
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter((item) => /^[a-zA-Z0-9-]{1,39}$/.test(item))
        .join(",");
      updates.push([dbKey, admins]);
    } else if (dbKey === "about_content") {
      updates.push([dbKey, text(value, 50000, "关于页面")]);
    } else if (dbKey === "seo_keywords") {
      updates.push([dbKey, text(value, 300, "SEO 关键词")]);
    } else if (dbKey === "banned_words") {
      updates.push([dbKey, text(value, 5000, "屏蔽词")]);
    } else if (dbKey === "site_name") {
      updates.push([dbKey, text(value, 60, "站点名称", true)]);
    } else if (dbKey === "ai_model") {
      const model = text(value, 100, "AI 模型");
      const provider = parseProvider(body.aiProvider) ?? currentSettings.aiProvider;
      updates.push([dbKey, model || defaultModel(provider)]);
    } else {
      const max = dbKey === "site_tagline" ? 160 : dbKey === "site_description" ? 500 : dbKey === "footer_text" ? 300 : 200;
      updates.push([dbKey, text(value, max, "设置项")]);
    }
  }
  if (!updates.length) fail("没有需要保存的设置");

  const statements = updates.map(([key, value]) =>
    db.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(key, value, nowIso()),
  );
  await db.batch(statements);
  const settings = await loadSettings(db);
  return context.json({ settings });
});

adminRoutes.post("/reorder", async (context) => {
  const body = await jsonBody(context);
  const type = body.type;
  if (type !== "sites" && type !== "categories" && type !== "pages") fail("未知的排序类型");
  if (!Array.isArray(body.ids) || body.ids.length === 0) fail("排序列表不能为空");
  const ids = body.ids.map((value) => int(value, 0)).filter((value) => value > 0);
  if (ids.length !== body.ids.length || ids.length > 500) fail("排序列表无效");
  const table = type === "sites" ? "sites" : type === "categories" ? "categories" : "pages";
  await context.env.DB.batch(
    ids.map((id, index) =>
      context.env.DB.prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
        .bind((index + 1) * 10, nowIso(), id),
    ),
  );
  return context.json({ ok: true });
});

export default adminRoutes;
