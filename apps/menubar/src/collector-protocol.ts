/** Messages between the Electron main process and the collector utility process. */

import type { AppConfig, FullSnapshot, ProviderPreference, RefreshOptions } from '@gary-ai-platform-monitor/core';

export interface RefreshRequest extends RefreshOptions {
  id: number;
}

export type ToCollector =
  | { type: 'init'; config: AppConfig }
  | { type: 'config'; config: AppConfig }
  | { type: 'refresh'; request: RefreshRequest }
  | { type: 'pause' }
  | { type: 'resume' };

export type FromCollector =
  | { type: 'snapshot'; snapshot: FullSnapshot }
  | { type: 'refreshed'; id: number; snapshot: FullSnapshot }
  | { type: 'config-proposal'; patch: Record<string, ProviderPreference> }
  | { type: 'log'; message: string };
