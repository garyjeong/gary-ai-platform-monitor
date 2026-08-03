import type { DetectResult, DetectSignal, ProviderAdapter, UsageResult } from '@gary-ai-platform-monitor/core';
import { fetchOpenRouterUsage, resolveOpenRouterKey } from './usage.js';

export const openrouterAdapter: ProviderAdapter = {
  meta: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    status: {
      pageUrl: 'https://status.openrouter.ai',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.openrouter.ai/api/v2/summary.json',
    },
    capabilities: {
      percentWindows: true,
      costOnly: true,
      multiWindow: false,
    },
  },
  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];
    if (process.env.OPENROUTER_API_KEY) {
      signals.push({ kind: 'env_api_key', detail: 'OPENROUTER_API_KEY' });
    }
    const key = resolveOpenRouterKey();
    if (key && !process.env.OPENROUTER_API_KEY) {
      signals.push({ kind: 'cli_credentials', detail: 'openrouter.key file' });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: signals.length ? 'high' : 'low',
    };
  },
  async fetchUsage(): Promise<UsageResult> {
    return fetchOpenRouterUsage();
  },
};

export { fetchOpenRouterUsage, mapOpenRouterKeyPayload } from './usage.js';
export default openrouterAdapter;
