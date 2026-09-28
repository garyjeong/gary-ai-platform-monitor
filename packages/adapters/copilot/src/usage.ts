/**
 * GitHub Copilot quotas via gh auth token +
 * GET https://api.github.com/copilot_internal/user
 *
 * usedPercent = 100 - percent_remaining
 *
 * `gh` is located explicitly: apps launched from Finder do not inherit the Homebrew PATH.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  fetchJson,
  parseRetryAfter,
  scrubSecrets,
  type UsageResult,
  type UsageWindow,
} from '@gary-ai-platform-monitor/core';

const execFileAsync = promisify(execFile);

const USER_URL = 'https://api.github.com/copilot_internal/user';
const TIMEOUT_MS = 10_000;
const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'];

interface QuotaSnap {
  percent_remaining?: number;
  quota_remaining?: number;
  entitlement?: number;
  remaining?: number;
  unlimited?: boolean;
  /** Epoch seconds or ISO string */
  quota_reset_at?: number | string;
  has_quota?: boolean;
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Absolute path of `gh`: Homebrew locations first, then PATH. */
export function findGhBinary(
  env: NodeJS.ProcessEnv = process.env,
  candidates: string[] = GH_CANDIDATES
): string | null {
  for (const c of candidates) if (isExecutable(c)) return c;
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'gh');
    if (isExecutable(p)) return p;
  }
  return null;
}

/** gh's config says a github.com login exists (no token is read). */
export function hasGhLogin(): boolean {
  const base = process.env.GH_CONFIG_DIR ?? path.join(os.homedir(), '.config', 'gh');
  try {
    return /(^|\n)github\.com:/.test(fs.readFileSync(path.join(base, 'hosts.yml'), 'utf8'));
  } catch {
    return false;
  }
}

function envToken(): string | null {
  return process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || null;
}

/** `gh auth token` (async), falling back to GH_TOKEN / GITHUB_TOKEN. Never logged. */
export async function getGhToken(): Promise<string | null> {
  const gh = findGhBinary();
  if (gh) {
    try {
      const { stdout } = await execFileAsync(gh, ['auth', 'token'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const t = stdout.trim();
      if (t) return t;
    } catch {
      // not logged in / gh failure — fall through to env
    }
  }
  return envToken();
}

function toEpochSeconds(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string' && v) {
    const t = Date.parse(v); // "2026-10-01" parses as UTC midnight
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }
  return undefined;
}

export function mapCopilotQuotas(
  snapshots: Record<string, QuotaSnap>,
  plan?: string,
  /** Top-level quota_reset_date(_utc), used when a bucket has no reset of its own */
  fallbackReset?: string | number
): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const fallbackResetsAt = toEpochSeconds(fallbackReset);
  for (const [id, snap] of Object.entries(snapshots ?? {})) {
    if (!snap || typeof snap !== 'object') continue;
    // Unlimited buckets report entitlement 0 — keep them, without a percent.
    if (snap.unlimited) {
      windows.push({
        id,
        usedPercent: null,
        label: `${id} (unlimited)`,
        source: 'oauth',
      });
      continue;
    }
    // Skip zero-entitlement buckets (e.g. premium_interactions on free tier)
    // — they report 100% used and pollute the menu bar max %.
    if (snap.entitlement === 0 || snap.has_quota === false) continue;
    if (typeof snap.percent_remaining === 'number' && Number.isFinite(snap.percent_remaining)) {
      const resetsAt = toEpochSeconds(snap.quota_reset_at) ?? fallbackResetsAt;
      windows.push({
        id,
        usedPercent: Math.max(0, Math.min(100, 100 - snap.percent_remaining)),
        ...(resetsAt !== undefined ? { resetsAt, windowKind: 'fixed' as const } : {}),
        label: id,
        source: 'oauth',
        usedAbsolute:
          typeof snap.entitlement === 'number' && typeof snap.remaining === 'number'
            ? snap.entitlement - snap.remaining
            : undefined,
        limitAbsolute:
          typeof snap.entitlement === 'number' ? snap.entitlement : undefined,
      });
    }
  }
  // Prefer chat + completions first
  const order = ['chat', 'completions', 'premium_interactions'];
  windows.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  if (plan && windows[0]) {
    windows[0] = { ...windows[0], label: `${windows[0].label} · ${plan}` };
  }
  return windows;
}

