import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { ProviderStatusMeta } from '@gary-ai-platform-monitor/core';
import { fetchStatuspageHealth, matchesWatch, parseStatuspageSummary } from './statuspage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, '../../../fixtures/status');

interface Summary {
  status: { indicator: string; description: string };
  components: Array<{ name: string; status: string; group?: boolean }>;
}

/** Fresh deep copy each call so tests can mutate freely. */
function load(name: 'claude-summary.json' | 'openai-summary.json'): Summary {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf-8')) as Summary;
}

function setStatus(body: Summary, componentName: string, status: string): Summary {
  const c = body.components.find((x) => x.name === componentName);
  assert.ok(c, `fixture component missing: ${componentName}`);
  c.status = status;
  return body;
}

const CLAUDE: ProviderStatusMeta = {
  pageUrl: 'https://status.claude.com',
  strategy: 'statuspage_v2',
  summaryUrl: 'https://status.claude.com/api/v2/summary.json',
  watchComponents: ['Claude Code', 'claude.ai', 'Claude API (api.anthropic.com)'],
};

const OPENAI: ProviderStatusMeta = {
  pageUrl: 'https://status.openai.com',
  strategy: 'statuspage_v2',
  summaryUrl: 'https://status.openai.com/api/v2/summary.json',
  watchComponents: ['Codex', 'Responses'],
};

describe('matchesWatch', () => {
  const cases: Array<[string, string, boolean]> = [
    ['Claude Code', 'Claude Code', true],
    ['claude.ai', 'Claude.AI', true],
    ['Claude API (api.anthropic.com)', 'Claude API', true],
    ['Codex in ChatGPT Desktop', 'Codex', true],
    ['Codex in ChatGPT Desktop', 'ChatGPT', false], // no infix match
    ['ChatGPT Atlas', 'ChatGPT', true],
    ['Compliance API', 'API', false],
    ['Login', 'Log', false], // prefix must end at a word boundary
    ['Claude Code', '  ', false],
  ];
  for (const [name, watch, expected] of cases) {
    it(`"${watch}" vs "${name}" → ${expected}`, () => {
      assert.equal(matchesWatch(name, watch), expected);
    });
  }

  it('old codex list [ChatGPT, API, Codex] vs openai fixture matches only 2 of 25', () => {
    const names = load('openai-summary.json').components.map((c) => c.name);
    assert.equal(names.length, 25);
    const hit = names.filter((n) => ['ChatGPT', 'API', 'Codex'].some((w) => matchesWatch(n, w)));
    assert.deepEqual(hit, ['Codex in ChatGPT Desktop', 'ChatGPT Atlas']);
  });
});

