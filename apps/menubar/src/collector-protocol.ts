/** Messages between the Electron main process and the collector utility process. */

import type { AppConfig, FullSnapshot, ProviderPreference, RefreshOptions } from '@gary-ai-platform-monitor/core';
import type { SystemResources } from '@gary-ai-platform-monitor/system';

export interface RefreshRequest extends RefreshOptions {
  id: number;
}

export type ToCollector =
  | { type: 'init'; config: AppConfig }
  | { type: 'config'; config: AppConfig }
  | { type: 'refresh'; request: RefreshRequest }
  | { type: 'pause' }
  | { type: 'resume' }
  /** Resource sampling interval requested by the visible surfaces; 0 stops sampling. */
  | { type: 'resources-demand'; intervalMs: number };

export type FromCollector =
  | { type: 'snapshot'; snapshot: FullSnapshot }
  | { type: 'refreshed'; id: number; snapshot: FullSnapshot }
  | { type: 'config-proposal'; patch: Record<string, ProviderPreference> }
  | { type: 'resources'; resources: SystemResources }
  | { type: 'log'; message: string };
