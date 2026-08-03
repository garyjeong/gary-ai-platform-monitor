/**
 * Wired runtime: all seed adapters + config + snapshot + health.
 */

import {
  buildSnapshot,
  clearAdapters,
  getProviderPref,
  listAdapters,
  loadConfig,
  registerAdapter,
  saveConfig,
  setOpenAtLogin,
  setProviderMonitor,
  setProviderShowHealth,
  type AppConfig,
  type FullSnapshot,
  type ProviderAdapter,
} from '@gary-ai-platform-monitor/core';
import { fetchProviderHealth } from '@gary-ai-platform-monitor/health';
import { claudeAdapter } from '@gary-ai-platform-monitor/adapter-claude';
import { codexAdapter } from '@gary-ai-platform-monitor/adapter-codex';
import { grokAdapter } from '@gary-ai-platform-monitor/adapter-grok';
import { geminiAdapter } from '@gary-ai-platform-monitor/adapter-gemini';
import { openrouterAdapter } from '@gary-ai-platform-monitor/adapter-openrouter';
import { cursorAdapter } from '@gary-ai-platform-monitor/adapter-cursor';

let registered = false;

export function ensureSeedAdapters(): ProviderAdapter[] {
  if (!registered) {
    clearAdapters();
    for (const a of [
      claudeAdapter,
      codexAdapter,
      grokAdapter,
      geminiAdapter,
      openrouterAdapter,
      cursorAdapter,
    ]) {
      registerAdapter(a);
    }
    registered = true;
  }
  return listAdapters();
}

export async function takeSnapshot(config?: AppConfig): Promise<FullSnapshot> {
  const adapters = ensureSeedAdapters();
  let cfg = config ?? loadConfig();
  return buildSnapshot({
    adapters,
    config: cfg,
    onConfigChange: (next) => {
      saveConfig(next);
      cfg = next;
    },
    fetchHealth: (id, meta) => fetchProviderHealth(id, meta),
  });
}

export function updateMonitor(providerId: string, monitor: boolean): AppConfig {
  const next = setProviderMonitor(loadConfig(), providerId, monitor);
  saveConfig(next);
  return next;
}

export function updateShowHealth(providerId: string, showHealth: boolean): AppConfig {
  const next = setProviderShowHealth(loadConfig(), providerId, showHealth);
  saveConfig(next);
  return next;
}

export function updateHealthInterval(seconds: number): AppConfig {
  const cfg = loadConfig();
  const next: AppConfig = {
    ...cfg,
    health: {
      ...cfg.health,
      intervalSeconds: Math.min(60, Math.max(10, seconds)),
    },
  };
  saveConfig(next);
  return next;
}

export function updateOpenAtLogin(openAtLogin: boolean): AppConfig {
  const next = setOpenAtLogin(loadConfig(), openAtLogin);
  saveConfig(next);
  return next;
}

export function updateIncludeBrowserCookies(include: boolean): AppConfig {
  const cfg = loadConfig();
  const next: AppConfig = {
    ...cfg,
    scan: { ...cfg.scan, includeBrowserCookies: include },
  };
  saveConfig(next);
  return next;
}

export {
  loadConfig,
  saveConfig,
  getProviderPref,
  listAdapters,
  type FullSnapshot,
  type AppConfig,
};
