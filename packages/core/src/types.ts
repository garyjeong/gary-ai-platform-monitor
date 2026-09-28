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

/**
 * fixed   — quota resets at `resetsAt` (5h session, weekly plan window).
 * rolling — trailing aggregate (e.g. "last 7 days"); there is no reset, so no countdown.
 */
export type UsageWindowKind = 'fixed' | 'rolling';

export interface UsageWindow {
  id: UsageWindowId;
  /** Prefer percent. null when the provider cannot expose quota % */
  usedPercent: number | null;
  /** Epoch **seconds** when a fixed window resets. Omit for rolling windows. */
  resetsAt?: number;
  /** Nominal window length in seconds (5h = 18000). Enables pace display. Omit if unknown. */
  windowSeconds?: number;
  /** Default 'fixed' when resetsAt is set. */
  windowKind?: UsageWindowKind;
  /**
   * Percentage points per hour over the recent past (≥15 min of samples in the same window).
   * Filled by the collector from its own observations; adapters leave it unset.
   */
  recentRatePerHour?: number;
  label?: string;
  source: UsageSource;
  /** Optional absolute units when % is unavailable */
  usedAbsolute?: number;
  limitAbsolute?: number;
  unit?: 'tokens' | 'usd' | 'credits' | 'messages' | 'bytes' | string;
}

export type FetchStatus = 'ok' | 'auth_required' | 'stale' | 'unsupported' | 'error';

/** Why a fetch failed — drives retry policy and user-facing copy. */
export type FetchErrorKind =
  | 'auth'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'parse'
  | 'unsupported'
  | 'unknown';

export interface UsageResult {
  providerId: string;
  windows: UsageWindow[];
  status: FetchStatus;
  /** Epoch ms of this fetch attempt. */
  updatedAt: number;
  /**
   * Epoch ms when the returned numbers were actually observed at the source
   * (cache write time, log line time). Defaults to updatedAt when omitted.
   * A stale cache must keep its original observedAt.
   */
  observedAt?: number;
  /** Human-readable failure reason. Never include secrets (see scrubSecrets). */
  errorMessage?: string;
  errorKind?: FetchErrorKind;
  /**
   * Server-requested wait before the next attempt (parsed Retry-After), ms. On an auth
   * failure it is the adapter's own recheck interval and replaces the auth backoff.
   */
  retryAfterMs?: number;
  /** Non-error extra info for display (plan tier, notes). */
  note?: string;
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
  errorKind?: FetchErrorKind;
  retryAfterMs?: number;
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

export interface WidgetPosition {
  /** Electron display id the widget was last placed on. */
  displayId: number;
  /** Top-left corner in screen DIP coordinates. */
  x: number;
  y: number;
}

/** Floating desktop widget (Electron panel window). */
export interface WidgetConfig {
  visible: boolean;
  /** Up to 3 provider ids shown in the widget. Empty = first monitored providers. */
  pinned: string[];
  /** Window opacity in percent (40–100). */
  opacity: number;
  /** Also float above other apps' full-screen spaces. */
  overFullScreen: boolean;
  /** Ask macOS to exclude the widget from screen capture (not honored by every capturer). */
  hideInScreenShare: boolean;
  position?: WidgetPosition;
}

export interface AppConfig {
  scan: {
    /** Local login re-detection interval. */
    intervalMinutes: number;
    includeBrowserCookies: boolean;
  };
  health: {
    enabled: boolean;
    /** Status-page poll interval. Default 60; allowed range 30–300 (see config.ts). */
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
  widget: WidgetConfig;
  /** This Mac's CPU / memory / shared memory / network. Sampled only while shown. */
  resources: {
    showInPopover: boolean;
    showInWidget: boolean;
  };
}

export const WIDGET_MAX_PINNED = 3;

export const DEFAULT_CONFIG: AppConfig = {
  scan: {
    intervalMinutes: 15,
    includeBrowserCookies: false,
  },
  health: {
    enabled: true,
    intervalSeconds: 60,
    showInMenuBar: true,
  },
  openAtLogin: false,
  providers: {},
  defaults: {
    autoEnableOnFirstConnect: true,
  },
  widget: {
    visible: false,
    pinned: [],
    opacity: 90,
    overFullScreen: false,
    hideInScreenShare: false,
  },
  resources: {
    showInPopover: true,
    showInWidget: true,
  },
};

/** Scheduler bookkeeping for one data stream (usage or health) of one provider. */
export interface RefreshState {
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  /** Earliest time the scheduler will try again (TTL, backoff or Retry-After). */
  nextAt?: number;
  consecutiveFailures: number;
  lastErrorKind?: FetchErrorKind;
  inFlight?: boolean;
}

export interface ProviderSnapshot {
  meta: ProviderMeta;
  lifecycle: ProviderLifecycle;
  detect: DetectResult | null;
  usage: UsageResult | null;
  health: HealthResult | null;
  /** Present when produced by the scheduler (app); absent for one-shot snapshots. */
  refresh?: {
    usage: RefreshState;
    health: RefreshState;
  };
}
