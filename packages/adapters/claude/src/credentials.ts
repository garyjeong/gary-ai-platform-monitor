/**
 * Claude Code OAuth credentials (Keychain → file).
 * Never log access tokens.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

interface CredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    subscriptionType?: string;
    expiresAt?: number;
  };
}

const KEYCHAIN_TIMEOUT_MS = 5000;

export function getClaudeAccessToken(): string | null {
  const now = Date.now();
  const fromKeychain = readKeychain(now);
  if (fromKeychain) return fromKeychain;
  return readFile(os.homedir(), now);
}

function readKeychain(now: number): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
    ).trim();
    if (!raw) return null;
    return parseToken(JSON.parse(raw) as CredentialsFile, now);
  } catch {
    return null;
  }
}

function readFile(home: string, now: number): string | null {
  const p = path.join(home, '.claude', '.credentials.json');
  if (!fs.existsSync(p)) return null;
  try {
    return parseToken(JSON.parse(fs.readFileSync(p, 'utf8')) as CredentialsFile, now);
  } catch {
    return null;
  }
}

function parseToken(data: CredentialsFile, now: number): string | null {
  const accessToken = data.claudeAiOauth?.accessToken;
  if (!accessToken) return null;
  const expiresAt = data.claudeAiOauth?.expiresAt;
  if (expiresAt != null && expiresAt <= now) return null;
  return accessToken;
}
