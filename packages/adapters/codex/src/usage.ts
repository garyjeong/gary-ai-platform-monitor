/**
 * Codex usage from local rollout JSONL rate_limits snapshots (no network).
 *
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 *
 * Real line shape (confirmed against local logs, 2026-09):
 *   {"timestamp":"2026-09-28T01:30:40.539Z","type":"event_msg",
 *    "payload":{"type":"token_count",
 *      "rate_limits":{"limit_id":"codex","limit_name":null,
 *        "primary":{"used_percent":9,"window_minutes":10080,"resets_at":1791125376},
 *        "secondary":null,"credits":{...},"plan_type":"prolite",...}}}
 *
 * One log interleaves several limit ids (`codex`, `base_model_inference`, `premium`);
 * only `codex` (or a missing id, older CLIs) is the plan quota shown here.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';

/** Per-file read sizes: tail first, grow when the tail holds no codex entry. */
export const TAIL_STEPS = [256 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024];
const MAX_FILES_SCANNED = 40;
const SCAN_DAYS = 8;
/** Upper bound on bytes read per fetch across all files (grown tails are expensive). */
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

export interface CodexRateLimitBucket {
  used_percent?: number;
  window_minutes?: number;
  /** Epoch seconds */
  resets_at?: number;
}

export interface CodexRateLimits {
  limit_id?: string | null;
  limit_name?: string | null;
  primary?: CodexRateLimitBucket | null;
  secondary?: CodexRateLimitBucket | null;
  plan_type?: string | null;
}

export interface CodexRateLimitSnapshot {
  limits: CodexRateLimits;
  /** Epoch ms of the log event (undefined when the line has no parseable timestamp) */
  observedAt?: number;
}

function sessionsRoot(): string {
  const home = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  return path.join(home, 'sessions');
}

function datePath(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(String(y), m, day);
}

/**
 * Rollout files from the last `days` date folders (local time, like the CLI writes them),
 * newest mtime first, at most `limit`.
 */
