/**
 * Anthropic OAuth usage → percent windows.
 * Endpoint: GET https://api.anthropic.com/api/oauth/usage
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  fetchJson,
  scrubSecrets,
  type FetchErrorKind,
  type FetchStatus,
  type UsageResult,
  type UsageWindow,
} from '@gary-ai-platform-monitor/core';
import { lookupClaudeAccessToken, type ClaudeTokenLookup } from './credentials.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const API_TIMEOUT_MS = 10_000;
/** A cache younger than this is returned as a fresh 'ok' without calling the API. */
export const CLAUDE_CACHE_TTL_MS = 60_000;
const CACHE_DIR = path.join(os.homedir(), '.config', 'gary-ai-platform-monitor');
const CACHE_FILE = path.join(CACHE_DIR, 'claude-usage-cache.json');

interface RateLimitInfo {
  utilization?: number | null;
  resets_at?: string | null;
}

export interface OAuthUsagePayload {
  five_hour?: RateLimitInfo | null;
  seven_day?: RateLimitInfo | null;
}

export interface ClaudeUsageCache {
  data: OAuthUsagePayload;
  /** Epoch ms when `data` was fetched from the API */
  timestamp: number;
}

/** Injection points (tests); every field defaults to the real implementation. */
export interface ClaudeUsageDeps {
  fetchImpl?: typeof fetch;
  lookupToken?: () => Promise<ClaudeTokenLookup>;
  loadCache?: () => ClaudeUsageCache | null;
  saveCache?: (entry: ClaudeUsageCache) => void;
  now?: () => number;
}

/**
 * Status mapping:
 *   200            → ok (observedAt = now, cache saved)
 *   401/403        → auth_required + errorKind 'auth' (cached windows kept, observedAt = cache time)
 *   429            → stale (cache) / error (no cache), errorKind 'rate_limited', retryAfterMs
 *   other failures → stale (cache) / error (no cache) with the classified errorKind
 * Cached data is only reported as 'ok' while younger than CLAUDE_CACHE_TTL_MS.
 */
export async function fetchClaudeUsage(deps: ClaudeUsageDeps = {}): Promise<UsageResult> {
  const now = deps.now ?? Date.now;
  const load = deps.loadCache ?? loadCache;
  const save = deps.saveCache ?? saveCache;
  const lookup = deps.lookupToken ?? (() => lookupClaudeAccessToken());

  const cached = load();
  if (cached) {
    const age = now() - cached.timestamp;
    if (age >= 0 && age < CLAUDE_CACHE_TTL_MS) return fromCache(cached, 'ok', now());
  }

  const auth = await lookup();
  if (auth.token === null) {
    return fromCache(cached, 'auth_required', now(), {
      errorKind: 'auth',
      errorMessage:
        auth.reason === 'expired'
          ? 'Claude Code OAuth token expired — run Claude Code once to refresh it'
          : 'Claude Code OAuth credentials not found — sign in with Claude Code',
    });
  }

  const res = await fetchJson<unknown>(USAGE_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'gary-ai-platform-monitor/0.1.0',
      Authorization: `Bearer ${auth.token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
    timeoutMs: API_TIMEOUT_MS,
    fetchImpl: deps.fetchImpl,
  });

  if (!res.ok) {
    if (res.errorKind === 'auth') {
      return fromCache(cached, 'auth_required', now(), {
        errorKind: 'auth',
        errorMessage: `Claude OAuth token rejected (HTTP ${res.status ?? '?'}) — run Claude Code to sign in again`,
      });
    }
    return fromCache(cached, cached ? 'stale' : 'error', now(), {
      errorKind: res.errorKind,
      retryAfterMs: res.retryAfterMs,
      errorMessage:
        res.errorKind === 'rate_limited'
          ? 'Claude usage API rate limited (HTTP 429)'
          : scrubSecrets(`Claude usage API: ${res.errorMessage}`),
    });
  }

  const data = res.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fromCache(cached, cached ? 'stale' : 'error', now(), {
      errorKind: 'parse',
      errorMessage: 'Claude usage API returned an unexpected payload',
    });
  }

  const d = data as OAuthUsagePayload;
  const entry: ClaudeUsageCache = {
    data: { five_hour: d.five_hour, seven_day: d.seven_day },
    timestamp: now(),
  };
  save(entry);
  return fromCache(entry, 'ok', entry.timestamp);
}

/** Pure mapper for tests */
export function mapOAuthUsageToWindows(data: OAuthUsagePayload): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const add = (id: string, info: RateLimitInfo | null | undefined, label: string, seconds: number) => {
    if (!info || typeof info.utilization !== 'number' || !Number.isFinite(info.utilization)) return;
    windows.push({
      id,
      usedPercent: info.utilization,
      resetsAt: parseReset(info.resets_at),
      windowSeconds: seconds,
      windowKind: 'fixed',
      label,
      source: 'oauth',
    });
  };
  add('5h', data.five_hour, '5 hour', 18_000);
  add('7d', data.seven_day, '7 day', 604_800);
  return windows;
}

/**
 * Build a result around (optional) cached data. observedAt is always the cache's own
 * timestamp, never the time of this attempt.
 */
function fromCache(
  cached: ClaudeUsageCache | null,
  status: FetchStatus,
  updatedAt: number,
  extra: { errorKind?: FetchErrorKind; errorMessage?: string; retryAfterMs?: number } = {}
): UsageResult {
  const windows = cached ? mapOAuthUsageToWindows(cached.data) : [];
  const result: UsageResult = {
    providerId: 'claude',
    windows,
    status,
    updatedAt,
  };
  if (cached) result.observedAt = cached.timestamp;
  if (status === 'ok' && windows.length === 0) {
    result.status = 'unsupported';
    result.errorKind = 'unsupported';
    result.errorMessage = 'No 5h/7d utilization in the Claude usage response';
    return result;
  }
  if (extra.errorKind) result.errorKind = extra.errorKind;
  if (extra.errorMessage) result.errorMessage = scrubSecrets(extra.errorMessage);
  if (extra.retryAfterMs !== undefined) result.retryAfterMs = extra.retryAfterMs;
  return result;
}

function parseReset(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
}

function loadCache(): ClaudeUsageCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as Partial<ClaudeUsageCache>;
    if (!raw || typeof raw !== 'object') return null;
    if (!raw.data || typeof raw.data !== 'object') return null;
    if (typeof raw.timestamp !== 'number' || !Number.isFinite(raw.timestamp)) return null;
    return { data: raw.data, timestamp: raw.timestamp };
  } catch {
    return null;
  }
}

function saveCache(entry: ClaudeUsageCache): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry), { mode: 0o600 });
  } catch {
    // ignore — cache is an optimisation
  }
}
