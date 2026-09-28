/**
 * Claude adapter — seed provider.
 *
 * detect: Claude Code Keychain / ~/.claude credentials / projects dir
 * fetchUsage: Anthropic OAuth usage API (5h / 7d %)
 * health: https://status.claude.com/api/v2/summary.json
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
import { hasClaudeKeychainItem } from './credentials.js';
import { fetchClaudeUsage } from './usage.js';

const HOME = os.homedir();

export const claudeAdapter: ProviderAdapter = {
  meta: {
    id: 'claude',
    displayName: 'Claude',
    status: {
      pageUrl: 'https://status.claude.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.claude.com/api/v2/summary.json',
      watchComponents: ['Claude Code', 'Claude API', 'claude.ai'],
    },
    capabilities: {
      percentWindows: true,
      costOnly: false,
      multiWindow: true,
    },
  },

  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];

    // Existence check only — never pulls the secret (no `-w`), so no Keychain prompt.
    if (await hasClaudeKeychainItem()) {
      signals.push({ kind: 'keychain', detail: 'Claude Code-credentials' });
    }

    const credFile = path.join(HOME, '.claude', '.credentials.json');
    if (fs.existsSync(credFile)) {
      signals.push({ kind: 'cli_credentials', detail: credFile });
    }

    const projects = path.join(HOME, '.claude', 'projects');
    if (fs.existsSync(projects)) {
      signals.push({ kind: 'session_dir', detail: projects });
    }

    const hasAuth = signals.some(
      (s) => s.kind === 'keychain' || s.kind === 'cli_credentials'
    );

    return {
      found: signals.length > 0,
      signals,
      confidence: hasAuth ? 'high' : signals.length > 0 ? 'medium' : 'low',
    };
  },

  async fetchUsage(): Promise<UsageResult> {
    return fetchClaudeUsage();
  },
};

export {
  fetchClaudeUsage,
  mapOAuthUsageToWindows,
  type ClaudeUsageDeps,
  type ClaudeUsageCache,
} from './usage.js';
export default claudeAdapter;
