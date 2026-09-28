/**
 * Claude Code OAuth credentials (Keychain → file).
 * Never log access tokens.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    subscriptionType?: string;
    expiresAt?: number;
  };
}

export const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 5000;

/** Result of looking up the Claude Code OAuth access token. */
export type ClaudeTokenLookup =
  | { token: string }
  | { token: null; reason: 'missing' | 'expired' };

/**
 * Keychain item existence only. Without `-w` the secret is never read, so this does
 * not trigger an "allow access" prompt.
 */
export async function hasClaudeKeychainItem(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE], {
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function lookupClaudeAccessToken(now = Date.now()): Promise<ClaudeTokenLookup> {
  const fromKeychain = await readKeychain(now);
  if (fromKeychain.token) return fromKeychain;
  const fromFile = readFile(os.homedir(), now);
  if (fromFile.token) return fromFile;
  const expired =
    (fromKeychain.token === null && fromKeychain.reason === 'expired') ||
    (fromFile.token === null && fromFile.reason === 'expired');
  return { token: null, reason: expired ? 'expired' : 'missing' };
}

export async function getClaudeAccessToken(): Promise<string | null> {
  return (await lookupClaudeAccessToken()).token;
}

async function readKeychain(now: number): Promise<ClaudeTokenLookup> {
  if (process.platform !== 'darwin') return { token: null, reason: 'missing' };
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/security',
      ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS }
    );
    const raw = stdout.trim();
    if (!raw) return { token: null, reason: 'missing' };
    return parseToken(JSON.parse(raw) as CredentialsFile, now);
  } catch {
    // not found / denied / malformed — never surface stdout (it may hold the secret)
    return { token: null, reason: 'missing' };
  }
}

function readFile(home: string, now: number): ClaudeTokenLookup {
  const p = path.join(home, '.claude', '.credentials.json');
  if (!fs.existsSync(p)) return { token: null, reason: 'missing' };
  try {
    return parseToken(JSON.parse(fs.readFileSync(p, 'utf8')) as CredentialsFile, now);
  } catch {
    return { token: null, reason: 'missing' };
  }
}

function parseToken(data: CredentialsFile, now: number): ClaudeTokenLookup {
  const accessToken = data.claudeAiOauth?.accessToken;
  if (!accessToken) return { token: null, reason: 'missing' };
  const expiresAt = data.claudeAiOauth?.expiresAt;
  if (expiresAt != null && expiresAt <= now) return { token: null, reason: 'expired' };
  return { token: accessToken };
}
