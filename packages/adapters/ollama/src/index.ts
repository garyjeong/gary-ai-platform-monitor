/**
 * Ollama — local models (no cloud quota %). Shows model count + daemon health.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  fetchJson,
  scrubSecrets,
  type DetectResult,
  type DetectSignal,
  type ProviderAdapter,
  type UsageResult,
} from '@gary-ai-platform-monitor/core';
import { normalizeOllamaHost } from './host.js';

const HOME = os.homedir();
const BASE = normalizeOllamaHost(process.env.OLLAMA_HOST);

interface OllamaTags {
  models?: Array<{ name?: string; size?: number }>;
}

/** Pure mapper: /api/tags → result (disk usage in bytes). */
export function mapOllamaTags(data: OllamaTags | null | undefined, now = Date.now()): UsageResult {
  const models = Array.isArray(data?.models) ? data.models : [];
  const totalBytes = models.reduce(
    (s, m) => s + (typeof m?.size === 'number' && Number.isFinite(m.size) && m.size > 0 ? m.size : 0),
    0
  );
  const names = models
    .slice(0, 3)
    .map((m) => m?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  return {
    providerId: 'ollama',
    windows: [
      {
        id: 'models',
        usedPercent: null,
        label: 'local models',
        source: 'local',
        usedAbsolute: models.length,
        unit: 'models',
      },
      {
        id: 'disk',
        usedPercent: null,
        label: 'model storage',
        source: 'local',
        usedAbsolute: totalBytes,
        unit: 'bytes',
      },
    ],
    status: 'ok',
    updatedAt: now,
    observedAt: now,
    ...(names.length ? { note: names.join(', ') } : {}),
  };
}

export const ollamaAdapter: ProviderAdapter = {
  meta: {
    id: 'ollama',
    displayName: 'Ollama',
    status: {
      pageUrl: 'https://ollama.com',
      strategy: 'custom',
    },
    capabilities: {
      percentWindows: false,
      costOnly: false,
      multiWindow: false,
    },
  },
  async detect(): Promise<DetectResult> {
    const signals: DetectSignal[] = [];
    const dir = path.join(HOME, '.ollama');
    if (fs.existsSync(dir)) {
      signals.push({ kind: 'local_app_config', detail: dir });
    }
    const probe = await fetchJson<OllamaTags>(`${BASE}/api/tags`, { timeoutMs: 1500 });
    if (probe.ok) {
      signals.push({ kind: 'local_app_config', detail: `${BASE}/api/tags` });
    }
    return {
      found: signals.length > 0,
      signals,
      confidence: signals.some((s) => s.detail.includes('api/tags'))
        ? 'high'
        : signals.length
          ? 'medium'
          : 'low',
    };
  },
  async fetchUsage(): Promise<UsageResult> {
    const res = await fetchJson<OllamaTags>(`${BASE}/api/tags`, { timeoutMs: 3000 });
    if (res.ok) return mapOllamaTags(res.data);
    const unreachable = res.status === undefined; // no HTTP response at all
    return {
      providerId: 'ollama',
      windows: [],
      status: 'error',
      updatedAt: Date.now(),
      // Daemon down is a network problem, never an auth one.
      errorKind: unreachable && res.errorKind === 'unknown' ? 'network' : res.errorKind,
      retryAfterMs: res.retryAfterMs,
      errorMessage: unreachable
        ? scrubSecrets(`Ollama daemon not reachable at ${BASE} (start \`ollama serve\`)`)
        : scrubSecrets(`Ollama daemon: ${res.errorMessage}`),
    };
  },
};

export { normalizeOllamaHost, DEFAULT_OLLAMA_BASE } from './host.js';
export default ollamaAdapter;
