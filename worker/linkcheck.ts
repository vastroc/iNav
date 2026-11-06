import type { LinkCheckResult, LinkStatus } from "../shared/types";
import type { Env } from "./env";
import { normalizeUrl, nowIso } from "./utils";

interface CheckSiteRow {
  id: number;
  name: string;
  url: string;
}

const USER_AGENT = "iNav-LinkChecker/1.0 (+https://github.com; public navigation health check)";
const TIMEOUT_MS = 6000;

function statusForCode(code: number): LinkStatus {
  if (code >= 200 && code < 400) return "alive";
  if (code === 401 || code === 403 || code === 405 || code === 429) return "warn";
  if (code >= 400 && code < 500) return "dead";
  if (code >= 500) return "dead";
  return "warn";
}

async function request(url: string, method: "HEAD" | "GET"): Promise<Response> {
  return fetch(url, {
    method,
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

export async function checkOneSite(env: Env, site: CheckSiteRow, trigger = "manual"): Promise<LinkCheckResult> {
  const startedAt = Date.now();
  const safeUrl = normalizeUrl(site.url);
  let status: LinkStatus = "dead";
  let statusCode: number | null = null;
  let latencyMs: number | null = null;
  let error: string | null = null;

  if (!safeUrl) {
    error = "无效或不安全的 URL";
  } else {
    let response: Response | null = null;
    try {
      response = await request(safeUrl, "HEAD");
      if (response.status >= 400) {
        await response.body?.cancel().catch(() => undefined);
        response = await request(safeUrl, "GET");
      }
    } catch (requestError) {
      error = requestError instanceof Error ? requestError.message : "请求失败";
    }

    if (response) {
      statusCode = response.status;
      latencyMs = Date.now() - startedAt;
      status = statusForCode(response.status);
      if (!response.ok) {
        error = response.statusText ? `HTTP ${response.status} ${response.statusText}` : `HTTP ${response.status}`;
      }
      await response.body?.cancel().catch(() => undefined);
    } else {
      latencyMs = Date.now() - startedAt;
      status = "dead";
    }
  }

  const checkedAt = nowIso();
  const latency = latencyMs ?? (Date.now() - startedAt);
  try {
    const exists = await env.DB.prepare("SELECT id FROM sites WHERE id = ?").bind(site.id).first<{ id: number }>();
    if (!exists) return {
      siteId: site.id,
      siteName: site.name,
      status,
      statusCode,
      latencyMs: latency,
      error: "站点已删除",
      checkedAt,
    };
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE sites SET link_status = ?, link_status_code = ?, link_checked_at = ?, link_latency_ms = ?, updated_at = ? WHERE id = ?",
      ).bind(status, statusCode, checkedAt, latency, checkedAt, site.id),
      env.DB.prepare(
        `INSERT INTO link_checks (site_id, status, status_code, latency_ms, error, trigger, checked_at)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ?)`,
      ).bind(site.id, status, statusCode, latency, error, trigger, checkedAt, site.id),
    ]);
  } catch (dbError) {
    const message = dbError instanceof Error ? dbError.message : String(dbError);
    if (!message.includes("FOREIGN KEY constraint failed")) {
      console.error("Failed to persist link check", dbError);
    }
  }

  return {
    siteId: site.id,
    siteName: site.name,
    status,
    statusCode,
    latencyMs: latency,
    error,
    checkedAt,
  };
}

export async function checkSites(
  env: Env,
  sites: CheckSiteRow[],
  trigger = "manual",
  concurrency = 4,
): Promise<LinkCheckResult[]> {
  const results: LinkCheckResult[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, sites.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const site = sites[index];
      if (!site) return;
      results[index] = await checkOneSite(env, site, trigger);
    }
  });
  await Promise.all(runners);
  return results.filter(Boolean);
}

export async function staleSites(env: Env, limit = 24): Promise<CheckSiteRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, url FROM sites
     WHERE is_visible = 1
       AND (link_checked_at IS NULL OR datetime(link_checked_at) < datetime('now', '-7 days'))
     ORDER BY CASE WHEN link_checked_at IS NULL THEN 0 ELSE 1 END, datetime(link_checked_at) ASC
     LIMIT ?`,
  )
    .bind(limit)
    .all<CheckSiteRow>();
  return results ?? [];
}

export async function runScheduledChecks(env: Env): Promise<void> {
  const sites = await staleSites(env, 40);
  if (!sites.length) return;
  await checkSites(env, sites, "cron", 4);
}
