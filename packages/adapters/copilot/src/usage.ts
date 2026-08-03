/**
 * GitHub Copilot quotas via gh auth token +
 * GET https://api.github.com/copilot_internal/user
 *
 * usedPercent = 100 - percent_remaining
 */

import { execFileSync } from 'node:child_process';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';

interface QuotaSnap {
  percent_remaining?: number;
  quota_remaining?: number;
  entitlement?: number;
  remaining?: number;
  unlimited?: boolean;
  quota_reset_at?: number;
  has_quota?: boolean;
}

export function getGhToken(): string | null {
  try {
    const t = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return t || null;
  } catch {
    return process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || null;
  }
}

export function mapCopilotQuotas(
  snapshots: Record<string, QuotaSnap>,
  plan?: string
): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const [id, snap] of Object.entries(snapshots)) {
    if (!snap || typeof snap !== 'object') continue;
    // Skip zero-entitlement buckets (e.g. premium_interactions on free tier)
    // — they report 100% used and pollute the menu bar max %.
    if (snap.entitlement === 0 || snap.has_quota === false) continue;
    if (snap.unlimited) {
      windows.push({
        id,
        usedPercent: 0,
        label: `${id} (unlimited)`,
        source: 'oauth',
      });
      continue;
    }
    if (typeof snap.percent_remaining === 'number') {
      windows.push({
        id,
        usedPercent: Math.max(0, Math.min(100, 100 - snap.percent_remaining)),
        resetsAt:
          typeof snap.quota_reset_at === 'number' && snap.quota_reset_at > 0
            ? snap.quota_reset_at
            : undefined,
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

export async function fetchCopilotUsage(): Promise<UsageResult> {
  const token = getGhToken();
  if (!token) {
    return {
      providerId: 'copilot',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'Run `gh auth login` or set GH_TOKEN',
    };
  }

  try {
    const res = await fetch('https://api.github.com/copilot_internal/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'gary-ai-platform-monitor/0.3.1',
        'X-Github-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        providerId: 'copilot',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorMessage: `Copilot API HTTP ${res.status}`,
      };
    }
    if (!res.ok) {
      return {
        providerId: 'copilot',
        windows: [],
        status: 'error',
        updatedAt: Date.now(),
        errorMessage: `Copilot API HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      copilot_plan?: string;
      access_type_sku?: string;
      quota_snapshots?: Record<string, QuotaSnap>;
    };
    const windows = mapCopilotQuotas(
      data.quota_snapshots ?? {},
      data.copilot_plan ?? data.access_type_sku
    );
    return {
      providerId: 'copilot',
      windows,
      status: windows.length ? 'ok' : 'unsupported',
      updatedAt: Date.now(),
    };
  } catch (err) {
    return {
      providerId: 'copilot',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      errorMessage: err instanceof Error ? err.message : 'request failed',
    };
  }
}
