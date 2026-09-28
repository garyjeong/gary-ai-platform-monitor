/**
 * Collector — owns all fetching for the app.
 *
 * Three independent streams per provider, each with its own cadence:
 *   detect  every scan.intervalMinutes (local, cheap)
 *   usage   per-provider TTL, exponential backoff on failure, honors Retry-After
 *   health  every health.intervalSeconds, deduplicated per status URL
 *
 * Failures never erase the last good data: the snapshot keeps the previous numbers
 * with their original observedAt and marks the failure in `refresh` state.
 * Results are published per provider as they arrive (no all-or-nothing snapshot).
 *
 * Pure Node — no Electron imports — so the CLI and the Electron utility process share it.
 */

import { getProviderPref, seedProviderPrefs } from './config.js';
import { classifyError, scrubSecrets } from './http.js';
import { resolveLifecycle, summarizeMenuBar, type FullSnapshot } from './snapshot.js';
import type {
  AppConfig,
  DetectResult,
  FetchErrorKind,
  HealthResult,
  ProviderAdapter,
  ProviderPreference,
  ProviderSnapshot,
  ProviderStatusMeta,
  RefreshState,
  UsageResult,
} from './types.js';

/** Usage TTL per provider (ms). Unlisted providers use DEFAULT_USAGE_TTL_MS. */
export const USAGE_TTL_MS: Readonly<Record<string, number>> = {
  claude: 180_000,
  codex: 60_000, // local log files
  grok: 180_000, // browser credits API first, local sessions as fallback
  ollama: 60_000, // local daemon
  opencode: 60_000, // local DB
};
export const DEFAULT_USAGE_TTL_MS = 300_000;

/** Recent-rate estimate: samples from the last 30 min, at least 15 min apart end to end. */
const RATE_LOOKBACK_MS = 30 * 60_000;
const RATE_MIN_SPAN_MS = 15 * 60_000;
/** Same window if resetsAt moves by less than this (APIs jitter by a few seconds). */
const RESET_TOLERANCE_S = 120;

interface RateTrack {
  resetsAt?: number;
  samples: Array<{ t: number; pct: number }>;
}

export interface CollectorPolicy {
  usageTtlMs(providerId: string): number;
  /** Stop waiting for one adapter call after this long (the call itself is not cancelled). */
  callDeadlineMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** Retry delay after an auth failure (user must log in again), unless the adapter sets retryAfterMs. */
  authRetryMs: number;
  /** Max parallel adapter/health calls. */
  concurrency: number;
  /** Coalesce change notifications. */
  emitDebounceMs: number;
}

export const DEFAULT_POLICY: CollectorPolicy = {
  usageTtlMs: (id) => USAGE_TTL_MS[id] ?? DEFAULT_USAGE_TTL_MS,
  callDeadlineMs: 20_000,
  backoffBaseMs: 60_000,
  backoffMaxMs: 30 * 60_000,
  authRetryMs: 30 * 60_000,
  concurrency: 4,
  emitDebounceMs: 250,
};

export interface CollectorDeps {
  adapters: ProviderAdapter[];
  config: AppConfig;
  fetchHealth?: (providerId: string, meta: ProviderStatusMeta) => Promise<HealthResult>;
  /** Snapshot changed (debounced). */
  onChange?: (snapshot: FullSnapshot) => void;
  /**
   * First-seen providers were detected. The owner of config.json persists the patch
   * (single writer) and later calls setConfig(). The collector applies it in memory immediately.
   */
  onConfigProposal?: (patch: Record<string, ProviderPreference>) => void;
  policy?: Partial<CollectorPolicy>;
  now?: () => number;
}

export interface RefreshOptions {
  /** Re-run detection too. */
  detect?: boolean;
  /** Only refresh streams whose last success is older than this (ms). Default: everything. */
  staleAfterMs?: number;
  providerId?: string;
}

