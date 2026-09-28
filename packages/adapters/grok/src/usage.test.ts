import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UsageResult } from '@gary-ai-platform-monitor/core';
import {
  creditsConfigToWindows,
  extractPercentWindows,
  fetchGrokBrowserUsageWithCookie,
  mapRateLimitPayload,
  parseGrokCreditsConfigMessage,
} from './browser-usage.js';
import { combineGrokResults } from './combine.js';
import { toGrokUsageResult, type GrokUsage } from './local-usage.js';
import { grokTierLabel } from './subscription.js';

const HEAVY_HEX =
  '0a610d0000144212001a00220c08dff7a0d30610a8f6e2d4012a0c08dfecc5d30610a8f6e2d4013a07080215000010423a070804150000803f3a020805421e0802120c08dff7a0d30610a8f6e2d4011a0c08dfecc5d30610a8f6e2d401580162006801';

function grpcFrame(msg: Buffer): Buffer {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(msg.length, 1);
  return Buffer.concat([head, msg]);
}

/** Fake fetch routing by URL; records every call. */
function fakeFetch(routes: {
  credits: () => Response | Promise<Response>;
  rateLimits?: () => Response | Promise<Response>;
}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('GetGrokCreditsConfig')) return routes.credits();
    if (url.includes('/rest/rate-limits') && routes.rateLimits) return routes.rateLimits();
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

const status = (code: number, headers: Record<string, string> = {}) => () =>
  new Response('', { status: code, headers });

describe('fetchGrokBrowserUsageWithCookie failure policy', () => {
  it('credits ok → ok with fixed weekly windows', async () => {
    const f = fakeFetch({
      credits: () => new Response(grpcFrame(Buffer.from(HEAVY_HEX, 'hex')), { status: 200 }),
    });
    const r = await fetchGrokBrowserUsageWithCookie('sso=x', f.impl);
    assert.equal(r.status, 'ok');
    assert.equal(r.windows[0]?.windowKind, 'fixed');
    assert.ok(r.windows[0]?.resetsAt);
    assert.equal(r.windows[0]?.windowSeconds, 604800);
    assert.equal(r.errorMessage, undefined);
    assert.equal(f.calls.length, 1);
  });

  it('429 → error/rate_limited with retryAfterMs, no fallback calls', async () => {
    const f = fakeFetch({ credits: status(429, { 'retry-after': '90' }) });
    const r = await fetchGrokBrowserUsageWithCookie('sso=x', f.impl);
    assert.equal(r.status, 'error');
    assert.equal(r.errorKind, 'rate_limited');
    assert.equal(r.retryAfterMs, 90_000);
    assert.equal(f.calls.length, 1);
  });

  it('network error / timeout → error (not auth_required), no fallback calls', async () => {
    const net = fakeFetch({
      credits: () => {
        throw new TypeError('fetch failed');
      },
    });
    const r1 = await fetchGrokBrowserUsageWithCookie('sso=x', net.impl);
    assert.equal(r1.status, 'error');
    assert.equal(r1.errorKind, 'network');
    assert.equal(net.calls.length, 1);

    const slow = fakeFetch({
      credits: () => {
        throw new DOMException('timed out', 'TimeoutError');
      },
    });
    const r2 = await fetchGrokBrowserUsageWithCookie('sso=x', slow.impl);
    assert.equal(r2.errorKind, 'timeout');
    assert.equal(slow.calls.length, 1);
  });

  it('401 / gRPC UNAUTHENTICATED → auth_required', async () => {
    const r1 = await fetchGrokBrowserUsageWithCookie('sso=x', fakeFetch({ credits: status(401) }).impl);
    assert.equal(r1.status, 'auth_required');
    assert.equal(r1.errorKind, 'auth');
    const r2 = await fetchGrokBrowserUsageWithCookie(
      'sso=x',
      fakeFetch({ credits: status(200, { 'grpc-status': '16' }) }).impl
    );
    assert.equal(r2.status, 'auth_required');
  });

  it('404 (endpoint changed) → fires the rate-limit fallback', async () => {
    const f = fakeFetch({
      credits: status(404),
      rateLimits: () =>
        Response.json({ windowSizeSeconds: 7200, remainingQueries: 30, totalQueries: 40 }),
    });
    const r = await fetchGrokBrowserUsageWithCookie('sso=x', f.impl);
    assert.equal(r.status, 'ok');
    assert.equal(f.calls.filter((u) => u.includes('rate-limits')).length, 4);
    assert.equal(r.windows[0]?.usedPercent, 25);
    assert.equal(r.windows[0]?.windowSeconds, 7200);
  });

  it('404 + fallback 404 → error/unsupported (not auth)', async () => {
    const r = await fetchGrokBrowserUsageWithCookie(
      'sso=x',
      fakeFetch({ credits: status(404), rateLimits: status(404) }).impl
    );
    assert.equal(r.status, 'error');
    assert.equal(r.errorKind, 'unsupported');
  });
});

