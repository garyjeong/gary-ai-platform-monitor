import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAUDE_CACHE_TTL_MS,
  fetchClaudeUsage,
  mapOAuthUsageToWindows,
  type ClaudeUsageCache,
  type ClaudeUsageDeps,
} from './usage.js';

const NOW = Date.UTC(2026, 8, 28, 3, 0, 0);
const TOKEN = 'sk-ant-oat01-' + 'A'.repeat(40); // synthetic

const CACHE: ClaudeUsageCache = {
  data: {
    five_hour: { utilization: 10, resets_at: '2026-09-28T05:39:59.962154+00:00' },
    seven_day: { utilization: 87, resets_at: '2026-09-28T14:59:59.962174+00:00' },
  },
  timestamp: NOW - 10 * 60_000,
};

function deps(opts: {
  cache?: ClaudeUsageCache | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
}): ClaudeUsageDeps & { saved: ClaudeUsageCache[]; calls: number } {
  const state = { saved: [] as ClaudeUsageCache[], calls: 0 };
  return Object.assign(state, {
    now: () => NOW,
    loadCache: () => opts.cache ?? null,
    saveCache: (e: ClaudeUsageCache) => void state.saved.push(e),
    lookupToken: async () =>
      opts.token === null
        ? ({ token: null, reason: 'expired' } as const)
        : ({ token: opts.token ?? TOKEN } as const),
    fetchImpl: (async (...args: Parameters<typeof fetch>) => {
      state.calls++;
      if (!opts.fetchImpl) throw new Error('fetch not expected');
      return opts.fetchImpl(...args);
    }) as typeof fetch,
  });
}

const respond =
  (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('fetchClaudeUsage status transitions', () => {
  it('200 → ok, observedAt = now, cache saved', async () => {
    const d = deps({ fetchImpl: respond(200, { five_hour: { utilization: 12, resets_at: null }, seven_day: null }) });
    const r = await fetchClaudeUsage(d);
    assert.equal(r.status, 'ok');
    assert.equal(r.observedAt, NOW);
    assert.equal(r.windows.length, 1);
    assert.equal(r.windows[0]?.windowSeconds, 18000);
    assert.equal(d.saved.length, 1);
    assert.equal(d.saved[0]?.timestamp, NOW);
  });

  it('fresh cache (< TTL) → ok without a request, observedAt = cache time', async () => {
    const fresh = { ...CACHE, timestamp: NOW - CLAUDE_CACHE_TTL_MS + 1000 };
    const d = deps({ cache: fresh });
    const r = await fetchClaudeUsage(d);
    assert.equal(r.status, 'ok');
    assert.equal(r.observedAt, fresh.timestamp);
    assert.equal(d.calls, 0);
  });

  it('401 with cache → auth_required, keeps cached windows at cache time', async () => {
    const d = deps({ cache: CACHE, fetchImpl: respond(401) });
    const r = await fetchClaudeUsage(d);
    assert.equal(r.status, 'auth_required');
    assert.equal(r.errorKind, 'auth');
    assert.equal(r.windows.length, 2);
    assert.equal(r.observedAt, CACHE.timestamp);
    assert.equal(d.saved.length, 0);
  });

  it('429 with Retry-After → stale (cache) / error (no cache), rate_limited + retryAfterMs', async () => {
    const withCache = await fetchClaudeUsage(deps({ cache: CACHE, fetchImpl: respond(429, {}, { 'retry-after': '120' }) }));
    assert.equal(withCache.status, 'stale');
    assert.equal(withCache.errorKind, 'rate_limited');
    assert.equal(withCache.retryAfterMs, 120_000);
    assert.equal(withCache.observedAt, CACHE.timestamp);
    assert.equal(withCache.windows[1]?.usedPercent, 87);

    const noCache = await fetchClaudeUsage(deps({ fetchImpl: respond(429, {}, { 'retry-after': '30' }) }));
    assert.equal(noCache.status, 'error');
    assert.equal(noCache.errorKind, 'rate_limited');
    assert.equal(noCache.retryAfterMs, 30_000);
    assert.equal(noCache.windows.length, 0);
  });

  it('network error → error/network without cache, stale with cache; message scrubbed', async () => {
    const boom = async () => {
      throw new TypeError(`fetch failed`, { cause: new Error(`connect ECONNREFUSED Bearer ${TOKEN}`) });
    };
    const noCache = await fetchClaudeUsage(deps({ fetchImpl: boom }));
    assert.equal(noCache.status, 'error');
    assert.equal(noCache.errorKind, 'network');
    assert.ok(!noCache.errorMessage?.includes(TOKEN), 'token must not leak');

    const withCache = await fetchClaudeUsage(deps({ cache: CACHE, fetchImpl: boom }));
    assert.equal(withCache.status, 'stale');
    assert.equal(withCache.errorKind, 'network');
    assert.equal(withCache.observedAt, CACHE.timestamp);
  });

  it('timeout → timeout kind', async () => {
    const slow = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };
    const r = await fetchClaudeUsage(deps({ fetchImpl: slow }));
    assert.equal(r.errorKind, 'timeout');
  });

  it('no/expired token → auth_required without calling the API', async () => {
    const d = deps({ cache: CACHE, token: null });
    const r = await fetchClaudeUsage(d);
    assert.equal(r.status, 'auth_required');
    assert.equal(r.errorKind, 'auth');
    assert.equal(r.observedAt, CACHE.timestamp);
    assert.match(r.errorMessage ?? '', /expired/);
    assert.equal(d.calls, 0);
  });
});

describe('mapOAuthUsageToWindows', () => {
  it('maps 5h and 7d utilization to percent windows', () => {
    const windows = mapOAuthUsageToWindows({
      five_hour: {
        utilization: 42.5,
        resets_at: '2026-08-03T12:00:00Z',
      },
      seven_day: {
        utilization: 18,
        resets_at: '2026-08-10T00:00:00Z',
      },
    });
    assert.equal(windows.length, 2);
    assert.equal(windows[0]?.id, '5h');
    assert.equal(windows[0]?.usedPercent, 42.5);
    assert.equal(windows[0]?.source, 'oauth');
    assert.ok(windows[0]?.resetsAt);
    assert.equal(windows[1]?.id, '7d');
    assert.equal(windows[1]?.usedPercent, 18);
  });

  it('returns empty when fields missing', () => {
    assert.deepEqual(mapOAuthUsageToWindows({}), []);
  });
});
