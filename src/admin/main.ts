import type {
  AdminCategory,
  AdminComment,
  AdminPage,
  AdminSettingsPayload,
  AdminSite,
  AuthConfig,
  AuthUser,
  LinkStatus,
  PaginatedAdminSites,
  SiteSettings,
} from "../../shared/types";
import { categoryIcon, CATEGORY_ICON_GROUPS } from "../lib/categoryIcons";
import { renderMarkdown } from "../lib/markdown";
import "../styles.css";

type Tab = "sites" | "categories" | "pages" | "comments" | "settings";
type CommentFilter = "all" | "pending" | "approved" | "spam";

interface State {
  user: AuthUser | null;
  config: AuthConfig | null;
  tab: Tab;
  categories: AdminCategory[];
  sites: AdminSite[];
  pages: AdminPage[];
  comments: AdminComment[];
  settings: SiteSettings | null;
  aiKeys: Record<string, boolean>;
  githubOauthConfigured: boolean;
  siteQuery: string;
  siteCategory: number | null;
  siteName: string;
  commentFilter: CommentFilter;
  busy: boolean;
}

const state: State = {
  user: null,
  config: null,
  tab: "sites",
  categories: [],
  sites: [],
  pages: [],
  comments: [],
  settings: null,
  aiKeys: {},
  githubOauthConfigured: false,
  siteQuery: "",
  siteCategory: null,
  siteName: "锦囊书签",
  commentFilter: "pending",
  busy: false,
};

const app = document.getElementById("root")!;
const $ = <T extends Element>(selector: string, scope: ParentNode = document) => scope.querySelector<T>(selector);
const $$ = <T extends Element>(selector: string, scope: ParentNode = document) => [...scope.querySelectorAll<T>(selector)];

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function num(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("zh-CN");
}

function statusText(status: LinkStatus): string {
  return status === "alive" ? "正常" : status === "warn" ? "警告" : status === "dead" ? "失效" : "未检测";
}

async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "请求失败";
    throw new Error(message);
  }
  return data as T;
}

function toast(message: string, kind: "ok" | "error" = "ok"): void {
  const el = document.createElement("div");
  el.className = "admin-toast " + kind;
  el.textContent = message;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, 2600);
}

function tabFromPath(): Tab {
  const path = location.pathname.replace(/\/+$/, "");
  if (path.endsWith("/categories")) return "categories";
  if (path.endsWith("/pages")) return "pages";
  if (path.endsWith("/comments")) return "comments";
  if (path.endsWith("/settings")) return "settings";
  return "sites";
}

function pathForTab(tab: Tab): string {
  return "/admin/" + tab;
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "sites", label: "书签" },
  { id: "categories", label: "分类" },
  { id: "pages", label: "独立页面" },
  { id: "comments", label: "评论" },
  { id: "settings", label: "设置" },
];

function frame(content: string): void {
  const user = state.user;
  app.innerHTML =
    '<div class="admin-shell">' +
    '<header class="admin-top"><div class="admin-top__inner">' +
    '<a class="admin-brand" href="/admin/sites" data-admin-tab="sites"><span class="admin-brand__mark">' + esc(state.siteName.slice(0, 1) || "书") + '</span><span>' + esc(state.siteName) + " · 后台</span></a>" +
    '<div class="admin-top__actions"><a class="admin-link" href="/" target="_blank" rel="noopener">查看前台</a>' +
    (user ? '<span class="admin-user">' + esc(user.name || user.login) + '</span><button type="button" class="admin-plain-btn" data-action="logout">退出</button>' : "") +
    "</div></div></header>" +
    '<div class="admin-layout"><aside class="admin-nav">' +
    TABS.map((tab) => '<a class="admin-nav__item' + (tab.id === state.tab ? " active" : "") + '" href="' + pathForTab(tab.id) + '" data-admin-tab="' + tab.id + '">' + tab.label + "</a>").join("") +
    "</aside><main class=\"admin-main\">" + content + "</main></div></div>";
  bindFrame();
}

function bindFrame(): void {
  $$<HTMLAnchorElement>("[data-admin-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const tab = link.dataset.adminTab as Tab | undefined;
      if (tab) navigate(tab);
    });
  });
  $<HTMLElement>('[data-action="logout"]')?.addEventListener("click", logout);
}

function loading(): string {
  return '<div class="admin-loading">正在加载…</div>';
}

async function navigate(tab: Tab, push = true): Promise<void> {
  if (state.busy) return;
  state.tab = tab;
  if (push && location.pathname !== pathForTab(tab)) history.pushState({ tab }, "", pathForTab(tab));
  state.busy = true;
  frame(loading());
  try {
    if (tab === "sites") await loadSites();
    else if (tab === "categories") await loadCategories();
    else if (tab === "pages") await loadPages();
    else if (tab === "comments") await loadComments();
    else await loadSettings();
  } catch (error) {
    toast(error instanceof Error ? error.message : "加载失败", "error");
    frame('<div class="admin-empty">加载失败，请刷新重试。</div>');
  } finally {
    state.busy = false;
  }
}

async function boot(): Promise<void> {
  app.innerHTML = '<div class="admin-boot">正在加载…</div>';
  try {
    const config = await api<AuthConfig>("/api/auth/config");
    state.config = config;
    try {
      const me = await api<{ user: AuthUser | null }>("/api/auth/me");
      state.user = me.user;
    } catch {
      state.user = null;
    }
    if (!state.user) {
      renderLogin();
      return;
    }
    try {
      const nav = await api<{ settings: { siteName: string } }>("/api/nav");
      state.siteName = nav.settings.siteName || state.siteName;
    } catch {
      // keep the default brand if the public nav endpoint fails
    }
    if (location.pathname.replace(/\/+$/, "") === "/admin" || location.pathname === "/admin/") {
      history.replaceState(null, "", "/admin/sites");
    }
    await navigate(tabFromPath(), false);
  } catch {
    app.innerHTML = '<div class="admin-empty">无法连接后台接口，请稍后刷新。</div>';
  }
}

