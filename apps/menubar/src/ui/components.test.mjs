// View-model and level rules of the shared renderer (runs components.js in a sandbox).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./components.js', import.meta.url), 'utf8');
const ctx = { window: {}, Intl, Math, Date, String, Number, Array, Object, Set, RegExp };
vm.createContext(ctx);
vm.runInContext(source, ctx);
const UI = ctx.window.GaiUI;

const NOW = Date.parse('2026-09-28T03:00:00Z');
const sec = (ms) => Math.floor(ms / 1000);
const HOUR = 36e5;

function provider(id, usage, extra = {}) {
  return {
    meta: { id, displayName: id, status: { pageUrl: 'https://status.example.com' } },
    detect: { found: true },
    usage,
    health: { indicator: 'none', pageUrl: 'https://status.example.com' },
    refresh: { usage: { consecutiveFailures: 0 }, health: { consecutiveFailures: 0 } },
    ...extra,
  };
}
const ok = (windows, observedAt = NOW) => ({ status: 'ok', updatedAt: NOW, observedAt, windows });

describe('providerView status', () => {
  it('failing with recent data is "failed", with old data "stale"', () => {
    const w = [{ id: '5h', usedPercent: 10, resetsAt: sec(NOW + HOUR), source: 'oauth' }];
    const recent = UI.providerView(provider('a', { ...ok(w, NOW - 5 * 6e4), status: 'stale' }), NOW);
    const old = UI.providerView(provider('a', { ...ok(w, NOW - 3 * 864e5), status: 'stale' }), NOW);
    assert.equal(recent.status, 'failed');
    assert.equal(old.status, 'stale');
  });

  it('auth_required is "auth" and keeps cached windows', () => {
    const w = [{ id: '5h', usedPercent: 10, resetsAt: sec(NOW + HOUR), source: 'oauth' }];
    const v = UI.providerView(provider('claude', { ...ok(w), status: 'auth_required' }), NOW);
    assert.equal(v.status, 'auth');
    assert.equal(v.windows.length, 1);
  });

  it('Claude usage auth failures never ask the user to log in on any surface', () => {
    const v = UI.providerView(provider('claude', { ...ok([]), status: 'auth_required' }), NOW);
    for (const html of [UI.providerBlock(v, NOW), UI.chipFor(v, true, NOW), UI.compactRow(v, NOW)]) {
      assert.match(html, /사용량 인증/);
      assert.doesNotMatch(html, /로그인/);
    }
    const other = UI.providerView(provider('codex', { ...ok([]), status: 'auth_required' }), NOW);
    assert.match(UI.providerBlock(other, NOW), /다시 로그인 필요/);
  });

  it('merges rolling tokens + usd into one row', () => {
    const v = UI.providerView(
      provider('grok', ok([
        { id: 'tok', usedPercent: null, usedAbsolute: 3.24e6, unit: 'tokens', windowKind: 'rolling', windowSeconds: 604800, source: 'local' },
        { id: 'usd', usedPercent: null, usedAbsolute: 18.4, unit: 'usd', windowKind: 'rolling', windowSeconds: 604800, source: 'local' },
      ])),
      NOW
    );
    assert.equal(v.windows.length, 1);
    assert.equal(v.windows[0].amount, '3.24M 토큰');
    assert.equal(v.windows[0].value, '$18.40');
  });
});

describe('quota levels in the rendered row', () => {
  const row = (w, rate) =>
    UI.providerBlock(UI.providerView(provider('p', ok([{ source: 'oauth', windowSeconds: 18000, ...w, ...(rate ? { recentRatePerHour: rate } : {}) }])), NOW), NOW);

  it('≥90% is danger, ≥70% warn, otherwise normal', () => {
    assert.match(row({ id: '5h', usedPercent: 93, resetsAt: sec(NOW + HOUR) }), /quota-row--danger/);
    assert.match(row({ id: '5h', usedPercent: 75, resetsAt: sec(NOW + 4.5 * HOUR) }), /quota-row--warn/);
    assert.match(row({ id: '5h', usedPercent: 20, resetsAt: sec(NOW + 4 * HOUR) }), /quota-row--normal/);
  });

  it('danger when the recent rate runs out before reset', () => {
    // 64% used, 2.5h left, 18%p/h → empty in 2h → 30 min early
    const html = row({ id: '5h', usedPercent: 64, resetsAt: sec(NOW + 2.5 * HOUR) }, 18);
    assert.match(html, /quota-row--danger/);
    assert.match(html, /지금 속도면 초기화 30분 전 소진/);
  });

  it('reset time passed shows "리셋 경과", not a stale number as current', () => {
    const html = row({ id: '5h', usedPercent: 95, resetsAt: sec(NOW - 60_000) });
    assert.match(html, /quota-row--reset/);
    assert.match(html, /리셋 경과 · 갱신 대기/);
  });

  it('pace label appears when ≥5%p ahead of even pace', () => {
    // 5h window, 2.5h elapsed (50%), 62% used → +12%p
    assert.match(row({ id: '5h', usedPercent: 62, resetsAt: sec(NOW + 2.5 * HOUR) }), /균등 대비 \+12%p/);
  });
});

