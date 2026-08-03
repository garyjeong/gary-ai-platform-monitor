/**
 * CLI OIDC can read subscription tier (not usage %).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

export async function fetchGrokSubscription(): Promise<GrokSubscriptionInfo | null> {
  const token = readAccessToken();
  if (!token) return null;
  try {
    const res = await fetch('https://grok.com/rest/subscriptions', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'gary-ai-platform-monitor/0.2.1',
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      subscriptions?: Array<{
        tier?: string;
        status?: string;
        billingPeriodEnd?: string;
      }>;
    };
    const sub = json.subscriptions?.[0];
    if (!sub) return null;
    return {
      tier: sub.tier,
      status: sub.status,
      billingPeriodEnd: sub.billingPeriodEnd,
    };
  } catch {
    return null;
  }
}
