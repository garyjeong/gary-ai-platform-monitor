#!/usr/bin/env node
/**
 * Phase 2: fetch usage for all seed providers
 *   npm run usage
 */
import { listAdapters } from '../packages/core/src/index.ts';
import { registerSeedAdapters } from './register-seed.ts';

registerSeedAdapters();

const adapters = listAdapters();
const results = await Promise.all(
  adapters.map(async (a) => {
    const detect = await a.detect().catch(() => ({ found: false }));
    if (!detect.found) return { id: a.meta.id, displayName: a.meta.displayName, found: false };
    const usage = await a.fetchUsage().catch((err: unknown) => ({
      status: 'error' as const,
      windows: [],
      errorMessage: err instanceof Error ? err.message : String(err),
    }));
    return {
      id: a.meta.id,
      displayName: a.meta.displayName,
      found: detect.found,
      usageStatus: usage.status,
      windows: usage.windows.map((w) => ({
        id: w.id,
        usedPercent: w.usedPercent,
        usedAbsolute: w.usedAbsolute,
        unit: w.unit,
        label: w.label,
        resetsAt: w.resetsAt
          ? new Date(w.resetsAt * 1000).toISOString()
          : null,
        source: w.source,
      })),
      errorMessage: usage.errorMessage ?? null,
    };
  })
);

console.log(JSON.stringify({ fetchedAt: new Date().toISOString(), providers: results }, null, 2));