interface Entry {
  adapter: ProviderAdapter;
  detect: DetectResult | null;
  usage: UsageResult | null;
  lastGoodUsage: UsageResult | null;
  usageState: RefreshState;
  health: HealthResult | null;
  healthState: RefreshState;
}

interface HealthCacheEntry {
  at: number;
  result?: HealthResult;
  pending?: Promise<HealthResult>;
}

export class Collector {
  private config: AppConfig;
  private readonly policy: CollectorPolicy;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();
  private readonly healthCache = new Map<string, HealthCacheEntry>();
  private readonly rateTracks = new Map<string, RateTrack>();

  private detectState: RefreshState = { consecutiveFailures: 0 };
  private detectPromise: Promise<void> | null = null;

  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private generatedAt = 0;

  constructor(private readonly deps: CollectorDeps) {
    this.config = structuredClone(deps.config);
    this.policy = { ...DEFAULT_POLICY, ...deps.policy };
    this.now = deps.now ?? Date.now;
    for (const adapter of deps.adapters) {
      this.entries.set(adapter.meta.id, {
        adapter,
        detect: null,
        usage: null,
        lastGoodUsage: null,
        usageState: { consecutiveFailures: 0 },
        health: null,
        healthState: { consecutiveFailures: 0 },
      });
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
  }

  /** Sleep / screen lock: stop starting new work. */
  pause(): void {
    this.paused = true;
    this.clearTimer();
  }

  /** Wake / unlock: resume after a short settle delay so the network can come back. */
  resume(delayMs = 5_000): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.running) return;
    this.clearTimer();
    this.timer = setTimeout(() => this.scheduleNext(), delayMs);
  }

  setConfig(config: AppConfig): void {
    const prev = this.config;
    this.config = structuredClone(config);
    const now = this.now();
    for (const [id, entry] of this.entries) {
      const was = getProviderPref(prev, id).monitor;
      const is = getProviderPref(this.config, id).monitor;
      if (is && !was) {
        // Newly enabled: fetch soon, but never before a server-requested wait.
        entry.usageState.nextAt = Math.max(now, this.retryFloor(entry.usageState));
        entry.healthState.nextAt = now;
      }
    }
    if (prev.health.intervalSeconds !== this.config.health.intervalSeconds) {
      for (const entry of this.entries.values()) {
        const last = entry.healthState.lastAttemptAt;
        if (last !== undefined && entry.healthState.consecutiveFailures === 0) {
          entry.healthState.nextAt = last + this.healthIntervalMs();
        }
      }
    }
    if (prev.scan.includeBrowserCookies !== this.config.scan.includeBrowserCookies) {
      for (const entry of this.entries.values()) entry.usageState.nextAt = now;
    }
    this.scheduleEmit();
    this.scheduleNext();
  }

  getConfig(): AppConfig {
    return structuredClone(this.config);
  }

  // ── refresh ─────────────────────────────────────────────────────────

  /**
   * Run due work now. Manual refresh bypasses TTLs but never a server Retry-After
   * or auth backoff. Resolves when the triggered work has finished.
   */
  async refreshNow(opts: RefreshOptions = {}): Promise<FullSnapshot> {
    const now = this.now();
    if (opts.detect || this.detectState.lastSuccessAt === undefined) {
      await this.runDetect();
    }
    const tasks: Promise<void>[] = [];
    for (const [id, entry] of this.entries) {
      if (opts.providerId && opts.providerId !== id) continue;
      if (this.wantUsage(entry) && this.isStale(entry.usageState, now, opts.staleAfterMs)) {
        if (now >= this.retryFloor(entry.usageState)) tasks.push(this.runUsage(entry));
      }
      if (this.wantHealth(entry) && this.isStale(entry.healthState, now, opts.staleAfterMs)) {
        if (now >= this.retryFloor(entry.healthState)) tasks.push(this.runHealth(entry));
      }
    }
    await Promise.all(tasks);
    this.emitNow();
    return this.snapshot();
  }

  snapshot(): FullSnapshot {
    const providers: ProviderSnapshot[] = [];
    for (const entry of this.entries.values()) {
      const pref = getProviderPref(this.config, entry.adapter.meta.id);
      const found = entry.detect?.found ?? false;
      providers.push({
        meta: entry.adapter.meta,
        lifecycle: resolveLifecycle(found, pref, entry.usage),
        detect: entry.detect,
        usage: pref.monitor ? entry.usage : null,
        health: pref.monitor && pref.showHealth ? entry.health : null,
        refresh: {
          usage: { ...entry.usageState },
          health: { ...entry.healthState },
        },
      });
    }
    providers.sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));
    return {
      updatedAt: new Date(this.generatedAt || this.now()).toISOString(),
      providers,
      menuBar: summarizeMenuBar(providers, this.config, this.now()),
      config: structuredClone(this.config),
    };
  }

  // ── scheduling ──────────────────────────────────────────────────────

  private scheduleNext(): void {
    this.clearTimer();
    if (!this.running || this.paused) return;
    const now = this.now();
    let due = this.nextDetectAt();
    for (const entry of this.entries.values()) {
      if (this.wantUsage(entry) && !entry.usageState.inFlight) {
        due = Math.min(due, entry.usageState.nextAt ?? now);
      }
      if (this.wantHealth(entry) && !entry.healthState.inFlight) {
        due = Math.min(due, entry.healthState.nextAt ?? now);
      }
    }
    const delay = Math.min(Math.max(0, due - now), 60 * 60_000);
    this.timer = setTimeout(() => void this.tick(), delay);
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (!this.running || this.paused) return;
    const now = this.now();
    if (now >= this.nextDetectAt()) await this.runDetect();
    for (const entry of this.entries.values()) {
      if (this.wantUsage(entry) && !entry.usageState.inFlight && now >= (entry.usageState.nextAt ?? now)) {
        void this.runUsage(entry).then(() => this.scheduleNext());
      }
      if (this.wantHealth(entry) && !entry.healthState.inFlight && now >= (entry.healthState.nextAt ?? now)) {
        void this.runHealth(entry).then(() => this.scheduleNext());
      }
    }
    this.scheduleNext();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private nextDetectAt(): number {
    const last = this.detectState.lastAttemptAt;
    if (last === undefined) return this.now();
    return last + this.config.scan.intervalMinutes * 60_000;
  }

  private healthIntervalMs(): number {
    return this.config.health.intervalSeconds * 1000;
  }

  private wantUsage(entry: Entry): boolean {
    return Boolean(entry.detect?.found) && getProviderPref(this.config, entry.adapter.meta.id).monitor;
  }

  private wantHealth(entry: Entry): boolean {
    const meta = entry.adapter.meta.status;
    const pref = getProviderPref(this.config, entry.adapter.meta.id);
    return (
      this.config.health.enabled !== false &&
      Boolean(this.deps.fetchHealth) &&
      Boolean(meta) &&
      meta?.strategy !== 'custom' &&
      Boolean(entry.detect?.found) &&
      pref.monitor &&
      pref.showHealth
    );
  }

  private isStale(state: RefreshState, now: number, staleAfterMs?: number): boolean {
    if (state.inFlight) return false;
    if (staleAfterMs === undefined) return true;
    const last = state.lastSuccessAt ?? state.lastAttemptAt;
    return last === undefined || now - last >= staleAfterMs;
  }

  /** Earliest time a retry is allowed regardless of TTL (Retry-After / auth backoff). */
  private retryFloor(state: RefreshState): number {
    if (
      state.consecutiveFailures > 0 &&
      (state.lastErrorKind === 'rate_limited' || state.lastErrorKind === 'auth') &&
      state.nextAt !== undefined
    ) {
      return state.nextAt;
    }
    return 0;
  }

  private backoffMs(failures: number): number {
    const exp = this.policy.backoffBaseMs * 2 ** Math.max(0, failures - 1);
    const capped = Math.min(this.policy.backoffMaxMs, exp);
    const jitter = capped * 0.1 * (Math.random() * 2 - 1);
    return Math.round(capped + jitter);
  }

  // ── work ────────────────────────────────────────────────────────────

  private runDetect(): Promise<void> {
    if (this.detectPromise) return this.detectPromise;
    this.detectState.lastAttemptAt = this.now();
    this.detectPromise = (async () => {
      const list = [...this.entries.values()];
      await Promise.all(
        list.map((entry) =>
          this.limit(async () => {
            const before = entry.detect?.found ?? false;
            let result: DetectResult;
            try {
              result = await withDeadline(entry.adapter.detect(), this.policy.callDeadlineMs);
            } catch {
              // Keep the previous answer: a failing detect is not "not installed".
              result = entry.detect ?? { found: false, signals: [], confidence: 'low' };
            }
            entry.detect = result;
            if (result.found && !before) {
              entry.usageState.nextAt = Math.max(this.now(), this.retryFloor(entry.usageState));
              entry.healthState.nextAt = this.now();
            }
          })
        )
      );
      this.detectState.lastSuccessAt = this.now();
      const patch = seedProviderPrefs(
        this.config,
        list.map((e) => ({ id: e.adapter.meta.id, found: Boolean(e.detect?.found) }))
      );
      if (Object.keys(patch).length > 0) {
        this.config = {
          ...this.config,
          providers: { ...this.config.providers, ...patch },
        };
        this.deps.onConfigProposal?.(patch);
      }
      this.scheduleEmit();
    })().finally(() => {
      this.detectPromise = null;
    });
    return this.detectPromise;
  }

  private runUsage(entry: Entry): Promise<void> {
    const state = entry.usageState;
    if (state.inFlight) return Promise.resolve();
    state.inFlight = true;
    return this.limit(async () => {
      const id = entry.adapter.meta.id;
      const startedAt = this.now();
      state.lastAttemptAt = startedAt;
      let result: UsageResult;
      try {
        result = await withDeadline(
          entry.adapter.fetchUsage({ includeBrowserCookies: this.config.scan.includeBrowserCookies }),
          this.policy.callDeadlineMs
        );
      } catch (err) {
        const kind: FetchErrorKind = err instanceof DeadlineError ? 'timeout' : classifyError(err);
        result = {
          providerId: id,
          windows: [],
          status: 'error',
          updatedAt: startedAt,
          errorKind: kind,
          errorMessage: kind === 'timeout' ? '응답 시간 초과' : errorMessageOf(err),
        };
      }
      if (result.errorMessage) result = { ...result, errorMessage: scrubSecrets(result.errorMessage) };
      const now = this.now();
      const ttl = this.policy.usageTtlMs(id);

      if (result.status === 'ok' || result.status === 'unsupported') {
        state.consecutiveFailures = 0;
        state.lastErrorKind = undefined;
        state.lastSuccessAt = now;
        state.nextAt = now + ttl;
        entry.usage = this.annotateRates(id, {
          ...result,
          observedAt: result.observedAt ?? result.updatedAt,
        });
        if (result.status === 'ok' && result.windows.length > 0) entry.lastGoodUsage = entry.usage;
      } else {
        state.consecutiveFailures += 1;
        const kind: FetchErrorKind =
          result.errorKind ?? (result.status === 'auth_required' ? 'auth' : 'unknown');
        state.lastErrorKind = kind;
        const wait =
          kind === 'auth'
            ? (result.retryAfterMs ?? this.policy.authRetryMs)
            : Math.max(result.retryAfterMs ?? 0, this.backoffMs(state.consecutiveFailures));
        state.nextAt = now + wait;
        entry.usage = mergeWithLastGood(result, entry.lastGoodUsage, kind);
      }
      state.inFlight = false;
      this.generatedAt = now;
      this.scheduleEmit();
    }).finally(() => {
      state.inFlight = false;
    });
  }

  private runHealth(entry: Entry): Promise<void> {
    const meta = entry.adapter.meta.status;
    const fetchHealth = this.deps.fetchHealth;
    const state = entry.healthState;
    if (!meta || !fetchHealth || state.inFlight) return Promise.resolve();
    state.inFlight = true;
    return this.limit(async () => {
      const id = entry.adapter.meta.id;
      const now0 = this.now();
      state.lastAttemptAt = now0;
      const key = meta.summaryUrl ?? meta.pageUrl;
      let result: HealthResult;
      try {
        result = await this.sharedHealth(key, () => fetchHealth(id, meta), now0);
        result = { ...result, providerId: id };
      } catch (err) {
        result = {
          providerId: id,
          indicator: 'unknown',
          description: '상태 확인 실패',
          pageUrl: meta.pageUrl,
          components: [],
          updatedAt: now0,
          unreachable: true,
          errorKind: err instanceof DeadlineError ? 'timeout' : classifyError(err),
        };
      }
      const now = this.now();
      if (!result.unreachable) {
        state.consecutiveFailures = 0;
        state.lastErrorKind = undefined;
        state.lastSuccessAt = now;
        state.nextAt = now + this.healthIntervalMs();
        entry.health = result;
      } else {
        state.consecutiveFailures += 1;
        state.lastErrorKind = result.errorKind ?? 'unknown';
        const exp = this.healthIntervalMs() * 2 ** (state.consecutiveFailures - 1);
        state.nextAt = now + Math.max(result.retryAfterMs ?? 0, Math.min(10 * 60_000, exp));
        // Keep the last good status; the failure is visible via refresh.health.
        if (!entry.health || entry.health.unreachable) entry.health = result;
      }
      this.generatedAt = now;
      this.scheduleEmit();
    }).finally(() => {
      state.inFlight = false;
    });
  }

  /**
   * Track % samples per fixed window and attach `recentRatePerHour` once there is enough
   * history. History lives in memory only; it restarts with the app or when the window resets.
   */
  private annotateRates(providerId: string, usage: UsageResult): UsageResult {
    const t = usage.observedAt ?? usage.updatedAt;
    const windows = usage.windows.map((w) => {
      if (typeof w.usedPercent !== 'number' || w.windowKind === 'rolling') return w;
      const key = `${providerId}:${w.id}`;
      let track = this.rateTracks.get(key);
      const last = track?.samples[track.samples.length - 1];
      const sameWindow =
        track !== undefined &&
        (track.resetsAt === w.resetsAt ||
          (track.resetsAt !== undefined &&
            w.resetsAt !== undefined &&
            Math.abs(track.resetsAt - w.resetsAt) <= RESET_TOLERANCE_S));
      if (!track || !sameWindow || (last && w.usedPercent < last.pct)) {
        track = { resetsAt: w.resetsAt, samples: [] };
        this.rateTracks.set(key, track);
      }
      const prev = track.samples[track.samples.length - 1];
      if (!prev || t > prev.t) track.samples.push({ t, pct: w.usedPercent });
      track.samples = track.samples.filter((s) => s.t >= t - 3 * RATE_LOOKBACK_MS).slice(-120);
      const rate = recentRate(track.samples);
      return rate === undefined ? w : { ...w, recentRatePerHour: rate };
    });
    return { ...usage, windows };
  }

  /** Several providers share one status page (e.g. Codex + ChatGPT) — fetch it once. */
  private sharedHealth(
    key: string,
    fetcher: () => Promise<HealthResult>,
    now: number
  ): Promise<HealthResult> {
    const cached = this.healthCache.get(key);
    if (cached?.pending) return cached.pending;
    if (cached?.result && now - cached.at < this.healthIntervalMs() / 2) {
      return Promise.resolve(cached.result);
    }
    const pending = withDeadline(fetcher(), this.policy.callDeadlineMs)
      .then((result) => {
        this.healthCache.set(key, { at: this.now(), result });
        return result;
      })
      .catch((err) => {
        this.healthCache.delete(key);
        throw err;
      });
    this.healthCache.set(key, { at: now, pending });
    return pending;
  }

  // ── plumbing ────────────────────────────────────────────────────────

  private limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.queue.shift()?.();
          });
      };
      if (this.active < this.policy.concurrency) run();
      else this.queue.push(run);
    });
  }

  private scheduleEmit(): void {
    if (!this.deps.onChange || this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.deps.onChange?.(this.snapshot());
    }, this.policy.emitDebounceMs);
  }

  private emitNow(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    this.deps.onChange?.(this.snapshot());
  }
}

