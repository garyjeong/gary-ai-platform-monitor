/**
 * Grok subscription usage via browser session cookies.
 *
 * Primary (matches grok.com Settings → 사용량 / SuperGrok Heavy):
 *   POST /grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig  (grpc-web+proto)
 *   → credit_usage_percent + product breakdown (Build / Chat / …)
 *
 * Fallback (short 2h query windows — NOT the same as weekly Heavy pool):
 *   POST https://grok.com/rest/rate-limits  body: { modelName }
 *
 * CLI OAuth cannot call credits (cookie session required).
 *
 * Failure policy: only 401/403 (or gRPC UNAUTHENTICATED/PERMISSION_DENIED) mean the session
 * is gone → 'auth_required'. 429 / network / timeout / 5xx are reported as 'error' with the
 * classified errorKind. The fallback endpoints are only tried when the primary looks
 * *changed* (404, gRPC UNIMPLEMENTED/NOT_FOUND, or an unparseable/empty reply).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  classifyError,
  classifyHttpStatus,
  fetchJson,
  parseRetryAfter,
  scrubSecrets,
  type FetchErrorKind,
  type UsageResult,
  type UsageWindow,
} from '@gary-ai-platform-monitor/core';
import {
  readChromiumCookieHeader,
  readManualCookieHeader,
} from '@gary-ai-platform-monitor/browser-cookies';

const CREDITS_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';
const RATE_LIMITS_URL = 'https://grok.com/rest/rate-limits';
const CREDITS_TIMEOUT_MS = 12_000;
const RATE_LIMIT_TIMEOUT_MS = 10_000;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** A failed grok.com call, classified. `endpointChanged` → worth trying the fallback. */
export interface GrokCallFailure {
  ok: false;
  errorKind: FetchErrorKind;
  errorMessage: string;
  retryAfterMs?: number;
  endpointChanged: boolean;
}

/** Models for optional short-window rate-limit fallback. */
export const GROK_RATE_LIMIT_MODELS = [
  'grok-4',
  'grok-4-auto',
  'grok-3',
  'grok-4-heavy',
] as const;

/** billing_product.Product enum (from grok web protobuf). */
export const GROK_PRODUCT_LABELS: Record<number, string> = {
  0: 'unspecified',
  1: 'API',
  2: 'Grok Build',
  3: 'Plugins',
  4: 'Chat',
  5: 'Imagine',
  6: 'Voice',
  7: 'App Builder',
};

export interface GrokCreditsConfig {
  creditUsagePercent: number;
  productUsage: Array<{ product: number; usagePercent: number; label: string }>;
  periodType: 'weekly' | 'monthly' | 'unspecified';
  periodStartSec?: number;
  periodEndSec?: number;
  isUnifiedBillingUser: boolean;
}

export interface GrokRateLimitPayload {
  windowSizeSeconds?: number;
  remainingQueries?: number;
  totalQueries?: number;
  lowEffortRateLimits?: GrokRateLimitPayload | null;
  highEffortRateLimits?: GrokRateLimitPayload | null;
  usedPercent?: number;
  used_percent?: number;
  remainingPercent?: number;
  remaining_percent?: number;
  remainingFraction?: number;
  remaining_fraction?: number;
  name?: string;
  windowName?: string;
  label?: string;
  resetsAt?: string | number;
  resets_at?: string | number;
  resetTime?: string | number;
}

export async function resolveGrokCookieHeader(includeBrowser: boolean): Promise<{
  header: string | null;
  source: string;
}> {
  const manual = readManualCookieHeader([
    'GAI_PM_GROK_COOKIE',
    'GROK_COOKIE',
    'GROK_SESSION_COOKIE',
  ]);
  if (manual) return { header: manual, source: 'env' };

  const file = path.join(
    os.homedir(),
    '.config',
    'gary-ai-platform-monitor',
    'grok.cookie'
  );
  try {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return { header: v, source: 'file' };
    }
  } catch {
    // ignore
  }

  if (!includeBrowser) return { header: null, source: 'none' };

  const auto = await readChromiumCookieHeader({
    hostLike: ['%.grok.com', 'grok.com'],
    names: ['sso', 'sso-rw', 'x-userid', 'cf_clearance'],
  });
  if (auto) return { header: auto.header, source: `browser:${auto.browser}` };
  return { header: null, source: 'none' };
}

