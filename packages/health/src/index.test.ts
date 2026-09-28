import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchProviderHealth } from './index.js';

describe('fetchProviderHealth', () => {
  it('custom strategy → unknown / unsupported', async () => {
    const result = await fetchProviderHealth('x', { pageUrl: 'https://example.com', strategy: 'custom' });
    assert.equal(result.indicator, 'unknown');
    assert.equal(result.errorKind, 'unsupported');
    assert.equal(result.unreachable, true);
  });

  it('passes fetchImpl through and never throws', async () => {
    const result = await fetchProviderHealth(
      'x',
      { pageUrl: 'https://example.com', strategy: 'statuspage_v2' },
      {
        fetchImpl: async () => {
          throw new TypeError('fetch failed');
        },
      }
    );
    assert.equal(result.errorKind, 'network');
  });
});
