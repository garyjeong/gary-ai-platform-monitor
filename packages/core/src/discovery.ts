import { listAdapters } from './registry.js';
import type { DetectResult, ProviderAdapter, ProviderSnapshot } from './types.js';

export interface DiscoveryEntry {
  adapter: ProviderAdapter;
  detect: DetectResult;
}

/**
 * Run local detect() for every registered adapter.
 * Does not call fetchUsage or health.
 */
export async function scanProviders(
  adapters: ProviderAdapter[] = listAdapters()
): Promise<DiscoveryEntry[]> {
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const detect = await adapter.detect();
        return { adapter, detect };
      } catch {
        return {
          adapter,
          detect: {
            found: false,
            signals: [],
            confidence: 'low' as const,
          },
        };
      }
    })
  );
  return results;
}

export function lifecycleFromDetect(
  detect: DetectResult,
  monitor: boolean
): ProviderSnapshot['lifecycle'] {
  if (!detect.found) return 'not_found';
  if (monitor) return 'monitored';
  return 'discovered';
}
