/**
 * Codex (ChatGPT plan) adapter — seed provider.
 *
 * detect: ~/.codex sessions / auth
 * fetchUsage: local rollout rate_limits used_percent
 * health: https://status.openai.com
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
import { readCodexUsage } from './usage.js';

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME ?? path.join(HOME, '.codex');

export const codexAdapter: ProviderAdapter = {
  meta: {
    id: 'codex',
    displayName: 'Codex',
    status: {
      pageUrl: 'https://status.openai.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.openai.com/api/v2/summary.json',
      watchComponents: ['ChatGPT', 'API', 'Codex'],
    },
    capabilities: {
      percentWindows: true,
      costOnly: false,
      multiWindow: true,
    },
  },

  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];

    const sessions = path.join(CODEX_HOME, 'sessions');
    if (fs.existsSync(sessions)) {
      signals.push({ kind: 'session_dir', detail: sessions });
    }

    for (const name of ['auth.json', 'config.toml']) {
      const p = path.join(CODEX_HOME, name);
      if (fs.existsSync(p)) {
        signals.push({ kind: 'cli_credentials', detail: p });
      }
    }

    return {
      found: signals.length > 0,
      signals,
      confidence: signals.some((s) => s.kind === 'session_dir')
        ? 'high'
        : signals.length
          ? 'medium'
          : 'low',
    };
  },

  async fetchUsage(): Promise<UsageResult> {
    return readCodexUsage();
  },
};

export { readCodexUsage, mapCodexRateLimits, parseRateLimitsFromRolloutText } from './usage.js';
export default codexAdapter;
