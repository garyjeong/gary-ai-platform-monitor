import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseStatuspageSummary } from './statuspage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, '../../../fixtures/status/claude-summary.json');

describe('parseStatuspageSummary', () => {
  it('parses Claude statuspage fixture', () => {
    const body = JSON.parse(readFileSync(fixture, 'utf-8'));
    const result = parseStatuspageSummary('claude', {
      pageUrl: 'https://status.claude.com',
      strategy: 'statuspage_v2',
      summaryUrl: 'https://status.claude.com/api/v2/summary.json',
      watchComponents: ['Claude Code', 'claude.ai'],
    }, body);

    assert.equal(result.providerId, 'claude');
    assert.equal(result.indicator, 'none');
    assert.ok(result.components.length >= 1);
    assert.equal(result.unreachable, undefined);
  });
});