export function listRecentRollouts(
  root: string,
  limit = MAX_FILES_SCANNED,
  days = SCAN_DAYS,
  now = new Date()
): { file: string; mtime: number }[] {
  const found: { file: string; mtime: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dir = path.join(root, datePath(d));
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of entries) {
      const full = path.join(dir, f);
      try {
        found.push({ file: full, mtime: fs.statSync(full).mtimeMs });
      } catch {
        // vanished between readdir and stat
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** Read the last `maxBytes` of a file; `complete` = the read started at byte 0. */
function readTail(file: string, maxBytes: number): { text: string; complete: boolean; bytes: number } {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    const n = fs.readSync(fd, buf, 0, len, start);
    return { text: buf.subarray(0, n).toString('utf-8'), complete: start === 0, bytes: n };
  } finally {
    fs.closeSync(fd);
  }
}

export function deepFind(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepFind(v, key);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (rec[key] !== undefined && rec[key] !== null) return rec[key];
  for (const v of Object.values(rec)) {
    const r = deepFind(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** `codex` (or no id at all, older CLIs) is the plan quota; other ids are separate pools. */
export function isCodexLimit(limits: CodexRateLimits): boolean {
  const id = limits.limit_id;
  return id === undefined || id === null || id === 'codex';
}

function hasPercent(b: CodexRateLimitBucket | null | undefined): boolean {
  return Boolean(b) && typeof b?.used_percent === 'number' && Number.isFinite(b.used_percent);
}

function rateLimitsOf(parsed: unknown): CodexRateLimits | null {
  if (!parsed || typeof parsed !== 'object') return null;
  // Real shape: payload.rate_limits. Fall back to a deep search for older layouts.
  const payload = (parsed as { payload?: unknown }).payload;
  const direct =
    payload && typeof payload === 'object'
      ? (payload as { rate_limits?: unknown }).rate_limits
      : undefined;
  const found = direct ?? deepFind(parsed, 'rate_limits');
  if (!found || typeof found !== 'object' || Array.isArray(found)) return null;
  const rl = found as CodexRateLimits;
  if (!('primary' in rl) && !('secondary' in rl)) return null;
  return rl;
}

function eventTime(parsed: unknown): number | undefined {
  const ts = (parsed as { timestamp?: unknown }).timestamp;
  if (typeof ts === 'string') {
    const t = Date.parse(ts);
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts > 1e12 ? ts : ts * 1000;
  return undefined;
}

/**
 * Latest usable codex rate_limits snapshot in a chunk of rollout JSONL
 * (skips other limit ids and entries without any percent).
 */
export function parseRateLimitsFromRolloutText(text: string): CodexRateLimitSnapshot | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"rate_limits"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // first line of a tail is usually cut
    }
    const limits = rateLimitsOf(parsed);
    if (!limits || !isCodexLimit(limits)) continue;
    if (!hasPercent(limits.primary) && !hasPercent(limits.secondary)) continue;
    return { limits, observedAt: eventTime(parsed) };
  }
  return null;
}

/**
 * Read a rollout file from the end, growing the tail (256 KB → 2 MB → 8 MB) until a codex
 * entry is found or the whole file was read. `budget.bytes` is decremented by bytes read.
 */
export function parseRateLimitsFromFile(
  file: string,
  budget: { bytes: number } = { bytes: Number.POSITIVE_INFINITY }
): CodexRateLimitSnapshot | null {
  for (let i = 0; i < TAIL_STEPS.length; i++) {
    const step = TAIL_STEPS[i]!;
    if (i > 0 && budget.bytes < step) break;
    let read: { text: string; complete: boolean; bytes: number };
    try {
      read = readTail(file, step);
    } catch {
      return null;
    }
    budget.bytes -= read.bytes;
    const snap = parseRateLimitsFromRolloutText(read.text);
    if (snap) return snap;
    if (read.complete) break;
  }
  return null;
}

function windowText(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/**
 * Map a codex rate_limits object → UsageWindow[].
 * Expired windows are kept as-is (resetsAt in the past); the UI shows "reset passed".
 */
export function mapCodexRateLimits(limits: CodexRateLimits): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const add = (id: string, bucket: CodexRateLimitBucket | null | undefined) => {
    if (!bucket || !hasPercent(bucket)) return;
    const minutes =
      typeof bucket.window_minutes === 'number' && bucket.window_minutes > 0
        ? bucket.window_minutes
        : undefined;
    const resetsAt =
      typeof bucket.resets_at === 'number' && Number.isFinite(bucket.resets_at) && bucket.resets_at > 0
        ? // epoch seconds; tolerate ms just in case
          bucket.resets_at > 1e12
          ? Math.floor(bucket.resets_at / 1000)
          : bucket.resets_at
        : undefined;
    windows.push({
      id,
      usedPercent: Math.max(0, Math.min(100, bucket.used_percent as number)),
      resetsAt,
      windowSeconds: minutes ? minutes * 60 : undefined,
      windowKind: 'fixed',
      label: minutes ? `${id} (${windowText(minutes)})` : id,
      source: 'local',
    });
  };

  add('primary', limits.primary);
  add('secondary', limits.secondary);
  return windows;
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

/** Display label for `plan_type` (e.g. "prolite" → "Pro Lite"); undefined when absent. */
export function codexPlanLabel(plan: string | null | undefined): string | undefined {
  if (!plan || typeof plan !== 'string') return undefined;
  return PLAN_LABELS[plan.toLowerCase()] ?? plan;
}

/**
 * Latest codex snapshot across recent rollouts. Files are visited newest-mtime first;
 * once a snapshot at time T is found, files last modified before T cannot hold a newer one.
 */
export function findLatestCodexSnapshot(
  root: string,
  now = new Date()
): (CodexRateLimitSnapshot & { observedAt: number }) | null {
  const budget = { bytes: MAX_TOTAL_BYTES };
  let best: (CodexRateLimitSnapshot & { observedAt: number }) | null = null;
  for (const { file, mtime } of listRecentRollouts(root, MAX_FILES_SCANNED, SCAN_DAYS, now)) {
    if (best && mtime <= best.observedAt) break;
    if (budget.bytes <= 0) break;
    const snap = parseRateLimitsFromFile(file, budget);
    if (!snap) continue;
    if (mapCodexRateLimits(snap.limits).length === 0) continue;
    const observedAt = snap.observedAt ?? mtime;
    if (!best || observedAt > best.observedAt) best = { ...snap, observedAt };
  }
  return best;
}

export function readCodexUsage(): UsageResult {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) {
    return {
      providerId: 'codex',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorKind: 'auth',
      errorMessage: 'No ~/.codex/sessions directory — run the Codex CLI once',
    };
  }

  const snap = findLatestCodexSnapshot(root);
  if (!snap) {
    return {
      providerId: 'codex',
      windows: [],
      status: 'unsupported',
      updatedAt: Date.now(),
      errorKind: 'unsupported',
      errorMessage: `No codex rate_limits in rollouts from the last ${SCAN_DAYS} days`,
    };
  }

  return {
    providerId: 'codex',
    windows: mapCodexRateLimits(snap.limits),
    status: 'ok',
    updatedAt: Date.now(),
    observedAt: snap.observedAt,
    note: codexPlanLabel(snap.limits.plan_type),
  };
}
