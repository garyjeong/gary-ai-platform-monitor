#!/usr/bin/env node
/**
 * Phase 0: public status-page health CLI
 *   npm run health
 *
 * Default interval target for the app: 30s (min 10s). No notifications.
 */
import { pollHealth } from '../packages/health/src/index.ts';
import { listAdapters } from '../packages/core/src/index.ts';
import { registerSeedAdapters } from './register-seed.ts';

registerSeedAdapters();

const results = await pollHealth(listAdapters());
const out = results.map((h) => ({
  id: h.providerId,
  indicator: h.indicator,
  description: h.description,
  pageUrl: h.pageUrl,
  unreachable: h.unreachable ?? false,
  watchedOrSample: h.components.slice(0, 5).map((c) => `${c.name}=${c.status}`),
  updatedAt: new Date(h.updatedAt).toISOString(),
}));

console.log(JSON.stringify({ polledAt: new Date().toISOString(), health: out }, null, 2));
