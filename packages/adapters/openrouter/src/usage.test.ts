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
});
