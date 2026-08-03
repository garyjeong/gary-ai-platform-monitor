/**
 * RSS/Atom health for status pages that are not Statuspage.io
 * (e.g. https://status.x.ai/feed.xml).
 */

import type {
  HealthIndicator,
  HealthResult,
  ProviderStatusMeta,
} from '@gary-ai-platform-monitor/core';

export interface RssIncident {
  title: string;
  link?: string;
  resolved: boolean;
  severity: string;
  categories: string[];
}

/** Pure parser — used by tests with fixtures */
export function parseRssHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  xml: string
): HealthResult {
  const items = extractItems(xml);
  const incidents = items.map(parseItem);
  const open = incidents.filter((i) => !i.resolved);

  if (open.length === 0) {
    return {
      providerId,
      indicator: 'none',
      description: 'All Systems Operational',
      pageUrl: meta.pageUrl,
      components: incidents.slice(0, 5).map((i) => ({
        name: truncate(i.title, 80),
        status: i.resolved ? 'resolved' : 'open',
      })),
      updatedAt: Date.now(),
    };
  }

  const indicator = worstIndicator(open);
  const top = open[0]!;
  return {
    providerId,
    indicator,
    description: truncate(top.title, 120),
    pageUrl: meta.pageUrl,
    components: open.map((i) => ({
      name: truncate(i.title, 80),
      status: i.severity || 'open',
    })),
    updatedAt: Date.now(),
  };
}

export async function fetchRssHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<HealthResult> {
  const url = meta.summaryUrl ?? defaultFeedUrl(meta.pageUrl);
  const timeoutMs = options?.timeoutMs ?? 8_000;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': 'gary-ai-platform-monitor/0.2.0',
      },
    });
    if (!res.ok) {
      return unreachable(providerId, meta, `HTTP ${res.status}`);
    }
    const xml = await res.text();
    if (!xml.includes('<item') && !xml.includes('<entry')) {
      return unreachable(providerId, meta, 'not an RSS/Atom feed');
    }
    return parseRssHealth(providerId, meta, xml);
  } catch {
    return unreachable(providerId, meta, 'request failed');
  } finally {
    clearTimeout(timer);
  }
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
  const title = decode(stripTags(tag(body, 'title') ?? '')).trim() || 'Incident';
  const link = tag(body, 'link') ?? undefined;
  const description = tag(body, 'description') ?? tag(body, 'content') ?? '';
  const categories = [...body.matchAll(/<category[^>]*>([^<]*)<\/category>/gi)].map((c) =>
    (c[1] ?? '').trim().toLowerCase()
  );

  const descText = decode(stripTags(description));
  const statusMatch = descText.match(/Status:\s*([A-Za-z_ -]+)/i);
  const status = (statusMatch?.[1] ?? '').trim().toLowerCase();
  const severityMatch = descText.match(/Severity:\s*([A-Za-z_ -]+)/i);
  const severity =
    (severityMatch?.[1] ?? categories.find((c) => c !== 'resolved') ?? 'unknown').trim().toLowerCase();

  const resolved =
    status === 'resolved' ||
    categories.includes('resolved') ||
    /Status:\s*RESOLVED/i.test(description);

  return { title, link, resolved, severity, categories };
}

function worstIndicator(open: RssIncident[]): HealthIndicator {
  let rank = 1; // minor
  for (const i of open) {
    const s = i.severity;
    if (s.includes('critical') || s.includes('outage')) {
      rank = Math.max(rank, 4);
    } else if (s.includes('major') || s.includes('degraded') || s.includes('partial') || s === 'unavailable') {
      rank = Math.max(rank, 3);
    } else if (s === 'available' || s.includes('investigat') || s.includes('monitor')) {
      rank = Math.max(rank, 1);
    } else {
      rank = Math.max(rank, 2);
    }
  }
  if (rank >= 4) return 'critical';
  if (rank >= 3) return 'major';
  if (rank >= 2) return 'major';
  return 'minor';
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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function unreachable(
  providerId: string,
  meta: ProviderStatusMeta,
  reason: string
): HealthResult {
  return {
    providerId,
    indicator: 'unknown',
    description: `상태 확인 불가 (${reason})`,
    pageUrl: meta.pageUrl,
    components: [],
    updatedAt: Date.now(),
    unreachable: true,
  };
}
