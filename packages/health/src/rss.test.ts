import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { parseRssHealth } from './rss.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, '../../../fixtures/status/xai-feed.xml');

describe('parseRssHealth', () => {
  it('treats all-resolved xAI feed as operational', () => {
    const xml = readFileSync(fixture, 'utf-8');
    const result = parseRssHealth(
      'grok',
      {
        pageUrl: 'https://status.x.ai',
        strategy: 'rss',
        summaryUrl: 'https://status.x.ai/feed.xml',
      },
      xml
    );
    assert.equal(result.indicator, 'none');
    assert.match(result.description, /operational/i);
    assert.equal(result.unreachable, undefined);
  });

  it('flags open investigating incident as non-none', () => {
    const xml = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title>[API] Elevated errors</title>
  <description><![CDATA[
    <h3>Status: Investigating</h3>
    <p>Severity: degraded</p>
  ]]></description>
  <category>degraded</category>
</item>
</channel></rss>`;
    const result = parseRssHealth(
      'grok',
      { pageUrl: 'https://status.x.ai', strategy: 'rss' },
      xml
    );
    assert.notEqual(result.indicator, 'none');
    assert.match(result.description, /Elevated errors/i);
  });
});