// ─── protobuf (minimal) ─────────────────────────────────────────────

function readVarint(buf: Buffer, o: number): [bigint, number] {
  let x = 0n;
  let s = 0n;
  while (o < buf.length) {
    const b = BigInt(buf[o++]!);
    x |= (b & 0x7fn) << s;
    if ((b & 0x80n) === 0n) break;
    s += 7n;
  }
  return [x, o];
}

interface PbField {
  field: number;
  wt: number;
  v?: number;
  raw?: bigint;
  float?: number;
  bytes?: Buffer;
}

function decodeFields(buf: Buffer): PbField[] {
  const fields: PbField[] = [];
  let o = 0;
  while (o < buf.length) {
    const [tag, o2] = readVarint(buf, o);
    o = o2;
    const field = Number(tag >> 3n);
    const wt = Number(tag & 7n);
    if (wt === 0) {
      const [v, o3] = readVarint(buf, o);
      o = o3;
      fields.push({ field, wt, v: Number(v), raw: v });
    } else if (wt === 1) {
      o += 8;
      fields.push({ field, wt });
    } else if (wt === 2) {
      const [len, o3] = readVarint(buf, o);
      o = o3;
      const data = buf.subarray(o, o + Number(len));
      o += Number(len);
      fields.push({ field, wt, bytes: data });
    } else if (wt === 5) {
      const f = buf.readFloatLE(o);
      o += 4;
      fields.push({ field, wt, float: f });
    } else {
      break;
    }
  }
  return fields;
}

function decodeTimestampSec(buf: Buffer): number | undefined {
  for (const f of decodeFields(buf)) {
    if (f.field === 1 && f.wt === 0 && f.v != null) return f.v;
  }
  return undefined;
}

/** Split a grpc-web body into the first data frame and the trailer's grpc-status. */
export function parseGrpcWebFrames(buf: Buffer): { message: Buffer | null; grpcStatus?: number } {
  let o = 0;
  let message: Buffer | null = null;
  let grpcStatus: number | undefined;
  while (o + 5 <= buf.length) {
    const flags = buf[o]!;
    const len = buf.readUInt32BE(o + 1);
    const data = buf.subarray(o + 5, o + 5 + len);
    o += 5 + len;
    if ((flags & 0x80) === 0) {
      if (!message) message = data; // data frame
    } else {
      const m = /grpc-status:\s*(\d+)/i.exec(data.toString('latin1')); // trailer frame
      if (m) grpcStatus = Number(m[1]);
    }
  }
  return { message, grpcStatus };
}

/** gRPC status code → FetchErrorKind; `endpointChanged` for codes meaning "no such method". */
export function classifyGrpcStatus(code: number): { errorKind: FetchErrorKind; endpointChanged: boolean } {
  switch (code) {
    case 16: // UNAUTHENTICATED
    case 7: // PERMISSION_DENIED
      return { errorKind: 'auth', endpointChanged: false };
    case 8: // RESOURCE_EXHAUSTED
      return { errorKind: 'rate_limited', endpointChanged: false };
    case 4: // DEADLINE_EXCEEDED
      return { errorKind: 'timeout', endpointChanged: false };
    case 13: // INTERNAL
    case 14: // UNAVAILABLE
      return { errorKind: 'server', endpointChanged: false };
    case 5: // NOT_FOUND
    case 12: // UNIMPLEMENTED
      return { errorKind: 'unsupported', endpointChanged: true };
    default:
      return { errorKind: 'unknown', endpointChanged: false };
  }
}

