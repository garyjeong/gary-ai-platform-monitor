/**
 * Merge the browser-cookie result (quota %) with the local CLI result (tokens/cost).
 *
 * - Browser ok with %           → browser result.
 * - No browser cookie           → local result.
 * - Browser auth failure        → 'auth_required' + errorKind 'auth', local windows kept.
 * - Other browser failure       → local result when it is ok (status 'ok'), carrying the
 *                                  browser errorKind / errorMessage / retryAfterMs so the
 *                                  scheduler can back off and the UI can say why % is missing;
 *                                  otherwise the browser failure itself.
 * `note` (plan tier label) is attached in every case when known.
 */

import type { UsageResult } from '@gary-ai-platform-monitor/core';

export function combineGrokResults(
  browser: UsageResult | null,
  getLocal: () => UsageResult,
  note?: string
): UsageResult {
  const withNote = (r: UsageResult): UsageResult => (note ? { ...r, note } : r);

  if (browser && browser.status === 'ok' && browser.windows.some((w) => w.usedPercent != null)) {
    return withNote(browser);
  }

  const local = getLocal();
  if (!browser || browser.status === 'ok') return withNote(local);

  if (browser.status === 'auth_required') {
    return withNote({
      providerId: 'grok',
      windows: local.status === 'ok' ? local.windows : [],
      status: 'auth_required',
      updatedAt: browser.updatedAt,
      errorKind: 'auth',
      errorMessage: browser.errorMessage,
    });
  }

  if (local.status === 'ok') {
    return withNote({
      ...local,
      errorKind: browser.errorKind,
      errorMessage: browser.errorMessage,
      retryAfterMs: browser.retryAfterMs,
    });
  }
  return withNote(browser);
}
