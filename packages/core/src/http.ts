/**
 * Shared HTTP helpers for adapters and health checks.
 * - Every request has a timeout (AbortSignal.timeout).
 * - Failures are classified (FetchErrorKind) so the scheduler can back off correctly.
 * - Error text is scrubbed so tokens never reach the snapshot / UI.
 */

import type { FetchErrorKind } from './types.js';

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpOk<T> {
  ok: true;
  status: number;
  data: T;
  headers: Headers;
}

export interface HttpErr {
  ok: false;
  status?: number;
  errorKind: FetchErrorKind;
  errorMessage: string;
  retryAfterMs?: number;
}

export type HttpResult<T> = HttpOk<T> | HttpErr;

export interface HttpOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchJson<T = unknown>(
  url: string,
  options: HttpOptions = {}
): Promise<HttpResult<T>> {
  return request(url, options, async (res) => (await res.json()) as T);
}

export async function fetchText(
  url: string,
  options: HttpOptions = {}
): Promise<HttpResult<string>> {
  return request(url, options, (res) => res.text());
}

async function request<T>(
  url: string,
  options: HttpOptions,
  read: (res: Response) => Promise<T>
): Promise<HttpResult<T>> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, ...init } = options;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    return {
      ok: false,
      errorKind: classifyError(err),
      errorMessage: scrubSecrets(errorText(err)),
    };
  }

  if (!res.ok) {
    // Drain the body so the socket can be reused; ignore content.
    await res.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      status: res.status,
      errorKind: classifyHttpStatus(res.status),
      errorMessage: `HTTP ${res.status}`,
      retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
    };
  }

  try {
    return { ok: true, status: res.status, data: await read(res), headers: res.headers };
  } catch (err) {
    const kind = classifyError(err);
    return {
      ok: false,
      status: res.status,
      errorKind: kind === 'unknown' ? 'parse' : kind,
      errorMessage: scrubSecrets(errorText(err)),
    };
  }
}

export function classifyHttpStatus(status: number): FetchErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  return 'unknown';
}

export function classifyError(err: unknown): FetchErrorKind {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (err instanceof SyntaxError) return 'parse';
  if (err instanceof TypeError) return 'network';
  return 'unknown';
}

/**
 * Retry-After is either delta-seconds or an HTTP-date (RFC 9110 §10.2.3).
 * Returns ms from now, or undefined when absent/invalid.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? `: ${cause.message}` : '';
    return `${err.message}${causeMsg}`;
  }
  return 'request failed';
}

/**
 * Remove credentials that may leak through error messages
 * (e.g. Node's "invalid header value" error echoes the whole Authorization header).
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(bearer|basic)\s+[^\s"',;]+/gi, '$1 [redacted]')
    .replace(/\b(sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xai|AIza)[-_][A-Za-z0-9_\-]{6,}/g, '[redacted]')
    .replace(/\b(sso|sso-rw|cf_clearance|session[a-z_]*|token|WorkosCursorSessionToken)=([^;\s]+)/gi, '$1=[redacted]')
    .replace(/[A-Za-z0-9_\-+/=.]{32,}/g, '[redacted]');
}
