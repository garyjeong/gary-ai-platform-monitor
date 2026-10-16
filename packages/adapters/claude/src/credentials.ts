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
const CLI_REFRESH_TIMEOUT_MS = 30_000;
/** A server name nobody configures: `mcp get` must stop at "not found". */
const CLI_REFRESH_PROBE = '__gary-ai-platform-monitor-token-refresh__';

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
  // An expired Keychain entry is authoritative; an old file may belong to a
  // previous login and must not replace it.
  if (fromKeychain.token !== null || fromKeychain.reason === 'expired') return fromKeychain;
  return readFile(os.homedir(), now);
}

export async function getClaudeAccessToken(): Promise<string | null> {
  return (await lookupClaudeAccessToken()).token;
}

/**
 * Let Claude Code refresh its own expired OAuth token. Sessions in the Claude desktop
 * app authenticate through the app and never refresh this Keychain entry, so it stays
 * expired until the standalone CLI runs. `claude mcp get <missing>` loads the claude.ai
 * connector list (which refreshes the token first) and exits at "not found" before any
 * MCP server is started. Returns false when no CLI is installed.
 */
export async function refreshClaudeTokenViaCli(home = os.homedir()): Promise<boolean> {
  const bin = [
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ].find((p) => fs.existsSync(p));
  if (!bin) return false;
  try {
    await execFileAsync(bin, ['mcp', 'get', CLI_REFRESH_PROBE], {
      cwd: home,
      timeout: CLI_REFRESH_TIMEOUT_MS,
      // Minimal env: inherited CLAUDE_CODE_* host-auth variables would bypass the Keychain.
      env: {
        HOME: home,
        USER: os.userInfo().username,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
      },
    });
  } catch {
    // exits 1 at "not found" — expected; the caller re-reads the token either way
  }
  return true;
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
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return { token: null, reason: 'missing' };
  }
  if (expiresAt <= now) return { token: null, reason: 'expired' };
  return { token: accessToken };
}
