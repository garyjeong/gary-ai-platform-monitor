/**
 * Codex usage from local rollout JSONL rate_limits snapshots.
 * Ported from gary-claude-code-hud (percent-focused; no network).
 *
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { UsageResult, UsageWindow } from '@gary-ai-platform-monitor/core';

const TAIL_BYTES = 256 * 1024;
const MAX_FILES_SCANNED = 10;

export interface CodexRateLimits {
  primary?: {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  } | null;
  secondary?: {
    used_percent?: number;
    window_minutes?: number;
    resets_at?: number;
  } | null;
  plan_type?: string;
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

function listRecentRollouts(limit: number): string[] {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  const found: { file: string; mtime: number }[] = [];

  for (const d of [now, yesterday]) {
    const dir = path.join(sessionsRoot(), datePath(d));
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
        // skip
      }
    }
    if (found.length >= limit) break;
  }

  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((x) => x.file);
}

function readTail(file: string, maxBytes: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString('utf-8');
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

/** Extract latest rate_limits object from a rollout file tail */
export function parseRateLimitsFromRolloutText(text: string): CodexRateLimits | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || !line.includes('"rate_limits"')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const found = deepFind(parsed, 'rate_limits');
    if (found && typeof found === 'object') return found as CodexRateLimits;
  }
  return null;
}

function parseRateLimitsFromFile(file: string): CodexRateLimits | null {
  try {
    return parseRateLimitsFromRolloutText(readTail(file, TAIL_BYTES));
  } catch {
    return null;
  }
}

/** Map server rate_limits → UsageWindow[] */
export function mapCodexRateLimits(limits: CodexRateLimits): UsageWindow[] {
  const windows: UsageWindow[] = [];
  const add = (
    id: string,
    bucket: CodexRateLimits['primary'],
    label: string
  ) => {
    if (!bucket || typeof bucket.used_percent !== 'number') return;
    const minutes = typeof bucket.window_minutes === 'number' ? bucket.window_minutes : 0;
    windows.push({
      id,
      usedPercent: bucket.used_percent,
      resetsAt: typeof bucket.resets_at === 'number' ? bucket.resets_at : undefined,
      label: minutes === 10080 ? `${label} (7d)` : minutes ? `${label} (${minutes}m)` : label,
      source: 'local',
    });
  };

  add('primary', limits.primary, 'primary');
  add('secondary', limits.secondary, 'secondary');
  return windows;
}

export function readCodexUsage(): UsageResult {
  if (!fs.existsSync(sessionsRoot())) {
    return {
      providerId: 'codex',
      windows: [],
      status: 'auth_required',
      updatedAt: Date.now(),
      errorMessage: 'No ~/.codex/sessions directory',
    };
  }

  const files = listRecentRollouts(MAX_FILES_SCANNED);
  for (const file of files) {
    const limits = parseRateLimitsFromFile(file);
    if (!limits) continue;
    const windows = mapCodexRateLimits(limits);
    if (windows.length === 0) continue;
    return {
      providerId: 'codex',
      windows,
      status: 'ok',
      updatedAt: Date.now(),
    };
  }

  return {
    providerId: 'codex',
    windows: [],
    status: 'unsupported',
    updatedAt: Date.now(),
    errorMessage: 'No rate_limits snapshot in recent rollouts',
  };
}
