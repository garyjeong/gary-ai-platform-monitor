/**
 * RSS/Atom health for status pages that are not Statuspage.io
 * (e.g. https://status.x.ai/feed.xml).
 *
 * xAI item shape (fixtures/status/xai-feed.xml):
 *   <description><![CDATA[ <h3>Status: RESOLVED</h3> <p>Severity: available</p> ... ]]></description>
 *   <pubDate>…</pubDate> <category>available</category> <category>resolved</category>
 * Labels are read per line (block tags → newlines) so a value never swallows the
 * next element's text.
 */

import {
  fetchText,
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

export interface RssIncident {
  title: string;
  link?: string;
  resolved: boolean;
  /** Normalized "Status:" value (lowercase, `_`/`-` → space), '' when absent. */
  status: string;
  /** Normalized "Severity:" value, else first non-status category, else 'unknown'. */
  severity: string;
  categories: string[];
  /** Epoch ms from pubDate / published / updated; undefined when absent or invalid. */
  publishedAt?: number;
}

export interface RssParseOptions {
  /** Clock for the staleness check. Defaults to Date.now(). */
  now?: number;
  /** Open incidents published longer ago than this are ignored. Default 14 days. */
  staleAfterMs?: number;
}

/**
 * Open incidents older than this are treated as never-resolved leftovers and
 * ignored (xAI has shipped items that were never marked resolved).
 */
export const STALE_OPEN_INCIDENT_MS = 14 * 24 * 60 * 60 * 1000;

/** Statuses / categories that mean the incident is over. */
const CLOSED_STATUSES = new Set(['resolved', 'completed', 'postmortem']);

/** Categories that describe lifecycle, not severity — skipped for the severity fallback. */
const STATUS_WORDS = new Set([
  ...CLOSED_STATUSES,
  'investigating',
  'identified',
  'monitoring',
  'verifying',
  'update',
  'updated',
  'scheduled',
  'in progress',
]);

/**
 * Severity → indicator for an OPEN incident (an open incident is never 'none'):
 *
 *   available, informational, info, minor, none, operational  → minor
 *   degraded, degraded performance, partial, partial outage, major → major
 *   unavailable, outage, major outage, critical                → critical
 *   maintenance, under maintenance, scheduled maintenance      → maintenance
 *   missing / unknown                                          → minor
 *
 * Values are normalized first (lowercase, `_`/`-` → space), so `partial_outage`
 * equals `partial outage`. Unlisted values fall through keyword checks in a fixed
 * order: `partial` before `outage` (partial outage is major, not critical) and
 * `unavailable` before anything that could match `available`.
 */
const SEVERITY_TO_INDICATOR: Record<string, HealthIndicator> = {
  available: 'minor',
  informational: 'minor',
  info: 'minor',
  minor: 'minor',
  none: 'minor',
  operational: 'minor',
  degraded: 'major',
  'degraded performance': 'major',
  partial: 'major',
  'partial outage': 'major',
  major: 'major',
  unavailable: 'critical',
  outage: 'critical',
  'major outage': 'critical',
  critical: 'critical',
  maintenance: 'maintenance',
  'under maintenance': 'maintenance',
  'scheduled maintenance': 'maintenance',
};

export function severityToIndicator(raw: string): HealthIndicator {
  const s = normalizeLabel(raw);
  const exact = SEVERITY_TO_INDICATOR[s];
  if (exact) return exact;
  if (/\bpartial\b/.test(s)) return 'major';
  if (/\b(unavailable|outage|critical)\b/.test(s)) return 'critical';
  if (/\bdegraded\b/.test(s)) return 'major';
  if (/\bmaintenance\b/.test(s)) return 'maintenance';
  return 'minor';
}

const INDICATOR_RANK: Record<HealthIndicator, number> = {
  unknown: -1,
  none: 0,
  maintenance: 1,
  minor: 2,
  major: 3,
  critical: 4,
};

/**
 * Pure parser — used by tests with fixtures.
 *
 * - No `<item>`/`<entry>` start tag but a channel/feed root → valid empty feed → 'none'.
 * - `<item>`/`<entry>` start tag present but zero complete items → truncated body →
 *   unknown + errorKind 'parse'. (If only the tail is cut, the complete items are
 *   still used: feeds are newest-first, so current incidents survive.)
 * - Neither → not a feed (e.g. an HTML error page served with 200) → 'parse'.
 */
export function parseRssHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  xml: string,
  options: RssParseOptions = {}
): HealthResult {
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? STALE_OPEN_INCIDENT_MS;

  const items = extractItems(xml);
  if (items.length === 0) {
    if (/<(item|entry)[\s>]/i.test(xml)) {
      return unreachable(providerId, meta, 'truncated feed', 'parse');
    }
    if (!/<(rss|channel|feed|rdf:RDF)[\s>]/i.test(xml)) {
      return unreachable(providerId, meta, 'not an RSS/Atom feed', 'parse');
    }
    return operational(providerId, meta, 'All Systems Operational', []);
  }

  const incidents = items.map(parseItem);
  const isStale = (i: RssIncident) =>
    !i.resolved && i.publishedAt !== undefined && now - i.publishedAt > staleAfterMs;
  const staleCount = incidents.filter(isStale).length;
  const open = incidents.filter((i) => !i.resolved && !isStale(i));

  if (open.length === 0) {
    const description =
      staleCount > 0
        ? `All Systems Operational (${staleCount} stale unresolved incident${staleCount > 1 ? 's' : ''} ignored)`
        : 'All Systems Operational';
    return operational(
      providerId,
      meta,
      description,
      incidents.slice(0, 5).map((i) => ({
        name: truncate(i.title, 80),
        status: i.resolved ? 'resolved' : 'stale',
      }))
    );
  }

  // Worst severity wins; ties keep feed order (newest first).
  let worst = open[0]!;
  let worstIndicator = severityToIndicator(worst.severity);
  for (const i of open.slice(1)) {
    const ind = severityToIndicator(i.severity);
    if (INDICATOR_RANK[ind] > INDICATOR_RANK[worstIndicator]) {
      worst = i;
      worstIndicator = ind;
    }
  }

  const more = open.length > 1 ? ` (+${open.length - 1} more)` : '';
  return {
    providerId,
    indicator: worstIndicator,
    description: truncate(worst.title, 120 - more.length) + more,
    pageUrl: meta.pageUrl,
    components: open.map((i) => ({
      name: truncate(i.title, 80),
      status: i.severity,
    })),
    updatedAt: Date.now(),
  };
}

