/**
 * Wired runtime: every registered adapter + health + collector.
 *
 * - The menu bar app runs `createAppCollector()` inside an Electron utility process.
 * - The CLI uses `takeSnapshot()` (one-shot, read-only unless persist is requested).
 * - Config writes go through core `updateConfig()` (atomic) in exactly one process.
 */

import {
  Collector,
  collectOnce,
  clearAdapters,
  getProviderPref,
  listAdapters,
  loadConfig,
  registerAdapter,
  setOpenAtLogin,
  setProviderMonitor,
  updateConfig,
  type AppConfig,
  type CollectorDeps,
  type FullSnapshot,
  type ProviderAdapter,
  type ProviderPreference,
} from '@gary-ai-platform-monitor/core';
import { fetchProviderHealth } from '@gary-ai-platform-monitor/health';
import { claudeAdapter } from '@gary-ai-platform-monitor/adapter-claude';
import { codexAdapter } from '@gary-ai-platform-monitor/adapter-codex';
import { grokAdapter } from '@gary-ai-platform-monitor/adapter-grok';
import { geminiAdapter } from '@gary-ai-platform-monitor/adapter-gemini';
import { openrouterAdapter } from '@gary-ai-platform-monitor/adapter-openrouter';
import { cursorAdapter } from '@gary-ai-platform-monitor/adapter-cursor';
import { copilotAdapter } from '@gary-ai-platform-monitor/adapter-copilot';
import { ollamaAdapter } from '@gary-ai-platform-monitor/adapter-ollama';
import { opencodeAdapter } from '@gary-ai-platform-monitor/adapter-opencode';
import { APP_ADAPTERS } from '@gary-ai-platform-monitor/adapter-apps';

/** Single source of truth for which adapters ship (app, CLI and dev scripts). */
export const ALL_ADAPTERS: readonly ProviderAdapter[] = [
  claudeAdapter,
  codexAdapter,
  grokAdapter,
  geminiAdapter,
  openrouterAdapter,
  cursorAdapter,
  copilotAdapter,
  ollamaAdapter,
  opencodeAdapter,
  ...APP_ADAPTERS,
];

let registered = false;

export function ensureSeedAdapters(): ProviderAdapter[] {
  if (!registered) {
    clearAdapters();
    for (const a of ALL_ADAPTERS) registerAdapter(a);
    registered = true;
  }
  return listAdapters();
}

export function providerIds(): string[] {
  return ALL_ADAPTERS.map((a) => a.meta.id);
}

const fetchHealth: NonNullable<CollectorDeps['fetchHealth']> = (id, meta) =>
  fetchProviderHealth(id, meta);

/** Long-lived collector for the app. The caller owns config persistence. */
export function createAppCollector(
  opts: Pick<CollectorDeps, 'config' | 'onChange' | 'onConfigProposal'>
): Collector {
  return new Collector({
    adapters: ensureSeedAdapters(),
    fetchHealth,
    ...opts,
  });
}

/**
 * One-shot snapshot (CLI). Read-only by default: first-seen providers are shown as
 * seeded in the output but config.json is only written when `persist` is true.
 */
export async function takeSnapshot(
  options: { config?: AppConfig; persist?: boolean } = {}
): Promise<FullSnapshot> {
  return collectOnce({
    adapters: ensureSeedAdapters(),
    config: options.config ?? loadConfig(),
    fetchHealth,
    onConfigProposal: options.persist ? persistSeed : undefined,
  });
}

/** Apply first-detect seeding without overwriting prefs written meanwhile. */
export function persistSeed(patch: Record<string, ProviderPreference>): AppConfig {
  return updateConfig((cfg) => {
    const providers = { ...cfg.providers };
    for (const [id, pref] of Object.entries(patch)) {
      if (!providers[id]) providers[id] = pref;
    }
    return { ...cfg, providers };
  });
}

export function updateMonitor(providerId: string, monitor: boolean): AppConfig {
  return updateConfig((cfg) => setProviderMonitor(cfg, providerId, monitor));
}

/** Batch monitor updates (one load/save) for Settings bulk actions. */
export function updateMonitors(
  updates: ReadonlyArray<{ providerId: string; monitor: boolean }>
): AppConfig {
  return updateConfig((cfg) =>
    updates.reduce((acc, u) => setProviderMonitor(acc, u.providerId, u.monitor), cfg)
  );
}

export function updateHealthInterval(seconds: number): AppConfig {
  return updateConfig((cfg) => ({
    ...cfg,
    health: { ...cfg.health, intervalSeconds: seconds },
  }));
}

export function updateOpenAtLogin(openAtLogin: boolean): AppConfig {
  return updateConfig((cfg) => setOpenAtLogin(cfg, openAtLogin));
}

export function updateIncludeBrowserCookies(include: boolean): AppConfig {
  return updateConfig((cfg) => ({
    ...cfg,
    scan: { ...cfg.scan, includeBrowserCookies: include },
  }));
}

export { loadConfig, getProviderPref, listAdapters, type FullSnapshot, type AppConfig };
