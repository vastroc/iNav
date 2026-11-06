import "./styles.css";
import { categoryIcon } from "../lib/categoryIcons";
import { renderMarkdown } from "../lib/markdown";
import type {
  CaptchaChallenge,
  Category,
  CommentSubmitResult,
  CommentsPayload,
  NavPayload,
  PublicComment,
  PublicPage,
  RecentComment,
  Site,
  SiteDetail,
} from "../../shared/types";

const appRoot = document.getElementById("app")!;

type Theme = "light" | "dark";
type SortMode = "manual" | "name" | "views";

interface CommentValues {
  author: string;
  email: string;
  website: string;
  content: string;
  answer: string;
}

interface CommentState {
  targetType: "site" | "page";
  targetSlug: string;
  page: number;
  total: number;
  comments: PublicComment[];
  captcha: CaptchaChallenge | null;
  captchaError: string;
  startedAt: number;
  loadingMore: boolean;
  busy: boolean;
  notice: string;
  error: string;
  values: CommentValues;
}

interface AppState {
  nav: NavPayload | null;
  navError: string;
  expanded: Set<number>;
  more: number;
  theme: Theme;
  comments: CommentState | null;
  routeSeq: number;
  commentSeq: number;
}

const state: AppState = {
  nav: null,
  navError: "",
  expanded: new Set<number>(),
  more: 120,
  theme:
    document.documentElement.dataset.theme === "dark"
      ? "dark"
      : localStorage.getItem("iNav-theme") === "dark"
        ? "dark"
        : "light",
  comments: null,
  routeSeq: 0,
  commentSeq: 0,
};

const numberFormat = new Intl.NumberFormat("zh-CN");

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function num(value: number | null | undefined): string {
  return numberFormat.format(Number(value ?? 0));
}

function compact(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (n < 10000) return String(n);
  return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "万";
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  let normalized = value.trim();
  if (!normalized.includes("T")) normalized = normalized.replace(" ", "T") + "Z";
  else if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) normalized += "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function timeAgo(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + " 分钟前";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " 小时前";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + " 天前";
  const months = Math.floor(days / 30);
  if (months < 12) return months + " 个月前";
  return Math.floor(months / 12) + " 年前";
}

function eyeIcon(): string {
  return (
    '<svg class="eye-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' +
    "</svg>"
  );
}

function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function faviconFor(site: Site | SiteDetail): string {
  if (site.iconUrl) return site.iconUrl;
  try {
    return "https://t3.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=" +
      encodeURIComponent(new URL(site.url).origin) +
      "&size=64";
  } catch {
    return "";
  }
}

function screenshotFor(site: SiteDetail): { src: string; fallback: string; automatic: boolean } {
  if (site.screenshotUrl) return { src: site.screenshotUrl, fallback: "", automatic: false };
  return {
    src: "https://s0.wp.com/mshots/v1/" + encodeURIComponent(site.url) + "?w=1200&h=675",
    fallback: "https://image.thum.io/get/width/1200/crop/800/noanimate/" + site.url,
    automatic: true,
  };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // keep text response
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : "请求失败（" + response.status + "）";
    throw new Error(message);
  }
  return data as T;
}

