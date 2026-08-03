/**
 * Grok adapter — seed provider.
 *
 * detect: ~/.grok auth / sessions
 * fetchUsage: local session aggregation (tokens/USD; percent not available)
 * health: status.x.ai (RSS/custom — Phase 4)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  DetectResult,
  DetectSignal,
  ProviderAdapter,
  UsageResult,
} from '@gary-ai-platform-monitor/core';
import { fetchGrokUsage } from './local-usage.js';

const HOME = os.homedir();
const GROK_HOME = path.join(HOME, '.grok');

export const grokAdapter: ProviderAdapter = {
  meta: {
    id: 'grok',
    displayName: 'Grok',
    status: {
      pageUrl: 'https://status.x.ai',
      strategy: 'rss',
    },
    capabilities: {
      percentWindows: false,
      costOnly: true,
      multiWindow: false,
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

    return {
      found: signals.length > 0,
      signals,
      confidence: signals.some((s) => s.kind === 'cli_credentials')
        ? 'high'
        : signals.length
          ? 'medium'
          : 'low',
    };
  },

  async fetchUsage(): Promise<UsageResult> {
    return fetchGrokUsage();
  },
};

export { fetchGrokUsage, readGrokUsage, weeklyWindow } from './local-usage.js';
export default grokAdapter;
