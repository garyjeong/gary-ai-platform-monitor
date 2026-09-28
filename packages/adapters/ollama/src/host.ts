/**
 * OLLAMA_HOST → base URL, following the Ollama CLI's own rules:
 *   ""                    → http://127.0.0.1:11434
 *   "0.0.0.0"             → http://127.0.0.1:11434   (bind-all address is not dialable)
 *   "example.com:8080"    → http://example.com:8080  (scheme optional, default http)
 *   "https://example.com" → https://example.com      (default port per scheme)
 * Trailing slashes are dropped; invalid values fall back to the default.
 */

export const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434';

export function normalizeOllamaHost(raw: string | undefined | null): string {
  let v = raw?.trim();
  if (!v) return DEFAULT_OLLAMA_BASE;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return DEFAULT_OLLAMA_BASE;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_OLLAMA_BASE;
  if (!u.hostname || u.hostname === '0.0.0.0') u.hostname = '127.0.0.1';
  if (u.hostname === '[::]') u.hostname = '[::1]';
  if (!u.port && u.protocol === 'http:' && !/:\d+(\/|$)/.test(v.replace(/^[a-z]+:\/\//i, ''))) {
    u.port = '11434';
  }
  const pathname = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${pathname}`;
}
