import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_CONFIG, type AppConfig, type ProviderPreference } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gary-ai-platform-monitor');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

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
  const normalized = normalizeHealthInterval(config);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(normalized, null, 2) + '\n', {
    mode: 0o600,
  });
}

export function getProviderPref(
  config: AppConfig,
  providerId: string
): ProviderPreference {
  return (
    config.providers[providerId] ?? {
      monitor: false,
      showHealth: true,
      userHidden: false,
    }
  );
}

export function setProviderMonitor(
  config: AppConfig,
  providerId: string,
  monitor: boolean
): AppConfig {
  const prev = getProviderPref(config, providerId);
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...prev,
        monitor,
        // Turning off is an explicit user choice — do not auto-enable again
        userHidden: monitor ? prev.userHidden : false,
      },
    },
  };
}

export function setProviderShowHealth(
  config: AppConfig,
  providerId: string,
  showHealth: boolean
): AppConfig {
  const prev = getProviderPref(config, providerId);
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: { ...prev, showHealth },
    },
  };
}

function normalizeHealthInterval(config: AppConfig): AppConfig {
  const sec = config.health.intervalSeconds;
  const clamped = Math.min(60, Math.max(10, Number.isFinite(sec) ? sec : 30));
  return {
    ...config,
    health: { ...config.health, intervalSeconds: clamped },
  };
}

function mergeConfig(base: AppConfig, raw: Partial<AppConfig>): AppConfig {
  return normalizeHealthInterval({
    scan: { ...base.scan, ...raw.scan },
    health: { ...base.health, ...raw.health },
    providers: { ...base.providers, ...raw.providers },
    defaults: { ...base.defaults, ...raw.defaults },
  });
}
