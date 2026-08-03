/**
 * Grok adapter — seed provider.
 *
 * detect: ~/.grok auth / sessions
 * fetchUsage: Phase 2 spike (CLI billing RPC / browser / local tokens)
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

const HOME = os.homedir();
const GROK_HOME = path.join(HOME, '.grok');

export const grokAdapter: ProviderAdapter = {
  meta: {
    id: 'grok',
    displayName: 'Grok',
    status: {
      pageUrl: 'https://status.x.ai',
      strategy: 'rss',
      // summaryUrl TBD when feed/API path is confirmed
    },
    capabilities: {
      percentWindows: false, // until web/billing % path is proven
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
    // Phase 0/2 gate: percent may require browser session or billing RPC
    return {
      providerId: 'grok',
      windows: [],
      status: 'unsupported',
      updatedAt: Date.now(),
      errorMessage: 'fetchUsage not implemented yet — Phase 2 (percent path TBD)',
    };
  },
};

export default grokAdapter;
