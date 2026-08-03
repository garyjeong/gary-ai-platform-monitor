/**
 * Grok subscription usage via browser session cookies (preferred for %)
 * or enrichment via CLI OIDC (subscriptions only — no rate-limit %).
 *
 * Rate-limits endpoint rejects OAuth2 tokens (403 oauth2-auth-forbidden).
 * With Cookie: sso=... from Chrome/manual, POST /rest/rate-limits may work
 * depending on xAI's current web API.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';
import {
  readChromiumCookieHeader,
  readManualCookieHeader,
} from '@gary-ai-platform-monitor/browser-cookies';

interface RateLimitWindow {
  usedPercent?: number;
  remainingPercent?: number;
  limit?: number;
  remaining?: number;
  resetsAt?: string | number;
  windowName?: string;
  name?: string;
  label?: string;
}

function deepFindPercent(obj: unknown, path: string[] = []): UsageWindow[] {
  const out: UsageWindow[] = [];
  if (obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const v of obj) out.push(...deepFindPercent(v, path));
    return out;
  }
  const rec = obj as Record<string, unknown>;

  // Common shapes
  if (typeof rec.usedPercent === 'number' || typeof rec.used_percent === 'number') {
    const used = (rec.usedPercent ?? rec.used_percent) as number;
    const label =
      (typeof rec.name === 'string' && rec.name) ||
      (typeof rec.windowName === 'string' && rec.windowName) ||
      (typeof rec.label === 'string' && rec.label) ||
      (path.length ? path.join('.') : 'quota');
    out.push({
      id: label,
      usedPercent: used,
      resetsAt: parseReset(rec.resetsAt ?? rec.resets_at ?? rec.resetTime),
      label,
      source: 'browser',
    });
  } else if (
    typeof rec.remainingFraction === 'number' ||
    typeof rec.remaining_fraction === 'number'
  ) {
    const rem = (rec.remainingFraction ?? rec.remaining_fraction) as number;
    const label =
      (typeof rec.name === 'string' && rec.name) ||
      (path.length ? path.join('.') : 'quota');
    out.push({
      id: label,
      usedPercent: (1 - rem) * 100,
      resetsAt: parseReset(rec.resetsAt ?? rec.resetTime),
      label,
      source: 'browser',
    });
  } else if (
    typeof rec.remainingPercent === 'number' ||
    typeof rec.remaining_percent === 'number'
  ) {
    const rem = (rec.remainingPercent ?? rec.remaining_percent) as number;
    const label =
      (typeof rec.name === 'string' && rec.name) ||
      (path.length ? path.join('.') : 'quota');
    out.push({
      id: label,
      usedPercent: 100 - rem,
      source: 'browser',
      label,
    });
  }

  for (const [k, v] of Object.entries(rec)) {
    if (v && typeof v === 'object') out.push(...deepFindPercent(v, [...path, k]));
  }
  return out;
}

function parseReset(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
  }
  return undefined;
}

export function resolveGrokCookieHeader(includeBrowser: boolean): {
  header: string | null;
  source: string;
} {
  const manual = readManualCookieHeader([
    'GAI_PM_GROK_COOKIE',
    'GROK_COOKIE',
    'GROK_SESSION_COOKIE',
  ]);
  if (manual) return { header: manual, source: 'env' };

  const file = path.join(
    os.homedir(),
    '.config',
    'gary-ai-platform-monitor',
    'grok.cookie'
  );
  try {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return { header: v, source: 'file' };
    }
  } catch {
    // ignore
  }

  if (!includeBrowser) return { header: null, source: 'none' };

  const auto = readChromiumCookieHeader({
    hostLike: ['%.grok.com', 'grok.com'],
    names: ['sso', 'sso-rw', 'x-userid', 'cf_clearance'],
  });
  if (auto) return { header: auto.header, source: `browser:${auto.browser}` };
  return { header: null, source: 'none' };
}

/**
 * Attempt rate-limit % with browser cookies.
 */
export async function fetchGrokBrowserUsage(
  includeBrowserCookies: boolean
): Promise<UsageResult | null> {
  const { header, source } = resolveGrokCookieHeader(includeBrowserCookies);
  if (!header) return null;

  const endpoints = [
    { method: 'POST' as const, url: 'https://grok.com/rest/rate-limits', body: '{}' },
    { method: 'GET' as const, url: 'https://grok.com/rest/rate-limits' },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: {
          Cookie: header,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: 'https://grok.com',
          Referer: 'https://grok.com/',
          'User-Agent': 'gary-ai-platform-monitor/0.2.1',
        },
        body: ep.method === 'POST' ? ep.body : undefined,
      });
      if (!res.ok) continue;
      const json: unknown = await res.json();
      const windows = dedupeWindows(deepFindPercent(json));
      if (windows.length === 0) continue;
      return {
        providerId: 'grok',
        windows,
        status: 'ok',
        updatedAt: Date.now(),
        errorMessage: `browser quota via ${source}`,
      };
    } catch {
      // try next
    }
  }

  return {
    providerId: 'grok',
    windows: [],
    status: 'auth_required',
    updatedAt: Date.now(),
    errorMessage:
      'Grok cookies present but rate-limits API returned no %. Paste Cookie from DevTools into ~/.config/gary-ai-platform-monitor/grok.cookie or GAI_PM_GROK_COOKIE (Chrome v20 encrypt may block auto-import).',
  };
}

function dedupeWindows(windows: UsageWindow[]): UsageWindow[] {
  const map = new Map<string, UsageWindow>();
  for (const w of windows) {
    const prev = map.get(w.id);
    if (!prev || (w.usedPercent ?? -1) > (prev.usedPercent ?? -1)) map.set(w.id, w);
  }
  return [...map.values()].slice(0, 6);
}

/** Map free-form JSON for tests */
export function extractPercentWindows(json: unknown): UsageWindow[] {
  return dedupeWindows(deepFindPercent(json));
}

export type { RateLimitWindow };
