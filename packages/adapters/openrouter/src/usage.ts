/**
 * OpenRouter API key usage
 * GET https://openrouter.ai/api/v1/key
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

const KEY_URL = 'https://openrouter.ai/api/v1/key';
const TIMEOUT_MS = 10_000;

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

export interface OpenRouterKeyPayload {
  data?: {
    /** All-time spend on this key (USD) */
    usage?: number | null;
    limit?: number | null;
    /** Remaining credit under `limit` for the current reset period (USD) */
    limit_remaining?: number | null;
    /** 'daily' | 'weekly' | 'monthly' | null */
    limit_reset?: string | null;
    is_free_tier?: boolean;
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * usedPercent = (limit - limit_remaining) / limit when limit_remaining is present
 * (correct for keys whose limit resets), else usage / limit. No % without a positive limit.
 */
export function mapOpenRouterKeyPayload(data: OpenRouterKeyPayload | null | undefined): UsageWindow[] {
  const d = data?.data;
  if (!d || typeof d !== 'object') return [];
  const windows: UsageWindow[] = [];
  if (num(d.limit) && d.limit > 0) {
    const used = num(d.limit_remaining)
      ? d.limit - d.limit_remaining
      : num(d.usage)
        ? d.usage
        : undefined;
    if (used !== undefined) {
      const reset = typeof d.limit_reset === 'string' && d.limit_reset ? d.limit_reset : undefined;
      windows.push({
        id: 'credit_limit',
        usedPercent: Math.min(100, Math.max(0, (used / d.limit) * 100)),
        label: reset ? `credit limit (${reset})` : 'credit limit',
        source: 'oauth',
        usedAbsolute: Math.max(0, used),
        limitAbsolute: d.limit,
        unit: 'usd',
      });
      return windows;
    }
  }
  if (num(d.usage)) {
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

export async function fetchOpenRouterUsage(fetchImpl?: typeof fetch): Promise<UsageResult> {
  const key = resolveOpenRouterKey();
  if (!key) {
    return {
      providerId: 'openrouter',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorKind: 'auth',
      errorMessage: 'Set OPENROUTER_API_KEY or ~/.config/gary-ai-platform-monitor/openrouter.key',
    };
  }

  const res = await fetchJson<OpenRouterKeyPayload>(KEY_URL, {
    headers: {
      Authorization: `Bearer ${key}`,
      'User-Agent': 'gary-ai-platform-monitor/0.2.1',
    },
    timeoutMs: TIMEOUT_MS,
    fetchImpl,
  });
  if (!res.ok) {
    return {
      providerId: 'openrouter',
      windows: [],
      status: res.errorKind === 'auth' ? 'auth_required' : 'error',
      updatedAt: Date.now(),
      errorKind: res.errorKind,
      retryAfterMs: res.retryAfterMs,
      errorMessage:
        res.errorKind === 'auth'
          ? `OpenRouter rejected the API key (HTTP ${res.status ?? '?'})`
          : scrubSecrets(`OpenRouter: ${res.errorMessage}`),
    };
  }
  const windows = mapOpenRouterKeyPayload(res.data);
  const now = Date.now();
  return windows.length
    ? { providerId: 'openrouter', windows, status: 'ok', updatedAt: now, observedAt: now }
    : {
        providerId: 'openrouter',
        windows,
        status: 'unsupported',
        updatedAt: now,
        errorKind: 'unsupported',
        errorMessage: 'OpenRouter key response had no usage/limit fields',
      };
}