function renderLogin(): void {
  const config = state.config;
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  app.innerHTML =
    '<div class="login-shell"><a class="login-back" href="/">← 返回前台</a><section class="login-card">' +
    '<span class="login-eyebrow">ADMIN</span><h1>锦囊书签后台</h1><p>维护书签、分类、页面、评论和站点设置。</p>' +
    (error ? '<p class="admin-error">登录失败：' + esc(error) + "</p>" : "") +
    (config?.githubEnabled
      ? '<a class="admin-button admin-button--primary login-github" href="/api/auth/github">使用 GitHub 登录</a>'
      : '<p class="admin-muted">GitHub OAuth 尚未配置。</p>') +
    '<p class="login-note">修改会立即写入 D1 数据库。</p></section></div>';
}

async function logout(): Promise<void> {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // logout even if the endpoint fails
  }
  state.user = null;
  renderLogin();
}

function pageHead(title: string, note: string, actions = ""): string {
  return '<div class="admin-page-head"><div><h1>' + esc(title) + '</h1>' + (note ? '<p>' + esc(note) + "</p>" : "") + "</div>" + (actions ? '<div class="admin-actions">' + actions + "</div>" : "") + "</div>";
}

function button(label: string, action: string, kind = "default", id?: number): string {
  return '<button type="button" class="admin-button admin-button--' + kind + '" data-action="' + action + '"' + (id === undefined ? "" : ' data-id="' + id + '"') + ">" + esc(label) + "</button>";
}

/* ---------- sites ---------- */

async function loadSites(): Promise<void> {
  const data = await api<PaginatedAdminSites>("/api/admin/sites?page=1&pageSize=100");
  state.sites = data.sites;
  if (!state.categories.length) await loadCategoryData();
  frame(renderSites());
  bindSites();
}

