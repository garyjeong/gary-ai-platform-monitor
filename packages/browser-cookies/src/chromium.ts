/**
 * Best-effort Chromium cookie reader (macOS Chrome Safe Storage, v10 AES-GCM).
 * Chrome 127+ app-bound encryption (v20) may fail — fall back to manual Cookie header.
 * Never log cookie values.
 */

import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

/**
 * Build Cookie header for matching cookies. Returns null if none decrypted.
 */
export function readChromiumCookieHeader(
  query: CookieQuery,
  browsers: BrowserId[] = ['chrome', 'brave', 'arc', 'chromium']
): { header: string; browser: BrowserId; count: number } | null {
  for (const id of browsers) {
    const cfg = BROWSER_PATHS[id];
    if (!fs.existsSync(cfg.root)) continue;
    try {
      const key = getSafeStorageKey(cfg.keychainService, cfg.keychainAccount);
      if (!key) continue;
      const cookieDb = findCookiesDb(cfg.root);
      if (!cookieDb) continue;
      const pairs = readCookies(cookieDb, key, query);
      if (pairs.length === 0) continue;
      return {
        header: pairs.map((p) => `${p.name}=${p.value}`).join('; '),
        browser: id,
        count: pairs.length,
      };
    } catch {
      // try next browser
    }
  }
  return null;
}

function findCookiesDb(root: string): string | null {
  const candidates = [
    path.join(root, 'Default', 'Cookies'),
    path.join(root, 'Profile 1', 'Cookies'),
    path.join(root, 'Profile 3', 'Cookies'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getSafeStorageKey(service: string, account: string): Buffer | null {
  if (process.platform !== 'darwin') return null;
  try {
    const password = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-w', '-s', service, '-a', account],
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!password) return null;
    return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
  } catch {
    return null;
  }
}

function decryptChromeValue(key: Buffer, encrypted: Buffer): string | null {
  if (encrypted.length < 3) return null;
  const prefix = encrypted.subarray(0, 3).toString('utf8');
  if (prefix === 'v10' || prefix === 'v11') {
    try {
      const nonce = encrypted.subarray(3, 15);
      const data = encrypted.subarray(15);
      const tag = data.subarray(data.length - 16);
      const ct = data.subarray(0, data.length - 16);
      const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
  // v20+ app-bound encryption not supported here
  return null;
}

function readCookies(
  dbPath: string,
  key: Buffer,
  query: CookieQuery
): { name: string; value: string }[] {
  const tmp = path.join(
    os.tmpdir(),
    `gai-pm-cookies-${process.pid}-${Date.now()}.db`
  );
  fs.copyFileSync(dbPath, tmp);
  try {
    const db = new DatabaseSync(tmp, { readOnly: true });
    const hostClauses = query.hostLike.map(() => 'host_key LIKE ?').join(' OR ');
    const params: string[] = [...query.hostLike];
    let sql = `SELECT host_key, name, encrypted_value FROM cookies WHERE (${hostClauses})`;
    if (query.names?.length) {
      sql += ` AND name IN (${query.names.map(() => '?').join(',')})`;
      params.push(...query.names);
    }
    const rows = db.prepare(sql).all(...params) as Array<{
      host_key: string;
      name: string;
      encrypted_value: Buffer;
    }>;
    db.close();
    const out: { name: string; value: string }[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const enc = Buffer.isBuffer(row.encrypted_value)
        ? row.encrypted_value
        : Buffer.from(row.encrypted_value as unknown as Uint8Array);
      const value = decryptChromeValue(key, enc);
      if (!value) continue;
      if (seen.has(row.name)) continue;
      seen.add(row.name);
      out.push({ name: row.name, value });
    }
    return out;
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

/** Manual cookie from env or config file (never commit secrets) */
export function readManualCookieHeader(envKeys: string[]): string | null {
  for (const k of envKeys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return null;
}
