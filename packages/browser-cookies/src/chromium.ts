/**
 * Best-effort Chromium cookie reader for macOS ("v10" AES-128-CBC, key from "<Browser> Safe Storage").
 *
 * Order of work is chosen to touch the Keychain as rarely as possible:
 *   1. find a Cookies DB (`<profile>/Network/Cookies`, legacy `<profile>/Cookies`)
 *   2. copy it (+ -wal/-journal) and look for matching, unexpired rows
 *   3. only then read the Safe Storage password (async, cached per browser for the process)
 *
 * "v20" app-bound encryption (Windows) is not supported — fall back to a manual Cookie header.
 * Never log cookie values.
 */

import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const execFileAsync = promisify(execFile);

export type BrowserId = 'chrome' | 'brave' | 'chromium' | 'arc';

const BROWSER_PATHS: Record<BrowserId, { root: string; keychainService: string; keychainAccount: string }> = {
  chrome: {
    root: path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
  },
  brave: {
    root: path.join(os.homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser'),
    keychainService: 'Brave Safe Storage',
    keychainAccount: 'Brave',
  },
  chromium: {
    root: path.join(os.homedir(), 'Library/Application Support/Chromium'),
    keychainService: 'Chromium Safe Storage',
    keychainAccount: 'Chromium',
  },
  arc: {
    root: path.join(os.homedir(), 'Library/Application Support/Arc/User Data'),
    keychainService: 'Arc Safe Storage',
    keychainAccount: 'Arc',
  },
};

export interface CookieQuery {
  /** host_key LIKE patterns, e.g. %.grok.com */
  hostLike: string[];
  names?: string[];
}

export interface ChromiumCookieHeader {
  header: string;
  browser: BrowserId;
  /** Profile directory name, e.g. "Default" or "Profile 2" */
  profile: string;
  count: number;
}

const DEFAULT_BROWSERS: BrowserId[] = ['chrome', 'brave', 'arc', 'chromium'];
/** The Keychain prompt may wait for the user to click "Allow". */
const KEYCHAIN_TIMEOUT_MS = 15_000;
/** After a denied/failed Keychain read, do not prompt again for this long. */
const KEY_FAILURE_RETRY_MS = 10 * 60_000;
/**
 * From this Cookies DB `meta.version` on, Chromium prepends SHA256(host_key) (32 bytes)
 * to the plaintext before encrypting.
 */
export const DOMAIN_HASH_PREFIX_MIN_VERSION = 24;
/** Microseconds between 1601-01-01 (Chromium/Windows epoch) and 1970-01-01. */
const CHROMIUM_EPOCH_OFFSET_US = 11_644_473_600_000_000n;
const CBC_IV = Buffer.alloc(16, ' ');

/**
 * Build a Cookie header for matching cookies from the first browser/profile that has them.
 * Returns null when nothing matched or nothing could be decrypted.
 */
export async function readChromiumCookieHeader(
  query: CookieQuery,
  browsers: BrowserId[] = DEFAULT_BROWSERS
): Promise<ChromiumCookieHeader | null> {
  if (process.platform !== 'darwin') return null;
  for (const id of browsers) {
    const cfg = BROWSER_PATHS[id];
    // 1) No Cookies DB → never touch the Keychain for this browser.
    const dbs = listCookieDbs(cfg.root);
    for (const db of dbs) {
      let snapshot: CookieDbSnapshot;
      try {
        snapshot = readCookieDbSnapshot(db.path, query);
      } catch {
        continue; // locked / corrupt copy / schema mismatch — try next profile
      }
      if (snapshot.rows.length === 0) continue;

      // 2) Rows exist — only now fetch the key (cached per browser).
      const needsKey = snapshot.rows.some((r) => !r.value && r.encrypted.length > 0);
      const key = needsKey ? await getSafeStorageKey(id) : null;
      if (needsKey && !key) break; // Keychain denied/missing — next browser

      const pairs = decodeCookieRows(snapshot, key);
      if (pairs.length === 0) continue;
      return {
        header: pairs.map((p) => `${p.name}=${p.value}`).join('; '),
        browser: id,
        profile: db.profile,
        count: pairs.length,
      };
    }
  }
  return null;
}

/**
 * Enumerate `Default` and every `Profile N` directory under a Chromium user-data root and
 * return the Cookies DB of each (modern `Network/Cookies` first, then legacy `Cookies`).
 */
export function listCookieDbs(root: string): { profile: string; path: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const profiles = entries
    .filter((e) => e.isDirectory() && (e.name === 'Default' || /^Profile \d+$/.test(e.name)))
    .map((e) => e.name)
    .sort(compareProfiles);

  const out: { profile: string; path: string }[] = [];
  for (const profile of profiles) {
    for (const rel of [['Network', 'Cookies'], ['Cookies']]) {
      const full = path.join(root, profile, ...rel);
      if (isFile(full)) {
        out.push({ profile, path: full });
        break;
      }
    }
  }
  return out;
}

function compareProfiles(a: string, b: string): number {
  const n = (s: string) => (s === 'Default' ? -1 : Number(s.slice('Profile '.length)));
  return n(a) - n(b);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const keyCache = new Map<BrowserId, { promise: Promise<Buffer | null>; failedAt?: number }>();

/** Safe Storage key, cached per browser for the process lifetime (failures retried after a while). */
async function getSafeStorageKey(id: BrowserId): Promise<Buffer | null> {
  const hit = keyCache.get(id);
  if (hit) {
    if (hit.failedAt === undefined) return hit.promise; // pending or success
    if (Date.now() - hit.failedAt < KEY_FAILURE_RETRY_MS) return null;
  }
  const cfg = BROWSER_PATHS[id];
  const entry: { promise: Promise<Buffer | null>; failedAt?: number } = {
    promise: readSafeStorageKey(cfg.keychainService, cfg.keychainAccount),
  };
  keyCache.set(id, entry);
  const key = await entry.promise;
  if (!key) entry.failedAt = Date.now();
  return key;
}

async function readSafeStorageKey(service: string, account: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/security',
      ['find-generic-password', '-w', '-s', service, '-a', account],
      { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS }
    );
    const password = stdout.trim();
    if (!password) return null;
    return deriveSafeStorageKey(password);
  } catch {
    return null; // not found / denied / timed out — never surface stdout/stderr
  }
}

