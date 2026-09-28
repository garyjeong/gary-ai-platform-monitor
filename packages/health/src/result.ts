/**
 * Shared result builders for health checks.
 *
 * Contract: every health fetch returns quickly with a classified HealthResult and
 * never throws. Cadence, backoff and "keep last good result" belong to the
 * scheduler outside this package — it reads `errorKind` / `retryAfterMs`.
 *
 * Description copy: vendor text (or our English summary) on success,
 * `상태 확인 불가 (<short English reason>)` on failure. Raw error messages are
 * never surfaced.
 */

import type {
  FetchErrorKind,
  HealthResult,
  HttpErr,
  ProviderStatusMeta,
} from '@gary-ai-platform-monitor/core';

export const DEFAULT_HEALTH_TIMEOUT_MS = 8_000;
export const USER_AGENT = 'gary-ai-platform-monitor/0.3 (health)';

export interface HealthFetchOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Clock used for RSS staleness checks (tests). Defaults to Date.now(). */
  now?: number;
}

export function unreachable(
  providerId: string,
  meta: ProviderStatusMeta,
  reason: string,
  errorKind: FetchErrorKind,
  retryAfterMs?: number
): HealthResult {
  const result: HealthResult = {
    providerId,
    indicator: 'unknown',
    description: `상태 확인 불가 (${reason})`,
    pageUrl: meta.pageUrl,
    components: [],
    updatedAt: Date.now(),
    unreachable: true,
    errorKind,
  };
  if (retryAfterMs !== undefined) result.retryAfterMs = retryAfterMs;
  return result;
}

/**
 * Map a classified HTTP failure (core/http.ts) to a health result.
 * Status pages are public: a 401/403 here is a WAF/bot block, not missing
 * credentials, so 'auth' is reported as 'server' to keep the scheduler from
 * treating it as a login problem.
 */
export function fromHttpError(
  providerId: string,
  meta: ProviderStatusMeta,
  err: HttpErr
): HealthResult {
  const kind: FetchErrorKind = err.errorKind === 'auth' ? 'server' : err.errorKind;
  return unreachable(providerId, meta, httpReason(err), kind, err.retryAfterMs);
}

function httpReason(err: HttpErr): string {
  switch (err.errorKind) {
    case 'timeout':
      return err.status ? `HTTP ${err.status}` : 'timeout';
    case 'network':
      return 'network error';
    case 'parse':
      return 'invalid response';
    case 'rate_limited':
      return err.retryAfterMs !== undefined
        ? `rate limited, retry in ${Math.ceil(err.retryAfterMs / 1000)}s`
        : 'rate limited';
    default:
      return err.status ? `HTTP ${err.status}` : 'request failed';
  }
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