/**
 * Parse GetGrokCreditsConfigResponse protobuf bytes.
 * Field numbers confirmed against live SuperGrok Heavy payload.
 */
export function parseGrokCreditsConfigMessage(msg: Buffer): GrokCreditsConfig | null {
  // Response: field 1 = GrokCreditsConfig
  const top = decodeFields(msg);
  const configBytes = top.find((f) => f.field === 1 && f.wt === 2)?.bytes;
  if (!configBytes || configBytes.length === 0) return null;

  const fields = decodeFields(configBytes);
  let creditUsagePercent = 0;
  let hasPercent = false;
  const productUsage: GrokCreditsConfig['productUsage'] = [];
  let periodType: GrokCreditsConfig['periodType'] = 'unspecified';
  let periodStartSec: number | undefined;
  let periodEndSec: number | undefined;
  let isUnifiedBillingUser = false;

  for (const f of fields) {
    // 1: credit_usage_percent (float)
    if (f.field === 1 && f.wt === 5 && typeof f.float === 'number') {
      creditUsagePercent = Math.max(0, Math.min(100, f.float));
      hasPercent = true;
    }
    // 7: product_usage (repeated) { product=1 enum, usage_percent=2 float }
    if (f.field === 7 && f.wt === 2 && f.bytes) {
      let product = 0;
      let usagePercent = 0;
      let hasU = false;
      for (const n of decodeFields(f.bytes)) {
        if (n.field === 1 && n.wt === 0) product = n.v ?? 0;
        if (n.field === 2 && n.wt === 5 && typeof n.float === 'number') {
          usagePercent = Math.max(0, Math.min(100, n.float));
          hasU = true;
        }
      }
      if (hasU || product > 0) {
        productUsage.push({
          product,
          usagePercent: hasU ? usagePercent : 0,
          label: GROK_PRODUCT_LABELS[product] ?? `product-${product}`,
        });
      }
    }
    // 8: current_period { type=1, start=2 Timestamp, end=3 Timestamp }
    if (f.field === 8 && f.wt === 2 && f.bytes) {
      for (const n of decodeFields(f.bytes)) {
        if (n.field === 1 && n.wt === 0) {
          periodType =
            n.v === 2 ? 'weekly' : n.v === 1 ? 'monthly' : 'unspecified';
        }
        if (n.field === 2 && n.wt === 2 && n.bytes) {
          periodStartSec = decodeTimestampSec(n.bytes);
        }
        if (n.field === 3 && n.wt === 2 && n.bytes) {
          periodEndSec = decodeTimestampSec(n.bytes);
        }
      }
    }
    // 11: is_unified_billing_user
    if (f.field === 11 && f.wt === 0) {
      isUnifiedBillingUser = nTruthy(f.v);
    }
  }

  if (!hasPercent && productUsage.length === 0) return null;

  return {
    creditUsagePercent,
    productUsage,
    periodType,
    periodStartSec,
    periodEndSec,
    isUnifiedBillingUser,
  };
}

function nTruthy(v: number | undefined): boolean {
  return v === 1;
}

export function creditsConfigToWindows(cfg: GrokCreditsConfig): UsageWindow[] {
  const periodLabel =
    cfg.periodType === 'weekly'
      ? 'weekly'
      : cfg.periodType === 'monthly'
        ? 'monthly'
        : 'period';
  const periodSeconds =
    cfg.periodStartSec !== undefined &&
    cfg.periodEndSec !== undefined &&
    cfg.periodEndSec > cfg.periodStartSec
      ? cfg.periodEndSec - cfg.periodStartSec
      : cfg.periodType === 'weekly'
        ? 604_800
        : undefined;
  const timing: Pick<UsageWindow, 'resetsAt' | 'windowSeconds' | 'windowKind'> = {
    resetsAt: cfg.periodEndSec,
    windowSeconds: periodSeconds,
    windowKind: 'fixed',
  };
  const windows: UsageWindow[] = [
    {
      id: 'supergrok-heavy',
      usedPercent: cfg.creditUsagePercent,
      label: `SuperGrok Heavy (${periodLabel})`,
      source: 'browser',
      ...timing,
    },
  ];

  // Product breakdown (skip zero/unspecified to reduce noise, but keep non-zero)
  for (const p of cfg.productUsage) {
    if (p.usagePercent <= 0 && p.product !== 2 && p.product !== 4) continue;
    if (p.product === 0) continue;
    windows.push({
      id: `product-${p.product}`,
      usedPercent: p.usagePercent,
      label: p.label,
      source: 'browser',
      ...timing,
    });
  }

  return windows;
}