describe('toGrokUsageResult', () => {
  const base: GrokUsage = {
    totalTokens: 1_500_000,
    costUsd: 1.25,
    modelCalls: 10,
    sessions: 3,
    resetsAt: 1_790_600_000,
    truncated: false,
    aligned: false,
  };

  it('no anchor → rolling 7d window without resetsAt', () => {
    const r = toGrokUsageResult(base);
    for (const w of r.windows) {
      assert.equal(w.windowKind, 'rolling');
      assert.equal(w.resetsAt, undefined);
      assert.equal(w.windowSeconds, 604800);
    }
    assert.equal(r.windows[0]?.id, '7d');
    assert.equal(r.errorMessage, undefined);
  });

  it('anchored → fixed weekly window with resetsAt', () => {
    const r = toGrokUsageResult({ ...base, aligned: true });
    assert.equal(r.windows[0]?.id, 'weekly');
    assert.equal(r.windows[0]?.windowKind, 'fixed');
    assert.equal(r.windows[0]?.resetsAt, 1_790_600_000);
  });
});

describe('grokTierLabel', () => {
  it('humanizes subscription tier enums', () => {
    assert.equal(grokTierLabel('SUBSCRIPTION_TIER_SUPER_GROK_HEAVY'), 'SuperGrok Heavy');
    assert.equal(grokTierLabel('SUBSCRIPTION_TIER_GROK_PRO'), 'Grok Pro');
    assert.equal(grokTierLabel('X_PREMIUM_PLUS'), 'X Premium Plus');
    assert.equal(grokTierLabel('SuperGrok Heavy'), 'SuperGrok Heavy');
    assert.equal(grokTierLabel('SUBSCRIPTION_TIER_UNSPECIFIED'), undefined);
    assert.equal(grokTierLabel(undefined), undefined);
  });
});

describe('combineGrokResults', () => {
  const local: UsageResult = {
    providerId: 'grok',
    windows: [{ id: '7d', usedPercent: null, source: 'local', usedAbsolute: 10, unit: 'tokens' }],
    status: 'ok',
    updatedAt: 1,
  };
  const fail = (status: UsageResult['status'], errorKind: UsageResult['errorKind']): UsageResult => ({
    providerId: 'grok',
    windows: [],
    status,
    updatedAt: 2,
    errorKind,
    errorMessage: 'why',
    retryAfterMs: 5000,
  });

  it('browser auth failure → auth_required with local windows and note', () => {
    const r = combineGrokResults(fail('auth_required', 'auth'), () => local, 'SuperGrok Heavy');
    assert.equal(r.status, 'auth_required');
    assert.equal(r.windows.length, 1);
    assert.equal(r.note, 'SuperGrok Heavy');
  });

  it('browser 429 + local ok → ok carrying rate_limited + retryAfterMs', () => {
    const r = combineGrokResults(fail('error', 'rate_limited'), () => local);
    assert.equal(r.status, 'ok');
    assert.equal(r.errorKind, 'rate_limited');
    assert.equal(r.retryAfterMs, 5000);
    assert.equal(r.note, undefined);
  });

  it('no cookie → local untouched except note', () => {
    const r = combineGrokResults(null, () => local, 'SuperGrok Heavy');
    assert.deepEqual(r, { ...local, note: 'SuperGrok Heavy' });
  });
});

describe('extractPercentWindows', () => {
  it('finds nested usedPercent', () => {
    const w = extractPercentWindows({
      rateLimits: {
        weekly: { usedPercent: 31, name: 'weekly', resetsAt: '2026-08-10T00:00:00Z' },
      },
    });
    assert.equal(w.length, 1);
    assert.equal(w[0]?.usedPercent, 31);
    assert.equal(w[0]?.source, 'browser');
  });

  it('maps remainingFraction', () => {
    const w = extractPercentWindows({ remainingFraction: 0.4, name: 'session' });
    assert.equal(w[0]?.usedPercent, 60);
  });
});

describe('mapRateLimitPayload', () => {
  it('maps remainingQueries/totalQueries to used percent', () => {
    const w = mapRateLimitPayload(
      {
        windowSizeSeconds: 7200,
        remainingQueries: 100,
        totalQueries: 400,
      },
      'grok-3'
    );
    assert.equal(w.length, 1);
    assert.equal(w[0]?.usedPercent, 75);
    assert.ok(w[0]?.label?.includes('burst'));
  });
});

describe('parseGrokCreditsConfigMessage', () => {
  it('parses live SuperGrok Heavy payload (37% + build/chat)', () => {
    // Captured from GET GetGrokCreditsConfig grpc-web data frame (minus outer frame)
    const hex =
      '0a610d0000144212001a00220c08dff7a0d30610a8f6e2d4012a0c08dfecc5d30610a8f6e2d4013a07080215000010423a070804150000803f3a020805421e0802120c08dff7a0d30610a8f6e2d4011a0c08dfecc5d30610a8f6e2d401580162006801';
    const msg = Buffer.from(hex, 'hex');
    const cfg = parseGrokCreditsConfigMessage(msg);
    assert.ok(cfg);
    assert.equal(Math.round(cfg!.creditUsagePercent), 37);
    assert.equal(cfg!.periodType, 'weekly');
    assert.equal(cfg!.isUnifiedBillingUser, true);
    assert.ok(cfg!.periodEndSec);

    const build = cfg!.productUsage.find((p) => p.product === 2);
    const chat = cfg!.productUsage.find((p) => p.product === 4);
    assert.equal(Math.round(build?.usagePercent ?? -1), 36);
    assert.equal(Math.round(chat?.usagePercent ?? -1), 1);

    const wins = creditsConfigToWindows(cfg!);
    assert.equal(wins[0]?.id, 'supergrok-heavy');
    assert.equal(Math.round(wins[0]?.usedPercent ?? -1), 37);
    assert.ok(wins[0]?.label?.includes('SuperGrok Heavy'));
  });
});