function setMeta(name: string, content: string, property = false): void {
  const selector = property ? 'meta[property="' + name + '"]' : 'meta[name="' + name + '"]';
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    if (property) element.setAttribute("property", name);
    else element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function themeIcon(theme: Theme): string {
  const path =
    theme === "dark"
      ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/>'
      : '<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8Z"/>';
  return (
    '<svg class="theme-svg" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    path +
    "</svg>"
  );
}

function applyTheme(theme: Theme): void {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#131313" : "#f5f5f5");
  try {
    localStorage.setItem("iNav-theme", theme);
  } catch {
    // ignore storage errors
  }
  const next = theme === "dark" ? "浅色" : "深色";
  document.querySelectorAll<HTMLButtonElement>('[data-action="theme"]').forEach((button) => {
    button.setAttribute("aria-label", "切换到" + next);
    button.title = "切换到" + next;
    const icon = button.querySelector<HTMLElement>("[data-theme-icon]");
    if (icon) icon.innerHTML = themeIcon(theme);
  });
}

function trackJump(siteId: number): void {
  if (!Number.isFinite(siteId)) return;
  void fetch("/api/sites/" + siteId + "/jump", {
    method: "POST",
    keepalive: true,
  }).catch(() => {
    // A failed beacon should never block the outbound link.
  });
}

function trackView(path: string): void {
  try {
    const key = "inav:view:" + path;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    // ignore storage errors
  }
  void fetch("/api/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}

function flattenCategories(categories: Category[]): Category[] {
  const result: Category[] = [];
  const walk = (items: Category[]) => {
    for (const item of items) {
      result.push(item);
      if (item.children?.length) walk(item.children);
    }
  };
  walk(categories);
  return result;
}

function findCategory(categories: Category[], slug: string | null): Category | null {
  if (!slug) return null;
  for (const category of categories) {
    if (category.slug === slug) return category;
    if (category.children?.length) {
      const found = findCategory(category.children, slug);
      if (found) return found;
    }
  }
  return null;
}

function descendantIds(categories: Category[], rootId: number): Set<number> {
  const ids = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function parentIds(categories: Category[]): number[] {
  return flattenCategories(categories)
    .filter((category) => category.children?.length)
    .map((category) => category.id);
}

function homeHref(changes: Record<string, string | null>): string {
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return query ? "/?" + query : "/";
}

function tagHref(tag: string): string {
  return "/?tag=" + encodeURIComponent(tag);
}

function themeButton(): string {
  const next = state.theme === "dark" ? "浅色" : "深色";
  return (
    '<button type="button" class="theme-toggle" data-action="theme" aria-label="切换到' +
    next +
    '" title="切换到' +
    next +
    '"><span class="theme-icon" data-theme-icon>' +
    themeIcon(state.theme) +
    "</span></button>"
  );
}

function renderHeader(): string {
  const settings = state.nav?.settings;
  const pages = (state.nav?.pages ?? []).filter((page) => page.showInNav).slice(0, 6);
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const pageLinks = pages
    .map((page) => {
      const href = "/page/" + encodeURIComponent(page.slug);
      const active = path === href;
      return '<a href="' + href + '" data-link' + (active ? ' class="active"' : "") + ">" + esc(page.title) + "</a>";
    })
    .join("");
  return (
    '<header class="top"><div class="wrap top-inner">' +
    '<a class="brand" href="/" data-link><span class="brand-mark">' +
    esc((settings?.siteName ?? "锦囊书签").slice(0, 1)) +
    "</span><span>" +
    esc(settings?.siteName ?? "锦囊书签") +
    "</span></a>" +
    '<nav class="nav">' +
    '<a href="/" data-link' + (path === "/" ? ' class="active"' : "") + ">首页</a>" +
    pageLinks +
    '<a href="/about" data-link' + (path === "/about" ? ' class="active"' : "") + ">关于</a>" +
    "</nav>" +
    '<div class="top-links">' + themeButton() + "</div></div></header>"
  );
}

function renderFooter(): string {
  const settings = state.nav?.settings;
  const pages = (state.nav?.pages ?? []).filter((page) => page.showInNav).slice(0, 4);
  return (
    '<footer class="footer"><div class="wrap footer-inner">' +
    "<span>" + esc(settings?.footerText ?? "保持好奇，常回来看看。") + "</span>" +
    '<span class="footer-links">' +
    pages.map((page) => '<a href="/page/' + encodeURIComponent(page.slug) + '" data-link>' + esc(page.title) + "</a>").join("") +
    "<a href=\"/about\" data-link>关于</a>" +
    "</span></div>" +
    '<div class="wrap footer-copy">© ' + new Date().getFullYear() + " " +
    esc(settings?.siteName ?? "锦囊书签") + " 其名为碰</div></footer>"
  );
}

function shell(main: string, title: string, description?: string): void {
  appRoot.innerHTML =
    renderHeader() +
    "<main>" +
    main +
    "</main>" +
    renderFooter() +
    '<button type="button" class="floating-cats" data-action="open-cats">' +
    categoryIcon("layout") +
    "分类</button>";
  document.title = title;
  const settings = state.nav?.settings;
  setMeta("description", description || settings?.siteDescription || "");
  setMeta("og:title", title, true);
  setMeta("og:description", description || settings?.siteDescription || "", true);
}

function navigate(url: string, replace = false): void {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  state.more = 120;
  document.body.classList.remove("cats-open");
  window.scrollTo(0, 0);
  void renderRoute();
}

async function boot(): Promise<void> {
  appRoot.innerHTML = '<div class="boot">正在加载站点索引…</div>';
  try {
    const nav = await api<NavPayload>("/api/nav");
    state.nav = nav;
    state.navError = "";
    state.expanded = new Set(parentIds(nav.categories));
    await renderRoute();
  } catch (error) {
    state.navError = error instanceof Error ? error.message : "导航数据加载失败";
    appRoot.innerHTML =
      '<div class="wrap error-box"><p>' + esc(state.navError) +
      '</p><button type="button" class="btn primary" data-action="reload-nav">重新加载</button></div>';
  }
}

async function renderRoute(): Promise<void> {
  const seq = ++state.routeSeq;
  state.comments = null;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/") {
    renderHome();
    trackView("/");
    return;
  }
  if (path === "/about") {
    renderAbout();
    trackView("/about");
    return;
  }
  const siteMatch = path.match(/^\/site\/([^/]+)$/);
  if (siteMatch) {
    await renderSitePage(decodeURIComponent(siteMatch[1]), seq);
    return;
  }
  const pageMatch = path.match(/^\/page\/([^/]+)$/);
  if (pageMatch) {
    await renderStandalonePage(decodeURIComponent(pageMatch[1]), seq);
    return;
  }
  renderNotFound();
}



function renderCategoryNodes(categories: Category[], selectedSlug: string | null): string {
  return categories
    .map((category) => {
      const hasChildren = Boolean(category.children?.length);
      const open = state.expanded.has(category.id);
      const active = selectedSlug === category.slug;
      const toggle = hasChildren
        ? '<button type="button" class="cat-toggle" data-action="toggle-cat" data-id="' +
          category.id +
          '" aria-label="' +
          (open ? "收起" : "展开") +
          " " +
          esc(category.name) +
          '">' +
          (open ? "−" : "+") +
          "</button>"
        : '<span class="cat-toggle cat-toggle--empty"></span>';
      const href = homeHref({ cat: category.slug, q: null, tag: null });
      return (
        "<li>" +
        '<div class="cat-row' + (active ? " active" : "") + '">' +
        toggle +
        '<a class="cat-link" href="' + esc(href) + '" data-link>' +
        '<span class="cat-icon-wrap">' + categoryIcon(category.icon) + "</span>" +
        '<span class="cat-name">' + esc(category.name) + "</span>" +
        '<span class="cat-count">' + num(category.siteCount) + "</span>" +
        "</a></div>" +
        (hasChildren && open ? '<ul class="cat-children">' + renderCategoryNodes(category.children!, selectedSlug) + "</ul>" : "") +
        "</li>"
      );
    })
    .join("");
}

function renderSidebar(categories: Category[], selectedSlug: string | null, totalSites: number): string {
  return (
    '<button type="button" class="sidebar-scrim" data-action="close-cats" aria-label="关闭分类"></button>' +
    '<aside class="sidebar" aria-label="站点分类">' +
    '<div class="sidebar-head"><button type="button" class="sidebar-close" data-action="close-cats">关闭</button></div>' +
    '<ul class="cat-list">' +
    '<li><a class="cat-all' + (selectedSlug ? "" : " active") + '" href="/" data-link><span class="cat-icon-wrap">' +
    categoryIcon("layout") +
    '</span><span>全部站点</span><span class="cat-count">' +
    num(totalSites) +
    "</span></a></li>" +
    renderCategoryNodes(categories, selectedSlug) +
    "</ul></aside>"
  );
}

function renderCard(site: Site, showCategory: boolean): string {
  const icon = faviconFor(site);
  const description = site.description || "暂无简介。";
  const tags = site.tags
    .slice(0, 3)
    .map((tag) => '<a class="tag" href="' + esc(tagHref(tag)) + '" data-link>' + esc(tag) + "</a>")
    .join("");
  const moreTags = site.tags.length > 3 ? '<span class="tag">+' + (site.tags.length - 3) + "</span>" : "";
  const category = showCategory && site.categoryName
    ? '<a class="card-cat" href="/?cat=' + encodeURIComponent(site.categorySlug) + '" data-link title="查看分类：' +
      esc(site.categoryName) +
      '">' +
      categoryIcon("folder") +
      esc(site.categoryName) +
      "</a>"
    : "";
  const detail = site.detailEnabled
    ? '<a class="detail-link" href="/site/' + encodeURIComponent(site.slug) + '" data-link>查看详情</a>'
    : "";
  return (
    '<article class="card">' +
    '<a class="card-body" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + site.id + '">' +
    '<div class="card-head">' +
    '<span class="site-icon"><span class="fallback">' + esc(initialOf(site.name)) + "</span>" +
    (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-icon>' : "") +
    "</span>" +
    '<span class="card-title-wrap"><span class="card-title">' + esc(site.name) + "</span></span>" +
    "</div>" +
    '<span class="card-domain">' + esc(site.domain) + "</span>" +
    '<p class="card-desc">' + esc(description) + "</p>" +
    "</a>" +
    '<div class="card-corner">' +
    '<span class="corner-stat" title="浏览量 ' + num(site.views) + '">' +
    eyeIcon() + compact(site.views) +
    "</span></div>" +
    (category ? '<div class="card-cat-row">' + category + "</div>" : "") +
    '<div class="card-bottom"><div class="card-tags"><div class="tag-track">' + tags + moreTags + (site.aiGenerated ? '<span class="tag ai" title="简介由 AI 生成">AI 生成</span>' : "") + "</div></div>" +
    detail +
    "</div></article>"
  );
}

function prepareCardEnhancements(): void {
  document.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    const desc = card.querySelector<HTMLElement>(".card-desc");
    if (desc && desc.scrollHeight > desc.clientHeight + 1) {
      card.title = desc.textContent ?? "";
    }
    const box = card.querySelector<HTMLElement>(".card-tags");
    const track = box?.querySelector<HTMLElement>(".tag-track");
    if (!box || !track) return;
    const overflow = track.scrollWidth - box.clientWidth;
    if (overflow > 2) {
      box.classList.add("is-overflow");
      box.style.setProperty("--tag-shift", "-" + (overflow + 4) + "px");
    }
  });
}

function renderRightRail(nav: NavPayload): string {
  const hot = [...nav.sites].sort((a, b) => b.views - a.views).slice(0, 5);
  const totalSiteViews = nav.sites.reduce((sum, site) => sum + site.views, 0);
  return (
    '<aside class="right-rail" aria-label="站点动态">' +
    '<section class="rail-section"><h2 class="rail-title">最近评论</h2>' +
    '<div class="rail-comment-list" id="recent-comments"><p class="rail-empty">加载中…</p></div></section>' +
    '<section class="rail-section"><h2 class="rail-title">热门站点</h2><div class="rail-hot-list">' +
    hot
      .map(
        (site, index) =>
          '<a class="rail-hot-row" href="/site/' + encodeURIComponent(site.slug) + '" data-link>' +
          '<span class="rail-rank">' + String(index + 1).padStart(2, "0") + "</span>" +
          '<span class="rail-site">' + esc(site.name) + "</span>" +
          '<span class="rail-views">' + eyeIcon() + compact(site.views) + "</span></a>",
      )
      .join("") +
    "</div></section>" +
    '<section class="rail-section"><h2 class="rail-title">站点概览</h2><div class="rail-stats">' +
    "<span><b>" + num(nav.stats.totalSites) + "</b>站点</span>" +
    "<span><b>" + num(totalSiteViews) + "</b>站点浏览</span>" +
    "<span><b>" + num(nav.stats.totalComments) + "</b>评论</span>" +
    "</div></section>" +
    '<button type="button" class="rail-random" data-action="random-site">随机逛一个</button>' +
    "</aside>"
  );
}

async function loadRecentComments(): Promise<void> {
  const box = document.getElementById("recent-comments");
  if (!box) return;
  try {
    const data = await api<{ comments: RecentComment[] }>("/api/recent-comments?limit=4");
    if (!box.isConnected) return;
    if (!data.comments.length) {
      box.innerHTML = '<p class="rail-empty">还没有公开评论。</p>';
      return;
    }
    box.innerHTML = data.comments
      .map((comment) => {
        const base = comment.targetType === "page" ? "/page/" : "/site/";
        const href = base + encodeURIComponent(comment.targetSlug) + "#comment-" + comment.id;
        return (
          '<a class="rail-comment" href="' + href + '" data-link>' +
          '<span class="rail-comment-head"><b>' + esc(comment.author) + "</b><time>" + timeAgo(comment.createdAt) + "</time></span>" +
          '<span class="rail-comment-text">' + esc(comment.content) + "</span>" +
          '<span class="rail-comment-site">' + esc(comment.targetName) + "</span></a>"
        );
      })
      .join("");
  } catch {
    if (box.isConnected) box.innerHTML = '<p class="rail-empty">评论加载失败。</p>';
  }
}

function renderHome(): void {
  const nav = state.nav;
  if (!nav) return;

  const params = new URLSearchParams(location.search);
  const selectedSlug = params.get("cat");
  const selected = findCategory(nav.categories, selectedSlug);
  const activeSlug = selected?.slug ?? null;
  const search = (params.get("q") ?? "").trim();
  const activeTag = params.get("tag") ?? "";
  const requestedSort = params.get("sort");
  const sort: SortMode =
    requestedSort === "name" || requestedSort === "views" ? requestedSort : "manual";
  const flat = flattenCategories(nav.categories);
  const scope = selected ? descendantIds(flat, selected.id) : null;
  const needle = search.toLowerCase();

  const filtered = nav.sites.filter((site) => {
    if (scope && !scope.has(site.categoryId)) return false;
    if (activeTag && !site.tags.includes(activeTag)) return false;
    if (!needle) return true;
    return [site.name, site.description, site.domain, site.categoryName, ...site.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
    if (sort === "views") return b.views - a.views || a.sortOrder - b.sortOrder;
    return a.sortOrder - b.sortOrder || a.id - b.id;
  });

  const views = filtered.reduce((sum, site) => sum + site.views, 0);
  const shown = filtered.slice(0, state.more);
  const hasFilters = Boolean(activeSlug || search || activeTag);
  const metaDescription = selected
    ? selected.description || nav.settings.siteDescription
    : nav.settings.siteDescription;

  const sortButton = (value: SortMode, label: string) =>
    '<button type="button" data-action="sort" data-value="' + value + '"' +
    (sort === value ? ' class="active"' : "") +
    ">" + label + "</button>";

  const tagLinks = nav.tags
    .slice(0, 20)
    .map((tag) => {
      const active = tag === activeTag;
      return '<a class="tag' + (active ? " active" : "") + '" href="' +
        esc(homeHref({ tag: active ? null : tag })) +
        '" data-link>' + esc(tag) + "</a>";
    })
    .join("");

  const cards = shown.map((site) => renderCard(site, !selected)).join("");

  const main =
    '<div class="wrap home-wrap"><div class="layout">' +
    renderSidebar(nav.categories, activeSlug, nav.stats.totalSites) +
    '<section class="content">' +
    '<div class="toolbar">' +
    '<div class="sort-box"><span class="sort-label">排序</span><div class="sort-options">' +
    sortButton("manual", "时间") + sortButton("name", "名称") + sortButton("views", "浏览") +
    "</div></div>" +
    '<form class="search" data-search><input type="search" name="q" value="' + esc(search) + '" placeholder="搜索站点、描述或标签" aria-label="搜索站点"><button type="submit">搜索</button></form>' +
    "</div>" +
    (tagLinks ? '<div class="tags-bar"><span>标签</span>' + tagLinks + "</div>" : "") +
    '<div class="result-meta"><span>共 <b>' + num(filtered.length) + "</b> 个站点 · " + num(views) + " 次浏览" + (hasFilters ? " · 已筛选" : "") + "</span>" +
    (hasFilters ? '<a class="link-btn" href="/" data-link>清除筛选</a>' : "") +
    "</div>" +
    (filtered.length === 0
      ? '<div class="empty"><h2>没有找到匹配的站点</h2><p>换个关键词，或回到全部站点看看。</p><a class="btn small" href="/" data-link>查看全部</a></div>'
      : '<div class="grid">' + cards + "</div>") +
    (shown.length < filtered.length
      ? '<div class="more-row"><button type="button" class="btn" data-action="more">显示更多（剩余 ' + num(filtered.length - shown.length) + " 个）</button></div>"
      : "") +
    "</section>" +
    renderRightRail(nav) +
    "</div></div>";

  shell(main, selected ? selected.name + " - " + nav.settings.siteName : nav.settings.siteName, metaDescription);
  prepareCardEnhancements();
  void loadRecentComments();
}



function renderCommentItem(comment: PublicComment): string {
  const author = comment.website
    ? '<a class="comment-author" href="' + esc(comment.website) + '" target="_blank" rel="noopener noreferrer">' + esc(comment.author) + "</a>"
    : '<b class="comment-author">' + esc(comment.author) + "</b>";
  return (
    '<article class="comment" id="comment-' + comment.id + '">' +
    '<span class="comment-avatar">' + esc(initialOf(comment.author)) + "</span>" +
    '<div class="comment-body"><header>' + author +
    '<a class="comment-time" href="#comment-' + comment.id + '"><time>' + timeAgo(comment.createdAt) + "</time></a></header>" +
    "<p>" + esc(comment.content) + "</p></div></article>"
  );
}

function renderCommentsBox(cs: CommentState): void {
  if (state.comments !== cs) return;
  const box = document.getElementById("comments-box");
  if (!box) return;
  const nav = state.nav;
  const enabled = nav?.settings.commentsEnabled ?? true;
  const moderation = nav?.settings.commentModeration ?? true;
  const captcha =
    cs.captcha && !cs.captchaError
      ? '<span class="captcha-question">验证：' + esc(cs.captcha.question) + '</span>' +
        '<button type="button" class="link-btn" data-action="refresh-captcha">换一题</button>' +
        '<input type="number" name="answer" required value="' + esc(cs.values.answer) + '" placeholder="答案" aria-label="验证码答案">'
      : '<span class="form-msg">' + esc(cs.captchaError || "验证码加载中…") + '</span>' +
        '<button type="button" class="link-btn" data-action="refresh-captcha">重试</button>';
  const form = enabled
    ? '<form class="comment-form" data-comment-form>' +
      '<div class="row"><input type="text" name="author" required maxlength="24" placeholder="你的称呼" value="' + esc(cs.values.author) + '">' +
      '<input type="email" name="email" required maxlength="120" placeholder="邮箱（必填，不公开）" value="' + esc(cs.values.email) + '">' +
      '<input type="text" name="website" maxlength="300" inputmode="url" placeholder="个人网址（选填）" value="' + esc(cs.values.website) + '"></div>' +
      '<textarea name="content" required minlength="5" maxlength="800" placeholder="写下你的使用体验或补充（5-800 字）">' + esc(cs.values.content) + "</textarea>" +
      '<input class="hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<div class="captcha-row">' + captcha +
      '<button type="submit" class="btn primary small"' + (cs.busy || !cs.captcha ? " disabled" : "") + ">" + (cs.busy ? "提交中…" : "发表评论") + "</button></div>" +
      (cs.notice ? '<p class="form-msg ok">' + esc(cs.notice) + "</p>" : "") +
      (cs.error ? '<p class="form-msg">' + esc(cs.error) + "</p>" : "") +
      '<p class="comment-note">' + (moderation ? "审核后展示 · " : "") + "邮箱不会公开；填写个人网址后，点击用户名可访问。</p>" +
      "</form>"
    : '<p class="comment-note">评论功能暂时关闭。</p>';
  const list = cs.comments.length
    ? '<div class="comment-list">' + cs.comments.map(renderCommentItem).join("") + "</div>"
    : '<p class="comments-empty">还没有评论。</p>';
  const more =
    cs.comments.length < cs.total
      ? '<div class="comments-more"><button type="button" class="btn small" data-action="load-comments"' +
        (cs.loadingMore ? " disabled" : "") +
        ">" + (cs.loadingMore ? "加载中…" : "加载更多评论（" + (cs.total - cs.comments.length) + "）") + "</button></div>"
      : "";
  box.innerHTML =
    '<div class="comments-head"><h2>评论</h2><small>' + num(cs.total) + " 条" + (moderation ? " · 审核后展示" : "") + "</small></div>" +
    form +
    (cs.error && !enabled ? '<p class="form-msg">' + esc(cs.error) + "</p>" : "") +
    list +
    more;
  if (location.hash.startsWith("#comment-") || location.hash === "#comments-box") {
    requestAnimationFrame(scrollToCommentHash);
  }
}

function scrollToCommentHash(): void {
  const hash = location.hash;
  if (!hash) return;
  const target = document.getElementById(hash.slice(1));
  if (target) target.scrollIntoView({ block: "center" });
}

async function fetchCaptcha(cs: CommentState): Promise<void> {
  try {
    cs.captcha = await api<CaptchaChallenge>("/api/captcha");
    cs.captchaError = "";
  } catch (error) {
    cs.captcha = null;
    cs.captchaError = error instanceof Error ? error.message : "验证码加载失败";
  }
}

async function loadCommentPage(cs: CommentState, page: number, append: boolean): Promise<void> {
  if (state.comments !== cs) return;
  if (append) cs.loadingMore = true;
  try {
    const base =
      (cs.targetType === "site" ? "/api/sites/" : "/api/pages/") + encodeURIComponent(cs.targetSlug) + "/comments";
    const data = await api<CommentsPayload>(base + "?page=" + page + "&pageSize=20");
    if (state.comments !== cs) return;
    cs.comments = append ? cs.comments.concat(data.comments) : data.comments;
    cs.total = data.total;
    cs.page = data.page;
    if (append) cs.error = "";
  } catch (error) {
    if (state.comments === cs) cs.error = error instanceof Error ? error.message : "评论加载失败";
  } finally {
    if (state.comments === cs) {
      cs.loadingMore = false;
      renderCommentsBox(cs);
    }
  }
}

async function initComments(target: { type: "site" | "page"; slug: string }): Promise<void> {
  const seq = ++state.commentSeq;
  const nav = state.nav;
  if (!nav) return;
  const enabled = nav.settings.commentsEnabled;
  let author = "";
  try {
    author = localStorage.getItem("iNav-comment-name") ?? "";
  } catch {
    author = "";
  }
  const cs: CommentState = {
    targetType: target.type,
    targetSlug: target.slug,
    page: 1,
    total: 0,
    comments: [],
    captcha: null,
    captchaError: "",
    startedAt: Date.now(),
    loadingMore: false,
    busy: false,
    notice: "",
    error: "",
    values: { author, email: "", website: "", content: "", answer: "" },
  };
  state.comments = cs;
  const commentBase =
    (target.type === "site" ? "/api/sites/" : "/api/pages/") + encodeURIComponent(target.slug) + "/comments";
  try {
    const list = await api<CommentsPayload>(commentBase + "?page=1&pageSize=20");
    if (state.commentSeq !== seq || state.comments !== cs) return;
    cs.comments = list.comments;
    cs.total = list.total;
    cs.page = list.page;
  } catch (error) {
    if (state.comments !== cs) return;
    cs.error = error instanceof Error ? error.message : "评论加载失败";
  }
  if (enabled) await fetchCaptcha(cs);
  if (state.commentSeq !== seq || state.comments !== cs) return;
  renderCommentsBox(cs);
}

async function submitComment(form: HTMLFormElement): Promise<void> {
  const cs = state.comments;
  if (!cs || cs.busy) return;
  const data = new FormData(form);
  cs.values.author = String(data.get("author") ?? "").trim();
  cs.values.email = String(data.get("email") ?? "").trim();
  cs.values.website = String(data.get("website") ?? "").trim();
  cs.values.content = String(data.get("content") ?? "").trim();
  cs.values.answer = String(data.get("answer") ?? "").trim();
  cs.notice = "";
  cs.error = "";
  if (!cs.captcha) {
    cs.error = "验证码尚未加载完成";
    renderCommentsBox(cs);
    return;
  }
  if (!cs.values.author || !cs.values.email || cs.values.content.length < 5) {
    cs.error = "请填写称呼、邮箱和至少 5 个字的评论";
    renderCommentsBox(cs);
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cs.values.email)) {
    cs.error = "请填写有效的邮箱地址";
    renderCommentsBox(cs);
    return;
  }
  cs.busy = true;
  renderCommentsBox(cs);
  try {
    const commentBase =
      (cs.targetType === "site" ? "/api/sites/" : "/api/pages/") + encodeURIComponent(cs.targetSlug) + "/comments";
    const result = await api<CommentSubmitResult>(commentBase, {
      method: "POST",
      body: JSON.stringify({
        author: cs.values.author,
        email: cs.values.email,
        website: cs.values.website,
        content: cs.values.content,
        company: String(data.get("company") ?? ""),
        captchaToken: cs.captcha.token,
        captchaAnswer: Number(cs.values.answer),
        startedAt: cs.startedAt,
      }),
    });
    if (state.comments !== cs) return;
    cs.notice = result.message;
    cs.values.content = "";
    cs.values.answer = "";
    cs.startedAt = Date.now();
    try {
      localStorage.setItem("iNav-comment-name", cs.values.author);
    } catch {
      // ignore
    }
    await loadCommentPage(cs, 1, false);
    await fetchCaptcha(cs);
  } catch (error) {
    if (state.comments !== cs) return;
    cs.error = error instanceof Error ? error.message : "评论提交失败";
    await fetchCaptcha(cs);
  } finally {
    if (state.comments === cs) {
      cs.busy = false;
      renderCommentsBox(cs);
    }
  }
}

function renderSitePage(slug: string, seq: number): Promise<void> {
  return (async () => {
    shell('<div class="wrap"><div class="empty">正在加载站点…</div></div>', "加载中");
    try {
      const site = await api<SiteDetail>("/api/sites/" + encodeURIComponent(slug));
      if (seq !== state.routeSeq) return;
      const shot = screenshotFor(site);
      const related = (state.nav?.sites ?? [])
        .filter((item) => item.categoryId === site.categoryId && item.id !== site.id)
        .slice(0, 6);
      const trail = site.categoryPath
        .map((category, index) =>
          index === site.categoryPath.length - 1
            ? esc(category.name)
            : '<a href="' + esc(homeHref({ cat: category.slug, q: null, tag: null })) + '" data-link>' + esc(category.name) + "</a>",
        )
        .join(" / ");
      const article = site.detailContent
        ? renderMarkdown(site.detailContent)
        : '<p class="comment-note">这个站点还没有补充更多介绍。</p>';
      const shotBlock =
        '<figure class="shot">' +
        (shot.src
          ? '<img class="shot-img" src="' + esc(shot.src) + '"' +
            (shot.fallback ? ' data-fallback-src="' + esc(shot.fallback) + '"' : "") +
            ' alt="' + esc(site.name) + ' 网站截图" loading="eager" referrerpolicy="no-referrer" data-shot>'
          : "") +
        '<div class="shot-fallback"' + (shot.src ? " hidden" : "") + ">截图暂不可用，可在后台手动填写截图地址</div>" +
        "<figcaption>" + (shot.automatic ? "网站截图由免费截图 API 自动生成，首次可能较慢；可在后台设置截图地址覆盖。" : "后台自定义网站截图。") + "</figcaption></figure>";
      const main =
        '<div class="wrap"><div class="detail-wrap">' +
        '<div class="breadcrumb"><a href="/" data-link>全部</a> / ' + trail + "</div>" +
        '<div class="detail-top">' +
        '<span class="site-icon lg"><span class="fallback">' + esc(initialOf(site.name)) + "</span>" +
        (faviconFor(site) ? '<img src="' + esc(faviconFor(site)) + '" alt="" referrerpolicy="no-referrer" data-icon>' : "") +
        "</span>" +
        '<div class="detail-head"><div class="detail-title-row"><h1 class="detail-title">' + esc(site.name) + "</h1>" +
        '<span class="detail-view-badge" title="网站跳转次数">' + eyeIcon() + "<b>" + num(site.views) + "</b> 次跳转</span>" +
        '<span class="detail-view-badge detail-date-badge" title="收录日期">收录于 ' + formatDate(site.createdAt) + "</span></div>" +
        '<a class="detail-domain" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + site.id + '">' + esc(site.domain) + "</a>" +
        '<p class="detail-desc">' + esc(site.description) + "</p>" +
        '<div class="detail-tags">' + site.tags.map((tag) => '<a class="tag" href="' + esc(tagHref(tag)) + '" data-link>' + esc(tag) + "</a>").join("") +
        (site.aiGenerated ? '<span class="tag" title="简介由 AI 生成">AI 生成</span>' : "") + "</div></div>" +
        '<div class="detail-actions"><a class="btn primary" href="' + esc(site.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + site.id + '">访问网站</a>' +
        '<button type="button" class="btn" data-action="copy-link">复制链接</button></div></div>' +
        shotBlock +
        '<section class="article"><h2>关于 ' + esc(site.name) + '</h2><div class="markdown">' + article + "</div></section>" +
        (related.length
          ? '<section class="related"><h2>同分类站点</h2><div class="related-list">' +
            related.map((item) => '<a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" data-site-jump="' + item.id + '">' + esc(item.name) + "</a>").join("") +
            "</div></section>"
          : "") +
        '<section class="comments" id="comments-box"><p class="comments-empty">评论加载中…</p></section>' +
        "</div></div>";
      shell(main, site.name + " - " + (state.nav?.settings.siteName ?? "锦囊书签"), site.description);
      trackView("/site/" + site.slug);
      void initComments({ type: "site", slug: site.slug });
    } catch {
      if (seq !== state.routeSeq) return;
      renderNotFound("没有找到这个站点", "它可能没有开启独立介绍页，或者已经被移除。");
    }
  })();
}



function renderAbout(): void {
  const nav = state.nav;
  if (!nav) return;
  const s = nav.settings;
  const main =
    '<div class="wrap"><div class="page-wrap">' +
    '<h1 class="page-title">' + esc(s.siteName) + "</h1>" +
    '<p class="page-desc">' + esc(s.siteTagline) + "</p>" +
    '<div class="about-stats">' +
    '<div class="about-stat"><b>' + num(nav.stats.totalSites) + '</b><span>收录站点</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.totalViews) + '</b><span>全站浏览</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.totalComments) + '</b><span>公开评论</span></div>' +
    '<div class="about-stat"><b>' + num(nav.stats.todayViews) + '</b><span>今日浏览</span></div></div>' +
    '<div class="markdown">' + renderMarkdown(s.aboutContent) + "</div>" +
    "</div></div>";
  shell(main, "关于 - " + s.siteName, s.siteDescription);
}

async function renderStandalonePage(slug: string, seq: number): Promise<void> {
  shell('<div class="wrap"><div class="empty">正在加载页面…</div></div>', "加载中");
  try {
    const page = await api<PublicPage>("/api/pages/" + encodeURIComponent(slug));
    if (seq !== state.routeSeq) return;
    const main =
      '<div class="wrap"><div class="page-wrap">' +
      '<h1 class="page-title">' + esc(page.title) + "</h1>" +
      '<div class="page-meta"><span>更新于 ' + formatDate(page.updatedAt) + "</span>" +
      "<span>该页被浏览 <b>" + num(page.views) + "</b> 次</span></div>" +
      (page.excerpt ? '<p class="page-desc">' + esc(page.excerpt) + "</p>" : "") +
      '<div class="markdown">' + renderMarkdown(page.content) + "</div>" +
      '<section class="comments" id="comments-box"><p class="comments-empty">评论加载中…</p></section>' +
      "</div></div>";
    shell(main, page.title + " - " + (state.nav?.settings.siteName ?? "锦囊书签"), page.excerpt);
    trackView("/page/" + page.slug);
    void initComments({ type: "page", slug: page.slug });
  } catch {
    if (seq !== state.routeSeq) return;
    renderNotFound("没有找到这个页面", "它可能尚未发布，或者地址已经改变。");
  }
}

function renderNotFound(title = "页面不存在", note = "这个地址没有对应的内容。"): void {
  shell(
    '<div class="wrap"><div class="page-wrap"><div class="error-box"><h1 class="page-title">' + esc(title) + "</h1><p>" +
      esc(note) +
      '</p><a class="btn" href="/" data-link>返回首页</a></div></div></div>',
    title,
  );
}



function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  const siteLink = target.closest<HTMLAnchorElement>("a[data-site-jump]");
  if (siteLink && event.button === 0) trackJump(Number(siteLink.dataset.siteJump));
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = target.closest<HTMLAnchorElement>("a[data-link]");
  if (link) {
    const href = link.getAttribute("href");
    if (href && href.startsWith("/")) {
      event.preventDefault();
      navigate(href);
    }
    return;
  }
  const control = target.closest<HTMLElement>("[data-action]");
  if (!control) return;
  const action = control.dataset.action;
  if (action === "theme") {
    applyTheme(state.theme === "dark" ? "light" : "dark");
    return;
  }
  if (action === "open-cats") {
    document.body.classList.add("cats-open");
    return;
  }
  if (action === "close-cats") {
    document.body.classList.remove("cats-open");
    return;
  }
  if (action === "reload-nav") {
    void boot();
    return;
  }
  if (action === "toggle-cat") {
    const id = Number(control.dataset.id);
    if (!Number.isFinite(id)) return;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    if (location.pathname === "/") renderHome();
    return;
  }
  if (action === "sort" && location.pathname === "/") {
    const value = control.dataset.value;
    if (value === "manual" || value === "name" || value === "views") {
      navigate(homeHref({ sort: value === "manual" ? null : value }));
    }
    return;
  }
  if (action === "more") {
    state.more += 120;
    renderHome();
    return;
  }
  if (action === "random-site") {
    const sites = state.nav?.sites ?? [];
    if (sites.length) {
      const site = sites[Math.floor(Math.random() * sites.length)];
      navigate("/site/" + encodeURIComponent(site.slug));
    }
    return;
  }
  if (action === "copy-link") {
    void navigator.clipboard
      .writeText(location.href)
      .then(() => {
        control.textContent = "已复制";
        window.setTimeout(() => {
          control.textContent = "复制链接";
        }, 1600);
      })
      .catch(() => {
        control.textContent = "复制失败";
      });
    return;
  }
  if (action === "refresh-captcha" && state.comments) {
    const cs = state.comments;
    void fetchCaptcha(cs).then(() => renderCommentsBox(cs));
    return;
  }
  if (action === "load-comments" && state.comments) {
    const cs = state.comments;
    if (!cs.loadingMore) void loadCommentPage(cs, cs.page + 1, true);
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.matches("[data-search]")) {
    event.preventDefault();
    const value = String(new FormData(form).get("q") ?? "").trim();
    navigate(homeHref({ q: value || null }));
    return;
  }
  if (form.matches("[data-comment-form]")) {
    event.preventDefault();
    void submitComment(form);
  }
});

