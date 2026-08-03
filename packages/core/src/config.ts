import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_CONFIG, type AppConfig, type ProviderPreference } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gary-ai-platform-monitor');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/** showHealth is coupled to monitor (single UI toggle). */
const DEFAULT_PREF: ProviderPreference = {
  monitor: false,
  showHealth: false,
  userHidden: false,
};

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return structuredClone(DEFAULT_CONFIG);
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as Partial<AppConfig>;
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const normalized = normalizeConfig(config);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2) + '\n', {
    mode: 0o600,
  });
}

export function normalizeProviderPref(
  partial?: Partial<ProviderPreference> | null
): ProviderPreference {
  const monitor =
    typeof partial?.monitor === 'boolean' ? partial.monitor : DEFAULT_PREF.monitor;
  // Health is not independent: always follows monitor (unified toggle).
  return {
    monitor,
    showHealth: monitor,
    userHidden:
      typeof partial?.userHidden === 'boolean' ? partial.userHidden : DEFAULT_PREF.userHidden,
  };
}

export function getProviderPref(
  config: AppConfig,
  providerId: string
): ProviderPreference {
  return normalizeProviderPref(config.providers[providerId]);
}

/**
 * Unified platform toggle (usage + health).
 * OFF → userHidden so auto-seed will not re-enable.
 * ON  → clears userHidden; showHealth follows monitor.
 */
export function setProviderMonitor(
  config: AppConfig,
  providerId: string,
  monitor: boolean
): AppConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        monitor,
        showHealth: monitor,
        userHidden: monitor ? false : true,
      },
    },
  };
}

/**
 * @deprecated Health is coupled to monitor. Kept for IPC compat — delegates to setProviderMonitor.
 */
export function setProviderShowHealth(
  config: AppConfig,
  providerId: string,
  showHealth: boolean
): AppConfig {
  return setProviderMonitor(config, providerId, showHealth);
}

export function setOpenAtLogin(config: AppConfig, openAtLogin: boolean): AppConfig {
  return { ...config, openAtLogin };
}

function normalizeConfig(config: AppConfig): AppConfig {
  const sec = config.health.intervalSeconds;
  const clamped = Math.min(60, Math.max(10, Number.isFinite(sec) ? sec : 30));
  const providers: AppConfig['providers'] = {};
  for (const [id, pref] of Object.entries(config.providers ?? {})) {
    providers[id] = normalizeProviderPref(pref);
  }
  return {
    ...config,
    health: {
      ...config.health,
      enabled: config.health.enabled !== false,
      intervalSeconds: clamped,
      showInMenuBar: config.health.showInMenuBar !== false,
    },
    scan: {
      intervalMinutes:
        typeof config.scan.intervalMinutes === 'number' && config.scan.intervalMinutes > 0
          ? config.scan.intervalMinutes
          : DEFAULT_CONFIG.scan.intervalMinutes,
      includeBrowserCookies: Boolean(config.scan.includeBrowserCookies),
    },
    openAtLogin: Boolean(config.openAtLogin),
    providers,
    defaults: {
      autoEnableOnFirstConnect: config.defaults?.autoEnableOnFirstConnect !== false,
    },
  };
}

export function mergeConfig(base: AppConfig, raw: Partial<AppConfig>): AppConfig {
  const providers: AppConfig['providers'] = { ...base.providers };
  if (raw.providers) {
    for (const [id, pref] of Object.entries(raw.providers)) {
      providers[id] = normalizeProviderPref({
        ...providers[id],
        ...pref,
      });
    }
  }
  return normalizeConfig({
    scan: { ...base.scan, ...raw.scan },
    health: { ...base.health, ...raw.health },
    openAtLogin:
      typeof raw.openAtLogin === 'boolean' ? raw.openAtLogin : base.openAtLogin,
    providers,
    defaults: { ...base.defaults, ...raw.defaults },
  });
}
