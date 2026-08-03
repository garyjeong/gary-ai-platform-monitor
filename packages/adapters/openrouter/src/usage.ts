/**
 * OpenRouter API key usage
 * GET https://openrouter.ai/api/v1/key
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';

export function resolveOpenRouterKey(): string | null {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) return env;

  const candidates = [
    path.join(os.homedir(), '.config', 'gary-ai-platform-monitor', 'openrouter.key'),
    path.join(os.homedir(), '.openrouter', 'api_key'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v) return v;
      }
    } catch {
      // continue
    }
  }
  return null;
}

export function mapOpenRouterKeyPayload(data: {
  data?: {
    usage?: number;
    limit?: number | null;
    limit_remaining?: number | null;
    is_free_tier?: boolean;
  };
}): UsageWindow[] {
  const d = data.data;
  if (!d) return [];
  const windows: UsageWindow[] = [];
  if (typeof d.limit === 'number' && d.limit > 0 && typeof d.usage === 'number') {
    windows.push({
      id: 'credit_limit',
      usedPercent: Math.min(100, Math.max(0, (d.usage / d.limit) * 100)),
      label: 'credit limit',
      source: 'oauth',
      usedAbsolute: d.usage,
      limitAbsolute: d.limit,
      unit: 'usd',
    });
  } else if (typeof d.usage === 'number') {
    windows.push({
      id: 'usage_usd',
      usedPercent: null,
      label: 'usage',
      source: 'oauth',
      usedAbsolute: d.usage,
      unit: 'usd',
    });
  }
  return windows;
}

export async function fetchOpenRouterUsage(): Promise<UsageResult> {
  const key = resolveOpenRouterKey();
  if (!key) {
    return {
      providerId: 'openrouter',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'Set OPENROUTER_API_KEY or ~/.config/gary-ai-platform-monitor/openrouter.key',
    };
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/key', {
      headers: {
        Authorization: `Bearer ${key}`,
        'User-Agent': 'gary-ai-platform-monitor/0.2.1',
      },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        providerId: 'openrouter',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorMessage: `OpenRouter HTTP ${res.status}`,
      };
    }
    if (!res.ok) {
      return {
        providerId: 'openrouter',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorMessage: `OpenRouter HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as Parameters<typeof mapOpenRouterKeyPayload>[0];
    const windows = mapOpenRouterKeyPayload(json);
    return {
      providerId: 'openrouter',
      windows,
      status: windows.length ? 'ok' : 'unsupported',
      updatedAt: Date.now(),
    };
  } catch (err) {
    return {
      providerId: 'openrouter',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      errorMessage: err instanceof Error ? err.message : 'request failed',
    };
  }
}
