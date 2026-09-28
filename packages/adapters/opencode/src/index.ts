/**
 * OpenCode — local auth + session activity from opencode.db
 * Cloud subscription % not exposed via public API (yet).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  DetectResult,
  DetectSignal,
  ProviderAdapter,
  UsageResult,
} from '@gary-ai-platform-monitor/core';

const HOME = os.homedir();
const AUTH = path.join(HOME, '.local/share/opencode/auth.json');
const DB = path.join(HOME, '.local/share/opencode/opencode.db');
const CONFIG = path.join(HOME, '.config/opencode/opencode.json');

function hasAuthKey(): boolean {
  try {
    if (!fs.existsSync(AUTH)) return false;
    const raw = JSON.parse(fs.readFileSync(AUTH, 'utf8')) as Record<
      string,
      { key?: string; type?: string }
    >;
    return Object.values(raw).some((v) => Boolean(v?.key));
  } catch {
    return false;
  }
}

function countRows(file: string): { sessions: number; messages: number } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const count = (table: string) =>
      Number((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number | bigint }).c);
    return { sessions: count('session'), messages: count('message') };
  } finally {
    db.close();
  }
}

/**
 * Snapshot opencode.db (+ -wal / -shm, so recent un-checkpointed rows are included) into a
 * private temp dir, read it read-only, and remove the whole temp dir afterwards.
 */
export function readLocalStats(dbPath: string = DB): { sessions: number; messages: number } | null {
  if (!fs.existsSync(dbPath)) return null;
  let dir: string | undefined;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-pm-opencode-'));
    const copy = path.join(dir, 'opencode.db');
    fs.copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, copy + suffix);
    }
    try {
      return countRows(copy);
    } catch {
      // A -shm copied mid-write can disagree with the -wal; let SQLite rebuild the index.
      fs.rmSync(copy + '-shm', { force: true });
      return countRows(copy);
    }
  } catch {
    return null;
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const opencodeAdapter: ProviderAdapter = {
  meta: {
    id: 'opencode',
    displayName: 'OpenCode',
    status: {
      pageUrl: 'https://opencode.ai',
      strategy: 'custom',
    },
    capabilities: {
      percentWindows: false,
      costOnly: false,
      multiWindow: false,
    },
  },
  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];
    if (fs.existsSync(AUTH) || hasAuthKey()) {
      signals.push({ kind: 'cli_credentials', detail: AUTH });
    }
    if (fs.existsSync(DB)) {
      signals.push({ kind: 'session_dir', detail: DB });
    }
    if (fs.existsSync(CONFIG)) {
      signals.push({ kind: 'local_app_config', detail: CONFIG });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: hasAuthKey() ? 'high' : signals.length ? 'medium' : 'low',
    };
  },
  async fetchUsage(): Promise<UsageResult> {
    if (!hasAuthKey() && !fs.existsSync(DB)) {
      return {
        providerId: 'opencode',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorKind: 'auth',
        errorMessage: 'No OpenCode auth.json / database',
      };
    }
    const stats = readLocalStats();
    if (!stats) {
      return {
        providerId: 'opencode',
        windows: [],
        status: 'unsupported',
        updatedAt: Date.now(),
        errorKind: 'unsupported',
        errorMessage: hasAuthKey()
          ? 'API key present; cloud quota endpoint not available — local DB unreadable'
          : 'No local stats',
      };
    }
    return {
      providerId: 'opencode',
      windows: [
        {
          id: 'sessions',
          usedPercent: null,
          label: 'sessions (local)',
          source: 'local',
          usedAbsolute: stats.sessions,
          unit: 'messages',
        },
        {
          id: 'messages',
          usedPercent: null,
          label: 'messages (local)',
          source: 'local',
          usedAbsolute: stats.messages,
          unit: 'messages',
        },
      ],
      status: 'ok',
      updatedAt: Date.now(),
      note: 'Cloud subscription % not exposed by OpenCode API',
    };
  },
};

export default opencodeAdapter;
