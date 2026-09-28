import { registerAdapter, clearAdapters } from '../packages/core/src/index.ts';
import { ALL_ADAPTERS } from '../packages/runtime/src/index.ts';

/** Dev scripts use the same adapter list as the app (packages/runtime). */
export function registerSeedAdapters(): void {
  clearAdapters();
  for (const a of ALL_ADAPTERS) registerAdapter(a);
}
