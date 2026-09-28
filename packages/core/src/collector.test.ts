import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Collector, collectOnce } from './collector.js';
import { loadConfigWithStatus, saveConfig, getConfigPath, normalizeHealthInterval } from './config.js';
import { isResetPassed, summarizeMenuBar } from './snapshot.js';
import { parseRetryAfter, scrubSecrets } from './http.js';
import { DEFAULT_CONFIG, type AppConfig, type ProviderAdapter, type UsageResult } from './types.js';

function adapter(
  id: string,
  fetchUsage: () => Promise<UsageResult>,
  found: () => boolean = () => true
): ProviderAdapter {
  return {
    meta: {
      id,
      displayName: id,
      capabilities: { percentWindows: true, costOnly: false, multiWindow: false },
      status: { pageUrl: 'https://status.example.com', strategy: 'statuspage_v2' },
    },
    async detect() {
      return { found: found(), signals: [], confidence: 'high' };
    },
    fetchUsage,
  };
}

function monitored(ids: string[]): AppConfig {
  const cfg = structuredClone(DEFAULT_CONFIG);
  for (const id of ids) cfg.providers[id] = { monitor: true, showHealth: true, userHidden: false };
  return cfg;
}

const ok = (pct: number, observedAt?: number): UsageResult => ({
  providerId: 'p',
  status: 'ok',
  updatedAt: Date.now(),
  observedAt,
  windows: [{ id: '5h', usedPercent: pct, source: 'oauth' }],
});

describe('Collector usage stream', () => {
  it('keeps last good numbers with the original observedAt after a failure', async () => {
    let t = 1_000_000;
    let call = 0;
    const a = adapter('p', async () => {
      call += 1;
      if (call === 1) return ok(40, t);
      return { providerId: 'p', status: 'error', updatedAt: t, windows: [], errorKind: 'server', errorMessage: 'HTTP 503' };
    });
    const c = new Collector({ adapters: [a], config: monitored(['p']), now: () => t });
    await c.refreshNow({ detect: true });
    const firstObserved = 1_000_000;
    t += 600_000;
    const snap = await c.refreshNow();
    const p = snap.providers[0]!;
    assert.equal(p.usage?.status, 'stale');
    assert.equal(p.usage?.windows[0]?.usedPercent, 40);
    assert.equal(p.usage?.observedAt, firstObserved);
    assert.equal(p.usage?.errorKind, 'server');
    assert.equal(p.refresh?.usage.consecutiveFailures, 1);
    assert.ok((p.refresh?.usage.nextAt ?? 0) > t);
  });

  it('honors Retry-After even on manual refresh', async () => {
    let t = 5_000_000;
    let calls = 0;
    const a = adapter('p', async () => {
      calls += 1;
      return { providerId: 'p', status: 'error', updatedAt: t, windows: [], errorKind: 'rate_limited', retryAfterMs: 900_000 };
    });
    const c = new Collector({ adapters: [a], config: monitored(['p']), now: () => t });
    await c.refreshNow({ detect: true });
    assert.equal(calls, 1);
    t += 60_000;
    await c.refreshNow(); // manual — must still wait for Retry-After
    assert.equal(calls, 1);
    t += 900_000;
    await c.refreshNow();
    assert.equal(calls, 2);
  });

  it('manual refresh with staleAfterMs skips fresh streams', async () => {
    let t = 0;
    let calls = 0;
    const a = adapter('p', async () => {
      calls += 1;
      return ok(10, t);
    });
    const c = new Collector({ adapters: [a], config: monitored(['p']), now: () => t });
    await c.refreshNow({ detect: true });
    t += 30_000;
    await c.refreshNow({ staleAfterMs: 60_000 });
    assert.equal(calls, 1);
    t += 40_000;
    await c.refreshNow({ staleAfterMs: 60_000 });
    assert.equal(calls, 2);
  });

  it('treats a hung adapter as timeout without blocking others', async () => {
    const slow = adapter('slow', () => new Promise(() => undefined));
    const fast = adapter('fast', async () => ok(5));
    const c = new Collector({
      adapters: [slow, fast],
      config: monitored(['slow', 'fast']),
      policy: { callDeadlineMs: 50 },
    });
    const snap = await c.refreshNow({ detect: true });
    const bySlow = snap.providers.find((p) => p.meta.id === 'slow')!;
    const byFast = snap.providers.find((p) => p.meta.id === 'fast')!;
    assert.equal(bySlow.usage?.errorKind, 'timeout');
    assert.equal(byFast.usage?.status, 'ok');
  });

  it('scrubs secrets from adapter error messages', async () => {
    const a = adapter('p', async () => {
      throw new TypeError('Headers.append: "Bearer sk-ant-oat01-abcdefghijklmnop" is an invalid header value');
    });
    const snap = await collectOnce({ adapters: [a], config: monitored(['p']) });
    const msg = snap.providers[0]!.usage?.errorMessage ?? '';
    assert.ok(!msg.includes('sk-ant'), msg);
  });
});

