#!/usr/bin/env node
/**
 * gai-pm — gary-ai-platform-monitor CLI
 *
 *   gai-pm snapshot
 *   gai-pm scan
 *   gai-pm usage
 *   gai-pm health
 *   gai-pm config get|set-monitor <id> <on|off>
 */

import {
  ensureSeedAdapters,
  getProviderPref,
  listAdapters,
  loadConfig,
  providerIds,
  takeSnapshot,
  updateMonitor,
} from '@gary-ai-platform-monitor/runtime';
import { scanProviders } from '@gary-ai-platform-monitor/core';
import { pollHealth } from '@gary-ai-platform-monitor/health';

const [cmd, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (cmd) {
    case 'snapshot':
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
        printHelp();
        return;
      }
      await cmdSnapshot();
      break;
    case 'scan':
      await cmdScan();
      break;
    case 'usage':
      await cmdUsage();
      break;
    case 'health':
      await cmdHealth();
      break;
    case 'config':
      await cmdConfig(args);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printHelp();
      process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log(`gary-ai-platform-monitor CLI (gai-pm)

Usage:
  gai-pm snapshot              Full snapshot (discover + usage + health + prefs); read-only
  gai-pm scan                  Local detect only
  gai-pm usage                 Usage windows for monitored providers
  gai-pm health                Public status pages
  gai-pm config get            Print config path + JSON
  gai-pm config set-monitor <id> <on|off>
`);
}

async function cmdSnapshot(): Promise<void> {
  const snap = await takeSnapshot();
  console.log(JSON.stringify(snap, null, 2));
}

async function cmdScan(): Promise<void> {
  // scanProviders isolates a throwing detect() so one adapter cannot abort the command.
  const entries = await scanProviders(ensureSeedAdapters());
  const out = entries.map(({ adapter, detect }) => ({
    id: adapter.meta.id,
    found: detect.found,
    confidence: detect.confidence,
    signals: detect.signals,
  }));
  console.log(JSON.stringify({ providers: out }, null, 2));
}

async function cmdUsage(): Promise<void> {
  const snap = await takeSnapshot();
  const providers = snap.providers
    .filter((p) => getProviderPref(snap.config, p.meta.id).monitor)
    .map((p) => ({
      id: p.meta.id,
      lifecycle: p.lifecycle,
      usage: p.usage,
    }));
  console.log(JSON.stringify({ providers }, null, 2));
}

async function cmdHealth(): Promise<void> {
  ensureSeedAdapters();
  const results = await pollHealth(
    listAdapters().filter((a) => a.meta.status && a.meta.status.strategy !== 'custom')
  );
  console.log(JSON.stringify({ health: results }, null, 2));
}

async function cmdConfig(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'get' || !sub) {
    const cfg = loadConfig();
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  if (sub === 'set-monitor') {
    const id = args[1];
    const flag = args[2];
    if (!id || (flag !== 'on' && flag !== 'off')) {
      console.error('Usage: gai-pm config set-monitor <id> <on|off>');
      process.exitCode = 1;
      return;
    }
    if (!providerIds().includes(id)) {
      console.error(`Unknown provider id: ${id}. Known: ${providerIds().join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const next = updateMonitor(id, flag === 'on');
    console.log(JSON.stringify(next.providers[id], null, 2));
    return;
  }
  console.error(`Unknown config subcommand: ${sub}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