/**
 * Keep the previous good numbers when a fetch fails, with their original observedAt,
 * so the UI can show "last checked 3 days ago" instead of blanking or faking freshness.
 */
function mergeWithLastGood(
  result: UsageResult,
  lastGood: UsageResult | null,
  kind: FetchErrorKind
): UsageResult {
  const status: UsageResult['status'] =
    result.status === 'auth_required' || kind === 'auth' ? 'auth_required' : 'stale';
  if (result.windows.length > 0) {
    // Adapter already returned (cached) data — trust its observedAt.
    return { ...result, status: result.status === 'error' ? 'stale' : result.status, errorKind: kind };
  }
  if (!lastGood) {
    return { ...result, status: result.status === 'auth_required' ? 'auth_required' : 'error', errorKind: kind };
  }
  return {
    ...lastGood,
    status,
    updatedAt: result.updatedAt,
    observedAt: lastGood.observedAt ?? lastGood.updatedAt,
    errorKind: kind,
    errorMessage: result.errorMessage,
    retryAfterMs: result.retryAfterMs,
  };
}

/** %p per hour over the last RATE_LOOKBACK_MS, or undefined with too little history. */
export function recentRate(samples: ReadonlyArray<{ t: number; pct: number }>): number | undefined {
  const last = samples[samples.length - 1];
  if (!last) return undefined;
  const first = samples.find((s) => s.t >= last.t - RATE_LOOKBACK_MS);
  if (!first || last.t - first.t < RATE_MIN_SPAN_MS) return undefined;
  const rate = ((last.pct - first.pct) / (last.t - first.t)) * 3_600_000;
  return Math.max(0, Math.round(rate * 10) / 10);
}

