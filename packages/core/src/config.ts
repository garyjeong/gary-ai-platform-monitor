import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_CONFIG,
  WIDGET_MAX_PINNED,
  type AppConfig,
  type ProviderPreference,
  type WidgetConfig,
} from './types.js';

/** Status-page poll bounds (seconds). Usage has its own per-provider TTL. */
export const HEALTH_INTERVAL_MIN = 30;
export const HEALTH_INTERVAL_MAX = 300;
export const HEALTH_INTERVAL_DEFAULT = 60;

/** showHealth is coupled to monitor (single UI toggle). */
const DEFAULT_PREF: ProviderPreference = {
  monitor: false,
  showHealth: false,
  userHidden: false,
};

/** `GAI_PM_CONFIG_DIR` overrides the location (tests, parallel dev builds). */
export function getConfigDir(): string {
  const override = process.env.GAI_PM_CONFIG_DIR?.trim();
  return override || path.join(os.homedir(), '.config', 'gary-ai-platform-monitor');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export interface LoadConfigResult {
  config: AppConfig;
  /** Set when an unreadable config.json was moved aside instead of being overwritten. */
  recoveredFrom?: string;
}

/**
 * Load config. A file that exists but cannot be parsed is renamed to
 * `config.json.corrupt-<timestamp>` so the next save never destroys the user's data.
 */
export function loadConfigWithStatus(): LoadConfigResult {
  const file = getConfigPath();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return { config: structuredClone(DEFAULT_CONFIG) };
  }
  try {
    const raw = JSON.parse(text) as Partial<AppConfig>;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('config root is not an object');
    }
    return { config: mergeConfig(DEFAULT_CONFIG, raw) };
  } catch {
    const backup = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      fs.renameSync(file, backup);
    } catch {
      // Leave it in place; saveConfig still writes atomically.
    }
    return { config: structuredClone(DEFAULT_CONFIG), recoveredFrom: backup };
  }
}

export function loadConfig(): AppConfig {
  return loadConfigWithStatus().config;
}

/** Atomic write: temp file in the same directory + rename. */
export function saveConfig(config: AppConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = getConfigPath();
  const tmp = path.join(dir, `.config.json.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify(normalizeConfig(config), null, 2) + '\n';
  try {
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

/** Read-modify-write in one place so every writer normalizes and saves atomically. */
export function updateConfig(mutate: (config: AppConfig) => AppConfig): AppConfig {
  const next = normalizeConfig(mutate(loadConfig()));
  saveConfig(next);
  return next;
}

export function normalizeProviderPref(
  partial?: Partial<ProviderPreference> | null
): ProviderPreference {
  const monitor =
    typeof partial?.monitor === 'boolean' ? partial.monitor : DEFAULT_PREF.monitor;
  const hidden =
    typeof partial?.userHidden === 'boolean' ? partial.userHidden : DEFAULT_PREF.userHidden;
  // Health is not independent: always follows monitor (unified toggle).
  // An explicit monitor:true wins over a leftover userHidden flag.
  return {
    monitor,
    showHealth: monitor,
    userHidden: monitor ? false : hidden,
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

export function setOpenAtLogin(config: AppConfig, openAtLogin: boolean): AppConfig {
  return { ...config, openAtLogin };
}

/**
 * Status-page interval migration (v0.4):
 * - 10–29s (old minimum range) → 30s
 * - 30–300s kept
 * - above 300s → 300s
 * - missing / non-numeric → 60s
 */
export function normalizeHealthInterval(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return HEALTH_INTERVAL_DEFAULT;
  return Math.round(Math.min(HEALTH_INTERVAL_MAX, Math.max(HEALTH_INTERVAL_MIN, n)));
}

export function normalizeConfig(config: AppConfig): AppConfig {
  const providers: AppConfig['providers'] = {};
  for (const [id, pref] of Object.entries(config.providers ?? {})) {
    providers[id] = normalizeProviderPref(pref);
  }
  return {
    ...config,
    health: {
      ...config.health,
      enabled: config.health?.enabled !== false,
      intervalSeconds: normalizeHealthInterval(config.health?.intervalSeconds),
      showInMenuBar: config.health?.showInMenuBar !== false,
    },
    scan: {
      intervalMinutes:
        typeof config.scan?.intervalMinutes === 'number' && config.scan.intervalMinutes > 0
          ? config.scan.intervalMinutes
          : DEFAULT_CONFIG.scan.intervalMinutes,
      includeBrowserCookies: Boolean(config.scan?.includeBrowserCookies),
    },
    openAtLogin: Boolean(config.openAtLogin),
    providers,
    defaults: {
      autoEnableOnFirstConnect: config.defaults?.autoEnableOnFirstConnect !== false,
    },
    widget: normalizeWidget(config.widget),
    resources: {
      showInPopover: config.resources?.showInPopover !== false,
      showInWidget: config.resources?.showInWidget !== false,
    },
  };
}

export function normalizeWidget(raw?: Partial<WidgetConfig> | null): WidgetConfig {
  const d = DEFAULT_CONFIG.widget;
  const pinned = Array.isArray(raw?.pinned)
    ? [...new Set(raw.pinned.filter((id): id is string => typeof id === 'string'))].slice(0, WIDGET_MAX_PINNED)
    : [];
  const opacity = typeof raw?.opacity === 'number' && Number.isFinite(raw.opacity) ? raw.opacity : d.opacity;
  const pos = raw?.position;
  const position =
    pos && [pos.displayId, pos.x, pos.y].every((n) => typeof n === 'number' && Number.isFinite(n))
      ? { displayId: pos.displayId, x: Math.round(pos.x), y: Math.round(pos.y) }
      : undefined;
  return {
    visible: typeof raw?.visible === 'boolean' ? raw.visible : d.visible,
    pinned,
    opacity: Math.round(Math.min(100, Math.max(40, opacity))),
    hideInScreenShare: Boolean(raw?.hideInScreenShare),
    ...(position ? { position } : {}),
  };
}

export function mergeConfig(base: AppConfig, raw: Partial<AppConfig>): AppConfig {
  const providers: AppConfig['providers'] = { ...base.providers };
  if (raw.providers && typeof raw.providers === 'object') {
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
    widget: { ...base.widget, ...raw.widget },
    resources: { ...base.resources, ...raw.resources },
  });
}

/**
 * Seed prefs for providers seen for the first time **and found**.
 * Not-found providers are left unseeded so that logging in later still auto-enables them.
 * Returns only the new entries (empty object when nothing to seed).
 */
export function seedProviderPrefs(
  config: AppConfig,
  detected: ReadonlyArray<{ id: string; found: boolean }>
): Record<string, ProviderPreference> {
  const patch: Record<string, ProviderPreference> = {};
  for (const { id, found } of detected) {
    if (!found || config.providers[id]) continue;
    const auto = config.defaults.autoEnableOnFirstConnect;
    patch[id] = normalizeProviderPref({ monitor: auto, userHidden: false });
  }
  return patch;
}
