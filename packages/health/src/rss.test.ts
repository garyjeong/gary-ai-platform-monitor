import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { HealthIndicator, ProviderStatusMeta } from '@gary-ai-platform-monitor/core';
import { fetchRssHealth, parseRssHealth, severityToIndicator } from './rss.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, '../../../fixtures/status/xai-feed.xml');
const FEED = readFileSync(fixture, 'utf-8');

const META: ProviderStatusMeta = {
  pageUrl: 'https://status.x.ai',
  strategy: 'rss',
  summaryUrl: 'https://status.x.ai/feed.xml',
};

/** First real <item> of the fixture (resolved, pubDate Tue, 07 Jul 2026 15:40:26 GMT). */
const FIRST_ITEM = FEED.match(/<item>[\s\S]*?<\/item>/)![0];
const FIRST_TITLE = FIRST_ITEM.match(/<title>([^<]*)<\/title>/)![1]!;
/** One day after the first item — keeps it inside the 14-day staleness window. */
const FIXTURE_NOW = Date.parse('Wed, 08 Jul 2026 16:00:00 GMT');
const DAY = 24 * 60 * 60 * 1000;

/** Re-open the real first item: change status line, severity line, categories, pubDate, title. */
function openItem(opts: {
  severity?: string | null;
  status?: string;
  categories?: string[];
  pubDate?: string;
  title?: string;
} = {}): string {
  const severity = opts.severity === undefined ? 'available' : opts.severity;
  const categories = opts.categories ?? (severity ? [severity.replace(/ /g, '_')] : []);
  let item = FIRST_ITEM.replace('Status: RESOLVED', `Status: ${opts.status ?? 'INVESTIGATING'}`)
    .replace(
      '<p>Severity: available</p>',
      severity === null ? '' : `<p>Severity: ${severity}</p>`
    )
    .replace(
      /<category>[\s\S]*<\/category>/,
      categories.map((c) => `<category>${c}</category>`).join('\n      ')
    );
  if (opts.pubDate) item = item.replace(/<pubDate>[^<]*<\/pubDate>/, `<pubDate>${opts.pubDate}</pubDate>`);
  if (opts.title) item = item.replace(/<title>[^<]*<\/title>/, `<title>${opts.title}</title>`);
  return item;
}

/** Real feed with the first item replaced by the given items. */
function feedWith(...items: string[]): string {
  return FEED.replace(FIRST_ITEM, items.join('\n'));
}

function parse(xml: string, now = FIXTURE_NOW) {
  return parseRssHealth('grok', META, xml, { now });
}

