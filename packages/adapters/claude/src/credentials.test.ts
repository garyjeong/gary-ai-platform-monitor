import assert from 'node:assert/strict';
import { after, it, mock } from 'node:test';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';

const NOW = 1_800_000_000_000;
let keychain: object | null = null;
let file: object = {};
let fileReads = 0;

// execFile's custom promisifier must also be mocked to avoid real Keychain access.
const originalExecFile = childProcess.execFile;
const fakeExecFile = () => { throw new Error('callback execFile not expected'); };
Object.defineProperty(fakeExecFile, promisify.custom, { value: async () => {
  if (keychain === null) throw new Error('not found');
  return { stdout: JSON.stringify({ claudeAiOauth: keychain }), stderr: '' };
} });
childProcess.execFile = fakeExecFile as typeof childProcess.execFile;
syncBuiltinESMExports();
const { lookupClaudeAccessToken } = await import('./credentials.js');
mock.method(fs, 'existsSync', () => true);
mock.method(fs, 'readFileSync', () => {
  fileReads++;
  return JSON.stringify({ claudeAiOauth: file });
});
syncBuiltinESMExports();
after(() => { childProcess.execFile = originalExecFile; mock.restoreAll(); syncBuiltinESMExports(); });

it('expired Keychain credentials never fall back to an older file; refreshed credentials recover', async () => {
  keychain = { accessToken: 'expired-keychain', expiresAt: NOW - 1 };
  file = { accessToken: 'old-file', expiresAt: NOW + 60_000 };
  fileReads = 0;
  assert.deepEqual(await lookupClaudeAccessToken(NOW), { token: null, reason: 'expired' });
  assert.equal(fileReads, 0);
  keychain = { accessToken: 'refreshed-keychain', expiresAt: NOW + 60_000 };
  assert.deepEqual(await lookupClaudeAccessToken(NOW), { token: 'refreshed-keychain' });
  assert.equal(fileReads, 0);
});

it('file fallback requires a known future expiry', async () => {
  keychain = null;
  for (const expiresAt of [undefined, null, 'tomorrow', NOW - 1]) {
    file = { accessToken: 'old-file', expiresAt };
    assert.equal((await lookupClaudeAccessToken(NOW)).token, null);
  }
  file = { accessToken: 'valid-file', expiresAt: NOW + 60_000 };
  assert.deepEqual(await lookupClaudeAccessToken(NOW), { token: 'valid-file' });
});