describe('Collector detection seeding', () => {
  it('seeds only found providers, so a later login still auto-enables', async () => {
    let found = false;
    const proposals: Array<Record<string, unknown>> = [];
    const a = adapter('codex', async () => ok(1), () => found);
    const c = new Collector({
      adapters: [a],
      config: structuredClone(DEFAULT_CONFIG),
      onConfigProposal: (patch) => proposals.push(patch),
    });
    await c.refreshNow({ detect: true });
    assert.equal(proposals.length, 0);
    assert.equal(c.getConfig().providers.codex, undefined);

    found = true;
    const snap = await c.refreshNow({ detect: true });
    assert.equal(proposals.length, 1);
    assert.equal(snap.config.providers.codex?.monitor, true);
    assert.equal(snap.providers[0]?.usage?.status, 'ok');
  });

  it('a throwing detect keeps the previous answer', async () => {
    let fail = false;
    const a: ProviderAdapter = {
      ...adapter('p', async () => ok(1)),
      async detect() {
        if (fail) throw new Error('keychain timeout');
        return { found: true, signals: [], confidence: 'high' };
      },
    };
    const c = new Collector({ adapters: [a], config: monitored(['p']) });
    await c.refreshNow({ detect: true });
    fail = true;
    const snap = await c.refreshNow({ detect: true });
    assert.equal(snap.providers[0]?.detect?.found, true);
  });
});

describe('Collector health stream', () => {
  it('fetches a shared status page once per interval and keeps last good on failure', async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const mk = (id: string) => adapter(id, async () => ok(1));
    const c = new Collector({
      adapters: [mk('codex'), mk('chatgpt')],
      config: monitored(['codex', 'chatgpt']),
      now: () => t,
      fetchHealth: async (id, meta) => {
        calls += 1;
        if (fail) {
          return { providerId: id, indicator: 'unknown', description: 'x', pageUrl: meta.pageUrl, components: [], updatedAt: t, unreachable: true, errorKind: 'timeout' };
        }
        return { providerId: id, indicator: 'minor', description: 'Partial', pageUrl: meta.pageUrl, components: [], updatedAt: t };
      },
    });
    const first = await c.refreshNow({ detect: true });
    assert.equal(calls, 1);
    assert.equal(first.providers.every((p) => p.health?.indicator === 'minor'), true);

    fail = true;
    t += 120_000;
    const second = await c.refreshNow();
    assert.equal(calls, 2);
    const codex = second.providers.find((p) => p.meta.id === 'codex')!;
    assert.equal(codex.health?.indicator, 'minor');
    assert.equal(codex.refresh?.health.consecutiveFailures, 1);
  });
});

describe('snapshot helpers', () => {
  it('reset-passed windows are ignored by the menu bar summary', () => {
    const now = 2_000_000_000_000;
    const past = Math.floor(now / 1000) - 60;
    const future = Math.floor(now / 1000) + 3600;
    const cfg = monitored(['p']);
    const summary = summarizeMenuBar(
      [
        {
          meta: { id: 'p', displayName: 'P', capabilities: { percentWindows: true, costOnly: false, multiWindow: true } },
          lifecycle: 'monitored',
          detect: null,
          health: null,
          usage: {
            providerId: 'p',
            status: 'ok',
            updatedAt: now,
            windows: [
              { id: '5h', usedPercent: 95, resetsAt: past, source: 'local' },
              { id: '7d', usedPercent: 40, resetsAt: future, source: 'local' },
            ],
          },
        },
      ],
      cfg,
      now
    );
    assert.equal(summary.lines[0]?.usedPercent, 40);
    assert.equal(isResetPassed({ id: 'r', usedPercent: 1, resetsAt: past, windowKind: 'rolling', source: 'local' }, now), false);
  });
});

describe('http helpers', () => {
  it('parses Retry-After seconds and HTTP-date', () => {
    assert.equal(parseRetryAfter('120'), 120_000);
    const now = Date.parse('2026-09-28T00:00:00Z');
    assert.equal(parseRetryAfter('Mon, 28 Sep 2026 00:01:00 GMT', now), 60_000);
    assert.equal(parseRetryAfter('garbage'), undefined);
  });

  it('scrubs bearer tokens, API keys and cookie values', () => {
    const s = scrubSecrets('Bearer abc.def.ghi sk-or-v1-0123456789abcdef sso=eyJhbGciOiJIUzI1NiJ9.payload; x=1');
    assert.ok(!s.includes('abc.def.ghi'));
    assert.ok(!s.includes('0123456789abcdef'));
    assert.ok(!s.includes('eyJhbGci'));
  });
});

describe('config file safety', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-pm-cfg-'));
    process.env.GAI_PM_CONFIG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.GAI_PM_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('moves an unparsable config aside instead of overwriting it', () => {
    fs.writeFileSync(getConfigPath(), '{ "providers": { "claude": { "monitor": false, }, } }');
    const res = loadConfigWithStatus();
    assert.ok(res.recoveredFrom);
    assert.ok(fs.existsSync(res.recoveredFrom!));
    assert.equal(fs.existsSync(getConfigPath()), false);
  });

  it('saves atomically and round-trips', () => {
    const cfg = monitored(['claude']);
    saveConfig(cfg);
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
    assert.equal(loadConfigWithStatus().config.providers.claude?.monitor, true);
  });

  it('migrates the old 10–29s status interval to 30s', () => {
    assert.equal(normalizeHealthInterval(10), 30);
    assert.equal(normalizeHealthInterval(45), 45);
    assert.equal(normalizeHealthInterval(9999), 300);
    assert.equal(normalizeHealthInterval(undefined), 60);
  });
});
