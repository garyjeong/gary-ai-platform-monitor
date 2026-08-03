/**
 * Register seed adapters. Imported by CLI and menu bar (resolved from workspace packages).
 * Adapters are peer dependencies of the host app, not of core — host must pass them in.
 * This module only documents the seed id list.
 */

export const SEED_PROVIDER_IDS = ['claude', 'codex', 'grok'] as const;
