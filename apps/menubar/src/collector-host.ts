/**
 * Collector utility process. Runs every adapter (Keychain, local logs, cookie DBs,
 * vendor APIs) away from the Electron main thread. Crashes here never freeze the tray;
 * main restarts this process.
 */

import type { Collector } from '@gary-ai-platform-monitor/core';
import { createAppCollector } from '@gary-ai-platform-monitor/runtime';
import { ResourceSampler } from '@gary-ai-platform-monitor/system';
import type { FromCollector, ToCollector } from './collector-protocol.js';

const port = process.parentPort;
let collector: Collector | null = null;
const sampler = new ResourceSampler({
  onSample: (resources) => post({ type: 'resources', resources }),
});

function post(msg: FromCollector): void {
  port.postMessage(msg);
}

port.on('message', (event) => {
  const msg = event.data as ToCollector;
  switch (msg.type) {
    case 'init':
      collector?.stop();
      collector = createAppCollector({
        config: msg.config,
        onChange: (snapshot) => post({ type: 'snapshot', snapshot }),
        onConfigProposal: (patch) => post({ type: 'config-proposal', patch }),
      });
      collector.start(); // first tick runs detection immediately, then due usage/health
      break;
    case 'config':
      collector?.setConfig(msg.config);
      break;
    case 'refresh': {
      const { id, ...opts } = msg.request;
      if (!collector) return;
      collector
        .refreshNow(opts)
        .then((snapshot) => post({ type: 'refreshed', id, snapshot }))
        .catch((err: unknown) => {
          post({ type: 'log', message: `refresh failed: ${String(err)}` });
          post({ type: 'refreshed', id, snapshot: collector!.snapshot() });
        });
      break;
    }
    case 'pause':
      collector?.pause();
      sampler.setInterval(0);
      break;
    case 'resume':
      collector?.resume();
      break;
    case 'resources-demand':
      sampler.setInterval(msg.intervalMs);
      break;
  }
});

process.on('unhandledRejection', (reason) => {
  post({ type: 'log', message: `unhandled rejection: ${String(reason)}` });
});

// If the main process dies without a clean quit (SIGKILL, crash), this process is
// re-parented. Exit instead of polling vendor APIs as an orphan.
const parentPid = process.ppid;
setInterval(() => {
  if (process.ppid !== parentPid || process.ppid === 1) {
    collector?.stop();
    sampler.setInterval(0);
    process.exit(0);
  }
}, 5_000).unref();
