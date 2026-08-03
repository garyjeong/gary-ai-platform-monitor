/**
 * Lightweight adapters for local apps where cloud quota % is limited.
 * Detection + best-effort usage (often activity counts, not plan %).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  DetectResult,
  DetectSignal,
  ProviderAdapter,
  UsageResult,
} from '@gary-ai-platform-monitor/core';

const HOME = os.homedir();

function exists(...parts: string[]): string | null {
  const p = path.join(HOME, ...parts);
  return fs.existsSync(p) ? p : null;
}

function detectPaths(
  paths: Array<{ path: string; kind?: DetectSignal['kind'] }>
): DetectResult {
  const signals: DetectSignal[] = [];
  for (const { path: p, kind } of paths) {
    if (fs.existsSync(p)) {
      signals.push({ kind: kind ?? 'local_app_config', detail: p });
    }
  }
  return {
    found: signals.length > 0,
    signals,
    confidence: signals.length ? 'medium' : 'low',
  };
}

function activityUsage(
  id: string,
  label: string,
  absolute: number | null,
  note: string
): UsageResult {
  if (absolute === null) {
    return {
      providerId: id,
      windows: [],
      status: 'unsupported',
      updatedAt: Date.now(),
      errorMessage: note,
    };
  }
  return {
    providerId: id,
    windows: [
      {
        id: 'activity',
        usedPercent: null,
        label,
        source: 'local',
        usedAbsolute: absolute,
        unit: 'messages',
      },
    ],
    status: 'ok',
    updatedAt: Date.now(),
    errorMessage: note,
  };
}

/** ChatGPT macOS desktop app */
export const chatgptDesktopAdapter: ProviderAdapter = {
  meta: {
    id: 'chatgpt-desktop',
    displayName: 'ChatGPT Desktop',
    status: {
      pageUrl: 'https://status.openai.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.openai.com/api/v2/summary.json',
    },
    capabilities: { percentWindows: false, costOnly: false, multiWindow: false },
  },
  async detect() {
    return detectPaths([
      {
        path: path.join(HOME, 'Library/Application Support/com.openai.chat'),
      },
      {
        path: '/Applications/ChatGPT.app',
        kind: 'local_app_config',
      },
    ]);
  },
  async fetchUsage() {
    return activityUsage(
      'chatgpt-desktop',
      'installed',
      1,
      'Plan quota is on Codex/ChatGPT web — use Codex adapter for %'
    );
  },
};

/** Warp terminal AI */
export const warpAdapter: ProviderAdapter = {
  meta: {
    id: 'warp',
    displayName: 'Warp',
    status: { pageUrl: 'https://www.warp.dev', strategy: 'custom' },
    capabilities: { percentWindows: false, costOnly: false, multiWindow: false },
  },
  async detect() {
    return detectPaths([
      {
        path: path.join(
          HOME,
          'Library/Application Support/dev.warp.Warp-Stable'
        ),
      },
      { path: '/Applications/Warp.app' },
    ]);
  },
  async fetchUsage() {
    const root = path.join(
      HOME,
      'Library/Application Support/dev.warp.Warp-Stable'
    );
    let files = 0;
    try {
      if (fs.existsSync(root)) {
        files = fs.readdirSync(root).length;
      }
    } catch {
      files = 0;
    }
    return activityUsage(
      'warp',
      'config entries',
      files || null,
      'Warp AI credit % needs Warp API token (not in free local files)'
    );
  },
};

/** Factory (droid) */
export const factoryAdapter: ProviderAdapter = {
  meta: {
    id: 'factory',
    displayName: 'Factory',
    status: {
      pageUrl: 'https://status.factory.ai',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.factory.ai/api/v2/summary.json',
    },
    capabilities: { percentWindows: false, costOnly: false, multiWindow: false },
  },
  async detect() {
    const d = detectPaths([{ path: path.join(HOME, '.factory') }]);
    if (process.env.FACTORY_API_KEY) {
      d.found = true;
      d.signals.push({ kind: 'env_api_key', detail: 'FACTORY_API_KEY' });
      d.confidence = 'high';
    }
    return d;
  },
  async fetchUsage() {
    if (process.env.FACTORY_API_KEY) {
      return {
        providerId: 'factory',
        windows: [],
        status: 'unsupported',
        updatedAt: Date.now(),
        errorMessage: 'FACTORY_API_KEY set — wire usage API when endpoint documented',
      };
    }
    return activityUsage(
      'factory',
      'config present',
      exists('.factory') ? 1 : null,
      'Set FACTORY_API_KEY for quota (local settings have no %)'
    );
  },
};

/** Amp */
export const ampAdapter: ProviderAdapter = {
  meta: {
    id: 'amp',
    displayName: 'Amp',
    status: { pageUrl: 'https://ampcode.com', strategy: 'custom' },
    capabilities: { percentWindows: false, costOnly: false, multiWindow: false },
  },
  async detect() {
    return detectPaths([{ path: path.join(HOME, '.config/amp') }]);
  },
  async fetchUsage() {
    return activityUsage(
      'amp',
      'config present',
      exists('.config', 'amp') ? 1 : null,
      'Run `amp usage` / Amp token for live credits (not bundled yet)'
    );
  },
};

/** Kiro */
export const kiroAdapter: ProviderAdapter = {
  meta: {
    id: 'kiro',
    displayName: 'Kiro',
    status: { pageUrl: 'https://kiro.dev', strategy: 'custom' },
    capabilities: { percentWindows: false, costOnly: false, multiWindow: false },
  },
  async detect() {
    return detectPaths([{ path: path.join(HOME, '.kiro') }]);
  },
  async fetchUsage() {
    return activityUsage(
      'kiro',
      'config present',
      exists('.kiro') ? 1 : null,
      'Install kiro-cli and login for /usage credits %'
    );
  },
};

/** Kilo */
export const kiloAdapter: ProviderAdapter = {
  meta: {
    id: 'kilo',
    displayName: 'Kilo',
    status: { pageUrl: 'https://kilo.ai', strategy: 'custom' },
    capabilities: { percentWindows: false, costOnly: false, multiWindow: false },
  },
  async detect() {
    return detectPaths([{ path: path.join(HOME, '.local/share/kilo') }]);
  },
  async fetchUsage() {
    return activityUsage(
      'kilo',
      'local data',
      exists('.local', 'share', 'kilo') ? 1 : null,
      'Kilo Pass API token needed for plan %'
    );
  },
};

export const APP_ADAPTERS: ProviderAdapter[] = [
  chatgptDesktopAdapter,
  warpAdapter,
  factoryAdapter,
  ampAdapter,
  kiroAdapter,
  kiloAdapter,
];