class DeadlineError extends Error {
  constructor(ms: number) {
    super(`deadline ${ms}ms exceeded`);
    this.name = 'DeadlineError';
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(ms)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function errorMessageOf(err: unknown): string {
  return scrubSecrets(err instanceof Error ? err.message : '요청 실패');
}

/**
 * One-shot collection (CLI, tests): detect, then fetch every monitored provider once.
 * Config seeding is reported through onConfigProposal; nothing is written here.
 */
export async function collectOnce(deps: Omit<CollectorDeps, 'onChange'>): Promise<FullSnapshot> {
  const collector = new Collector(deps);
  return collector.refreshNow({ detect: true });
}

/**
 * Back-compat wrapper used by tests: one-shot snapshot that reports the seeded config
 * through onConfigChange.
 */
export async function buildSnapshot(deps: {
  adapters: ProviderAdapter[];
  config: AppConfig;
  onConfigChange?: (config: AppConfig) => void;
  fetchHealth?: CollectorDeps['fetchHealth'];
  concurrency?: number;
}): Promise<FullSnapshot> {
  let seeded: Record<string, ProviderPreference> | null = null;
  const snap = await collectOnce({
    adapters: deps.adapters,
    config: deps.config,
    fetchHealth: deps.fetchHealth,
    policy: deps.concurrency ? { concurrency: deps.concurrency } : undefined,
    onConfigProposal: (patch) => {
      seeded = { ...(seeded ?? {}), ...patch };
    },
  });
  if (seeded) deps.onConfigChange?.(snap.config);
  return snap;
}