function categoryFilterOptions(): string {
  const rows: string[] = ['<option value="">全部分类</option>'];
  const walk = (parent: number | null, depth: number) => {
    state.categories
      .filter((category) => category.parentId === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .forEach((category) => {
        rows.push('<option value="' + category.id + '"' + (state.siteCategory === category.id ? " selected" : "") + ">" + "　".repeat(depth) + esc(category.name) + "</option>");
        walk(category.id, depth + 1);
      });
  };
  walk(null, 0);
  return rows.join("");
}

function categoryFilterIds(categoryId: number): Set<number> {
  const ids = new Set<number>([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of state.categories) {
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function siteRows(): AdminSite[] {
  const query = state.siteQuery.trim().toLowerCase();
  const categoryIds = state.siteCategory ? categoryFilterIds(state.siteCategory) : null;
  return state.sites.filter((site) => {
    if (categoryIds && !categoryIds.has(site.categoryId)) return false;
    if (!query) return true;
    return [site.name, site.url, site.categoryName, site.description, site.tags.join(" ")].join(" ").toLowerCase().includes(query);
  });
}

function siteInitial(site: AdminSite): string {
  return esc((site.name || "?").slice(0, 1).toUpperCase());
}

function siteIconUrl(site: AdminSite): string {
  if (site.iconUrl) return site.iconUrl;
  try {
    return "https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=" + encodeURIComponent(new URL(site.url).origin) + "&size=64";
  } catch {
    return "";
  }
}

function siteRowHtml(site: AdminSite, drag: boolean): string {
  const icon = siteIconUrl(site);
  return (
    '<tr data-drag-id="' + site.id + '"' + (drag ? ' draggable="true"' : "") + ">" +
    '<td class="drag-col"><span class="drag-handle" title="' + (drag ? "拖拽排序" : "清除搜索或分类筛选后可拖拽") + '">⠿</span></td>' +
    '<td><div class="site-cell"><span class="site-avatar"><span class="site-avatar__fallback">' + siteInitial(site) + "</span>" +
    (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-admin-site-icon>' : "") +
    '</span><div><b>' + esc(site.name) + "</b><span>" + esc(site.domain) + "</span></div></div></td>" +
    "<td>" + esc(site.categoryName) + "</td>" +
    '<td class="tags-col">' + (site.tags.length ? site.tags.map((tag) => '<span class="admin-tag">' + esc(tag) + "</span>").join("") : '<span class="admin-muted">—</span>') + "</td>" +
    '<td class="num-col">' + num(site.views) + "</td>" +
    '<td><button type="button" class="link-status link-status--' + site.linkStatus + ' link-status--button" data-action="check-site" data-id="' + site.id + '" title="点击重新检测">' + statusText(site.linkStatus) + "</button></td>" +
    '<td class="actions-col"><button type="button" class="admin-text-btn" data-action="edit-site" data-id="' + site.id + '">编辑</button><button type="button" class="admin-text-btn danger" data-action="delete-site" data-id="' + site.id + '">删除</button></td>' +
    "</tr>"
  );
}

function siteTableHtml(rows: AdminSite[], drag: boolean): string {
  return (
    '<table class="admin-table admin-sites-table"><thead><tr><th class="drag-col"></th><th>站点</th><th>分类</th><th class="tags-col">标签</th><th class="num-col">浏览</th><th>状态</th><th class="actions-col">操作</th></tr></thead><tbody id="sites-tbody">' +
    (rows.length ? rows.map((site) => siteRowHtml(site, drag)).join("") : '<tr><td class="admin-empty" colspan="7">没有匹配的书签。</td></tr>') +
    "</tbody></table>"
  );
}

function renderSites(): string {
  const rows = siteRows();
  const drag = !state.siteQuery && !state.siteCategory && state.sites.length > 1;
  return (
    pageHead(
      "书签",
      state.sites.length + " 个站点，拖拽行可调整顺序。",
      '<input class="admin-search" id="site-search" type="search" value="' + esc(state.siteQuery) + '" placeholder="搜索书签" aria-label="搜索书签">' +
        '<select class="admin-filter-select" id="site-category-filter" aria-label="按分类筛选">' + categoryFilterOptions() + "</select>" +
        button("检测链接", "check-links", "ghost") +
        button("新增书签", "new-site", "primary"),
    ) +
    '<div class="admin-table-wrap" id="sites-table-wrap">' + siteTableHtml(rows, drag) + "</div>"
  );
}

function renderSitesTable(): void {
  const wrap = $<HTMLElement>("#sites-table-wrap");
  if (!wrap) return;
  const rows = siteRows();
  const drag = !state.siteQuery && !state.siteCategory && state.sites.length > 1;
  wrap.innerHTML = siteTableHtml(rows, drag);
  if (drag) enableSiteDrag();
  bindSiteRows();
  bindSiteIcons();
}

function bindSites(): void {
  const search = $<HTMLInputElement>("#site-search");
  search?.addEventListener("input", () => {
    state.siteQuery = search.value;
    renderSitesTable();
  });
  const category = $<HTMLSelectElement>("#site-category-filter");
  category?.addEventListener("change", () => {
    state.siteCategory = category.value ? Number(category.value) : null;
    renderSitesTable();
  });
  bindSiteRows();
  bindSiteIcons();
  if (!state.siteQuery && !state.siteCategory) enableSiteDrag();
}

function bindSiteIcons(): void {
  $$<HTMLImageElement>("img[data-admin-site-icon]").forEach((img) => {
    const remove = () => img.remove();
    img.addEventListener("error", remove, { once: true });
    if (img.complete && img.naturalWidth === 0) remove();
  });
}

function bindSiteRows(): void {
  $$<HTMLElement>('[data-action="edit-site"]').forEach((el) =>
    el.addEventListener("click", () => {
      const site = state.sites.find((item) => item.id === Number(el.dataset.id));
      if (site) openSiteForm(site);
    }),
  );
  $$<HTMLElement>('[data-action="delete-site"]').forEach((el) =>
    el.addEventListener("click", () => removeSite(Number(el.dataset.id))),
  );
  $$<HTMLButtonElement>('[data-action="check-site"]').forEach((el) =>
    el.addEventListener("click", () => checkSite(Number(el.dataset.id), el)),
  );
}

async function checkSite(id: number, button: HTMLButtonElement): Promise<void> {
  const previous = button.textContent ?? "";
  button.disabled = true;
  button.textContent = "检测中…";
  try {
    await api("/api/admin/sites/" + id + "/check", { method: "POST", body: {} });
    toast("链接状态已更新");
    await loadSites();
  } catch (error) {
    button.disabled = false;
    button.textContent = previous;
    toast(error instanceof Error ? error.message : "检测失败", "error");
  }
}

function enableSiteDrag(): void {
  const tbody = $<HTMLTableSectionElement>("#sites-tbody");
  if (!tbody) return;
  let dragged: HTMLElement | null = null;
  $$<HTMLTableRowElement>("tr[data-drag-id]", tbody).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      dragged = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.dragId ?? "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
      $$(".dragging, .drag-over", tbody).forEach((el) => el.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      if (!dragged || dragged === row) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragged || dragged === row) return;
      row.classList.remove("drag-over");
      const parent = dragged.parentElement;
      if (!parent) return;
      parent.insertBefore(dragged, row);
      dragged.classList.remove("dragging");
      const ids = $$<HTMLTableRowElement>("tr[data-drag-id]", tbody).map((item) => Number(item.dataset.dragId));
      void reorder("sites", ids);
    });
  });
}

async function reorder(type: "sites" | "categories" | "pages", ids: number[]): Promise<void> {
  try {
    await api("/api/admin/reorder", { method: "POST", body: { type, ids } });
    await navigate(state.tab, false);
  } catch (error) {
    toast(error instanceof Error ? error.message : "排序保存失败", "error");
    await navigate(state.tab, false);
  }
}

async function removeSite(id: number): Promise<void> {
  if (!window.confirm("确定删除这个书签吗？相关评论也会删除。")) return;
  try {
    await api("/api/admin/sites/" + id, { method: "DELETE" });
    toast("书签已删除");
    await loadSites();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

function categoryOptions(selected?: number): string {
  const rows: string[] = [];
  const walk = (parent: number | null, depth: number) => {
    state.categories
      .filter((category) => category.parentId === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .forEach((category) => {
        rows.push('<option value="' + category.id + '"' + (category.id === selected ? " selected" : "") + ">" + "　".repeat(depth) + esc(category.name) + "</option>");
        walk(category.id, depth + 1);
      });
  };
  walk(null, 0);
  return rows.join("");
}

function openSiteForm(site?: AdminSite): void {
  const editing = Boolean(site);
  const selectedTags = [...new Set(site?.tags ?? [])];
  const knownTags = [...new Set(state.sites.flatMap((item) => item.tags))]
    .filter((tag) => !selectedTags.includes(tag))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  openDrawer(
    editing ? "编辑书签" : "新增书签",
    '<form class="admin-form" data-form="site" data-id="' + (site?.id ?? "") + '">' +
      '<div class="form-grid">' +
      field("站点名称", '<input name="name" required maxlength="80" value="' + esc(site?.name ?? "") + '">') +
      field("网址", '<input name="url" type="url" required value="' + esc(site?.url ?? "") + '">') +
      field("分类", '<select name="categoryId" required>' + categoryOptions(site?.categoryId) + "</select>") +
      "</div>" +
      '<div class="form-field full"><span>标签</span><div class="tag-editor" data-tag-editor>' +
      '<div class="tag-chips" data-tag-chips></div>' +
      '<div class="tag-input-row"><input id="site-tag-input" list="site-tag-options" autocomplete="off" placeholder="输入新标签后回车，或点击下方已有标签"><button type="button" class="admin-button admin-button--ghost" data-action="add-site-tag">添加</button></div>' +
      '<datalist id="site-tag-options">' + [...new Set([...selectedTags, ...knownTags])].map((tag) => '<option value="' + esc(tag) + '"></option>').join("") + "</datalist>" +
      '<div class="tag-suggestions" data-tag-suggestions></div>' +
      '<input type="hidden" name="tags" value="' + esc(selectedTags.join(", ")) + '">' +
      "</div></div>" +
      field("简介", '<textarea name="description" rows="4" maxlength="1200" placeholder="留空保存时自动生成">' + esc(site?.description ?? "") + "</textarea>", "full") +
      '<div class="form-field full"><div class="md-field-head"><span>详情介绍</span><button type="button" class="admin-text-btn" data-action="preview-detail">预览 Markdown</button></div>' +
      '<textarea name="detailContent" rows="10" data-detail-content>' + esc(site?.detailContent ?? "") + "</textarea>" +
      '<div class="md-preview" data-detail-preview hidden></div></div>' +
      '<div class="form-grid">' + field("图标地址（选填）", '<input name="iconUrl" value="' + esc(site?.iconUrl ?? "") + '">') + field("截图地址（选填）", '<input name="screenshotUrl" value="' + esc(site?.screenshotUrl ?? "") + '">') + "</div>" +
      '<div class="drawer-actions">' + (editing ? '<button type="button" class="admin-button admin-button--ghost" data-action="ai-site" data-id="' + site!.id + '">AI 重写简介</button>' : "") + '<button type="submit" class="admin-button admin-button--primary">保存书签</button></div>' +
      "</form>",
  );
  bindSiteTagEditor(selectedTags, knownTags);
  bindDetailPreview();
}

function bindSiteTagEditor(selected: string[], known: string[]): void {
  const editor = $<HTMLElement>("[data-tag-editor]");
  if (!editor) return;
  const values = [...selected];
  const chips = $<HTMLElement>("[data-tag-chips]", editor)!;
  const suggestions = $<HTMLElement>("[data-tag-suggestions]", editor)!;
  const input = $<HTMLInputElement>("#site-tag-input", editor)!;
  const hidden = $<HTMLInputElement>('input[name="tags"]', editor)!;

  const render = () => {
    chips.innerHTML = values.length
      ? values.map((tag) => '<span class="tag-chip">' + esc(tag) + '<button type="button" data-action="remove-site-tag" data-tag="' + esc(tag) + '" aria-label="删除标签">×</button></span>').join("")
      : '<span class="tag-empty">还没有标签</span>';
    const remaining = known.filter((tag) => !values.includes(tag));
    suggestions.innerHTML = remaining.length
      ? '<span class="tag-suggest-label">已有标签</span>' + remaining.slice(0, 24).map((tag) => '<button type="button" class="tag-suggest" data-action="suggest-site-tag" data-tag="' + esc(tag) + '">' + esc(tag) + "</button>").join("")
      : "";
    hidden.value = values.join(", ");
  };

  const add = (raw: string) => {
    const tag = raw.trim().slice(0, 24);
    if (!tag || values.includes(tag) || values.length >= 12) return;
    values.push(tag);
    input.value = "";
    render();
  };

  editor.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!target) return;
    if (target.dataset.action === "add-site-tag") add(input.value);
    else if (target.dataset.action === "suggest-site-tag") add(target.dataset.tag ?? "");
    else if (target.dataset.action === "remove-site-tag") {
      const index = values.indexOf(target.dataset.tag ?? "");
      if (index >= 0) values.splice(index, 1);
      render();
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add(input.value);
    }
  });
  render();
}

function bindDetailPreview(): void {
  const button = $<HTMLButtonElement>('[data-action="preview-detail"]');
  const textarea = $<HTMLTextAreaElement>("[data-detail-content]");
  const preview = $<HTMLElement>("[data-detail-preview]");
  if (!button || !textarea || !preview) return;
  button.addEventListener("click", () => {
    if (preview.hidden) {
      preview.innerHTML = renderMarkdown(textarea.value) || '<p class="admin-muted">暂无内容</p>';
      preview.hidden = false;
      textarea.hidden = true;
      button.textContent = "返回编辑";
    } else {
      preview.hidden = true;
      textarea.hidden = false;
      button.textContent = "预览 Markdown";
    }
  });
}

/* ---------- categories ---------- */

async function loadCategoryData(): Promise<void> {
  const data = await api<{ categories: AdminCategory[] }>("/api/admin/categories");
  state.categories = data.categories;
}

async function loadCategories(): Promise<void> {
  await loadCategoryData();
  frame(renderCategories());
  bindCategoryActions();
}

function categoryTree(): Array<{ category: AdminCategory; depth: number }> {
  const out: Array<{ category: AdminCategory; depth: number }> = [];
  const walk = (parent: number | null, depth: number) => {
    state.categories
      .filter((category) => category.parentId === parent)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .forEach((category) => {
        out.push({ category, depth });
        walk(category.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

function renderCategories(): string {
  const rows = categoryTree();
  return (
    pageHead("分类", "拖拽同级分类调整顺序。", button("新增分类", "new-category", "primary")) +
    '<div class="admin-list">' +
    (rows.length
      ? rows
          .map(
            ({ category, depth }) =>
              '<div class="category-row" data-drag-id="' + category.id + '" data-parent="' + (category.parentId ?? "root") + '" data-depth="' + depth + '" draggable="true" style="padding-left:' + (10 + depth * 22) + 'px">' +
              '<span class="drag-handle">⠿</span><span class="category-icon">' + esc((category.icon || "folder").slice(0, 1).toUpperCase()) + "</span>" +
              '<div class="category-main"><b>' + esc(category.name) + "</b><span>/" + esc(category.slug) + " · " + category.directSiteCount + " 个书签</span></div>" +
              '<div class="row-actions"><button type="button" class="admin-text-btn" data-action="edit-category" data-id="' + category.id + '">编辑</button><button type="button" class="admin-text-btn danger" data-action="delete-category" data-id="' + category.id + '">删除</button></div></div>',
          )
          .join("")
      : '<div class="admin-empty">还没有分类。</div>') +
    "</div>"
  );
}

function bindCategoryActions(): void {
  $$<HTMLElement>('[data-action="edit-category"]').forEach((el) =>
    el.addEventListener("click", () => {
      const category = state.categories.find((item) => item.id === Number(el.dataset.id));
      if (category) openCategoryForm(category);
    }),
  );
  $$<HTMLElement>('[data-action="delete-category"]').forEach((el) => el.addEventListener("click", () => removeCategory(Number(el.dataset.id))));
  enableCategoryDrag();
}

function categoryOptionsExcept(selected: number | undefined, excludeId?: number): string {
  const rows: string[] = ['<option value="">无（顶级分类）</option>'];
  const walk = (parent: number | null, depth: number) => {
    state.categories
      .filter((category) => category.parentId === parent && category.id !== excludeId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .forEach((category) => {
        rows.push('<option value="' + category.id + '"' + (category.id === selected ? " selected" : "") + ">" + "　".repeat(depth) + esc(category.name) + "</option>");
        walk(category.id, depth + 1);
      });
  };
  walk(null, 0);
  return rows.join("");
}

function openCategoryForm(category?: AdminCategory): void {
  openDrawer(
    category ? "编辑分类" : "新增分类",
    '<form class="admin-form" data-form="category" data-id="' + (category?.id ?? "") + '">' +
      '<div class="form-grid">' +
      field("分类名称", '<input name="name" required maxlength="40" value="' + esc(category?.name ?? "") + '">') +
      field("上级分类", '<select name="parentId">' + categoryOptionsExcept(category?.parentId ?? undefined, category?.id) + "</select>") +
      field("分类路径（选填）", '<input name="slug" value="' + esc(category?.slug ?? "") + '">') +
      "</div>" +
      '<div class="form-field full"><span>图标</span><input type="hidden" name="icon" value="' + esc(category?.icon ?? "folder") + '"><button type="button" class="icon-trigger" data-icon-trigger>' +
      '<span class="icon-trigger__preview">' + categoryIcon(category?.icon ?? "folder", 22) + "</span>" +
      '<span class="icon-trigger__name" data-icon-name>' + esc(category?.icon ?? "folder") + "</span>" +
      '<span class="icon-trigger__hint">选择图标</span></button></div>' +
      field("分类描述", '<textarea name="description" rows="3" maxlength="300">' + esc(category?.description ?? "") + "</textarea>", "full") +
      '<div class="drawer-actions"><button type="submit" class="admin-button admin-button--primary">保存分类</button></div></form>',
  );
  bindIconPicker();
}

function bindIconPicker(): void {
  const trigger = $<HTMLButtonElement>("[data-icon-trigger]");
  if (!trigger) return;
  trigger.addEventListener("click", () => openIconModal(trigger));
}

function openIconModal(trigger: HTMLButtonElement): void {
  const field = trigger.closest(".form-field");
  const hidden = field?.querySelector<HTMLInputElement>('input[name="icon"]');
  const name = field?.querySelector<HTMLElement>("[data-icon-name]");
  const preview = field?.querySelector<HTMLElement>(".icon-trigger__preview");
  if (!hidden) return;
  const current = hidden.value || "folder";
  const modal = document.createElement("div");
  modal.className = "admin-icon-modal";
  modal.innerHTML =
    '<button type="button" class="admin-icon-modal__scrim" data-close-icon-modal aria-label="关闭"></button>' +
    '<section class="admin-icon-modal__panel" role="dialog" aria-modal="true" aria-label="选择分类图标">' +
    '<header class="admin-icon-modal__head"><h2>选择分类图标</h2><button type="button" class="admin-icon-btn" data-close-icon-modal aria-label="关闭">×</button></header>' +
    '<div class="admin-icon-modal__body">' +
    CATEGORY_ICON_GROUPS.map(
      (group) =>
        '<div class="icon-group"><span class="icon-group__label">' + esc(group.label) + '</span><div class="icon-group__grid">' +
        group.icons
          .map(
            (icon) =>
              '<button type="button" class="icon-choice' + (current === icon ? " selected" : "") + '" data-pick-icon="' + icon + '" title="' + icon + '" aria-label="' + icon + '">' + categoryIcon(icon, 20) + "</button>",
          )
          .join("") +
        "</div></div>",
    ).join("") +
    "</div></section>";
  document.body.append(modal);
  const close = () => modal.remove();
  $$<HTMLElement>("[data-close-icon-modal]", modal).forEach((el) => el.addEventListener("click", close));
  modal.addEventListener("click", (event) => {
    const choice = (event.target as Element).closest<HTMLElement>("[data-pick-icon]");
    if (!choice) return;
    const icon = choice.dataset.pickIcon ?? "folder";
    hidden.value = icon;
    if (name) name.textContent = icon;
    if (preview) preview.innerHTML = categoryIcon(icon, 22);
    close();
  });
}

async function removeCategory(id: number): Promise<void> {
  if (!window.confirm("确定删除这个分类吗？")) return;
  try {
    await api("/api/admin/categories/" + id, { method: "DELETE" });
    toast("分类已删除");
    await loadCategories();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

function enableCategoryDrag(): void {
  const list = $<HTMLElement>(".admin-list");
  if (!list) return;
  let dragged: HTMLElement | null = null;
  $$<HTMLElement>(".category-row", list).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      dragged = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.dragId ?? "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
      $$(".dragging, .drag-over", list).forEach((el) => el.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      if (!dragged || dragged === row) return;
      if (dragged.dataset.parent !== row.dataset.parent) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragged || dragged === row || dragged.dataset.parent !== row.dataset.parent) {
        toast("只能在同级分类内拖拽排序", "error");
        return;
      }
      row.classList.remove("drag-over");
      const parent = dragged.dataset.parent;
      const all = $$<HTMLElement>(".category-row", list);
      const from = all.indexOf(dragged);
      const depth = Number(dragged.dataset.depth ?? 0);
      let end = from + 1;
      while (end < all.length && Number(all[end].dataset.depth ?? 0) > depth) end += 1;
      const moving = all.slice(from, end);
      if (moving.includes(row)) {
        toast("不能把分类拖到自己的子分类里", "error");
        return;
      }
      for (const item of moving) list.insertBefore(item, row);
      const ids = $$<HTMLElement>('.category-row[data-parent="' + parent + '"]', list).map((item) =>
        Number(item.dataset.dragId),
      );
      void reorder("categories", ids);
    });
  });
}

/* ---------- pages ---------- */

async function loadPages(): Promise<void> {
  const data = await api<{ pages: AdminPage[] }>("/api/admin/pages");
  state.pages = data.pages;
  frame(renderPages());
  bindPageActions();
}

function renderPages(): string {
  return (
    pageHead("独立页面", "拖拽调整导航顺序，关于页固定最后。", button("新增页面", "new-page", "primary")) +
    '<div class="admin-list">' +
    state.pages
      .map(
        (page) =>
          '<div class="page-row" data-drag-id="' + page.id + '" draggable="true"><span class="drag-handle">⠿</span><div class="page-main"><b>' + esc(page.title) + "</b><span>/page/" + esc(page.slug) + " · " + num(page.views) + ' 次浏览</span></div><span class="admin-badge ' + (page.isPublished ? "ok" : "") + '">' + (page.isPublished ? "已发布" : "草稿") + "</span><div class=\"row-actions\"><button type=\"button\" class=\"admin-text-btn\" data-action=\"edit-page\" data-id=\"" + page.id + '">编辑</button><button type="button" class="admin-text-btn danger" data-action="delete-page" data-id="' + page.id + '">删除</button></div></div>',
      )
      .join("") +
    (state.pages.length ? "" : '<div class="admin-empty">还没有独立页面。</div>') +
    '<div class="page-row page-row--about"><span class="drag-handle muted">·</span><div class="page-main"><b>关于</b><span>/about · 固定显示在最后</span></div><span class="admin-badge">固定</span><div class="row-actions"><button type="button" class="admin-text-btn" data-action="about-settings">去设置编辑</button></div></div>' +
    "</div>"
  );
}

function bindPageActions(): void {
  $$<HTMLElement>('[data-action="edit-page"]').forEach((el) =>
    el.addEventListener("click", () => {
      const page = state.pages.find((item) => item.id === Number(el.dataset.id));
      if (page) openPageForm(page);
    }),
  );
  $$<HTMLElement>('[data-action="delete-page"]').forEach((el) => el.addEventListener("click", () => removePage(Number(el.dataset.id))));
  $<HTMLElement>('[data-action="about-settings"]')?.addEventListener("click", () => navigate("settings"));
  enablePageDrag();
}

function openPageForm(page?: AdminPage): void {
  openDrawer(
    page ? "编辑页面" : "新增页面",
    '<form class="admin-form" data-form="page" data-id="' + (page?.id ?? "") + '">' +
      '<div class="form-grid">' + field("页面标题", '<input name="title" required maxlength="80" value="' + esc(page?.title ?? "") + '">') + field("路径（选填）", '<input name="slug" maxlength="80" value="' + esc(page?.slug ?? "") + '" placeholder="自动生成">') + "</div>" +
      field("摘要", '<input name="excerpt" maxlength="300" value="' + esc(page?.excerpt ?? "") + '">', "full") +
      field("页面内容（Markdown）", '<textarea name="content" rows="16">' + esc(page?.content ?? "") + "</textarea>", "full") +
      '<div class="form-inline"><label class="check-row"><input type="checkbox" name="showInNav" ' + (page?.showInNav === false ? "" : "checked") + "> 显示在导航</label><label class=\"check-row\"><input type=\"checkbox\" name=\"isPublished\" " + (page?.isPublished === false ? "" : "checked") + "> 发布</label></div>" +
      '<div class="drawer-actions"><button type="submit" class="admin-button admin-button--primary">保存页面</button></div></form>',
  );
}

async function removePage(id: number): Promise<void> {
  if (!window.confirm("确定删除这个页面吗？相关评论也会删除。")) return;
  try {
    await api("/api/admin/pages/" + id, { method: "DELETE" });
    toast("页面已删除");
    await loadPages();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

function enablePageDrag(): void {
  const list = $<HTMLElement>(".admin-list");
  if (!list) return;
  let dragged: HTMLElement | null = null;
  $$<HTMLElement>(".page-row[data-drag-id]", list).forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      dragged = row;
      row.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", row.dataset.dragId ?? "");
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      dragged = null;
      $$(".dragging, .drag-over", list).forEach((el) => el.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (event) => {
      if (!dragged || dragged === row) return;
      event.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!dragged || dragged === row) return;
      row.classList.remove("drag-over");
      row.before(dragged);
      const ids = $$<HTMLElement>(".page-row[data-drag-id]", list).map((item) => Number(item.dataset.dragId));
      void reorder("pages", ids);
    });
  });
}

/* ---------- comments ---------- */

async function loadComments(): Promise<void> {
  const data = await api<{ comments: AdminComment[]; total: number }>(
    "/api/admin/comments?status=" + state.commentFilter + "&page=1&pageSize=50",
  );
  state.comments = data.comments;
  frame(renderComments(data.total));
  bindCommentActions();
}

function renderComments(total: number): string {
  const filters: Array<[CommentFilter, string]> = [
    ["pending", "待审核"],
    ["approved", "已发布"],
    ["spam", "垃圾"],
    ["all", "全部"],
  ];
  return (
    pageHead("评论", total + " 条记录，站点与独立页面评论统一审核。") +
    '<div class="admin-filter">' +
    filters.map(([id, label]) => '<button type="button" class="admin-filter__btn' + (state.commentFilter === id ? " active" : "") + '" data-comment-filter="' + id + '">' + label + "</button>").join("") +
    "</div>" +
    '<div class="comment-admin-list">' +
    (state.comments.length
      ? state.comments
          .map(
            (comment) =>
              '<article class="comment-admin"><div class="comment-admin__head"><div><b>' + esc(comment.author) + "</b><span>" + esc(comment.email || "未留邮箱") + " · " + shortDate(comment.createdAt) + "</span></div><span class=\"admin-badge\">" + (comment.status === "approved" ? "已发布" : comment.status === "spam" ? "垃圾" : "待审核") + "</span></div>" +
              '<p>' + esc(comment.content) + "</p>" +
              '<div class="comment-admin__meta">评论于 <a href="' + (comment.targetType === "page" ? "/page/" : "/site/") + encodeURIComponent(comment.targetSlug) + '" target="_blank" rel="noopener">' + esc(comment.targetName) + "</a>" + (comment.website ? ' · <a href="' + esc(comment.website) + '" target="_blank" rel="noopener">个人主页</a>' : "") + "</div>" +
              '<div class="comment-admin__actions">' +
              (comment.status !== "approved" ? '<button type="button" class="admin-text-btn" data-action="comment-status" data-id="' + comment.id + '" data-status="approved">通过</button>' : "") +
              (comment.status !== "spam" ? '<button type="button" class="admin-text-btn" data-action="comment-status" data-id="' + comment.id + '" data-status="spam">垃圾</button>' : "") +
              (comment.status !== "pending" ? '<button type="button" class="admin-text-btn" data-action="comment-status" data-id="' + comment.id + '" data-status="pending">待审</button>' : "") +
              '<button type="button" class="admin-text-btn danger" data-action="delete-comment" data-id="' + comment.id + '">删除</button>' +
              "</div></article>",
          )
          .join("")
      : '<div class="admin-empty">这里还没有评论。</div>') +
    "</div>"
  );
}

function bindCommentActions(): void {
  $$<HTMLButtonElement>("[data-comment-filter]").forEach((el) =>
    el.addEventListener("click", () => {
      state.commentFilter = el.dataset.commentFilter as CommentFilter;
      void loadComments();
    }),
  );
  $$<HTMLElement>('[data-action="comment-status"]').forEach((el) =>
    el.addEventListener("click", () => setCommentStatus(Number(el.dataset.id), el.dataset.status ?? "pending")),
  );
  $$<HTMLElement>('[data-action="delete-comment"]').forEach((el) => el.addEventListener("click", () => removeComment(Number(el.dataset.id))));
}

async function setCommentStatus(id: number, status: string): Promise<void> {
  try {
    await api("/api/admin/comments/" + id, { method: "PATCH", body: { status } });
    toast("评论状态已更新");
    await loadComments();
  } catch (error) {
    toast(error instanceof Error ? error.message : "更新失败", "error");
  }
}

async function removeComment(id: number): Promise<void> {
  if (!window.confirm("确定永久删除这条评论吗？")) return;
  try {
    await api("/api/admin/comments/" + id, { method: "DELETE" });
    toast("评论已删除");
    await loadComments();
  } catch (error) {
    toast(error instanceof Error ? error.message : "删除失败", "error");
  }
}

/* ---------- settings ---------- */

async function loadSettings(): Promise<void> {
  const data = await api<AdminSettingsPayload>("/api/admin/settings");
  state.settings = data.settings;
  state.siteName = data.settings.siteName || state.siteName;
  state.aiKeys = data.aiKeys as unknown as Record<string, boolean>;
  state.githubOauthConfigured = data.githubOauthConfigured;
  frame(renderSettings());
  bindSettings();
}

function field(label: string, input: string, className = ""): string {
  return '<label class="form-field ' + className + '"><span>' + esc(label) + "</span>" + input + "</label>";
}

function selectProvider(value: string): string {
  return ["pollinations", "openai", "deepseek", "gemini"]
    .map((provider) => '<option value="' + provider + '"' + (provider === value ? " selected" : "") + ">" + provider + "</option>")
    .join("");
}

function renderSettings(): string {
  const s = state.settings!;
  const aiConfigured = Object.entries(state.aiKeys)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .join("、");
  return (
    pageHead("设置", "前台文案、评论策略和 AI 配置。") +
    '<form class="admin-form settings-form" data-form="settings">' +
    '<section class="settings-section"><h2>站点信息</h2><div class="form-grid">' +
    field("站点名称", '<input name="siteName" required maxlength="60" value="' + esc(s.siteName) + '">') +
    field("一句话介绍", '<input name="siteTagline" maxlength="160" value="' + esc(s.siteTagline) + '">') +
    "</div>" +
    field("站点描述", '<textarea name="siteDescription" rows="3" maxlength="500">' + esc(s.siteDescription) + "</textarea>", "full") +
    field("页脚文案", '<input name="footerText" maxlength="300" value="' + esc(s.footerText) + '">', "full") +
    field("SEO 关键词", '<input name="seoKeywords" maxlength="300" value="' + esc(s.seoKeywords) + '">', "full") +
    "</section>" +
    '<section class="settings-section"><h2>关于页面</h2>' + field("内容（Markdown）", '<textarea name="aboutContent" rows="12">' + esc(s.aboutContent) + "</textarea>", "full") + "</section>" +
    '<section class="settings-section"><h2>评论</h2><div class="form-inline"><label class="check-row"><input type="checkbox" name="commentsEnabled" ' + (s.commentsEnabled ? "checked" : "") + "> 启用评论</label><label class=\"check-row\"><input type=\"checkbox\" name=\"commentModeration\" " + (s.commentModeration ? "checked" : "") + "> 审核后发布</label></div>" + field("屏蔽词（逗号分隔）", '<textarea name="bannedWords" rows="3">' + esc(s.bannedWords) + "</textarea>", "full") + "</section>" +
    '<section class="settings-section"><h2>AI 简介</h2><div class="form-grid">' +
    field("服务", '<select name="aiProvider">' + selectProvider(s.aiProvider) + "</select>") +
    field("模型", '<input name="aiModel" value="' + esc(s.aiModel) + '">') +
    field("接口地址（选填）", '<input name="aiBaseUrl" value="' + esc(s.aiBaseUrl) + '">') +
    "</div><p class=\"admin-muted\">" + (aiConfigured ? "已检测到密钥：" + esc(aiConfigured) : "未检测到 AI 密钥，自动简介会跳过。") + "</p></section>" +
    '<section class="settings-section"><h2>管理员</h2>' + field("GitHub 管理员（逗号分隔）", '<input name="githubAdmins" value="' + esc(s.githubAdmins) + '">', "full") + '<p class="admin-muted">' + (state.githubOauthConfigured ? "GitHub OAuth 已配置。" : "GitHub OAuth 尚未配置。") + "</p></section>" +
    '<div class="drawer-actions"><button type="submit" class="admin-button admin-button--primary">保存设置</button></div></form>'
  );
}

function bindSettings(): void {
  // Form submit is handled globally.
}

/* ---------- drawer/forms ---------- */

function openDrawer(title: string, body: string): void {
  document.body.classList.add("admin-drawer-open");
  const wrapper = document.createElement("div");
  wrapper.className = "admin-drawer";
  wrapper.innerHTML =
    '<button type="button" class="admin-drawer__scrim" data-action="close-drawer" aria-label="关闭"></button>' +
    '<section class="admin-drawer__panel" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
    '<header class="admin-drawer__head"><h2>' + esc(title) + '</h2><button type="button" class="admin-icon-btn" data-action="close-drawer" aria-label="关闭">×</button></header>' +
    '<div class="admin-drawer__body">' + body + "</div></section>";
  document.body.append(wrapper);
  $<HTMLElement>(".admin-drawer__panel")?.addEventListener("click", (event) => event.stopPropagation());
  $$<HTMLElement>('[data-action="close-drawer"]', wrapper).forEach((el) => el.addEventListener("click", closeDrawer));
  $<HTMLElement>('[data-action="ai-site"]')?.addEventListener("click", generateSiteDescription);
}

function closeDrawer(): void {
  document.body.classList.remove("admin-drawer-open");
  $(".admin-drawer")?.remove();
}

async function generateSiteDescription(): Promise<void> {
  const id = $<HTMLElement>('[data-action="ai-site"]')?.dataset.id;
  if (!id) return;
  const buttonEl = $<HTMLButtonElement>('[data-action="ai-site"]');
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "生成中…";
  }
  try {
    const result = await api<{ description: string; provider: string }>("/api/admin/sites/" + id + "/generate-description", { method: "POST", body: {} });
    const textarea = $<HTMLTextAreaElement>('textarea[name="description"]');
    if (textarea) textarea.value = result.description;
    toast("简介已生成");
  } catch (error) {
    toast(error instanceof Error ? error.message : "生成失败", "error");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "AI 重写简介";
    }
  }
}

function formValue(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function formChecked(data: FormData, name: string): boolean {
  return data.get(name) === "on";
}

async function submitSiteForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = form.dataset.id;
  const payload = {
    name: formValue(data, "name"),
    url: formValue(data, "url"),
    categoryId: Number(formValue(data, "categoryId")),
    description: formValue(data, "description"),
    tags: formValue(data, "tags")
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    iconUrl: formValue(data, "iconUrl"),
    screenshotUrl: formValue(data, "screenshotUrl"),
    detailContent: formValue(data, "detailContent"),
  };
  try {
    await api(id ? "/api/admin/sites/" + id : "/api/admin/sites", { method: id ? "PUT" : "POST", body: payload });
    closeDrawer();
    toast(id ? "书签已更新" : "书签已创建");
    await loadSites();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

async function submitCategoryForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = form.dataset.id;
  const payload = {
    name: formValue(data, "name"),
    parentId: formValue(data, "parentId") ? Number(formValue(data, "parentId")) : null,
    icon: formValue(data, "icon"),
    slug: formValue(data, "slug"),
    description: formValue(data, "description"),
  };
  try {
    await api(id ? "/api/admin/categories/" + id : "/api/admin/categories", { method: id ? "PUT" : "POST", body: payload });
    closeDrawer();
    toast(id ? "分类已更新" : "分类已创建");
    await loadCategories();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

async function submitPageForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const id = form.dataset.id;
  const payload = {
    title: formValue(data, "title"),
    slug: formValue(data, "slug"),
    excerpt: formValue(data, "excerpt"),
    content: formValue(data, "content"),
    showInNav: formChecked(data, "showInNav"),
    isPublished: formChecked(data, "isPublished"),
  };
  try {
    await api(id ? "/api/admin/pages/" + id : "/api/admin/pages", { method: id ? "PUT" : "POST", body: payload });
    closeDrawer();
    toast(id ? "页面已更新" : "页面已创建");
    await loadPages();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

async function submitSettingsForm(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const payload = {
    siteName: formValue(data, "siteName"),
    siteTagline: formValue(data, "siteTagline"),
    siteDescription: formValue(data, "siteDescription"),
    footerText: formValue(data, "footerText"),
    seoKeywords: formValue(data, "seoKeywords"),
    aboutContent: formValue(data, "aboutContent"),
    commentsEnabled: formChecked(data, "commentsEnabled"),
    commentModeration: formChecked(data, "commentModeration"),
    bannedWords: formValue(data, "bannedWords"),
    aiProvider: formValue(data, "aiProvider"),
    aiModel: formValue(data, "aiModel"),
    aiBaseUrl: formValue(data, "aiBaseUrl"),
    githubAdmins: formValue(data, "githubAdmins"),
  };
  try {
    await api("/api/admin/settings", { method: "PUT", body: payload });
    toast("设置已保存");
    await loadSettings();
  } catch (error) {
    toast(error instanceof Error ? error.message : "保存失败", "error");
  }
}

/* ---------- global events ---------- */

document.addEventListener("submit", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "site") void submitSiteForm(form);
  else if (kind === "category") void submitCategoryForm(form);
  else if (kind === "page") void submitPageForm(form);
  else if (kind === "settings") void submitSettingsForm(form);
});

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "close-drawer") {
    closeDrawer();
    return;
  }
  if (action === "new-site") openSiteForm();
  else if (action === "new-category") openCategoryForm();
  else if (action === "new-page") openPageForm();
  else if (action === "check-links") void checkLinks();
});

async function checkLinks(): Promise<void> {
  try {
    toast("正在检测，请稍候…");
    const result = await api<{ checked: number }>("/api/admin/check-all", { method: "POST", body: { limit: 10 } });
    toast("已检测 " + result.checked + " 个链接");
    await loadSites();
  } catch (error) {
    toast(error instanceof Error ? error.message : "检测失败", "error");
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

window.addEventListener("popstate", () => {
  if (!state.user) return;
  void navigate(tabFromPath(), false);
});

void boot();
