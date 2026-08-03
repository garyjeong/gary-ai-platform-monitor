/**
 * Ollama — local models (no cloud quota %). Shows model count + daemon health.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  DetectResult,
  DetectSignal,
  ProviderAdapter,
  UsageResult,
} from '@gary-ai-platform-monitor/core';

const HOME = os.homedir();
const BASE = process.env.OLLAMA_HOST?.replace(/\/$/, '') || 'http://127.0.0.1:11434';

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
    try {
      const res = await fetch(`${BASE}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) {
        signals.push({ kind: 'local_app_config', detail: `${BASE}/api/tags` });
      }
    } catch {
      // offline
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
    try {
      const res = await fetch(`${BASE}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        return {
          providerId: 'ollama',
          windows: [],
          status: 'error',
          updatedAt: Date.now(),
          errorMessage: `Ollama daemon HTTP ${res.status}`,
        };
      }
      const data = (await res.json()) as {
        models?: Array<{ name?: string; size?: number }>;
      };
      const models = data.models ?? [];
      const totalBytes = models.reduce((s, m) => s + (m.size ?? 0), 0);
      return {
        providerId: 'ollama',
        windows: [
          {
            id: 'models',
            usedPercent: null,
            label: 'local models',
            source: 'local',
            usedAbsolute: models.length,
            unit: 'messages',
          },
          {
            id: 'disk',
            usedPercent: null,
            label: 'model storage (MB)',
            source: 'local',
            usedAbsolute: Math.round(totalBytes / (1024 * 1024)),
            unit: 'tokens',
          },
        ],
        status: 'ok',
        updatedAt: Date.now(),
        errorMessage: models
          .slice(0, 3)
          .map((m) => m.name)
          .filter(Boolean)
          .join(', '),
      };
    } catch {
      return {
        providerId: 'ollama',
        windows: [],
        status: 'auth_required',
        updatedAt: Date.now(),
        errorMessage: 'Ollama daemon not reachable (start `ollama serve`)',
      };
    }
  },
};

export default ollamaAdapter;
