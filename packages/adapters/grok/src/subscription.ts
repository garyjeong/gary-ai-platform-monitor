/**
 * CLI OIDC can read subscription tier (not usage %).
 * Metadata only: any failure returns null and never affects the usage status.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fetchJson } from '@gary-ai-platform-monitor/core';

const SUBSCRIPTION_TIMEOUT_MS = 8_000;

/**
 * Display label for a subscription tier enum, e.g.
 *   SUBSCRIPTION_TIER_SUPER_GROK_HEAVY → "SuperGrok Heavy"
 *   SUBSCRIPTION_TIER_GROK_PRO         → "Grok Pro"
 *   X_PREMIUM_PLUS                     → "X Premium Plus"
 * Values without underscores are returned unchanged.
 */
export function grokTierLabel(tier: string | null | undefined): string | undefined {
  if (!tier || typeof tier !== 'string') return undefined;
  const bare = tier.trim().replace(/^SUBSCRIPTION_TIER_/i, '');
  if (!bare || /^(UNSPECIFIED|UNKNOWN|NONE|INVALID)$/i.test(bare)) return undefined;
  if (!bare.includes('_') && bare !== bare.toUpperCase()) return bare;
  const words = bare
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 1 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()));
  return words.join(' ').replace(/\bSuper Grok\b/g, 'SuperGrok');
}

export interface GrokSubscriptionInfo {
  tier?: string;
  status?: string;
  billingPeriodEnd?: string;
}

function readAccessToken(): string | null {
  const p = path.join(os.homedir(), '.grok', 'auth.json');
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, { key?: string }>;
    for (const v of Object.values(data)) {
      if (v?.key) return v.key;
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchGrokSubscription(
  fetchImpl?: typeof fetch
): Promise<GrokSubscriptionInfo | null> {
  const token = readAccessToken();
  if (!token) return null;
  const res = await fetchJson<{
    subscriptions?: Array<{
      tier?: string;
      status?: string;
      billingPeriodEnd?: string;
    }>;
  }>('https://grok.com/rest/subscriptions', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'gary-ai-platform-monitor/0.2.1',
    },
    timeoutMs: SUBSCRIPTION_TIMEOUT_MS,
    fetchImpl,
  });
  if (!res.ok) return null;
  const sub = res.data?.subscriptions?.[0];
  if (!sub) return null;
  return {
    tier: sub.tier,
    status: sub.status,
    billingPeriodEnd: sub.billingPeriodEnd,
  };
}
