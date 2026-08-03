import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapOAuthUsageToWindows } from './usage.js';

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