function failure(
  errorKind: FetchErrorKind,
  errorMessage: string,
  endpointChanged: boolean,
  retryAfterMs?: number
): GrokCallFailure {
  return { ok: false, errorKind, errorMessage: scrubSecrets(errorMessage), endpointChanged, retryAfterMs };
}

/**
 * POST GetGrokCreditsConfig (grpc-web, binary — so plain fetch with a timeout and the
 * shared classifiers instead of fetchJson/fetchText).
 */
export async function fetchGrokCreditsConfig(
  cookieHeader: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; cfg: GrokCreditsConfig } | GrokCallFailure> {
  let res: Response;
  try {
    res = await fetchImpl(CREDITS_URL, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/grpc-web+proto',
        Accept: 'application/grpc-web+proto',
        'x-grpc-web': '1',
        Origin: 'https://grok.com',
        Referer: 'https://grok.com/',
        'User-Agent': BROWSER_UA,
      },
      // empty protobuf message framed for grpc-web
      body: Buffer.from([0, 0, 0, 0, 0]),
      signal: AbortSignal.timeout(CREDITS_TIMEOUT_MS),
    });
  } catch (err) {
    return failure(classifyError(err), `grok.com credits: ${errText(err)}`, false);
  }

  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
    if (res.status === 404) {
      return failure('unsupported', 'grok.com credits endpoint HTTP 404', true);
    }
    return failure(classifyHttpStatus(res.status), `grok.com credits HTTP ${res.status}`, false, retryAfterMs);
  }

  // Trailers-only gRPC errors arrive as HTTP 200 with grpc-status in the headers.
  const headerStatus = Number(res.headers.get('grpc-status') ?? '0');
  if (headerStatus !== 0 && Number.isFinite(headerStatus)) {
    await res.body?.cancel().catch(() => undefined);
    const c = classifyGrpcStatus(headerStatus);
    return failure(c.errorKind, `grok.com credits gRPC status ${headerStatus}`, c.endpointChanged);
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const kind = classifyError(err);
    return failure(kind === 'unknown' ? 'parse' : kind, `grok.com credits: ${errText(err)}`, false);
  }
  const { message, grpcStatus } = parseGrpcWebFrames(buf);
  if (grpcStatus !== undefined && grpcStatus !== 0) {
    const c = classifyGrpcStatus(grpcStatus);
    return failure(c.errorKind, `grok.com credits gRPC status ${grpcStatus}`, c.endpointChanged);
  }
  const cfg = message ? parseGrokCreditsConfigMessage(message) : null;
  if (!cfg) {
    // Empty/unknown reply: treat as "endpoint changed" (or no credit pool) → fallback.
    return failure('parse', 'grok.com credits reply had no usage fields', true);
  }
  return { ok: true, cfg };
}

function errText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return cause instanceof Error ? `${err.message}: ${cause.message}` : err.message;
  }
  return 'request failed';
}

// ─── short rate-limit fallback ──────────────────────────────────────

