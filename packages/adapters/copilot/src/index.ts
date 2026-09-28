import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DetectResult, DetectSignal, ProviderAdapter } from '@gary-ai-platform-monitor/core';
import { fetchCopilotUsage, findGhBinary, hasGhLogin } from './usage.js';

export const copilotAdapter: ProviderAdapter = {
  meta: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    status: {
      pageUrl: 'https://www.githubstatus.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://www.githubstatus.com/api/v2/summary.json',
      watchComponents: ['Copilot'],
    },
    capabilities: {
      percentWindows: true,
      costOnly: false,
      multiWindow: true,
    },
  },
  async detect(): Promise<DetectResult> {
    // Presence only — the token itself is read once per fetch, never during detect.
    const signals: DetectSignal[] = [];
    const ghLogin = Boolean(findGhBinary()) && hasGhLogin();
    if (ghLogin) {
      signals.push({ kind: 'cli_credentials', detail: 'gh hosts.yml (github.com)' });
    }
    const envVar = process.env.GH_TOKEN ? 'GH_TOKEN' : process.env.GITHUB_TOKEN ? 'GITHUB_TOKEN' : null;
    if (envVar) {
      signals.push({ kind: 'env_api_key', detail: envVar });
    }
    const copilotDir = path.join(os.homedir(), '.copilot');
    if (fs.existsSync(copilotDir)) {
      signals.push({ kind: 'local_app_config', detail: copilotDir });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: ghLogin || envVar ? 'high' : signals.length ? 'medium' : 'low',
    };
  },
  async fetchUsage() {
    return fetchCopilotUsage();
  },
};

export {
  fetchCopilotUsage,
  fetchCopilotUsageWithToken,
  mapCopilotQuotas,
  classifyGithubRateLimit,
  findGhBinary,
  getGhToken,
} from './usage.js';
export default copilotAdapter;
