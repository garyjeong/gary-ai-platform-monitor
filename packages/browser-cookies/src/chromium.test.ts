import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  decodeCookieRows,
  decryptChromiumCookieValue,
  deriveSafeStorageKey,
  listCookieDbs,
  readCookieDbSnapshot,
} from './chromium.js';

const KEY = deriveSafeStorageKey('synthetic-test-password');
const IV = Buffer.alloc(16, ' ');

/** Encrypt like macOS Chromium: "v10" + AES-128-CBC(plaintext), optional SHA256(host) prefix. */
function encrypt(value: string, host: string, withDomainHash: boolean, key = KEY): Buffer {
  const plain = withDomainHash
    ? Buffer.concat([crypto.createHash('sha256').update(host).digest(), Buffer.from(value)])
    : Buffer.from(value);
  const c = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([Buffer.from('v10'), c.update(plain), c.final()]);
}

/** Chromium time (µs since 1601) for a JS epoch ms. */
function chromiumTime(ms: number): bigint {
  return BigInt(ms) * 1000n + 11_644_473_600_000_000n;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-pm-bc-test-'));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

describe('decryptChromiumCookieValue', () => {
  it('strips the 32-byte domain hash only for DB version >= 24', () => {
    const v24 = encrypt('abc123', '.grok.com', true);
    assert.equal(decryptChromiumCookieValue(KEY, v24, 24), 'abc123');

    const v23 = encrypt('abc123', '.grok.com', false);
    assert.equal(decryptChromiumCookieValue(KEY, v23, 23), 'abc123');
    // No prefix stripping on old DBs, even when the value is long enough to have one.
    const longOld = 'x'.repeat(40);
    assert.equal(decryptChromiumCookieValue(KEY, encrypt(longOld, 'h', false), 23), longOld);
  });

  it('rejects a v24 value decoded as legacy (hash bytes are not header-safe)', () => {
    const v24 = encrypt('abc123', '.grok.com', true);
    assert.equal(decryptChromiumCookieValue(KEY, v24, 0), null);
  });

  it('returns null for a wrong key and for v20 app-bound values', () => {
    const wrong = deriveSafeStorageKey('other');
    assert.equal(decryptChromiumCookieValue(wrong, encrypt('abc123', 'h', true), 24), null);
    const v20 = Buffer.concat([Buffer.from('v20'), crypto.randomBytes(32)]);
    assert.equal(decryptChromiumCookieValue(KEY, v20, 24), null);
  });
});

describe('listCookieDbs', () => {
  it('enumerates Default + Profile N, preferring Network/Cookies', () => {
    const root = path.join(tmpRoot, 'chrome-root');
    const mk = (rel: string) => {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), '');
    };
    mk('Profile 10/Network/Cookies');
    mk('Profile 2/Cookies');
    mk('Default/Network/Cookies');
    mk('Default/Cookies');
    mk('Guest Profile/Network/Cookies');
    fs.mkdirSync(path.join(root, 'Profile 3'), { recursive: true }); // no DB

    const dbs = listCookieDbs(root);
    assert.deepEqual(
      dbs.map((d) => [d.profile, path.relative(root, d.path)]),
      [
        ['Default', path.join('Default', 'Network', 'Cookies')],
        ['Profile 2', path.join('Profile 2', 'Cookies')],
        ['Profile 10', path.join('Profile 10', 'Network', 'Cookies')],
      ]
    );
    assert.deepEqual(listCookieDbs(path.join(tmpRoot, 'missing')), []);
  });
});

describe('readCookieDbSnapshot', () => {
  it('skips expired rows, orders by last access, reads WAL, cleans temp dir', () => {
    const dir = path.join(tmpRoot, 'db');
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'Cookies');
    const writer = new DatabaseSync(dbPath);
    writer.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA wal_autocheckpoint=0;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES ('version', '24');
      CREATE TABLE cookies (
        host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
        expires_utc INTEGER, last_access_utc INTEGER
      );
    `);
    const now = Date.UTC(2026, 8, 28);
    const ins = writer.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('.grok.com', 'sso', '', encrypt('old', '.grok.com', true), chromiumTime(now + 3600e3), chromiumTime(now - 7200e3));
    ins.run('grok.com', 'sso', '', encrypt('new', 'grok.com', true), chromiumTime(now + 3600e3), chromiumTime(now - 60e3));
    ins.run('.grok.com', 'sso-rw', '', encrypt('gone', '.grok.com', true), chromiumTime(now - 1e3), chromiumTime(now));
    ins.run('.grok.com', 'x-userid', '', encrypt('u1', '.grok.com', true), 0, chromiumTime(now - 5e3));
    ins.run('.other.com', 'sso', '', encrypt('nope', '.other.com', true), 0, chromiumTime(now));

    // Rows are only in the -wal file while the writer is open (no checkpoint).
    assert.ok(fs.existsSync(`${dbPath}-wal`));
    const tmpBase = path.join(tmpRoot, 'tmp');
    fs.mkdirSync(tmpBase);
    const prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpBase;
    let snap;
    try {
      snap = readCookieDbSnapshot(dbPath, { hostLike: ['%.grok.com', 'grok.com'] }, now);
    } finally {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
      writer.close();
    }

    assert.equal(snap.version, 24);
    assert.deepEqual(
      snap.rows.map((r) => r.name),
      ['x-userid', 'sso', 'sso'],
      'expired sso-rw and other hosts excluded; newest access first'
    );
    assert.deepEqual(decodeCookieRows(snap, KEY), [
      { name: 'x-userid', value: 'u1' },
      { name: 'sso', value: 'new' },
    ]);
    assert.deepEqual(fs.readdirSync(tmpBase), [], 'temp dir removed');
  });

  it('filters by cookie name', () => {
    const dbPath = path.join(tmpRoot, 'db2');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
        expires_utc INTEGER, last_access_utc INTEGER);
    `);
    const ins = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?)');
    ins.run('cursor.com', 'WorkosCursorSessionToken', '', encrypt('tok', 'cursor.com', false), 0, 1);
    ins.run('cursor.com', 'analytics', 'plain', Buffer.alloc(0), 0, 2);
    db.close();

    const snap = readCookieDbSnapshot(dbPath, {
      hostLike: ['cursor.com'],
      names: ['WorkosCursorSessionToken'],
    });
    assert.equal(snap.version, 0, 'no meta table → legacy');
    assert.deepEqual(decodeCookieRows(snap, KEY), [{ name: 'WorkosCursorSessionToken', value: 'tok' }]);
  });
});