export function mapRateLimitPayload(
  json: unknown,
  modelName: string
): UsageWindow[] {
  if (!json || typeof json !== 'object') return [];
  const rec = json as GrokRateLimitPayload;
  const out: UsageWindow[] = [];

  const primary = mapQueryWindow(rec, modelName);
  if (primary) out.push(primary);

  if (rec.lowEffortRateLimits && typeof rec.lowEffortRateLimits === 'object') {
    const w = mapQueryWindow(rec.lowEffortRateLimits, `${modelName}:low`);
    if (w) out.push(w);
  }
  if (rec.highEffortRateLimits && typeof rec.highEffortRateLimits === 'object') {
    const w = mapQueryWindow(rec.highEffortRateLimits, `${modelName}:high`);
    if (w) out.push(w);
  }

  if (out.length === 0) {
    out.push(...deepFindPercent(json));
  }
  return out;
}

function mapQueryWindow(
  rec: GrokRateLimitPayload,
  id: string
): UsageWindow | null {
  const remaining = rec.remainingQueries;
  const total = rec.totalQueries;
  if (
    typeof remaining === 'number' &&
    typeof total === 'number' &&
    total > 0 &&
    Number.isFinite(remaining) &&
    Number.isFinite(total)
  ) {
    const used = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
    const hours =
      typeof rec.windowSizeSeconds === 'number' && rec.windowSizeSeconds > 0
        ? rec.windowSizeSeconds / 3600
        : null;
    const label =
      hours != null
        ? `${id} (${hours % 1 === 0 ? hours : hours.toFixed(1)}h burst)`
        : `${id} (burst)`;
    return {
      id: `burst-${id}`,
      usedPercent: used,
      label,
      source: 'browser',
      windowSeconds:
        typeof rec.windowSizeSeconds === 'number' && rec.windowSizeSeconds > 0
          ? rec.windowSizeSeconds
          : undefined,
      usedAbsolute: total - remaining,
      unit: 'queries',
    };
  }

  if (typeof rec.usedPercent === 'number' || typeof rec.used_percent === 'number') {
    const used = (rec.usedPercent ?? rec.used_percent) as number;
    return {
      id,
      usedPercent: used,
      resetsAt: parseReset(rec.resetsAt ?? rec.resets_at ?? rec.resetTime),
      label: id,
      source: 'browser',
    };
  }
  if (
    typeof rec.remainingFraction === 'number' ||
    typeof rec.remaining_fraction === 'number'
  ) {
    const rem = (rec.remainingFraction ?? rec.remaining_fraction) as number;
    return {
      id,
      usedPercent: (1 - rem) * 100,
      label: id,
      source: 'browser',
    };
  }
  if (
    typeof rec.remainingPercent === 'number' ||
    typeof rec.remaining_percent === 'number'
  ) {
    const rem = (rec.remainingPercent ?? rec.remaining_percent) as number;
    return {
      id,
      usedPercent: 100 - rem,
      label: id,
      source: 'browser',
    };
  }
  return null;
}

function deepFindPercent(obj: unknown, pathParts: string[] = []): UsageWindow[] {
  const out: UsageWindow[] = [];
  if (obj === null || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    for (const v of obj) out.push(...deepFindPercent(v, pathParts));
    return out;
  }
  const rec = obj as GrokRateLimitPayload & Record<string, unknown>;
  const mapped = mapQueryWindow(
    rec,
    (typeof rec.name === 'string' && rec.name) ||
      (typeof rec.windowName === 'string' && rec.windowName) ||
      (typeof rec.label === 'string' && rec.label) ||
      (pathParts.length ? pathParts.join('.') : 'quota')
  );
  if (mapped) out.push(mapped);

  for (const [k, v] of Object.entries(rec)) {
    if (v && typeof v === 'object') out.push(...deepFindPercent(v, [...pathParts, k]));
  }
  return out;
}

function parseReset(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : Math.floor(t / 1000);
  }
  return undefined;
}

