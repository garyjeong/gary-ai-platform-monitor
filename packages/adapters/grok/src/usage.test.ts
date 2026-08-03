import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractPercentWindows } from './browser-usage.js';

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
