/**
 * Shared types for gary-ai-platform-monitor.
 *
 * Discovery (local login signals) is separate from monitoring (user toggle)
 * and from health (public status pages).
 */

export type Confidence = 'high' | 'medium' | 'low';

export type ProviderLifecycle =
  | 'not_found'
  | 'discovered'
  | 'connected'
  | 'monitored'
  | 'paused'
  | 'auth_error'
  | 'unsupported';

export type DetectSignalKind =
  | 'cli_credentials'
  | 'session_dir'
  | 'keychain'
  | 'browser_cookie'
  | 'env_api_key'
  | 'local_app_config';

export interface DetectSignal {
  kind: DetectSignalKind;
  /** Path, keychain service name, domain, or env var name — never secret values */
  detail: string;
}

export interface DetectResult {
  found: boolean;
  signals: DetectSignal[];
  /** Masked account hint only (e.g. g***@example.com) */
  accountHint?: string;
  confidence: Confidence;
}

export type UsageWindowId = '5h' | '7d' | 'weekly' | 'monthly' | 'daily' | string;

export type UsageSource = 'oauth' | 'local' | 'browser' | 'estimated' | 'cli';

export interface UsageWindow {
  id: UsageWindowId;
  /** Prefer percent. null when the provider cannot expose quota % */
  usedPercent: number | null;
  resetsAt?: number;
  label?: string;
  source: UsageSource;
  /** Optional absolute units when % is unavailable */
  usedAbsolute?: number;
  limitAbsolute?: number;
  unit?: 'tokens' | 'usd' | 'credits' | 'messages' | string;
}

export type FetchStatus = 'ok' | 'auth_required' | 'stale' | 'unsupported' | 'error';

export interface UsageResult {
  providerId: string;
  windows: UsageWindow[];
  status: FetchStatus;
  updatedAt: number;
  errorMessage?: string;
}

export type HealthStrategy = 'statuspage_v2' | 'rss' | 'custom';

export type HealthIndicator =
  | 'none'
  | 'minor'
  | 'major'
  | 'critical'
  | 'maintenance'
  | 'unknown';

export interface ComponentHealth {
  name: string;
  status: string;
}

export interface HealthResult {
  providerId: string;
  indicator: HealthIndicator;
  description: string;
  pageUrl: string;
  components: ComponentHealth[];
  updatedAt: number;
  /** True when the status source could not be parsed or reached */
  unreachable?: boolean;
}

export interface ProviderStatusMeta {
  pageUrl: string;
  strategy: HealthStrategy;
  summaryUrl?: string;
  /** Prefer these component names when summarizing */
  watchComponents?: string[];
}

export interface ProviderMeta {
  id: string;
  displayName: string;
  status?: ProviderStatusMeta;
  capabilities: {
    percentWindows: boolean;
    costOnly: boolean;
    multiWindow: boolean;
  };
}

export interface AuthContext {
  /** Reserved for future cookie/key material; never log contents */
  [key: string]: unknown;
}

/**
 * Contract every platform adapter must implement.
 */
export interface ProviderAdapter {
  meta: ProviderMeta;
  /** Local, network-free (or minimal) presence check */
  detect(): Promise<DetectResult>;
  /** Fetch quota windows when credentials/signals allow */
  fetchUsage(ctx?: AuthContext): Promise<UsageResult>;
}

export interface ProviderPreference {
  monitor: boolean;
  showHealth: boolean;
  userHidden: boolean;
}

export interface AppConfig {
  scan: {
    intervalMinutes: number;
    includeBrowserCookies: boolean;
  };
  health: {
    enabled: boolean;
    /** Default 30; allowed range 10–60 */
    intervalSeconds: number;
    showInMenuBar: boolean;
  };
  /** Start menu bar app when the user logs into macOS (Electron login item) */
  openAtLogin: boolean;
  /** Notifications are intentionally unsupported in v1 */
  providers: Record<string, ProviderPreference>;
  defaults: {
    autoEnableOnFirstConnect: boolean;
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  scan: {
    intervalMinutes: 15,
    includeBrowserCookies: false,
  },
  health: {
    enabled: true,
    intervalSeconds: 30,
    showInMenuBar: true,
  },
  openAtLogin: false,
  providers: {},
  defaults: {
    autoEnableOnFirstConnect: true,
  },
};

export interface ProviderSnapshot {
  meta: ProviderMeta;
  lifecycle: ProviderLifecycle;
  detect: DetectResult | null;
  usage: UsageResult | null;
  health: HealthResult | null;
}
