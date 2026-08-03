import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  creditsConfigToWindows,
  extractPercentWindows,
  mapRateLimitPayload,
  parseGrokCreditsConfigMessage,
} from './browser-usage.js';

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
