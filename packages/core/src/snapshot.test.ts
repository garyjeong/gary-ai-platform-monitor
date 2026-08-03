import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, type ProviderAdapter } from './types.js';
import { buildSnapshot, summarizeMenuBar } from './snapshot.js';

function mockAdapter(
  id: string,
  opts: { found?: boolean; percent?: number | null; slowMs?: number } = {}
): ProviderAdapter {
  const found = opts.found ?? true;
  const percent = opts.percent ?? 50;
  return {
    meta: {
      id,
      displayName: id,
      capabilities: { percentWindows: true, costOnly: false, multiWindow: false },
      status: {
        pageUrl: `https://status.example.com/${id}`,
        strategy: 'statuspage_v2',
      },
    },
    async detect() {
      return {
        found,
        signals: found ? [{ kind: 'session_dir', detail: '/tmp' }] : [],
        confidence: found ? 'high' : 'low',
      };
    },
    async fetchUsage() {
      if (opts.slowMs) await new Promise((r) => setTimeout(r, opts.slowMs));
      return {
        providerId: id,
        status: 'ok',
        updatedAt: Date.now(),
        windows:
          percent === null
            ? []
            : [{ id: 'primary', usedPercent: percent, source: 'local' }],
      };
    },
  };
}

describe('buildSnapshot', () => {
  it('auto-enables found providers on first discover', async () => {
    let saved = structuredClone(DEFAULT_CONFIG);
    const snap = await buildSnapshot({
      adapters: [mockAdapter('claude', { percent: 62 })],
      config: DEFAULT_CONFIG,
      onConfigChange: (c) => {
        saved = c;
      },
    });
    assert.equal(snap.config.providers.claude?.monitor, true);
    assert.equal(saved.providers.claude?.monitor, true);
    assert.equal(snap.providers[0]?.lifecycle, 'monitored');
    assert.equal(snap.menuBar.title, '');
    assert.equal(snap.menuBar.lines[0]?.usedPercent, 62);
  });

  it('respects monitor false and does not fetch usage', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude = {
      monitor: false,
      showHealth: false,
      userHidden: true,
    };
    let fetched = false;
    const adapter = mockAdapter('claude');
    const original = adapter.fetchUsage.bind(adapter);
    adapter.fetchUsage = async () => {
      fetched = true;
      return original();
    };
    const snap = await buildSnapshot({ adapters: [adapter], config });
    assert.equal(fetched, false);
    assert.equal(snap.providers[0]?.lifecycle, 'discovered');
  });

  it('does not fetch health for non-monitored providers', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude = {
      monitor: false,
      showHealth: true,
      userHidden: true,
    };
    let healthCalls = 0;
    const snap = await buildSnapshot({
      adapters: [mockAdapter('claude')],
      config,
      fetchHealth: async () => {
        healthCalls++;
        return {
          providerId: 'claude',
          indicator: 'none',
          description: 'ok',
          pageUrl: 'https://example.com',
          components: [],
          updatedAt: Date.now(),
        };
      },
    });
    assert.equal(healthCalls, 0);
    assert.equal(snap.providers[0]?.health, null);
  });

  it('fetches health only for monitored+found', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude = {
      monitor: true,
      showHealth: true,
      userHidden: false,
    };
    let healthCalls = 0;
    const snap = await buildSnapshot({
      adapters: [mockAdapter('claude')],
      config,
      fetchHealth: async () => {
        healthCalls++;
        return {
          providerId: 'claude',
          indicator: 'none',
          description: 'ok',
          pageUrl: 'https://example.com',
          components: [],
          updatedAt: Date.now(),
        };
      },
    });
    assert.equal(healthCalls, 1);
    assert.equal(snap.providers[0]?.health?.indicator, 'none');
  });

  it('skips custom health strategy', async () => {
    const adapter = mockAdapter('x');
    adapter.meta.status = {
      pageUrl: 'https://example.com',
      strategy: 'custom',
    };
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.x = { monitor: true, showHealth: true, userHidden: false };
    let healthCalls = 0;
    await buildSnapshot({
      adapters: [adapter],
      config,
      fetchHealth: async () => {
        healthCalls++;
        return {
          providerId: 'x',
          indicator: 'none',
          description: 'ok',
          pageUrl: 'https://example.com',
          components: [],
          updatedAt: Date.now(),
        };
      },
    });
    assert.equal(healthCalls, 0);
  });

  it('forces monitor off when userHidden is set', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude = {
      monitor: true, // inconsistent — should be corrected
      showHealth: true,
      userHidden: true,
    };
    let fetched = false;
    const adapter = mockAdapter('claude');
    adapter.fetchUsage = async () => {
      fetched = true;
      return {
        providerId: 'claude',
        status: 'ok',
        updatedAt: Date.now(),
        windows: [],
      };
    };
    const snap = await buildSnapshot({ adapters: [adapter], config });
    assert.equal(fetched, false);
    assert.equal(snap.config.providers.claude?.monitor, false);
  });

  it('skips health when global health.enabled is false', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.health.enabled = false;
    config.providers.claude = {
      monitor: true,
      showHealth: true,
      userHidden: false,
    };
    let healthCalls = 0;
    await buildSnapshot({
      adapters: [mockAdapter('claude')],
      config,
      fetchHealth: async () => {
        healthCalls++;
        return {
          providerId: 'claude',
          indicator: 'none',
          description: 'ok',
          pageUrl: 'https://example.com',
          components: [],
          updatedAt: Date.now(),
        };
      },
    });
    assert.equal(healthCalls, 0);
  });

  it('dashboard/menuBar only include monitor-ON providers', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude = {
      monitor: true,
      showHealth: true,
      userHidden: false,
    };
    config.providers.grok = {
      monitor: false,
      showHealth: true,
      userHidden: true,
    };
    config.providers.cursor = {
      monitor: true,
      showHealth: false,
      userHidden: false,
    };
    const snap = await buildSnapshot({
      adapters: [
        mockAdapter('claude', { percent: 40 }),
        mockAdapter('grok', { percent: 90 }),
        mockAdapter('cursor', { percent: 15 }),
      ],
      config,
    });
    // All three appear in full provider list
    assert.equal(snap.providers.length, 3);
    // Menu bar (dashboard source of truth for tray) only monitored
    const ids = snap.menuBar.lines.map((l) => l.id).sort();
    assert.deepEqual(ids, ['claude', 'cursor']);
    // Grok usage must not have been needed for menu bar
    const grok = snap.providers.find((p) => p.meta.id === 'grok');
    assert.equal(grok?.usage, null);
    assert.equal(grok?.lifecycle, 'discovered');
  });

  it('runs many adapters without dropping results', async () => {
    const adapters = Array.from({ length: 12 }, (_, i) =>
      mockAdapter(`p${i}`, { percent: i * 5, found: i % 2 === 0 })
    );
    const config = structuredClone(DEFAULT_CONFIG);
    for (let i = 0; i < 12; i++) {
      config.providers[`p${i}`] = {
        monitor: true,
        showHealth: false,
        userHidden: false,
      };
    }
    const snap = await buildSnapshot({ adapters, config, concurrency: 4 });
    assert.equal(snap.providers.length, 12);
    const found = snap.providers.filter((p) => p.detect.found);
    assert.equal(found.length, 6);
    // only found+monitored get usage
    for (const p of snap.providers) {
      if (p.detect.found) {
        assert.ok(p.usage);
      } else {
        assert.equal(p.usage, null);
      }
    }
  });
});

describe('summarizeMenuBar', () => {
  it('lists each monitored provider using first percent window', () => {
    const s = summarizeMenuBar(
      [
        {
          meta: mockAdapter('a').meta,
          lifecycle: 'monitored',
          detect: { found: true, signals: [], confidence: 'high' },
          usage: {
            providerId: 'a',
            status: 'ok',
            updatedAt: 0,
            windows: [
              { id: 'first', usedPercent: 10, source: 'local' },
              { id: 'second', usedPercent: 90, source: 'local' },
            ],
          },
          health: null,
        },
      ],
      {
        ...DEFAULT_CONFIG,
        providers: {
          a: { monitor: true, showHealth: true, userHidden: false },
        },
      }
    );
    assert.equal(s.title, '');
    assert.equal(s.lines[0]?.usedPercent, 10);
  });
});
