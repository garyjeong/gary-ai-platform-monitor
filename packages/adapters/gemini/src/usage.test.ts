import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapQuotaBuckets, pickPrimaryWindows } from './usage.js';

describe('mapQuotaBuckets', () => {
  it('converts remainingFraction to used percent', () => {
    const windows = mapQuotaBuckets([
      { modelId: 'gemini-2.5-pro', remainingFraction: 0.25, resetTime: '2026-08-04T00:00:00Z' },
      { modelId: 'gemini-2.5-flash', remainingFraction: 1 },
    ]);
    assert.equal(windows.length, 2);
    assert.equal(windows[0]?.usedPercent, 75);
    assert.equal(windows[1]?.usedPercent, 0);
  });
});

describe('pickPrimaryWindows', () => {
  it('sorts highest used first', () => {
    const w = pickPrimaryWindows(mapQuotaBuckets([
      { modelId: 'a', remainingFraction: 0.9 },
      { modelId: 'b', remainingFraction: 0.1 },
    ]));
    assert.equal(w[0]?.usedPercent, 90);
  });
});