async function fetchOneModel(
  header: string,
  modelName: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: true; windows: UsageWindow[] } | GrokCallFailure> {
  const res = await fetchJson<unknown>(RATE_LIMITS_URL, {
    method: 'POST',
    headers: {
      Cookie: header,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: 'https://grok.com',
      Referer: 'https://grok.com/',
      'User-Agent': BROWSER_UA,
    },
    body: JSON.stringify({ modelName }),
    timeoutMs: RATE_LIMIT_TIMEOUT_MS,
    fetchImpl,
  });
  if (!res.ok) {
    return failure(
      res.errorKind,
      `grok.com rate-limits: ${res.errorMessage}`,
      res.status === 404,
      res.retryAfterMs
    );
  }
  return { ok: true, windows: mapRateLimitPayload(res.data, modelName) };
}

const RELOGIN_HINT =
  'grok.com session expired or rejected — log in to grok.com in Chrome again (or refresh ~/.config/gary-ai-platform-monitor/grok.cookie)';

function failureResult(f: GrokCallFailure, now: number): UsageResult {
  return {
    providerId: 'grok',
    windows: [],
    status: f.errorKind === 'auth' ? 'auth_required' : 'error',
    updatedAt: now,
    errorKind: f.errorKind,
    errorMessage: f.errorKind === 'auth' ? RELOGIN_HINT : scrubSecrets(f.errorMessage),
    retryAfterMs: f.retryAfterMs,
  };
}

/**
 * Browser cookie usage: SuperGrok Heavy pool first; burst rate-limits only when the
 * credits endpoint looks changed. Returns null when no cookie is available.
 */
export async function fetchGrokBrowserUsage(
  includeBrowserCookies: boolean,
  fetchImpl?: typeof fetch
): Promise<UsageResult | null> {
  const { header } = await resolveGrokCookieHeader(includeBrowserCookies);
  if (!header) return null;
  return fetchGrokBrowserUsageWithCookie(header, fetchImpl);
}

export async function fetchGrokBrowserUsageWithCookie(
  header: string,
  fetchImpl?: typeof fetch
): Promise<UsageResult> {
  // 1) Weekly/monthly SuperGrok Heavy credit pool (what Settings UI shows)
  const credits = await fetchGrokCreditsConfig(header, fetchImpl);
  if (credits.ok) {
    return {
      providerId: 'grok',
      windows: creditsConfigToWindows(credits.cfg),
      status: 'ok',
      updatedAt: Date.now(),
    };
  }
  // 429 / network / timeout / 5xx / auth: report it; hammering 4 more endpoints won't help.
  if (!credits.endpointChanged) return failureResult(credits, Date.now());

  // 2) Fallback: short burst rate-limits (not the same metric as Heavy %)
  const results = await Promise.all(
    GROK_RATE_LIMIT_MODELS.map((m) => fetchOneModel(header, m, fetchImpl))
  );
  const windows: UsageWindow[] = [];
  const failures: GrokCallFailure[] = [];
  for (const r of results) {
    if (r.ok) windows.push(...r.windows);
    else failures.push(r);
  }
  const deduped = dedupeWindows(windows);
  if (deduped.length > 0) {
    return { providerId: 'grok', windows: deduped, status: 'ok', updatedAt: Date.now() };
  }

  const authFailure = failures.find((f) => f.errorKind === 'auth');
  if (authFailure) return failureResult(authFailure, Date.now());
  const other = failures.find((f) => !f.endpointChanged);
  if (other) return failureResult(other, Date.now());
  return failureResult(
    failure(
      'unsupported',
      `grok.com usage endpoints look changed (${credits.errorMessage}); rate-limit fallback returned no usage`,
      true
    ),
    Date.now()
  );
}

function dedupeWindows(windows: UsageWindow[]): UsageWindow[] {
  const map = new Map<string, UsageWindow>();
  for (const w of windows) {
    const prev = map.get(w.id);
    if (!prev || (w.usedPercent ?? -1) > (prev.usedPercent ?? -1)) map.set(w.id, w);
  }
  return [...map.values()].slice(0, 8);
}

/** Map free-form JSON for tests (legacy rate-limit shapes). */
export function extractPercentWindows(json: unknown): UsageWindow[] {
  return dedupeWindows(deepFindPercent(json));
}

export type { UsageWindow };
