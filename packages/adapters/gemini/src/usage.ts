/**
 * Gemini CLI OAuth → cloudcode-pa retrieveUserQuota
 * remainingFraction 1.0 = 0% used
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';

const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

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
  for (const b of buckets) {
    if (typeof b.remainingFraction !== 'number') continue;
    const used = Math.max(0, Math.min(100, (1 - b.remainingFraction) * 100));
    const id = `${b.modelId ?? 'model'}:${b.tokenType ?? 'quota'}`;
    windows.push({
      id,
      usedPercent: used,
      resetsAt: b.resetTime ? Math.floor(Date.parse(b.resetTime) / 1000) : undefined,
      label: b.modelId ?? id,
      source: 'oauth',
    });
  }
  return windows;
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

export async function fetchGeminiUsage(): Promise<UsageResult> {
  if (!hasGeminiCreds()) {
    return {
      providerId: 'gemini',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'No ~/.gemini/oauth_creds.json',
    };
  }

  let creds: OAuthCreds;
  try {
    creds = JSON.parse(fs.readFileSync(getGeminiCredsPath(), 'utf8')) as OAuthCreds;
  } catch {
    return {
      providerId: 'gemini',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'Invalid Gemini OAuth credentials file',
    };
  }

  if (!creds.access_token) {
    return {
      providerId: 'gemini',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'Missing access_token',
    };
  }

  if (creds.expiry_date && creds.expiry_date < Date.now()) {
    return {
      providerId: 'gemini',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'Gemini OAuth token expired — run gemini login / refresh',
    };
  }

  try {
    const res = await fetch(QUOTA_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'gary-ai-platform-monitor/0.2.1',
      },
      body: '{}',
    });
    if (res.status === 401 || res.status === 403) {
      return {
        providerId: 'gemini',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorMessage: `Quota API HTTP ${res.status}`,
      };
    }
    if (!res.ok) {
      return {
        providerId: 'gemini',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorMessage: `Quota API HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as { buckets?: QuotaBucket[] };
    const windows = pickPrimaryWindows(mapQuotaBuckets(data.buckets ?? []));
    return {
      providerId: 'gemini',
      windows,
      status: windows.length ? 'ok' : 'unsupported',
      updatedAt: Date.now(),
    };
  } catch (err) {
    return {
      providerId: 'gemini',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      errorMessage: err instanceof Error ? err.message : 'request failed',
    };
  }
}
