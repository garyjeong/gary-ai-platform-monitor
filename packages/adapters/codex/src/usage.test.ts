import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapCodexRateLimits, parseRateLimitsFromRolloutText } from './usage.js';

const sampleLine = JSON.stringify({
  type: 'event',
  rate_limits: {
    plan_type: 'plus',
    primary: {
      used_percent: 18.0,
      window_minutes: 10080,
      resets_at: 1786165248,
    },
    secondary: null,
  },
});

describe('parseRateLimitsFromRolloutText', () => {
  it('finds rate_limits from jsonl tail', () => {
    const text = '{"noise":true}\n' + sampleLine + '\n';
    const limits = parseRateLimitsFromRolloutText(text);
    assert.ok(limits);
    assert.equal(limits?.primary?.used_percent, 18);
    assert.equal(limits?.plan_type, 'plus');
  });
});

describe('mapCodexRateLimits', () => {
  it('maps primary used_percent', () => {
    const windows = mapCodexRateLimits({
      primary: { used_percent: 18, window_minutes: 10080, resets_at: 1786165248 },
      secondary: null,
    });
    assert.equal(windows.length, 1);
    assert.equal(windows[0]?.usedPercent, 18);
    assert.equal(windows[0]?.id, 'primary');
    assert.equal(windows[0]?.source, 'local');
    assert.match(windows[0]?.label ?? '', /7d/);
  });
});