describe('parseStatuspageSummary', () => {
  it('Claude fixture, all operational → none with page description', () => {
    const result = parseStatuspageSummary('claude', CLAUDE, load('claude-summary.json'));
    assert.equal(result.providerId, 'claude');
    assert.equal(result.indicator, 'none');
    assert.equal(result.description, 'All Systems Operational');
    assert.equal(result.components.length, 6);
    assert.equal(result.unreachable, undefined);
    assert.equal(result.errorKind, undefined);
  });

  it('Claude: prefix watch "Claude API" catches a major outage while page says none', () => {
    const body = setStatus(load('claude-summary.json'), 'Claude API (api.anthropic.com)', 'major_outage');
    const result = parseStatuspageSummary(
      'claude',
      { ...CLAUDE, watchComponents: ['Claude Code', 'Claude API'] },
      body
    );
    assert.equal(body.status.indicator, 'none');
    assert.equal(result.indicator, 'critical');
    assert.equal(result.description, 'Claude API (api.anthropic.com): major outage');
  });

  it('OpenAI fixture, watched operational → none', () => {
    const result = parseStatuspageSummary('codex', OPENAI, load('openai-summary.json'));
    assert.equal(result.indicator, 'none');
    assert.equal(result.description, 'All Systems Operational');
    assert.equal(result.components.length, 25);
  });

  it('OpenAI: watched component partial_outage → major even if page indicator is none', () => {
    const body = setStatus(load('openai-summary.json'), 'Codex in ChatGPT Desktop', 'partial_outage');
    const result = parseStatuspageSummary('codex', OPENAI, body);
    assert.equal(result.indicator, 'major');
    assert.equal(result.description, 'Codex in ChatGPT Desktop: partial outage');
  });

  it('OpenAI: worst watched component wins, not the first non-operational one', () => {
    const body = load('openai-summary.json');
    // "Responses" (position 2) comes before "Codex in ChatGPT Desktop" (position 3).
    setStatus(body, 'Responses', 'degraded_performance');
    setStatus(body, 'Codex in ChatGPT Desktop', 'major_outage');
    body.status = { indicator: 'minor', description: 'Partially Degraded Service' };
    const result = parseStatuspageSummary('codex', OPENAI, body);
    assert.equal(result.indicator, 'critical');
    assert.equal(result.description, 'Codex in ChatGPT Desktop: major outage (+1 more)');
  });

  it('OpenAI: degraded_performance → minor, under_maintenance → maintenance', () => {
    const degraded = setStatus(load('openai-summary.json'), 'Responses', 'degraded_performance');
    assert.equal(parseStatuspageSummary('codex', OPENAI, degraded).indicator, 'minor');
    const maint = setStatus(load('openai-summary.json'), 'Responses', 'under_maintenance');
    assert.equal(parseStatuspageSummary('codex', OPENAI, maint).indicator, 'maintenance');
  });

  it('OpenAI: outage in an unwatched component does not colour the watched badge', () => {
    const body = setStatus(load('openai-summary.json'), 'Sora', 'major_outage');
    body.status = { indicator: 'major', description: 'Partial System Outage' };
    const result = parseStatuspageSummary('codex', OPENAI, body);
    assert.equal(result.indicator, 'none');
    assert.equal(result.description, 'Watched components operational (page: Partial System Outage)');
  });

  it('no watched component matches → page-wide indicator', () => {
    const body = setStatus(load('openai-summary.json'), 'Sora', 'partial_outage');
    body.status = { indicator: 'minor', description: 'Minor Service Outage' };
    const result = parseStatuspageSummary(
      'codex',
      { ...OPENAI, watchComponents: ['Nonexistent Product'] },
      body
    );
    assert.equal(result.indicator, 'minor');
    assert.equal(result.description, 'Minor Service Outage');
  });

  it('watched components with unrecognized statuses → page-wide indicator', () => {
    const body = setStatus(load('openai-summary.json'), 'Responses', 'weird_state');
    setStatus(body, 'Codex in ChatGPT Desktop', 'weird_state');
    body.status = { indicator: 'major', description: 'Partial System Outage' };
    const result = parseStatuspageSummary('codex', OPENAI, body);
    assert.equal(result.indicator, 'major');
    assert.equal(result.description, 'Partial System Outage');
  });

  it('group components are excluded from list and matching', () => {
    const body = load('claude-summary.json');
    body.components.push({ name: 'Claude Code Group', status: 'major_outage', group: true });
    const result = parseStatuspageSummary('claude', { ...CLAUDE, watchComponents: ['Claude Code'] }, body);
    assert.equal(result.indicator, 'none');
    assert.equal(result.components.length, 6);
  });

  for (const [label, body] of [
    ['null', null],
    ['array', []],
    ['string', 'ok'],
    ['number', 42],
    ['empty object', {}],
  ] as const) {
    it(`${label} body → unknown / parse (no throw)`, () => {
      const result = parseStatuspageSummary('claude', CLAUDE, body);
      assert.equal(result.indicator, 'unknown');
      assert.equal(result.unreachable, true);
      assert.equal(result.errorKind, 'parse');
    });
  }
});

function respond(body: string, init: ResponseInit = {}): typeof fetch {
  return async () => new Response(body, init);
}

const hangingFetch: typeof fetch = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

describe('fetchStatuspageHealth', () => {
  it('200 fixture → parsed', async () => {
    const body = JSON.stringify(setStatus(load('openai-summary.json'), 'Responses', 'partial_outage'));
    const result = await fetchStatuspageHealth('codex', OPENAI, {
      fetchImpl: respond(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    assert.equal(result.indicator, 'major');
    assert.equal(result.errorKind, undefined);
  });

  it('200 with JSON null → parse', async () => {
    const result = await fetchStatuspageHealth('codex', OPENAI, {
      fetchImpl: respond('null', { status: 200 }),
    });
    assert.equal(result.indicator, 'unknown');
    assert.equal(result.errorKind, 'parse');
  });

  it('200 with HTML body (invalid JSON) → parse', async () => {
    const result = await fetchStatuspageHealth('codex', OPENAI, {
      fetchImpl: respond('<html>Just a moment...</html>', { status: 200 }),
    });
    assert.equal(result.errorKind, 'parse');
    assert.equal(result.description, '상태 확인 불가 (invalid response)');
  });

  it('429 → rate_limited with retryAfterMs', async () => {
    const result = await fetchStatuspageHealth('codex', OPENAI, {
      fetchImpl: respond('', { status: 429, headers: { 'Retry-After': '30' } }),
    });
    assert.equal(result.errorKind, 'rate_limited');
    assert.equal(result.retryAfterMs, 30_000);
    assert.equal(result.unreachable, true);
  });

  it('500 → server', async () => {
    const result = await fetchStatuspageHealth('codex', OPENAI, {
      fetchImpl: respond('', { status: 500 }),
    });
    assert.equal(result.errorKind, 'server');
    assert.equal(result.retryAfterMs, undefined);
  });

  it('timeout → timeout, returns promptly', async () => {
    const started = Date.now();
    const result = await fetchStatuspageHealth('codex', OPENAI, {
      fetchImpl: hangingFetch,
      timeoutMs: 30,
    });
    assert.equal(result.errorKind, 'timeout');
    assert.equal(result.description, '상태 확인 불가 (timeout)');
    assert.ok(Date.now() - started < 2_000);
  });
});
