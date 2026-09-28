/**
 * Gemini CLI OAuth → cloudcode-pa retrieveUserQuota
 * remainingFraction 1.0 = 0% used
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  fetchJson,
  scrubSecrets,
  type UsageResult,
  type UsageWindow,
} from '@gary-ai-platform-monitor/core';

const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const TIMEOUT_MS = 10_000;
const REFRESH_HINT = 'Gemini CLI를 한 번 실행하면 토큰이 갱신됩니다';

interface OAuthCreds {
  access_token?: string;
  expiry_date?: number;
  refresh_token?: string;
}

interface QuotaBucket {
  modelId?: string;
  tokenType?: string;
  remainingFraction?: number;
  resetTime?: string;
}

export function getGeminiCredsPath(): string {
  return path.join(os.homedir(), '.gemini', 'oauth_creds.json');
}

export function hasGeminiCreds(): boolean {
  return fs.existsSync(getGeminiCredsPath());
}

export function mapQuotaBuckets(buckets: QuotaBucket[]): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const b of buckets ?? []) {
    if (!b || typeof b.remainingFraction !== 'number' || !Number.isFinite(b.remainingFraction)) continue;
    const used = Math.max(0, Math.min(100, (1 - b.remainingFraction) * 100));
    const id = `${b.modelId ?? 'model'}:${b.tokenType ?? 'quota'}`;
    const resetsAt = parseResetTime(b.resetTime);
    windows.push({
      id,
      usedPercent: used,
      ...(resetsAt !== undefined ? { resetsAt, windowKind: 'fixed' as const } : {}),
      label: b.modelId ?? id,
      source: 'oauth',
    });
  }
  return windows;
}

/** RFC 3339 → epoch seconds; undefined for missing/invalid values (never NaN). */
export function parseResetTime(v: unknown): number | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
}

/** Worst (highest used) window for menu bar */
export function pickPrimaryWindows(windows: UsageWindow[]): UsageWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort(
    (a, b) => (b.usedPercent ?? 0) - (a.usedPercent ?? 0)
  );
  // Keep top used + pro/flash highlights (max 4)
  return sorted.slice(0, 4);
}

function authRequired(errorMessage: string): UsageResult {
  return {
    providerId: 'gemini',
    windows: [],
    status: 'auth_required',
    updatedAt: Date.now(),
    errorKind: 'auth',
    errorMessage,
  };
}

export async function fetchGeminiUsage(fetchImpl?: typeof fetch): Promise<UsageResult> {
  if (!hasGeminiCreds()) {
    return authRequired('No ~/.gemini/oauth_creds.json — Gemini CLI로 로그인하세요');
  }

  let creds: OAuthCreds;
  try {
    creds = JSON.parse(fs.readFileSync(getGeminiCredsPath(), 'utf8')) as OAuthCreds;
  } catch {
    return authRequired('Invalid Gemini OAuth credentials file');
  }

  if (!creds.access_token) {
    return authRequired('Missing access_token — Gemini CLI로 다시 로그인하세요');
  }

  if (typeof creds.expiry_date === 'number' && creds.expiry_date < Date.now()) {
    return authRequired(`Gemini OAuth 토큰이 만료됐습니다 — ${REFRESH_HINT}`);
  }

  const res = await fetchJson<{ buckets?: QuotaBucket[] }>(QUOTA_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'gary-ai-platform-monitor/0.2.1',
    },
    body: '{}',
    timeoutMs: TIMEOUT_MS,
    fetchImpl,
  });
  if (!res.ok) {
    if (res.errorKind === 'auth') {
      return authRequired(`Gemini quota API rejected the token (HTTP ${res.status ?? '?'}) — ${REFRESH_HINT}`);
    }
    return {
      providerId: 'gemini',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      errorKind: res.errorKind,
      retryAfterMs: res.retryAfterMs,
      errorMessage: scrubSecrets(`Gemini quota API: ${res.errorMessage}`),
    };
  }
  const windows = pickPrimaryWindows(mapQuotaBuckets(res.data?.buckets ?? []));
  const now = Date.now();
  return windows.length
    ? { providerId: 'gemini', windows, status: 'ok', updatedAt: now, observedAt: now }
    : {
        providerId: 'gemini',
        windows,
        status: 'unsupported',
        updatedAt: now,
        errorKind: 'unsupported',
        errorMessage: 'Gemini quota response had no buckets',
      };
}
