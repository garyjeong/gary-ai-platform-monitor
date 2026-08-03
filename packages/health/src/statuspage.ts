import type {
  ComponentHealth,
  HealthIndicator,
  HealthResult,
  ProviderStatusMeta,
} from '@gary-ai-platform-monitor/core';

interface StatuspageSummary {
  status?: {
    indicator?: string;
    description?: string;
  };
  components?: Array<{
    name?: string;
    status?: string;
    group?: boolean;
  }>;
  page?: {
    url?: string;
  };
}

const VALID_INDICATORS = new Set<HealthIndicator>([
  'none',
  'minor',
  'major',
  'critical',
  'maintenance',
]);

export function parseStatuspageSummary(
  providerId: string,
  meta: ProviderStatusMeta,
  body: unknown
): HealthResult {
  const data = body as StatuspageSummary;
  const rawIndicator = data.status?.indicator ?? 'unknown';
  const indicator: HealthIndicator = VALID_INDICATORS.has(rawIndicator as HealthIndicator)
    ? (rawIndicator as HealthIndicator)
    : 'unknown';

  const components: ComponentHealth[] = (data.components ?? [])
    .filter((c) => c.name && !c.group)
    .map((c) => ({
      name: c.name as string,
      status: c.status ?? 'unknown',
    }));

  let description = data.status?.description ?? 'Unknown';
  if (meta.watchComponents?.length) {
    const watched = components.filter((c) =>
      meta.watchComponents!.some((w) => c.name.toLowerCase() === w.toLowerCase())
    );
    if (watched.length > 0) {
      const worst = watched.find((c) => c.status !== 'operational');
      if (worst) {
        description = `${worst.name}: ${worst.status}`;
      }
    }
  }

  return {
    providerId,
    indicator,
    description,
    pageUrl: meta.pageUrl,
    components,
    updatedAt: Date.now(),
  };
}

export async function fetchStatuspageHealth(
  providerId: string,
  meta: ProviderStatusMeta,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<HealthResult> {
  const url = meta.summaryUrl ?? defaultSummaryUrl(meta.pageUrl);
  const timeoutMs = options?.timeoutMs ?? 8_000;
  const fetchImpl = options?.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gary-ai-platform-monitor/0.1.0',
      },
    });
    if (!res.ok) {
      return unreachable(providerId, meta, `HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    return parseStatuspageSummary(providerId, meta, json);
  } catch {
    return unreachable(providerId, meta, 'request failed');
  } finally {
    clearTimeout(timer);
  }
}

function defaultSummaryUrl(pageUrl: string): string {
  const base = pageUrl.replace(/\/$/, '');
  return `${base}/api/v2/summary.json`;
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