/** PBKDF2 key derivation used by Chromium on macOS. */
export function deriveSafeStorageKey(password: string): Buffer {
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

/**
 * Decrypt a macOS Chromium cookie value ("v10"/"v11" + AES-128-CBC, IV of 16 spaces).
 * The 32-byte SHA256(domain) prefix is stripped only when the DB version says it exists.
 * Returns null for unsupported formats (e.g. "v20"), a wrong key, or values that
 * could not be sent as a header.
 */
export function decryptChromiumCookieValue(
  key: Buffer,
  encrypted: Buffer,
  dbVersion: number
): string | null {
  if (encrypted.length < 3 + 16) return null;
  const prefix = encrypted.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11') return null;
  const ct = encrypted.subarray(3);
  if (ct.length % 16 !== 0) return null;
  let plain: Buffer;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, CBC_IV);
    plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    return null; // bad padding → wrong key or corrupt value
  }
  if (dbVersion >= DOMAIN_HASH_PREFIX_MIN_VERSION) {
    if (plain.length < 32) return null;
    plain = plain.subarray(32);
  }
  const value = plain.toString('utf8');
  return isHeaderSafe(value) ? value : null;
}

/** Cookie values may not contain control characters (RFC 6265); also guards a wrong key. */
function isHeaderSafe(value: string): boolean {
  if (!value) return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0xfffd) return false;
  }
  return true;
}

export interface CookieRow {
  hostKey: string;
  name: string;
  /** Plaintext value column (usually empty on macOS) */
  value: string;
  encrypted: Buffer;
}

export interface CookieDbSnapshot {
  /** `meta.version` of the Cookies DB (0 when unknown) */
  version: number;
  /** Matching, unexpired rows — most recently accessed first */
  rows: CookieRow[];
}

/**
 * Copy the Cookies DB (+ -wal / -journal siblings) into a private temp dir and read
 * matching rows. The DB is closed and the whole temp dir removed in `finally`.
 */
export function readCookieDbSnapshot(
  dbPath: string,
  query: CookieQuery,
  nowMs: number = Date.now()
): CookieDbSnapshot {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-pm-cookies-'));
  let db: DatabaseSync | undefined;
  try {
    fs.chmodSync(dir, 0o700);
    const copy = path.join(dir, 'Cookies');
    fs.copyFileSync(dbPath, copy);
    for (const suffix of ['-wal', '-journal']) {
      if (isFile(dbPath + suffix)) fs.copyFileSync(dbPath + suffix, copy + suffix);
    }
    // Private copy, opened read-write so SQLite can apply a copied -wal / roll back a hot -journal.
    db = new DatabaseSync(copy);

    let version = 0;
    try {
      const meta = db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get() as
        | { value?: unknown }
        | undefined;
      const v = Number(meta?.value);
      if (Number.isFinite(v)) version = v;
    } catch {
      // no meta table → treat as legacy (no domain-hash prefix)
    }

    if (query.hostLike.length === 0) return { version, rows: [] };
    const hostClauses = query.hostLike.map(() => 'host_key LIKE ?').join(' OR ');
    const params: (string | bigint)[] = [...query.hostLike];
    let sql =
      `SELECT host_key, name, value, encrypted_value FROM cookies WHERE (${hostClauses})`;
    if (query.names?.length) {
      sql += ` AND name IN (${query.names.map(() => '?').join(',')})`;
      params.push(...query.names);
    }
    // expires_utc = 0 → session cookie (no expiry). Chromium time = µs since 1601-01-01.
    sql += ' AND (expires_utc = 0 OR expires_utc > ?) ORDER BY last_access_utc DESC';
    params.push(BigInt(Math.floor(nowMs)) * 1000n + CHROMIUM_EPOCH_OFFSET_US);

    const raw = db.prepare(sql).all(...params) as Array<{
      host_key: string;
      name: string;
      value: string | null;
      encrypted_value: Uint8Array | null;
    }>;
    const rows: CookieRow[] = raw.map((r) => ({
      hostKey: r.host_key,
      name: r.name,
      value: typeof r.value === 'string' ? r.value : '',
      encrypted: r.encrypted_value ? Buffer.from(r.encrypted_value) : Buffer.alloc(0),
    }));
    return { version, rows };
  } finally {
    try {
      db?.close();
    } catch {
      // ignore
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Decode rows into name/value pairs. Rows arrive most-recently-accessed first, so the
 * first decodable value per name wins.
 */
export function decodeCookieRows(
  snapshot: CookieDbSnapshot,
  key: Buffer | null
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const row of snapshot.rows) {
    if (seen.has(row.name)) continue;
    let value: string | null = null;
    if (row.value) value = isHeaderSafe(row.value) ? row.value : null;
    else if (key && row.encrypted.length > 0) {
      value = decryptChromiumCookieValue(key, row.encrypted, snapshot.version);
    }
    if (!value) continue;
    seen.add(row.name);
    out.push({ name: row.name, value });
  }
  return out;
}

/** Manual cookie from env or config file (never commit secrets) */
export function readManualCookieHeader(envKeys: string[]): string | null {
  for (const k of envKeys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return null;
}
