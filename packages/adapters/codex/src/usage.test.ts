import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  findLatestCodexSnapshot,
  mapCodexRateLimits,
  parseRateLimitsFromFile,
  parseRateLimitsFromRolloutText,
  type CodexRateLimits,
} from './usage.js';

/** A token_count event in the real rollout shape (see usage.ts header). */
function tokenCount(timestamp: string, rateLimits: CodexRateLimits & Record<string, unknown>): string {
  return JSON.stringify({
    timestamp,
    ordinal: 1,
    type: 'event_msg',
    payload: { type: 'token_count', info: null, rate_limits: rateLimits },
  });
}

const codexLine = (ts: string, primaryPct = 5, secondaryPct = 20) =>
  tokenCount(ts, {
    limit_id: 'codex',
    limit_name: null,
    primary: { used_percent: primaryPct, window_minutes: 300, resets_at: 1788544249 },
    secondary: { used_percent: secondaryPct, window_minutes: 10080, resets_at: 1788749354 },
    credits: { has_credits: false, unlimited: false, balance: '0' },
    plan_type: 'plus',
    rate_limit_reached_type: null,
  });

const reserveLine = (ts: string) =>
  tokenCount(ts, {
    limit_id: 'base_model_inference',
    limit_name: 'gpt-reserve',
    primary: { used_percent: 0, window_minutes: 10080, resets_at: 1790594472 },
    secondary: null,
    plan_type: 'prolite',
  });

const premiumLine = (ts: string) =>
  tokenCount(ts, { limit_id: 'premium', limit_name: null, primary: null, secondary: null, plan_type: 'plus' });

const noise = (i: number) =>
  JSON.stringify({ timestamp: '2026-09-04T12:00:00.000Z', type: 'response_item', payload: { i, text: 'x'.repeat(200) } });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-pm-codex-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('parseRateLimitsFromRolloutText', () => {
  it('reads payload.rate_limits and skips non-codex limit ids', () => {
    const text = [
      '{"cut-off line',
      codexLine('2026-09-04T12:53:52.362Z', 5, 20),
      codexLine('2026-09-04T12:54:08.013Z', 7, 21),
      reserveLine('2026-09-04T12:55:00.000Z'),
      premiumLine('2026-09-04T13:04:15.301Z'),
      '',
    ].join('\n');
    const snap = parseRateLimitsFromRolloutText(text);
    assert.ok(snap);
    assert.equal(snap.limits.limit_id, 'codex');
    assert.equal(snap.limits.primary?.used_percent, 7);
    assert.equal(snap.observedAt, Date.parse('2026-09-04T12:54:08.013Z'));
  });

  it('accepts entries without limit_id (older CLIs)', () => {
    const legacy = JSON.stringify({
      timestamp: '2026-08-01T00:00:00Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: { primary: { used_percent: 18, window_minutes: 10080, resets_at: 1786165248 }, secondary: null },
      },
    });
    const snap = parseRateLimitsFromRolloutText(legacy);
    assert.equal(snap?.limits.primary?.used_percent, 18);
  });

  it('returns null when only other pools are present', () => {
    const text = [reserveLine('2026-09-21T11:21:27.880Z'), premiumLine('2026-09-21T11:22:00Z')].join('\n');
    assert.equal(parseRateLimitsFromRolloutText(text), null);
  });
});

describe('mapCodexRateLimits', () => {
  it('maps 5h + 7d windows with windowSeconds/fixed kind', () => {
    const snap = parseRateLimitsFromRolloutText(codexLine('2026-09-04T12:53:52.362Z', 5, 20));
    const windows = mapCodexRateLimits(snap!.limits);
    assert.equal(windows.length, 2);
    assert.deepEqual(
      windows.map((w) => [w.id, w.usedPercent, w.windowSeconds, w.windowKind, w.label, w.resetsAt]),
      [
        ['primary', 5, 18000, 'fixed', 'primary (5h)', 1788544249],
        ['secondary', 20, 604800, 'fixed', 'secondary (7d)', 1788749354],
      ]
    );
  });

  it('keeps an already-expired window (resetsAt in the past) untouched', () => {
    const windows = mapCodexRateLimits({
      primary: { used_percent: 42, window_minutes: 300, resets_at: 1_000_000_000 },
      secondary: null,
    });
    assert.equal(windows[0]?.usedPercent, 42);
    assert.equal(windows[0]?.resetsAt, 1_000_000_000);
  });
});

describe('parseRateLimitsFromFile (tail growth)', () => {
  function writeRollout(name: string, lines: string[]): string {
    const file = path.join(tmpRoot, name);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  }

  it('grows past 256 KB and 2 MB of non-codex tail', () => {
    const filler: string[] = [];
    // ~3 MB of noise and reserve-pool entries after the only codex entry
    for (let i = 0; i < 12_000; i++) filler.push(i % 10 === 0 ? reserveLine('2026-09-04T13:00:00Z') : noise(i));
    const file = writeRollout('big.jsonl', [codexLine('2026-09-04T12:54:08.013Z', 9, 30), ...filler]);
    assert.ok(fs.statSync(file).size > 2 * 1024 * 1024);

    const budget = { bytes: 64 * 1024 * 1024 };
    const snap = parseRateLimitsFromFile(file, budget);
    assert.equal(snap?.limits.primary?.used_percent, 9);
    assert.ok(budget.bytes < 64 * 1024 * 1024 - 2 * 1024 * 1024, 'read beyond the 2 MB step');
  });

  it('stops growing when the byte budget is exhausted', () => {
    const filler: string[] = [];
    for (let i = 0; i < 2_000; i++) filler.push(noise(i));
    const file = writeRollout('budget.jsonl', [codexLine('2026-09-04T12:54:08.013Z'), ...filler]);
    assert.equal(parseRateLimitsFromFile(file, { bytes: 300 * 1024 }), null);
    assert.ok(parseRateLimitsFromFile(file));
  });
});

describe('findLatestCodexSnapshot', () => {
  it('scans 8 days of date folders and prefers the newest codex entry', () => {
    const root = path.join(tmpRoot, 'sessions');
    const now = new Date(2026, 8, 28, 12, 0, 0);
    const dayDir = (daysAgo: number) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
      const dir = path.join(
        root,
        String(d.getFullYear()),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0')
      );
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    const put = (dir: string, name: string, lines: string[], mtime: Date) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, lines.join('\n') + '\n');
      fs.utimesSync(f, mtime, mtime);
    };

    // Newest file: reserve pool only → must be skipped.
    put(dayDir(0), 'rollout-a.jsonl', [reserveLine('2026-09-28T02:00:00Z')], new Date('2026-09-28T02:00:00Z'));
    // 5 days ago: the codex entry we want.
    put(dayDir(5), 'rollout-b.jsonl', [codexLine('2026-09-23T01:00:00Z', 11, 44)], new Date('2026-09-23T01:00:00Z'));
    // 6 days ago: older codex entry.
    put(dayDir(6), 'rollout-c.jsonl', [codexLine('2026-09-22T01:00:00Z', 1, 2)], new Date('2026-09-22T01:00:00Z'));
    // 9 days ago: outside the 8-day scan even though its mtime is recent.
    put(dayDir(9), 'rollout-d.jsonl', [codexLine('2026-09-28T03:00:00Z', 99, 99)], new Date('2026-09-28T03:00:00Z'));

    const snap = findLatestCodexSnapshot(root, now);
    assert.ok(snap);
    assert.equal(snap.limits.primary?.used_percent, 11);
    assert.equal(snap.observedAt, Date.parse('2026-09-23T01:00:00Z'));
  });
});
