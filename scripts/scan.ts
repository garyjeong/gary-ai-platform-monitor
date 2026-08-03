#!/usr/bin/env node
/**
 * Phase 0: local discovery CLI
 *   npm run scan
 */
import { scanProviders } from '../packages/core/src/index.ts';
import { registerSeedAdapters } from './register-seed.ts';

registerSeedAdapters();

const entries = await scanProviders();
const out = entries.map(({ adapter, detect }) => ({
  id: adapter.meta.id,
  displayName: adapter.meta.displayName,
  found: detect.found,
  confidence: detect.confidence,
  signals: detect.signals,
  capabilities: adapter.meta.capabilities,
  statusPage: adapter.meta.status?.pageUrl ?? null,
}));

console.log(JSON.stringify({ scannedAt: new Date().toISOString(), providers: out }, null, 2));
