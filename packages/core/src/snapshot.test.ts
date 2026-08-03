import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, type ProviderAdapter } from './types.js';
import { buildSnapshot, summarizeMenuBar } from './snapshot.js';

function mockAdapter(
  id: string,
  opts: { found?: boolean; percent?: number | null } = {}
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
    // No aggregate "AI n%" title — per-platform lines only
    assert.equal(snap.menuBar.title, '');
    assert.equal(snap.menuBar.lines[0]?.usedPercent, 62);
  });

  it('respects monitor false and does not fetch usage', async () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude = {
      monitor: false,
      showHealth: false,
      userHidden: false,
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
});

describe('summarizeMenuBar', () => {
  it('lists each monitored provider without aggregate title', () => {
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
            windows: [{ id: 'x', usedPercent: 10, source: 'local' }],
          },
          health: null,
        },
        {
          meta: mockAdapter('b').meta,
          lifecycle: 'monitored',
          detect: { found: true, signals: [], confidence: 'high' },
          usage: {
            providerId: 'b',
            status: 'ok',
            updatedAt: 0,
            windows: [{ id: 'x', usedPercent: 80, source: 'local' }],
          },
          health: null,
        },
      ],
      {
        ...DEFAULT_CONFIG,
        providers: {
          a: { monitor: true, showHealth: true, userHidden: false },
          b: { monitor: true, showHealth: true, userHidden: false },
        },
      }
    );
    assert.equal(s.title, '');
    assert.equal(s.lines.length, 2);
    assert.equal(s.lines.find((l) => l.id === 'b')?.usedPercent, 80);
  });
});
