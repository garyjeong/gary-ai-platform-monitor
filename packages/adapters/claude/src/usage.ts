/**
 * Anthropic OAuth usage → percent windows.
 * Endpoint: GET https://api.anthropic.com/api/oauth/usage
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';
import { getClaudeAccessToken } from './credentials.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const API_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const CACHE_DIR = path.join(os.homedir(), '.config', 'gary-ai-platform-monitor');
const CACHE_FILE = path.join(CACHE_DIR, 'claude-usage-cache.json');

interface RateLimitInfo {
  utilization?: number;
  resets_at?: string;
}

interface OAuthUsagePayload {
  five_hour?: RateLimitInfo;
  seven_day?: RateLimitInfo;
}

interface CacheEnvelope {
  data: OAuthUsagePayload;
  timestamp: number;
}

export async function fetchClaudeUsage(): Promise<UsageResult> {
  const cached = loadCache();
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return toResult(cached.data, 'ok');
  }

  let token = getClaudeAccessToken();
  if (!token) {
    if (cached) return toResult(cached.data, 'stale');
    return {
      providerId: 'claude',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'Claude Code OAuth credentials not found or expired',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(USAGE_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'gary-ai-platform-monitor/0.1.0',
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: controller.signal,
    });
    token = null;

    if (res.status === 401 || res.status === 403) {
      if (cached) return toResult(cached.data, 'stale');
      return {
        providerId: 'claude',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorMessage: `OAuth usage HTTP ${res.status}`,
      };
    }

    if (!res.ok) {
      if (cached) return toResult(cached.data, 'stale');
      return {
        providerId: 'claude',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorMessage: `OAuth usage HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as OAuthUsagePayload;
    if (typeof data !== 'object' || data === null) {
      if (cached) return toResult(cached.data, 'stale');
      return {
        providerId: 'claude',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorMessage: 'Invalid usage payload',
      };
    }

    const payload: OAuthUsagePayload = {
      five_hour: data.five_hour,
      seven_day: data.seven_day,
    };
    saveCache(payload);
    return toResult(payload, 'ok');
  } catch (err) {
    token = null;
    if (cached) return toResult(cached.data, 'stale');
    return {
      providerId: 'claude',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      errorMessage: err instanceof Error ? err.message : 'request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Pure mapper for tests */
export function mapOAuthUsageToWindows(data: OAuthUsagePayload): UsageWindow[] {
  const windows: UsageWindow[] = [];
  if (data.five_hour && typeof data.five_hour.utilization === 'number') {
    windows.push({
      id: '5h',
      usedPercent: data.five_hour.utilization,
      resetsAt: parseReset(data.five_hour.resets_at),
      label: '5 hour',
      source: 'oauth',
    });
  }
  if (data.seven_day && typeof data.seven_day.utilization === 'number') {
    windows.push({
      id: '7d',
      usedPercent: data.seven_day.utilization,
      resetsAt: parseReset(data.seven_day.resets_at),
      label: '7 day',
      source: 'oauth',
    });
  }
  return windows;
}

function toResult(data: OAuthUsagePayload, status: UsageResult['status']): UsageResult {
  const windows = mapOAuthUsageToWindows(data);
  return {
    providerId: 'claude',
    windows,
    status: windows.length === 0 && status === 'ok' ? 'unsupported' : status,
    updatedAt: Date.now(),
  };
}

function parseReset(iso?: string): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
}

function loadCache(): CacheEnvelope | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheEnvelope;
  } catch {
    return null;
  }
}

function saveCache(data: OAuthUsagePayload): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ data, timestamp: Date.now() } satisfies CacheEnvelope),
      { mode: 0o600 }
    );
  } catch {
    // ignore
  }
}