describe('widget pins', () => {
  it('empty pin list falls back to the first three monitored providers', () => {
    const snap = {
      config: { providers: { a: { monitor: true }, b: { monitor: true }, c: { monitor: true }, d: { monitor: true } }, widget: { pinned: [] } },
      providers: ['a', 'b', 'c', 'd'].map((id) => provider(id, ok([]))),
    };
    assert.deepEqual(UI.pinnedViews(snap, NOW).map((v) => v.id), ['a', 'b', 'c']);
    snap.config.widget.pinned = ['d', 'a'];
    assert.deepEqual(UI.pinnedViews(snap, NOW).map((v) => v.id), ['d', 'a']);
  });
});

describe('usage level thresholds (50 / 80 / 90 %)', () => {
  const t = [NOW - 4000, NOW - 3000, NOW - 2000, NOW - 1000];
  const html = UI.resourceBlock({
    at: NOW, cpu: { usagePct: 95, userPct: 50, systemPct: 45, cores: 8, load1: 1 }, memory: null, sharedBytes: null, network: null,
    history: { t, cpu: [49.9, 50, 80, 90], memory: [], pressure: [], shared: [], rx: [], tx: [] },
  }, NOW);
  const cpu = html.slice(html.indexOf('data-chart="cpu"'), html.indexOf('</svg>', html.indexOf('data-chart="cpu"')));
  it('each band gets its own color', () => {
    for (const lv of ['normal', 'mid', 'warn', 'danger']) assert.match(cpu, new RegExp(`chart__line--${lv}`));
  });
});

describe('this Mac resources', () => {
  const res = {
    at: NOW - 1000,
    cpu: { usagePct: 86.4, userPct: 60, systemPct: 26.4, cores: 12, load1: 7.25 },
    memory: {
      totalBytes: 24 * 1024 ** 3, usedBytes: 18.3 * 1024 ** 3, appBytes: 0, wiredBytes: 0, compressedBytes: 0,
      cachedBytes: 4.4 * 1024 ** 3, swapUsedBytes: 267 * 1024 ** 2, swapTotalBytes: 1024 ** 3, pressure: 'warn',
    },
    sharedBytes: 2.9 * 1024 ** 3,
    network: { rxBytesPerSec: 2.5 * 1024 ** 2, txBytesPerSec: 800 },
    history: {
      t: [NOW - 4000, NOW - 2000, NOW - 1000],
      cpu: [10, 20, 86.4],
      memory: [70, 71, 76],
      pressure: ['normal', 'normal', 'warn'],
      shared: [2.9 * 1024 ** 3, 2.9 * 1024 ** 3, 2.9 * 1024 ** 3],
      rx: [null, 1000, 2.5 * 1024 ** 2],
      tx: [null, 500, 800],
    },
  };

  it('popover shows four chart tiles with current values', () => {
    const html = UI.resourceBlock(res, NOW);
    assert.equal((html.match(/class="res-tile /g) || []).length, 4);
    assert.match(html, /res-tile--warn" role="group" aria-label="CPU"/);
    assert.match(html, /18\.3 GB<small> \/ 24\.0 GB<\/small>/);
    assert.match(html, /압력 주의 · 스왑 267 MB/);
    assert.match(html, /aria-label="공유 메모리"[^]*2\.9 GB/);
    assert.match(html, /↓2\.5M ↑800B/);
    assert.match(html, /chart__key--thin"><\/i>보내기/);
  });

  it('colors each run by usage level and labels the levels', () => {
    const html = UI.resourceBlock(res, NOW);
    const chart = (id) => { const i = html.indexOf(`data-chart="${id}"`); return html.slice(i, html.indexOf('</svg>', i)); };
    // CPU 10 → 20 normal, then 86.4 (≥80) high
    assert.match(chart('cpu'), /chart__line--normal/);
    assert.match(chart('cpu'), /chart__line--warn/);
    // memory: 70 → 71 → 76 % all fall in the 50–80 % band
    assert.match(chart('mem'), /chart__line--mid/);
    assert.doesNotMatch(chart('mem'), /chart__line--(normal|warn|danger)/);
    // 2.5 MB/s received is in the 1–10 MB/s band; sent traffic is the thin line
    assert.match(chart('net'), /chart__line--mid/);
    assert.doesNotMatch(chart('net'), /chart__line--warn/);
    assert.match(chart('net'), /chart__line--thin/);
    assert.match(html, /chart__key chart__key--normal chart__key--thin"><\/i>보내기/);
    assert.match(html, /level-legend[^]*50% 미만[^]*50% 이상[^]*80% 이상[^]*90% 이상/);
  });

  it('draws one axis per chart and keeps the network line continuous', () => {
    const html = UI.resourceBlock(res, NOW);
    // null samples break the line instead of dropping to zero
    const net = html.slice(html.indexOf('data-chart="net"'));
    assert.ok(!/M0\.00,35/.test(net.slice(0, net.indexOf('</svg>'))));
  });

  it('marks resources older than 20 s as stale; no data shows a measuring state', () => {
    assert.match(UI.resourceBlock({ ...res, at: NOW - 60_000 }, NOW), /is-stale/);
    assert.match(UI.resourceBlock(null, NOW), /측정하는 중/);
  });

  it('widget rows pair each value with a compact chart', () => {
    const html = UI.resourceCompactRows(res);
    assert.equal((html.match(/chart--compact/g) || []).length, 3);
    assert.match(html, /CPU<\/span><span class="wc-val">[^%]*86%/);
    assert.match(html, /메모리<\/span><span class="wc-val">[^%]*76%/);
    assert.match(html, /↓2\.5M ↑800B/);
  });
});
