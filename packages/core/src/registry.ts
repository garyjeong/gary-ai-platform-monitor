import type { ProviderAdapter } from './types.js';

const adapters = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  if (adapters.has(adapter.meta.id)) {
    throw new Error(`Adapter already registered: ${adapter.meta.id}`);
  }
  adapters.set(adapter.meta.id, adapter);
}

export function getAdapter(id: string): ProviderAdapter | undefined {
  return adapters.get(id);
}

export function listAdapters(): ProviderAdapter[] {
  return [...adapters.values()].sort((a, b) =>
    a.meta.displayName.localeCompare(b.meta.displayName)
  );
}

export function clearAdapters(): void {
  adapters.clear();
}
