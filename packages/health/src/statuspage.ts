/**
 * Statuspage.io v2 summary.json (also served by incident.io-hosted pages such as
 * status.openai.com in the same shape).
 */

import {
  fetchJson,
  type ComponentHealth,
  type HealthIndicator,
  type HealthResult,
  type ProviderStatusMeta,
} from '@gary-ai-platform-monitor/core';
import {
  DEFAULT_HEALTH_TIMEOUT_MS,
  USER_AGENT,
  fromHttpError,
  truncate,
  unreachable,
  type HealthFetchOptions,
} from './result.js';

const VALID_INDICATORS = new Set<HealthIndicator>([
  'none',
  'minor',
  'major',
  'critical',
  'maintenance',
]);

/** Statuspage component status → indicator (used for watched components). */
const COMPONENT_STATUS_TO_INDICATOR: Record<string, HealthIndicator> = {
  operational: 'none',
  under_maintenance: 'maintenance',
  degraded_performance: 'minor',
  partial_outage: 'major',
  major_outage: 'critical',
};

const INDICATOR_RANK: Record<HealthIndicator, number> = {
  unknown: -1,
  none: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

/**
 * Watch-list matching (case-insensitive, whitespace-trimmed):
 *   - exact:  'Claude Code'  ↔ 'Claude Code'
 *   - prefix at a word boundary: 'Codex' ↔ 'Codex in ChatGPT Desktop',
 *     'Claude API' ↔ 'Claude API (api.anthropic.com)'.
 * The character after the prefix must be non-alphanumeric, so 'Log' does NOT
 * match 'Login' and 'Claude Code' would not match a hypothetical 'Claude Codex'.
 * No substring/infix match: 'ChatGPT' does not match 'Codex in ChatGPT Desktop'.
 */
export function matchesWatch(componentName: string, watch: string): boolean {
  const name = componentName.trim().toLowerCase();
  const w = watch.trim().toLowerCase();
  if (!w) return false;
  if (name === w) return true;
  return name.startsWith(w) && /[^a-z0-9]/.test(name.charAt(w.length));
}

/**
 * Indicator rules:
 * - `meta.watchComponents` set and ≥1 matched component with a known status →
 *   indicator = WORST watched component (operational→none, under_maintenance→
 *   maintenance, degraded_performance→minor, partial_outage→major,
 *   major_outage→critical); description names that component.
 * - Otherwise → page-wide `status.indicator` / `status.description`.
 * - Body that is not a JSON object, or has neither `status` nor `components` →
 *   unknown + errorKind 'parse'.
 */
export function parseStatuspageSummary(
  providerId: string,
  meta: ProviderStatusMeta,
  body: unknown
): HealthResult {
  if (!isRecord(body)) {
    return unreachable(providerId, meta, 'invalid response', 'parse');
  }
  const status = isRecord(body.status) ? body.status : undefined;
  const rawComponents = Array.isArray(body.components) ? body.components : undefined;
  if (!status && !rawComponents) {
    return unreachable(providerId, meta, 'invalid response', 'parse');
  }

  const rawIndicator = typeof status?.indicator === 'string' ? status.indicator : 'unknown';
  const pageIndicator: HealthIndicator = VALID_INDICATORS.has(rawIndicator as HealthIndicator)
    ? (rawIndicator as HealthIndicator)
    : 'unknown';
  const pageDescription =
    typeof status?.description === 'string' && status.description.trim()
      ? status.description.trim()
      : 'Unknown';

  const components: ComponentHealth[] = (rawComponents ?? [])
    .filter(isRecord)
    .filter((c) => typeof c.name === 'string' && c.name.trim() !== '' && c.group !== true)
    .map((c) => ({
      name: (c.name as string).trim(),
      status: typeof c.status === 'string' ? c.status : 'unknown',
    }));

  const base = {
    providerId,
    pageUrl: meta.pageUrl,
    components,
    updatedAt: Date.now(),
  };

  const watched = summarizeWatched(components, meta.watchComponents);
  if (!watched) {
    return { ...base, indicator: pageIndicator, description: pageDescription };
  }

  let description: string;
  if (watched.indicator === 'none') {
    // Page-wide trouble elsewhere is mentioned but does not colour the badge.
    if (pageIndicator === 'none') description = pageDescription;
    else if (pageDescription !== 'Unknown')
      description = `Watched components operational (page: ${pageDescription})`;
    else description = 'Watched components operational';
  } else {
    const more = watched.nonOperational > 1 ? ` (+${watched.nonOperational - 1} more)` : '';
    description =
      truncate(`${watched.worst.name}: ${humanizeStatus(watched.worst.status)}`, 120 - more.length) +
      more;
  }
  return { ...base, indicator: watched.indicator, description };
}

function summarizeWatched(
  components: ComponentHealth[],
  watchComponents: string[] | undefined
): { indicator: HealthIndicator; worst: ComponentHealth; nonOperational: number } | null {
  const watches = (watchComponents ?? []).filter((w) => w.trim() !== '');
  if (watches.length === 0) return null;

  let worst: ComponentHealth | null = null;
  let worstIndicator: HealthIndicator = 'none';
  let nonOperational = 0;
  for (const c of components) {
    if (!watches.some((w) => matchesWatch(c.name, w))) continue;
    const ind = COMPONENT_STATUS_TO_INDICATOR[c.status.toLowerCase()];
    if (!ind) continue; // unknown status: ignore rather than guess
    if (ind !== 'none') nonOperational++;
    if (!worst || INDICATOR_RANK[ind] > INDICATOR_RANK[worstIndicator]) {
      worst = c;
      worstIndicator = ind;
    }
  }
  return worst ? { indicator: worstIndicator, worst, nonOperational } : null;
}

function humanizeStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function fetchStatuspageHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  options: HealthFetchOptions = {}
): Promise<HealthResult> {
  try {
    const url = meta.summaryUrl ?? defaultSummaryUrl(meta.pageUrl);
    const res = await fetchJson<unknown>(url, {
      timeoutMs: options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) return fromHttpError(providerId, meta, res);
    return parseStatuspageSummary(providerId, meta, res.data);
  } catch {
    // fetchJson already classifies; this only guards unexpected bugs.
    return unreachable(providerId, meta, 'request failed', 'unknown');
  }
}

function defaultSummaryUrl(pageUrl: string): string {
  const base = pageUrl.replace(/\/$/, '');
  return `${base}/api/v2/summary.json`;
}
