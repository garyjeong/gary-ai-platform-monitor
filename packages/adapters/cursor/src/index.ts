/**
 * Cursor adapter — detect install + optional browser session usage.
 * Usage requires cookies for cursor.com (auto or CURSOR_COOKIE / cursor.cookie file).
 *
 * Only the session cookie (WorkosCursorSessionToken) is read from the browser, and the
 * Cookie header is only ever sent to cursor.com endpoints.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  fetchJson,
  scrubSecrets,
  type AuthContext,
  type DetectResult,
  type DetectSignal,
  type ProviderAdapter,
  type UsageResult,
  type UsageWindow,
} from '@gary-ai-platform-monitor/core';
import {
  readChromiumCookieHeader,
  readManualCookieHeader,
} from '@gary-ai-platform-monitor/browser-cookies';

const HOME = os.homedir();
const SESSION_COOKIE_NAMES = ['WorkosCursorSessionToken'];
const TIMEOUT_MS = 10_000;
/** cursor.com only — the Cookie header must never go to another host. */
export const CURSOR_USAGE_URLS = [
  'https://www.cursor.com/api/usage',
  'https://cursor.com/api/usage',
  'https://www.cursor.com/api/auth/stripe',
];
const RELOGIN =
  'Cursor session rejected — log in to cursor.com again in Chrome (or refresh CURSOR_COOKIE / cursor.cookie)';

export function isCursorComUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'cursor.com' || u.hostname.endsWith('.cursor.com'));
  } catch {
    return false;
  }
}

function deepFindPercent(obj: unknown): UsageWindow[] {
  const out: UsageWindow[] = [];
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const v of obj) out.push(...deepFindPercent(v));
    return out;
  }
  const rec = obj as Record<string, unknown>;
  if (typeof rec.used === 'number' && typeof rec.limit === 'number' && rec.limit > 0) {
    out.push({
      id: String(rec.name ?? 'usage'),
      usedPercent: (rec.used / rec.limit) * 100,
      label: String(rec.name ?? 'usage'),
      source: 'browser',
    });
  }
  if (typeof rec.usagePercentage === 'number') {
    out.push({
      id: 'usage',
      usedPercent: rec.usagePercentage,
      source: 'browser',
      label: 'usage',
    });
  }
  if (typeof rec.percentUsed === 'number') {
    out.push({
      id: 'usage',
      usedPercent: rec.percentUsed,
      source: 'browser',
      label: 'usage',
    });
  }
  for (const v of Object.values(rec)) {
    if (v && typeof v === 'object') out.push(...deepFindPercent(v));
  }
  return out;
}

async function resolveCookie(includeBrowser: boolean): Promise<string | null> {
  const manual = readManualCookieHeader(['GAI_PM_CURSOR_COOKIE', 'CURSOR_COOKIE']);
  if (manual) return manual;
  const file = path.join(HOME, '.config', 'gary-ai-platform-monitor', 'cursor.cookie');
  try {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v;
    }
  } catch {
    // ignore
  }
  if (!includeBrowser) return null;
  const auto = await readChromiumCookieHeader({
    hostLike: ['%.cursor.com', 'cursor.com'],
    names: SESSION_COOKIE_NAMES,
  });
  return auto?.header ?? null;
}

/**
 * Try the cursor.com endpoints in order. 404 / no percent fields → next endpoint;
 * 401/403 → auth_required; 429 / network / timeout / 5xx → error (no further calls).
 */
export async function fetchCursorUsageWithCookie(
  cookie: string,
  fetchImpl?: typeof fetch
): Promise<UsageResult> {
  for (const url of CURSOR_USAGE_URLS) {
    if (!isCursorComUrl(url)) continue; // defensive: cookies only go to cursor.com
    const res = await fetchJson<unknown>(url, {
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        'User-Agent': 'gary-ai-platform-monitor/0.2.1',
      },
      timeoutMs: TIMEOUT_MS,
      fetchImpl,
    });
    if (!res.ok) {
      if (res.errorKind === 'auth') {
        return {
          providerId: 'cursor',
          windows: [],
          status: 'auth_required',
          updatedAt: Date.now(),
          errorKind: 'auth',
          errorMessage: RELOGIN,
        };
      }
      if (res.status === 404 || res.errorKind === 'parse' || res.errorKind === 'unknown') continue;
      return {
        providerId: 'cursor',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorKind: res.errorKind,
        retryAfterMs: res.retryAfterMs,
        errorMessage: scrubSecrets(`Cursor: ${res.errorMessage}`),
      };
    }
    const windows = deepFindPercent(res.data).slice(0, 4);
    if (windows.length) {
      const now = Date.now();
      return { providerId: 'cursor', windows, status: 'ok', updatedAt: now, observedAt: now };
    }
  }

  return {
    providerId: 'cursor',
    windows: [],
    status: 'unsupported',
    updatedAt: Date.now(),
    errorKind: 'unsupported',
    errorMessage: 'Cursor session found but usage endpoints returned no percent fields',
  };
}

export const cursorAdapter: ProviderAdapter = {
  meta: {
    id: 'cursor',
    displayName: 'Cursor',
    status: {
      pageUrl: 'https://status.cursor.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.cursor.com/api/v2/summary.json',
    },
    capabilities: {
      percentWindows: true,
      costOnly: false,
      multiWindow: false,
    },
  },
  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];
    const appSupport = path.join(HOME, 'Library/Application Support/Cursor');
    if (fs.existsSync(appSupport)) {
      signals.push({ kind: 'local_app_config', detail: appSupport });
    }
    if (fs.existsSync(path.join(HOME, '.cursor'))) {
      signals.push({ kind: 'local_app_config', detail: path.join(HOME, '.cursor') });
    }
    if (process.env.CURSOR_COOKIE || process.env.GAI_PM_CURSOR_COOKIE) {
      signals.push({ kind: 'browser_cookie', detail: 'CURSOR_COOKIE' });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: signals.some((s) => s.kind === 'browser_cookie')
        ? 'high'
        : signals.length
          ? 'medium'
          : 'low',
    };
  },
  async fetchUsage(ctx?: AuthContext): Promise<UsageResult> {
    const cookie = await resolveCookie(Boolean(ctx?.includeBrowserCookies));
    if (!cookie) {
      return {
        providerId: 'cursor',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorKind: 'auth',
        errorMessage:
          'Cursor usage needs browser cookies. Set CURSOR_COOKIE or enable includeBrowserCookies + login on cursor.com',
      };
    }
    return fetchCursorUsageWithCookie(cookie);
  },
};

export default cursorAdapter;
