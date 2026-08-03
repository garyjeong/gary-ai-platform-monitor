/**
 * Cursor adapter — detect install + optional browser session usage.
 * Usage requires cookies for cursor.com (auto or CURSOR_COOKIE / cursor.cookie file).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  AuthContext,
  DetectResult,
  DetectSignal,
  ProviderAdapter,
  UsageResult,
  UsageWindow,
} from '@gary-ai-platform-monitor/core';
import {
  readChromiumCookieHeader,
  readManualCookieHeader,
} from '@gary-ai-platform-monitor/browser-cookies';

const HOME = os.homedir();

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

function resolveCookie(includeBrowser: boolean): string | null {
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
  const auto = readChromiumCookieHeader({
    hostLike: ['%.cursor.com', 'cursor.com', '%.cursor.sh'],
  });
  return auto?.header ?? null;
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
    const cookie = resolveCookie(Boolean(ctx?.includeBrowserCookies));
    if (!cookie) {
      return {
        providerId: 'cursor',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorMessage:
          'Cursor usage needs browser cookies. Set CURSOR_COOKIE or enable includeBrowserCookies + login on cursor.com',
      };
    }

    const urls = [
      'https://www.cursor.com/api/usage',
      'https://cursor.com/api/usage',
      'https://www.cursor.com/api/auth/stripe',
      'https://api2.cursor.sh/auth/full_stripe_profile',
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: {
            Cookie: cookie,
            Accept: 'application/json',
            'User-Agent': 'gary-ai-platform-monitor/0.2.1',
          },
        });
        if (!res.ok) continue;
        const json: unknown = await res.json();
        const windows = deepFindPercent(json).slice(0, 4);
        if (windows.length) {
          return {
            providerId: 'cursor',
            windows,
            status: 'ok',
            updatedAt: Date.now(),
          };
        }
      } catch {
        // next
      }
    }

    return {
      providerId: 'cursor',
      windows: [],
      status: 'unsupported',
      updatedAt: Date.now(),
      errorMessage: 'Cursor session found but usage endpoints returned no percent fields',
    };
  },
};

export default cursorAdapter;
