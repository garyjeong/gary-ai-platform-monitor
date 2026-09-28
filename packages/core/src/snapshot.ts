/**
 * Snapshot shape shared by the collector, CLI and UI, plus pure helpers.
 * Fetching lives in collector.ts.
 */

import type {
  AppConfig,
  HealthResult,
  ProviderPreference,
  ProviderSnapshot,
  UsageResult,
  UsageWindow,
} from './types.js';
import { getProviderPref } from './config.js';

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

export function resolveLifecycle(
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

/** A fixed window whose reset time is already behind us: its % is no longer current. */
export function isResetPassed(window: UsageWindow, nowMs = Date.now()): boolean {
  if (window.windowKind === 'rolling') return false;
  return typeof window.resetsAt === 'number' && window.resetsAt * 1000 <= nowMs;
}

export function summarizeMenuBar(
  providers: ProviderSnapshot[],
  config: AppConfig,
  nowMs = Date.now()
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

    // First current % window (adapters order primary first); never max across windows.
    let usedPercent: number | null = null;
    for (const w of p.usage?.windows ?? []) {
      if (typeof w.usedPercent === 'number' && !isResetPassed(w, nowMs)) {
        usedPercent = w.usedPercent;
        break;
      }
    }

    let health: HealthResult['indicator'] | undefined;
    if (pref.showHealth && p.health && config.health.showInMenuBar) {
      health = p.health.indicator;
      const r = rank[p.health.indicator] ?? 0;
      if (r > (rank[worstHealth] ?? 0)) worstHealth = p.health.indicator;
    }

    lines.push({ id: p.meta.id, displayName: p.meta.displayName, usedPercent, health });
  }

  return { title: '', lines, worstHealth };
}
