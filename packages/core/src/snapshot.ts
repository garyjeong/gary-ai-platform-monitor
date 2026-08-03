/**
 * Build a full UI snapshot: discover + optional usage + health + preferences.
 */

import type {
  AppConfig,
  HealthResult,
  ProviderAdapter,
  ProviderPreference,
  ProviderSnapshot,
  UsageResult,
} from './types.js';
import { getProviderPref } from './config.js';

export interface MenuBarSummary {
  /** Compact title for tray, e.g. "AI 71%" or "AI" */
  title: string;
  /** Highest usedPercent among monitored providers (null if none) */
  maxUsedPercent: number | null;
  worstHealth: HealthResult['indicator'];
}

export interface FullSnapshot {
  updatedAt: string;
  providers: ProviderSnapshot[];
  menuBar: MenuBarSummary;
  config: AppConfig;
}

export interface SnapshotDeps {
  adapters: ProviderAdapter[];
  config: AppConfig;
  /** Called when discovery auto-seeds new provider prefs */
  onConfigChange?: (config: AppConfig) => void;
  fetchHealth?: (
    providerId: string,
    meta: NonNullable<ProviderAdapter['meta']['status']>
  ) => Promise<HealthResult>;
}

export async function buildSnapshot(deps: SnapshotDeps): Promise<FullSnapshot> {
  const { adapters, fetchHealth } = deps;
  let config = structuredClone(deps.config);
  let configDirty = false;

  const providers: ProviderSnapshot[] = [];

  for (const adapter of adapters) {
    let detect;
    try {
      detect = await adapter.detect();
    } catch {
      detect = { found: false, signals: [], confidence: 'low' as const };
    }

    // First time we see a provider id: seed prefs (auto-enable if found)
    if (!config.providers[adapter.meta.id]) {
      config.providers[adapter.meta.id] = {
        monitor: Boolean(detect.found && config.defaults.autoEnableOnFirstConnect),
        showHealth: true,
        userHidden: false,
      };
      configDirty = true;
    }

    const pref = getProviderPref(config, adapter.meta.id);

    let usage: UsageResult | null = null;
    let health: HealthResult | null = null;

    if (detect.found && pref.monitor) {
      try {
        usage = await adapter.fetchUsage({
          includeBrowserCookies: config.scan.includeBrowserCookies,
        });
      } catch (err) {
        usage = {
          providerId: adapter.meta.id,
          windows: [],
          status: 'error',
          updatedAt: Date.now(),
          errorMessage: err instanceof Error ? err.message : 'fetch failed',
        };
      }
    }

    if (pref.showHealth && adapter.meta.status && fetchHealth) {
      try {
        health = await fetchHealth(adapter.meta.id, adapter.meta.status);
      } catch {
        health = {
          providerId: adapter.meta.id,
          indicator: 'unknown',
          description: 'Health fetch failed',
          pageUrl: adapter.meta.status.pageUrl,
          components: [],
          updatedAt: Date.now(),
          unreachable: true,
        };
      }
    }

    providers.push({
      meta: adapter.meta,
      lifecycle: resolveLifecycle(detect.found, pref, usage),
      detect,
      usage,
      health,
    });
  }

  if (configDirty) {
    deps.onConfigChange?.(config);
  }

  return {
    updatedAt: new Date().toISOString(),
    providers,
    menuBar: summarizeMenuBar(providers, config),
    config,
  };
}

function resolveLifecycle(
  found: boolean,
  pref: ProviderPreference,
  usage: UsageResult | null
): ProviderSnapshot['lifecycle'] {
  if (!found) return 'not_found';
  if (usage?.status === 'auth_required') return 'auth_error';
  if (pref.monitor && usage?.status === 'ok') return 'monitored';
  if (pref.monitor && usage && usage.status !== 'ok') {
    if (usage.status === 'unsupported') return 'unsupported';
    return 'connected';
  }
  if (pref.monitor) return 'monitored';
  return 'discovered';
}

export function summarizeMenuBar(
  providers: ProviderSnapshot[],
  config: AppConfig
): MenuBarSummary {
  let maxUsedPercent: number | null = null;
  let worstHealth: HealthResult['indicator'] = 'none';
  const rank: Record<string, number> = {
    none: 0,
    maintenance: 1,
    minor: 2,
    major: 3,
    critical: 4,
    unknown: 1,
  };

  for (const p of providers) {
    const pref = getProviderPref(config, p.meta.id);
    if (!pref.monitor) continue;

    if (p.usage?.windows) {
      for (const w of p.usage.windows) {
        if (typeof w.usedPercent === 'number') {
          maxUsedPercent =
            maxUsedPercent === null
              ? w.usedPercent
              : Math.max(maxUsedPercent, w.usedPercent);
        }
      }
    }

    if (pref.showHealth && p.health && config.health.showInMenuBar) {
      const r = rank[p.health.indicator] ?? 0;
      if (r > (rank[worstHealth] ?? 0)) worstHealth = p.health.indicator;
    }
  }

  let title = 'AI';
  if (maxUsedPercent !== null) {
    title = `AI ${Math.round(maxUsedPercent)}%`;
  }
  if (
    config.health.showInMenuBar &&
    (worstHealth === 'minor' ||
      worstHealth === 'major' ||
      worstHealth === 'critical' ||
      worstHealth === 'maintenance')
  ) {
    title += worstHealth === 'critical' || worstHealth === 'major' ? ' ⚠' : ' ·';
  }

  return { title, maxUsedPercent, worstHealth };
}