describe('parseRssHealth — real xAI feed', () => {
  it('fixture sanity: 105 items, first item is resolved/available', () => {
    assert.equal(FEED.match(/<item>/g)?.length, 105);
    assert.match(FIRST_ITEM, /<h3>Status: RESOLVED<\/h3>/);
    assert.match(FIRST_ITEM, /<p>Severity: available<\/p>/);
  });

  it('all-resolved feed is operational (today and at fixture time)', () => {
    for (const result of [parseRssHealth('grok', META, FEED), parse(FEED)]) {
      assert.equal(result.indicator, 'none');
      assert.equal(result.description, 'All Systems Operational');
      assert.equal(result.unreachable, undefined);
      assert.equal(result.errorKind, undefined);
      assert.equal(result.components.length, 5);
      assert.ok(result.components.every((c) => c.status === 'resolved'));
    }
  });

  it('open incident with "Severity: available" is minor, not major', () => {
    const result = parse(feedWith(openItem({ severity: 'available' })));
    assert.equal(result.indicator, 'minor');
    assert.equal(result.description, FIRST_TITLE);
    assert.deepEqual(result.components, [
      { name: FIRST_TITLE.slice(0, 79) + '…', status: 'available' },
    ]);
  });

  it('"partial outage" is major (partial wins over outage)', () => {
    const result = parse(feedWith(openItem({ severity: 'partial outage' })));
    assert.equal(result.indicator, 'major');
    assert.equal(result.components[0]?.status, 'partial outage');
  });

  const table: Array<[string, HealthIndicator]> = [
    ['available', 'minor'],
    ['informational', 'minor'],
    ['degraded', 'major'],
    ['degraded_performance', 'major'],
    ['partial', 'major'],
    ['partial_outage', 'major'],
    ['unavailable', 'critical'],
    ['major outage', 'critical'],
    ['major_outage', 'critical'],
    ['outage', 'critical'],
    ['critical', 'critical'],
    ['maintenance', 'maintenance'],
    ['under_maintenance', 'maintenance'],
    ['something-new', 'minor'],
  ];
  for (const [severity, expected] of table) {
    it(`severity "${severity}" → ${expected}`, () => {
      assert.equal(severityToIndicator(severity), expected);
      assert.equal(parse(feedWith(openItem({ severity }))).indicator, expected);
    });
  }

  it('missing Severity line falls back to first non-status category', () => {
    const result = parse(
      feedWith(openItem({ severity: null, categories: ['investigating', 'unavailable'] }))
    );
    assert.equal(result.indicator, 'critical');
    assert.equal(result.components[0]?.status, 'unavailable');
  });

  it('no severity at all on an open incident → minor', () => {
    const result = parse(feedWith(openItem({ severity: null, categories: [] })));
    assert.equal(result.indicator, 'minor');
    assert.equal(result.components[0]?.status, 'unknown');
  });

  it('"Status: RESOLVED" alone (no resolved category) closes the incident', () => {
    const result = parse(
      feedWith(openItem({ status: 'RESOLVED', severity: 'unavailable', categories: ['unavailable'] }))
    );
    assert.equal(result.indicator, 'none');
  });

  it('two labels on one line do not bleed into each other', () => {
    const item = openItem().replace(
      /<h3>Status: INVESTIGATING<\/h3>\s*<p>Severity: available<\/p>/,
      '<p>Status: Investigating Severity: partial_outage</p>'
    );
    const result = parse(feedWith(item));
    assert.equal(result.indicator, 'major');
    assert.equal(result.components[0]?.status, 'partial outage');
  });

  it('worst open incident drives indicator and description', () => {
    const result = parse(
      feedWith(
        openItem({ severity: 'available', title: 'Minor blip' }),
        openItem({ severity: 'unavailable', title: 'API down' })
      )
    );
    assert.equal(result.indicator, 'critical');
    assert.equal(result.description, 'API down (+1 more)');
    assert.equal(result.components.length, 2);
  });

  it('open incident older than 14 days is ignored and counted', () => {
    const old = new Date(FIXTURE_NOW - 30 * DAY).toUTCString();
    const result = parse(feedWith(openItem({ severity: 'unavailable', pubDate: old })));
    assert.equal(result.indicator, 'none');
    assert.equal(result.description, 'All Systems Operational (1 stale unresolved incident ignored)');
    assert.equal(result.components[0]?.status, 'stale');
  });

  it('stale incident does not mask a fresh one', () => {
    const old = new Date(FIXTURE_NOW - 15 * DAY).toUTCString();
    const fresh = new Date(FIXTURE_NOW - 13 * DAY).toUTCString();
    const result = parse(
      feedWith(
        openItem({ severity: 'unavailable', pubDate: old, title: 'Old never-resolved' }),
        openItem({ severity: 'degraded', pubDate: fresh, title: 'Current issue' })
      )
    );
    assert.equal(result.indicator, 'major');
    assert.equal(result.description, 'Current issue');
  });

  it('real fixture evaluated today: first item re-opened is already stale', () => {
    // pubDate 2026-07-07; with the real clock (≥ 2026-09) it is > 14 days old.
    const result = parseRssHealth('grok', META, feedWith(openItem({ severity: 'unavailable' })), {
      now: Date.parse('2026-09-28T00:00:00Z'),
    });
    assert.equal(result.indicator, 'none');
    assert.match(result.description, /1 stale unresolved incident ignored/);
  });

  it('truncated body (item start, no complete item) → unknown / parse', () => {
    const truncated = FEED.slice(0, FEED.indexOf('<item>') + 300);
    const result = parse(truncated);
    assert.equal(result.indicator, 'unknown');
    assert.equal(result.unreachable, true);
    assert.equal(result.errorKind, 'parse');
  });

  it('valid channel with zero items → none', () => {
    const empty = FEED.slice(0, FEED.indexOf('<item>')) + '</channel>\n</rss>\n';
    const result = parse(empty);
    assert.equal(result.indicator, 'none');
    assert.equal(result.unreachable, undefined);
    assert.deepEqual(result.components, []);
  });

  it('HTML page instead of a feed → unknown / parse', () => {
    const result = parse('<!doctype html><html><body>Just a moment...</body></html>');
    assert.equal(result.indicator, 'unknown');
    assert.equal(result.errorKind, 'parse');
  });

  it('Atom entry with category term attribute', () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Console errors</title>
    <link href="https://status.example.com/i/1"/>
    <updated>${new Date(FIXTURE_NOW - DAY).toISOString()}</updated>
    <category term="degraded"/>
    <content type="html">&lt;h3&gt;Status: Identified&lt;/h3&gt;</content>
  </entry>
</feed>`;
    const result = parse(atom);
    assert.equal(result.indicator, 'major');
    assert.equal(result.description, 'Console errors');
  });
});

function respond(body: string, init: ResponseInit = {}): typeof fetch {
  return async () => new Response(body, init);
}

/** Never resolves on its own; rejects with the abort reason like real fetch. */
const hangingFetch: typeof fetch = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

describe('fetchRssHealth', () => {
  it('parses a 200 feed', async () => {
    const result = await fetchRssHealth('grok', META, {
      fetchImpl: respond(feedWith(openItem({ severity: 'available' })), { status: 200 }),
      now: FIXTURE_NOW,
    });
    assert.equal(result.indicator, 'minor');
    assert.equal(result.errorKind, undefined);
  });

  it('429 → rate_limited with retryAfterMs', async () => {
    const result = await fetchRssHealth('grok', META, {
      fetchImpl: respond('slow down', { status: 429, headers: { 'Retry-After': '120' } }),
    });
    assert.equal(result.indicator, 'unknown');
    assert.equal(result.unreachable, true);
    assert.equal(result.errorKind, 'rate_limited');
    assert.equal(result.retryAfterMs, 120_000);
    assert.match(result.description, /retry in 120s/);
  });

  it('503 → server', async () => {
    const result = await fetchRssHealth('grok', META, {
      fetchImpl: respond('oops', { status: 503 }),
    });
    assert.equal(result.errorKind, 'server');
    assert.match(result.description, /HTTP 503/);
  });

  it('403 (WAF block on a public page) → server, not auth', async () => {
    const result = await fetchRssHealth('grok', META, {
      fetchImpl: respond('forbidden', { status: 403 }),
    });
    assert.equal(result.errorKind, 'server');
  });

  it('timeout → timeout, returns promptly', async () => {
    const started = Date.now();
    const result = await fetchRssHealth('grok', META, { fetchImpl: hangingFetch, timeoutMs: 30 });
    assert.equal(result.errorKind, 'timeout');
    assert.equal(result.indicator, 'unknown');
    assert.ok(Date.now() - started < 2_000);
  });

  it('network failure → network', async () => {
    const result = await fetchRssHealth('grok', META, {
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });
    assert.equal(result.errorKind, 'network');
    assert.equal(result.description, '상태 확인 불가 (network error)');
  });

  it('truncated 200 body → parse', async () => {
    const result = await fetchRssHealth('grok', META, {
      fetchImpl: respond(FEED.slice(0, FEED.indexOf('<item>') + 300), { status: 200 }),
    });
    assert.equal(result.errorKind, 'parse');
    assert.equal(result.unreachable, true);
  });
});
