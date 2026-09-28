import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapOpenRouterKeyPayload } from './usage.js';

describe('mapOpenRouterKeyPayload', () => {
  it('computes percent from usage/limit', () => {
    const w = mapOpenRouterKeyPayload({
      data: { usage: 2.5, limit: 10, limit_remaining: 7.5 },
    });
    assert.equal(w.length, 1);
    assert.equal(w[0]?.usedPercent, 25);
    assert.equal(w[0]?.unit, 'usd');
  });

  it('falls back to absolute usage without limit', () => {
    const w = mapOpenRouterKeyPayload({ data: { usage: 1.23, limit: null } });
    assert.equal(w[0]?.usedPercent, null);
    assert.equal(w[0]?.usedAbsolute, 1.23);
  });

  it('prefers limit_remaining over all-time usage (limits that reset)', () => {
    // All-time usage 40 exceeds the monthly limit, but only 2.5 of 10 is used this period.
    const w = mapOpenRouterKeyPayload({
      data: { usage: 40, limit: 10, limit_remaining: 7.5, limit_reset: 'monthly' },
    });
    assert.equal(w[0]?.usedPercent, 25);
    assert.equal(w[0]?.usedAbsolute, 2.5);
    assert.equal(w[0]?.label, 'credit limit (monthly)');
  });

  it('uses usage/limit when limit_remaining is absent', () => {
    const w = mapOpenRouterKeyPayload({ data: { usage: 3, limit: 12 } });
    assert.equal(w[0]?.usedPercent, 25);
  });

  it('guards zero/invalid limits and NaN', () => {
    const zero = mapOpenRouterKeyPayload({ data: { usage: 1, limit: 0, limit_remaining: 0 } });
    assert.equal(zero[0]?.id, 'usage_usd');
    assert.equal(zero[0]?.usedPercent, null);
    const nan = mapOpenRouterKeyPayload({ data: { usage: Number.NaN, limit: 10, limit_remaining: Number.NaN } });
    assert.deepEqual(nan, []);
    assert.deepEqual(mapOpenRouterKeyPayload({}), []);
    assert.deepEqual(mapOpenRouterKeyPayload(null), []);
  });

  it('clamps overspend to 100%', () => {
    const w = mapOpenRouterKeyPayload({ data: { limit: 10, limit_remaining: -2 } });
    assert.equal(w[0]?.usedPercent, 100);
  });
});
