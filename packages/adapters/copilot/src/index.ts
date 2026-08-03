import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DetectResult, DetectSignal, ProviderAdapter } from '@gary-ai-platform-monitor/core';
import { fetchCopilotUsage, getGhToken } from './usage.js';

export const copilotAdapter: ProviderAdapter = {
  meta: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    status: {
      pageUrl: 'https://www.githubstatus.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://www.githubstatus.com/api/v2/summary.json',
      watchComponents: ['GitHub Copilot', 'API Requests', 'Git Operations'],
    },
    capabilities: {
      percentWindows: true,
      costOnly: false,
      multiWindow: true,
    },
  },
  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];
    if (getGhToken()) {
      signals.push({ kind: 'cli_credentials', detail: 'gh auth token' });
    }
    const copilotDir = path.join(os.homedir(), '.copilot');
    if (fs.existsSync(copilotDir)) {
      signals.push({ kind: 'local_app_config', detail: copilotDir });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: getGhToken() ? 'high' : signals.length ? 'medium' : 'low',
    };
  },
  async fetchUsage() {
    return fetchCopilotUsage();
  },
};

export { fetchCopilotUsage, mapCopilotQuotas } from './usage.js';
export default copilotAdapter;
