/**
 * Build a full UI snapshot: discover + optional usage + health + preferences.
 * Provider work runs in parallel with concurrency limits.
 */

import type {
  AppConfig,
  HealthResult,
  ProviderAdapter,
  ProviderPreference,
  ProviderSnapshot,
  UsageResult,
} from './types.js';
import { getProviderPref, normalizeProviderPref } from './config.js';

export interface MenuBarProviderLine {
  id: string;
  displayName: string;
  usedPercent: number | null;
  health?: HealthResult['indicator'];
}

export interface MenuBarSummary {
  /** Empty = icon-only tray (no aggregate "AI n%") */
  title: string;
  lines: MenuBarProviderLine[];
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
  onConfigChange?: (config: AppConfig) => void;
  fetchHealth?: (
    providerId: string,
    meta: NonNullable<ProviderAdapter['meta']['status']>
  ) => Promise<HealthResult>;
  /** Max concurrent provider pipelines (detect+usage+health). Default 6. */
  concurrency?: number;
}

const DEFAULT_CONCURRENCY = 6;

export async function buildSnapshot(deps: SnapshotDeps): Promise<FullSnapshot> {
  const { adapters, fetchHealth } = deps;
  let config = structuredClone(deps.config);
  let configDirty = false;

  // Phase 1: detect all (cheap, local) — parallel
  const detects = await mapPool(adapters, deps.concurrency ?? DEFAULT_CONCURRENCY, async (adapter) => {
    try {
      return await adapter.detect();
    } catch {
      return { found: false, signals: [], confidence: 'low' as const };
    }
  });

  // Seed prefs for first-seen adapters
  for (let i = 0; i < adapters.length; i++) {
    const adapter = adapters[i]!;
    const detect = detects[i]!;
    if (!config.providers[adapter.meta.id]) {
      const auto =
        Boolean(detect.found && config.defaults.autoEnableOnFirstConnect);
      config.providers[adapter.meta.id] = normalizeProviderPref({
        monitor: auto,
        showHealth: auto,
        userHidden: false,
      });
      configDirty = true;
    } else {
      // Deep-normalize existing prefs
      config.providers[adapter.meta.id] = getProviderPref(config, adapter.meta.id);
    }
  }

  // Phase 2: usage + health per provider (parallel with concurrency)
  const providers = await mapPool(
    adapters.map((adapter, i) => ({ adapter, detect: detects[i]! })),
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    async ({ adapter, detect }) => {
      let pref = getProviderPref(config, adapter.meta.id);

      // Respect userHidden: never auto-force monitor on here (seed already handled)
      // If userHidden, keep monitor as stored (should be false after toggle off)
      if (pref.userHidden && pref.monitor) {
        pref = { ...pref, monitor: false };
        config.providers[adapter.meta.id] = pref;
        configDirty = true;
      }

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

      // Health only when globally enabled AND user wants health AND platform is monitored & found
      // (avoids status storms for every registered adapter)
      const wantHealth =
        config.health.enabled !== false &&
        pref.showHealth &&
        pref.monitor &&
        detect.found &&
        Boolean(adapter.meta.status) &&
        Boolean(fetchHealth) &&
        adapter.meta.status?.strategy !== 'custom';

      if (wantHealth && adapter.meta.status && fetchHealth) {
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

      return {
        meta: adapter.meta,
        lifecycle: resolveLifecycle(detect.found, pref, usage),
        detect,
        usage,
        health,
      } satisfies ProviderSnapshot;
    }
  );

  if (configDirty) {
    deps.onConfigChange?.(config);
  }

  // Stable order by display name
  providers.sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));

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
  if (!pref.monitor) return 'discovered';
  if (usage?.status === 'auth_required') return 'auth_error';
  if (usage?.status === 'ok') return 'monitored';
  if (usage?.status === 'unsupported') return 'unsupported';
  if (usage?.status === 'error' || usage?.status === 'stale') return 'connected';
  return 'monitored';
}

export function summarizeMenuBar(
  providers: ProviderSnapshot[],
  config: AppConfig
): MenuBarSummary {
  let worstHealth: HealthResult['indicator'] = 'none';
  const rank: Record<string, number> = {
    none: 0,
    maintenance: 1,
    minor: 2,
    major: 3,
    critical: 4,
    unknown: 1,
  };
  const lines: MenuBarProviderLine[] = [];

  for (const p of providers) {
    const pref = getProviderPref(config, p.meta.id);
    if (!pref.monitor) continue;

    // Prefer first % window (adapters order primary first); do not take max across windows
    let usedPercent: number | null = null;
    if (p.usage?.windows) {
      for (const w of p.usage.windows) {
        if (typeof w.usedPercent === 'number') {
          usedPercent = w.usedPercent;
          break;
        }
      }
    }

    let health: HealthResult['indicator'] | undefined;
    if (pref.showHealth && p.health && config.health.showInMenuBar) {
      health = p.health.indicator;
      const r = rank[p.health.indicator] ?? 0;
      if (r > (rank[worstHealth] ?? 0)) worstHealth = p.health.indicator;
    }

    lines.push({
      id: p.meta.id,
      displayName: p.meta.displayName,
      usedPercent,
      health,
    });
  }

  return { title: '', lines, worstHealth };
}

/** Simple async pool */
async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}
