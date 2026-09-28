import type { HealthResult, ProviderAdapter, ProviderStatusMeta } from '@gary-ai-platform-monitor/core';
import { fetchStatuspageHealth } from './statuspage.js';
import { fetchRssHealth } from './rss.js';
import { unreachable, type HealthFetchOptions } from './result.js';

export { parseStatuspageSummary, fetchStatuspageHealth, matchesWatch } from './statuspage.js';
export {
  parseRssHealth,
  fetchRssHealth,
  severityToIndicator,
  STALE_OPEN_INCIDENT_MS,
  type RssIncident,
  type RssParseOptions,
} from './rss.js';
export type { HealthFetchOptions } from './result.js';

/**
 * Poll health for adapters that declare status metadata.
 * Never throws; failures become indicator "unknown" with an errorKind.
 * No notifications — UI updates only.
 */
export async function pollHealth(
  adapters: ProviderAdapter[],
  options?: HealthFetchOptions
): Promise<HealthResult[]> {
  const withStatus = adapters.filter((a) => a.meta.status);
  return Promise.all(
    withStatus.map((a) => fetchProviderHealth(a.meta.id, a.meta.status!, options))
  );
}

/** One provider, one attempt. Never throws; the scheduler owns retries/backoff. */
export async function fetchProviderHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  options?: HealthFetchOptions
): Promise<HealthResult> {
  try {
    switch (meta.strategy) {
      case 'statuspage_v2':
        return await fetchStatuspageHealth(providerId, meta, options);
      case 'rss':
        return await fetchRssHealth(providerId, meta, options);
      case 'custom':
        return unreachable(providerId, meta, 'custom strategy not implemented', 'unsupported');
      default:
        return unreachable(providerId, meta, 'unknown strategy', 'unsupported');
    }
  } catch {
    return unreachable(providerId, meta, 'request failed', 'unknown');
  }
}
