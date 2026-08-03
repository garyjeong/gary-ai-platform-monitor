/**
 * Grok adapter
 *
 * Usage priority:
 * 1) Browser cookies / manual Cookie → rate-limits % when API allows
 * 2) Local sessions → tokens + USD (no %)
 * Plus subscription tier via CLI OIDC (metadata only).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  AuthContext,
  DetectResult,
  DetectSignal,
  ProviderAdapter,
  UsageResult,
} from '@gary-ai-platform-monitor/core';
import { fetchGrokUsage } from './local-usage.js';
import { fetchGrokBrowserUsage } from './browser-usage.js';
import { fetchGrokSubscription } from './subscription.js';

const HOME = os.homedir();
const GROK_HOME = path.join(HOME, '.grok');

export const grokAdapter: ProviderAdapter = {
  meta: {
    id: 'grok',
    displayName: 'Grok',
    status: {
      pageUrl: 'https://status.x.ai',
      strategy: 'rss',
      summaryUrl: 'https://status.x.ai/feed.xml',
    },
    capabilities: {
      percentWindows: true, // when browser cookie path succeeds
      costOnly: true,
      multiWindow: true,
    },
  },

  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];

    const auth = path.join(GROK_HOME, 'auth.json');
    if (fs.existsSync(auth)) {
      signals.push({ kind: 'cli_credentials', detail: auth });
    }

    const sessions = path.join(GROK_HOME, 'sessions');
    if (fs.existsSync(sessions)) {
      signals.push({ kind: 'session_dir', detail: sessions });
    }

    const config = path.join(GROK_HOME, 'config.toml');
    if (fs.existsSync(config)) {
      signals.push({ kind: 'local_app_config', detail: config });
    }

    const cookieFile = path.join(
      HOME,
      '.config',
      'gary-ai-platform-monitor',
      'grok.cookie'
    );
    if (fs.existsSync(cookieFile) || process.env.GAI_PM_GROK_COOKIE) {
      signals.push({ kind: 'browser_cookie', detail: 'grok.cookie / env' });
    }

    return {
      found: signals.length > 0,
      signals,
      confidence: signals.some((s) => s.kind === 'cli_credentials' || s.kind === 'browser_cookie')
        ? 'high'
        : signals.length
          ? 'medium'
          : 'low',
    };
  },

  async fetchUsage(ctx?: AuthContext): Promise<UsageResult> {
    const includeBrowser = Boolean(ctx?.includeBrowserCookies);

    // 1) Browser / manual cookie path for %
    const browser = await fetchGrokBrowserUsage(includeBrowser);
    if (browser && browser.status === 'ok' && browser.windows.some((w) => w.usedPercent != null)) {
      // Enrich with subscription tier when available (non-blocking metadata)
      const sub = await fetchGrokSubscription().catch(() => null);
      if (sub?.tier) {
        browser.errorMessage = [
          browser.errorMessage,
          `tier=${sub.tier}`,
          sub.billingPeriodEnd ? `periodEnd=${sub.billingPeriodEnd}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }
      return browser;
    }

    // 2) Local tokens + subscription tier note (no %)
    const local = fetchGrokUsage();
    const sub = await fetchGrokSubscription();
    if (sub?.tier) {
      local.errorMessage = [
        local.errorMessage,
        `tier=${sub.tier}`,
        sub.billingPeriodEnd ? `periodEnd=${sub.billingPeriodEnd}` : '',
        browser?.errorMessage,
      ]
        .filter(Boolean)
        .join(' · ');
    } else if (browser?.errorMessage) {
      local.errorMessage = [local.errorMessage, browser.errorMessage]
        .filter(Boolean)
        .join(' · ');
    }
    return local;
  },
};

export { fetchGrokUsage, readGrokUsage, weeklyWindow } from './local-usage.js';
export { fetchGrokBrowserUsage, extractPercentWindows } from './browser-usage.js';
export default grokAdapter;