/**
 * GitHub answers primary/secondary rate limits with 403 (or 429) plus
 * `x-ratelimit-remaining: 0` / `retry-after`. Those are not auth failures.
 */
export function classifyGithubRateLimit(
  status: number | undefined,
  headers: Headers | undefined,
  now = Date.now()
): { rateLimited: boolean; retryAfterMs?: number } {
  if (!headers || (status !== 403 && status !== 429)) return { rateLimited: false };
  const retryAfter = parseRetryAfter(headers.get('retry-after'), now);
  const remaining = headers.get('x-ratelimit-remaining');
  const rateLimited = status === 429 || remaining === '0' || retryAfter !== undefined;
  if (!rateLimited) return { rateLimited: false };
  if (retryAfter !== undefined) return { rateLimited, retryAfterMs: retryAfter };
  const reset = Number(headers.get('x-ratelimit-reset'));
  return {
    rateLimited,
    retryAfterMs: Number.isFinite(reset) && reset > 0 ? Math.max(0, reset * 1000 - now) : undefined,
  };
}

export async function fetchCopilotUsage(fetchImpl?: typeof fetch): Promise<UsageResult> {
  const token = await getGhToken(); // once per fetch
  if (!token) {
    return {
      providerId: 'copilot',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorKind: 'auth',
      errorMessage: 'Run `gh auth login` or set GH_TOKEN',
    };
  }
  return fetchCopilotUsageWithToken(token, fetchImpl);
}

export async function fetchCopilotUsageWithToken(
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<UsageResult> {
  // fetchJson drops headers on errors; keep the last response's headers for rate-limit checks.
  let lastHeaders: Headers | undefined;
  const capturing: typeof fetch = async (input, init) => {
    const res = await fetchImpl(input, init);
    lastHeaders = res.headers;
    return res;
  };

  const res = await fetchJson<{
    copilot_plan?: string;
    access_type_sku?: string;
    quota_reset_date?: string;
    quota_reset_date_utc?: string;
    quota_snapshots?: Record<string, QuotaSnap>;
  }>(USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'gary-ai-platform-monitor/0.3.1',
      'X-Github-Api-Version': '2022-11-28',
    },
    timeoutMs: TIMEOUT_MS,
    fetchImpl: capturing,
  });

  if (!res.ok) {
    const rl = classifyGithubRateLimit(res.status, lastHeaders);
    if (rl.rateLimited) {
      return {
        providerId: 'copilot',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorKind: 'rate_limited',
        retryAfterMs: rl.retryAfterMs ?? res.retryAfterMs,
        errorMessage: `GitHub API rate limited (HTTP ${res.status})`,
      };
    }
    if (res.errorKind === 'auth') {
      return {
        providerId: 'copilot',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorKind: 'auth',
        errorMessage: `Copilot API HTTP ${res.status} — run \`gh auth login\` (or check Copilot access)`,
      };
    }
    return {
      providerId: 'copilot',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      errorKind: res.errorKind,
      retryAfterMs: res.retryAfterMs,
      errorMessage: scrubSecrets(`Copilot API: ${res.errorMessage}`),
    };
  }

  const data = res.data ?? {};
  const windows = mapCopilotQuotas(
    data.quota_snapshots ?? {},
    data.copilot_plan ?? data.access_type_sku,
    data.quota_reset_date_utc ?? data.quota_reset_date
  );
  const now = Date.now();
  return windows.length
    ? { providerId: 'copilot', windows, status: 'ok', updatedAt: now, observedAt: now }
    : {
        providerId: 'copilot',
        windows,
        status: 'unsupported',
        updatedAt: now,
        errorKind: 'unsupported',
        errorMessage: 'Copilot response had no quota buckets',
      };
}
