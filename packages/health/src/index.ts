import type { HealthResult, ProviderAdapter, ProviderStatusMeta } from '@gary-ai-platform-monitor/core';
import { fetchStatuspageHealth } from './statuspage.js';

export { parseStatuspageSummary, fetchStatuspageHealth } from './statuspage.js';

/**
 * Poll health for adapters that declare status metadata.
 * Never throws; failures become indicator "unknown".
 * No notifications — UI updates only.
 */
export async function pollHealth(
  adapters: ProviderAdapter[],
  options?: { timeoutMs?: number }
): Promise<HealthResult[]> {
  const withStatus = adapters.filter((a) => a.meta.status);
  return Promise.all(
    withStatus.map((a) => fetchProviderHealth(a.meta.id, a.meta.status!, options))
  );
}

export async function fetchProviderHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  options?: { timeoutMs?: number }
): Promise<HealthResult> {
  switch (meta.strategy) {
    case 'statuspage_v2':
      return fetchStatuspageHealth(providerId, meta, options);
    case 'rss':
    case 'custom':
      // Phase 4+: Grok/xAI and other non-Statuspage sources
      return {
        providerId,
        indicator: 'unknown',
        description: `Health strategy "${meta.strategy}" not implemented yet`,
        pageUrl: meta.pageUrl,
        components: [],
        updatedAt: Date.now(),
        unreachable: true,
      };
    default:
      return {
        providerId,
        indicator: 'unknown',
        description: 'Unknown health strategy',
        pageUrl: meta.pageUrl,
        components: [],
        updatedAt: Date.now(),
        unreachable: true,
      };
  }
}
