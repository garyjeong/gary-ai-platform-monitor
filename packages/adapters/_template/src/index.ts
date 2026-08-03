/**
 * Template adapter — copy to packages/adapters/<id>/ and fill in.
 */
import type { ProviderAdapter } from '@gary-ai-platform-monitor/core';

export const templateAdapter: ProviderAdapter = {
  meta: {
    id: 'example',
    displayName: 'Example',
    // status: { pageUrl: 'https://status.example.com', strategy: 'statuspage_v2' },
    capabilities: {
      percentWindows: false,
      costOnly: false,
      multiWindow: false,
    },
  },
  async detect() {
    return { found: false, signals: [], confidence: 'low' };
  },
  async fetchUsage() {
    return {
      providerId: 'example',
      windows: [],
      status: 'unsupported',
      updatedAt: Date.now(),
    };
  },
};