document.addEventListener("input", (event) => {
  const cs = state.comments;
  if (!cs) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;
  if (!target.form?.matches("[data-comment-form]")) return;
  const name = target.name;
  if (name === "author" || name === "content" || name === "answer") {
    cs.values[name] = target.value;
  }
});

document.addEventListener(
  "error",
  (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    if (image.matches("[data-icon]")) {
      image.style.display = "none";
    }
    if (image.matches("[data-shot]")) {
      const fallbackSrc = image.dataset.fallbackSrc;
      if (fallbackSrc) {
        delete image.dataset.fallbackSrc;
        image.src = fallbackSrc;
        return;
      }
      image.style.display = "none";
      const fallback = image.parentElement?.querySelector(".shot-fallback");
      fallback?.removeAttribute("hidden");
    }
  },
  true,
);

document.addEventListener("auxclick", (event) => {
  if (event.button !== 1) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-site-jump]");
  if (link) trackJump(Number(link.dataset.siteJump));
});

window.addEventListener("popstate", () => {
  state.more = 120;
  document.body.classList.remove("cats-open");
  window.scrollTo(0, 0);
  void renderRoute();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    document.body.classList.remove("cats-open");
    return;
  }
  if (event.key === "/" && !isTypingTarget(event.target)) {
    const input = document.querySelector<HTMLInputElement>(".search input");
    if (input) {
      event.preventDefault();
      input.focus();
    }
  }
});

applyTheme(state.theme);
void boot();

