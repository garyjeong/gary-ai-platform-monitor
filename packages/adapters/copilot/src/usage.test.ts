import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapCopilotQuotas } from './usage.js';

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

  it('handles unlimited', () => {
    const w = mapCopilotQuotas({ chat: { unlimited: true } });
    assert.equal(w[0]?.usedPercent, 0);
    assert.match(w[0]?.label ?? '', /unlimited/);
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

