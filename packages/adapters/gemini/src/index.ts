import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DetectResult, DetectSignal, ProviderAdapter, UsageResult } from '@gary-ai-platform-monitor/core';
import { fetchGeminiUsage, hasGeminiCreds } from './usage.js';

const HOME = os.homedir();

export const geminiAdapter: ProviderAdapter = {
  meta: {
    id: 'gemini',
    displayName: 'Gemini',
    status: {
      pageUrl: 'https://status.cloud.google.com',
      strategy: 'custom',
    },
    capabilities: {
      percentWindows: true,
      costOnly: false,
      multiWindow: true,
    },
  },
  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];
    const oauth = path.join(HOME, '.gemini', 'oauth_creds.json');
    if (fs.existsSync(oauth)) {
      signals.push({ kind: 'cli_credentials', detail: oauth });
    }
    const settings = path.join(HOME, '.gemini', 'settings.json');
    if (fs.existsSync(settings)) {
      signals.push({ kind: 'local_app_config', detail: settings });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: hasGeminiCreds() ? 'high' : signals.length ? 'medium' : 'low',
    };
  },
  async fetchUsage(): Promise<UsageResult> {
    return fetchGeminiUsage();
  },
};

export { fetchGeminiUsage, mapQuotaBuckets } from './usage.js';
export default geminiAdapter;
