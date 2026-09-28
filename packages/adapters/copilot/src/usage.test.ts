import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  classifyGithubRateLimit,
  fetchCopilotUsageWithToken,
  findGhBinary,
  mapCopilotQuotas,
} from './usage.js';

describe('mapCopilotQuotas', () => {
  it('converts percent_remaining to used percent', () => {
    const w = mapCopilotQuotas({
      chat: { percent_remaining: 75, entitlement: 200, remaining: 150 },
      completions: { percent_remaining: 100, entitlement: 2000, remaining: 2000 },
    });
    assert.equal(w[0]?.id, 'chat');
    assert.equal(w[0]?.usedPercent, 25);
    assert.equal(w[1]?.usedPercent, 0);
  });

  it('keeps unlimited buckets (entitlement 0 + unlimited) with null percent', () => {
    const w = mapCopilotQuotas({
      chat: { unlimited: true, entitlement: 0, percent_remaining: 100 },
      completions: { unlimited: true, entitlement: 0, percent_remaining: 100 },
      premium_interactions: { unlimited: false, entitlement: 300, remaining: 255, percent_remaining: 85 },
    });
    assert.equal(w.length, 3);
    assert.equal(w[0]?.id, 'chat');
    assert.equal(w[0]?.usedPercent, null);
    assert.match(w[0]?.label ?? '', /unlimited/);
    assert.equal(w[1]?.usedPercent, null);
    assert.equal(w[2]?.usedPercent, 15);
    assert.equal(w[2]?.usedAbsolute, 45);
  });

  it('falls back to top-level quota_reset_date when a bucket has no reset', () => {
    const w = mapCopilotQuotas(
      {
        premium_interactions: { entitlement: 300, remaining: 150, percent_remaining: 50 },
        chat: { entitlement: 50, remaining: 25, percent_remaining: 50, quota_reset_at: 1_790_000_000 },
      },
      undefined,
      '2026-10-01'
    );
    const premium = w.find((x) => x.id === 'premium_interactions');
    const chat = w.find((x) => x.id === 'chat');
    assert.equal(premium?.resetsAt, Date.UTC(2026, 9, 1) / 1000);
    assert.equal(premium?.windowKind, 'fixed');
    assert.equal(chat?.resetsAt, 1_790_000_000);
    assert.equal(mapCopilotQuotas({ chat: { percent_remaining: 50, entitlement: 1 } }, undefined, 'garbage')[0]?.resetsAt, undefined);
  });

  it('skips zero-entitlement buckets', () => {
    const w = mapCopilotQuotas({
      chat: { percent_remaining: 50, entitlement: 200, remaining: 100 },
      premium_interactions: { percent_remaining: 0, entitlement: 0, remaining: 0 },
    });
    assert.equal(w.length, 1);
    assert.equal(w[0]?.id, 'chat');
    assert.equal(w[0]?.usedPercent, 50);
  });
});


describe('GitHub rate limits are not auth failures', () => {
  const NOW = Date.UTC(2026, 8, 28);

  it('403 + x-ratelimit-remaining: 0 → rate limited, retry at x-ratelimit-reset', () => {
    const h = new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) });
    assert.deepEqual(classifyGithubRateLimit(403, h, NOW), { rateLimited: true, retryAfterMs: 600_000 });
  });

  it('403 + retry-after (secondary limit) → rate limited', () => {
    const h = new Headers({ 'retry-after': '60', 'x-ratelimit-remaining': '4000' });
    assert.deepEqual(classifyGithubRateLimit(403, h, NOW), { rateLimited: true, retryAfterMs: 60_000 });
  });

  it('plain 403 → not rate limited', () => {
    assert.deepEqual(classifyGithubRateLimit(403, new Headers({ 'x-ratelimit-remaining': '4999' }), NOW), {
      rateLimited: false,
    });
  });

  it('fetch: 403 rate limit → error/rate_limited; 401 → auth_required', async () => {
    const limited = (async () =>
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '30' } })) as typeof fetch;
    const r1 = await fetchCopilotUsageWithToken('synthetic', limited);
    assert.equal(r1.status, 'error');
    assert.equal(r1.errorKind, 'rate_limited');
    assert.equal(r1.retryAfterMs, 30_000);

    const denied = (async () => new Response('{}', { status: 401 })) as typeof fetch;
    const r2 = await fetchCopilotUsageWithToken('synthetic', denied);
    assert.equal(r2.status, 'auth_required');
    assert.equal(r2.errorKind, 'auth');
  });

  it('fetch: ok response maps unlimited + reset fallback', async () => {
    const ok = (async () =>
      Response.json({
        copilot_plan: 'individual',
        quota_reset_date: '2026-10-01',
        quota_snapshots: {
          chat: { unlimited: true, entitlement: 0, percent_remaining: 100 },
          premium_interactions: { entitlement: 300, remaining: 270, percent_remaining: 90, unlimited: false },
        },
      })) as typeof fetch;
    const r = await fetchCopilotUsageWithToken('synthetic', ok);
    assert.equal(r.status, 'ok');
    assert.equal(r.windows.length, 2);
    assert.equal(r.windows[1]?.resetsAt, Date.UTC(2026, 9, 1) / 1000);
  });
});

describe('findGhBinary', () => {
  it('uses candidates first, then PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-pm-gh-'));
    try {
      const gh = path.join(dir, 'gh');
      fs.writeFileSync(gh, '#!/bin/sh\n', { mode: 0o755 });
      assert.equal(findGhBinary({ PATH: `/nonexistent${path.delimiter}${dir}` }, []), gh);
      assert.equal(findGhBinary({ PATH: '' }, [gh]), gh);
      assert.equal(findGhBinary({ PATH: '/nonexistent' }, ['/nonexistent/gh']), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