export async function fetchRssHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  options: HealthFetchOptions = {}
): Promise<HealthResult> {
  try {
    const url = meta.summaryUrl ?? defaultFeedUrl(meta.pageUrl);
    const res = await fetchText(url, {
      timeoutMs: options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) return fromHttpError(providerId, meta, res);
    return parseRssHealth(providerId, meta, res.data, { now: options.now });
  } catch {
    // fetchText already classifies; this only guards unexpected bugs.
    return unreachable(providerId, meta, 'request failed', 'unknown');
  }
}

function operational(
  providerId: string,
  meta: ProviderStatusMeta,
  description: string,
  components: HealthResult['components']
): HealthResult {
  return {
    providerId,
    indicator: 'none',
    description,
    pageUrl: meta.pageUrl,
    components,
    updatedAt: Date.now(),
  };
}

function defaultFeedUrl(pageUrl: string): string {
  const base = pageUrl.replace(/\/$/, '');
  return `${base}/feed.xml`;
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) items.push(m[1]);
  }
  // Atom fallback
  if (items.length === 0) {
    const are = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((m = are.exec(xml)) !== null) {
      if (m[1]) items.push(m[1]);
    }
  }
  return items;
}

function parseItem(body: string): RssIncident {
  const title =
    decode(stripTags(tag(body, 'title') ?? ''))
      .replace(/\s+/g, ' ')
      .trim() || 'Incident';
  const link = (tag(body, 'link') ?? attr(body, 'link', 'href'))?.trim() || undefined;
  const description =
    tag(body, 'description') ?? tag(body, 'content') ?? tag(body, 'summary') ?? '';
  const categories = extractCategories(body);

  const lines = htmlToLines(description);
  const status = normalizeLabel(labelValue(lines, 'Status') ?? '');
  const severity =
    normalizeLabel(labelValue(lines, 'Severity') ?? '') ||
    categories.find((c) => !STATUS_WORDS.has(c)) ||
    'unknown';

  const resolved =
    CLOSED_STATUSES.has(status) || categories.some((c) => CLOSED_STATUSES.has(c));

  const publishedAt = parseDate(
    tag(body, 'pubDate') ?? tag(body, 'published') ?? tag(body, 'updated') ?? tag(body, 'dc:date')
  );

  return { title, link, resolved, status, severity, categories, publishedAt };
}

/** Block-level tags become line breaks; inline tags become spaces. */
function htmlToLines(raw: string): string[] {
  // Non-CDATA descriptions carry entity-escaped HTML (&lt;p&gt;…).
  const html = /<[a-z!/]/i.test(raw) ? raw : decode(raw);
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/?(?:p|div|h[1-6]|li|ul|ol|tr|td|th|table|hr|section|article|header|footer|blockquote|pre)\b[^>]*>/gi,
      '\n'
    )
    .replace(/<[^>]+>/g, ' ');
  return decode(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Value of the first `Label: value` occurrence (line start or after whitespace).
 * A value is cut at the next `Word:` label in case two labels share a line.
 */
function labelValue(lines: string[], label: string): string | null {
  const re = new RegExp(`(?:^|\\s)${label}\\s*:\\s*(.*)$`, 'i');
  for (const line of lines) {
    const m = line.match(re);
    if (m) return (m[1] ?? '').split(/\s[A-Za-z]+:/)[0] ?? '';
  }
  return null;
}

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCategories(body: string): string[] {
  const out: string[] = [];
  const re = /<category\b([^>]*?)(?:\/>|>([\s\S]*?)<\/category>)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const text = m[2] !== undefined ? m[2].replace(/<!\[CDATA\[|\]\]>/g, '') : '';
    const term = /\bterm\s*=\s*"([^"]*)"/i.exec(m[1] ?? '')?.[1] ?? '';
    const value = normalizeLabel(decode(text.trim() || term));
    if (value) out.push(value);
  }
  return out;
}

function parseDate(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const t = Date.parse(raw.trim());
  return Number.isNaN(t) ? undefined : t;
}

function attr(xml: string, name: string, attribute: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return m?.[1] ?? null;
}

function tag(xml: string, name: string): string | null {
  const cdata = new RegExp(
    `<${name}\\b[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${name}>`,
    'i'
  );
  const m1 = xml.match(cdata);
  if (m1?.[1] != null) return m1[1];
  const plain = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m2 = xml.match(plain);
  return m2?.[1] ?? null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}
