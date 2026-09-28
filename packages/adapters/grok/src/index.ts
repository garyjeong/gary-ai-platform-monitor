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
import { fetchGrokSubscription, grokTierLabel } from './subscription.js';
import { combineGrokResults } from './combine.js';

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

    // Browser/manual cookie path (quota %) and the tier lookup (metadata → note) in parallel.
    const [browser, sub] = await Promise.all([
      fetchGrokBrowserUsage(includeBrowser),
      fetchGrokSubscription().catch(() => null),
    ]);
    // Local tokens/cost (no %) only when the browser path did not produce %.
    return combineGrokResults(browser, fetchGrokUsage, grokTierLabel(sub?.tier));
  },
};

export { fetchGrokUsage, readGrokUsage, weeklyWindow, toGrokUsageResult } from './local-usage.js';
export {
  fetchGrokBrowserUsage,
  fetchGrokBrowserUsageWithCookie,
  extractPercentWindows,
} from './browser-usage.js';
export { grokTierLabel } from './subscription.js';
export { combineGrokResults } from './combine.js';
export default grokAdapter;
