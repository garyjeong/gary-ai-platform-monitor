/**
 * Local Mac resource sampling: CPU, memory (+ pressure, swap), shared memory, network throughput.
 *
 * Sources (macOS 26, measured):
 *   CPU      os.cpus() time deltas + os.loadavg()            — no subprocess
 *   memory   vm_stat + sysctl hw.memsize / vm.swapusage / kern.memorystatus_vm_pressure_level
 *   shared   `top -l 1 -n 0` header "MemRegions: … N shared" — ~0.5 s, so sampled every 30 s
 *   network  `netstat -ibn` byte counters of physical links    — deltas per second
 *
 * The sampler only runs while a surface asks for it (setInterval(ms > 0)).
 */

import { execFile } from 'node:child_process';
import * as os from 'node:os';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export type MemoryPressure = 'normal' | 'warn' | 'critical' | 'unknown';

export interface CpuSample {
  usagePct: number;
  userPct: number;
  systemPct: number;
  cores: number;
  load1: number;
}

export interface MemorySample {
  totalBytes: number;
  /** Activity Monitor "Memory Used": app + wired + compressed. */
  usedBytes: number;
  appBytes: number;
  wiredBytes: number;
  compressedBytes: number;
  /** File cache + purgeable: reclaimable, not counted as used. */
  cachedBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  pressure: MemoryPressure;
}

export interface NetworkSample {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface SystemResources {
  at: number;
  cpu: CpuSample | null;
  memory: MemorySample | null;
  /** "shared" of top's MemRegions line, bytes. */
  sharedBytes: number | null;
  network: NetworkSample | null;
  /**
   * Oldest first, one entry per sample (max HISTORY_LEN), all arrays aligned with `t`.
   * A metric that could not be read in a sample repeats as null.
   */
  history: {
    t: number[];
    cpu: Array<number | null>;
    memory: Array<number | null>;
    /** Memory pressure at each sample (drives the memory chart's color). */
    pressure: Array<MemoryPressure | null>;
    shared: Array<number | null>;
    rx: Array<number | null>;
    tx: Array<number | null>;
  };
}

export const HISTORY_LEN = 60;
const SHARED_EVERY_MS = 30_000;
const EXEC_TIMEOUT_MS = 4_000;
const STALE_BASELINE_MS = 10_000;
const BASELINE_GAP_MS = 400;

// ── parsers (pure, tested with fixtures/system) ──────────────────────

export function parseVmStat(text: string): { pageSize: number; pages: Record<string, number> } {
  const size = /page size of (\d+) bytes/.exec(text);
  const pages: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const m = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(line.trim());
    if (m) pages[m[1]!.trim().toLowerCase()] = Number(m[2]);
  }
  return { pageSize: size ? Number(size[1]) : 4096, pages };
}

/** "total = 1024.00M  used = 266.75M  free = 757.25M  (encrypted)" → bytes */
export function parseSwapUsage(text: string): { totalBytes: number; usedBytes: number } {
  const num = (key: string) => {
    const m = new RegExp(`${key} = ([\\d.]+)([KMGT])`).exec(text);
    return m ? toBytes(Number(m[1]), m[2]!) : 0;
  };
  return { totalBytes: num('total'), usedBytes: num('used') };
}

export function pressureFromLevel(level: number): MemoryPressure {
  if (level === 1) return 'normal';
  if (level === 2) return 'warn';
  if (level === 4) return 'critical';
  return 'unknown';
}

export function memoryFrom(
  vm: { pageSize: number; pages: Record<string, number> },
  totalBytes: number,
  swap: { totalBytes: number; usedBytes: number },
  pressure: MemoryPressure
): MemorySample {
  const p = (k: string) => (vm.pages[k] ?? 0) * vm.pageSize;
  const app = Math.max(0, p('anonymous pages') - p('pages purgeable'));
  const wired = p('pages wired down');
  const compressed = p('pages occupied by compressor');
  return {
    totalBytes,
    usedBytes: Math.min(totalBytes || Infinity, app + wired + compressed),
    appBytes: app,
    wiredBytes: wired,
    compressedBytes: compressed,
    cachedBytes: p('file-backed pages') + p('pages purgeable'),
    swapUsedBytes: swap.usedBytes,
    swapTotalBytes: swap.totalBytes,
    pressure,
  };
}

/** "MemRegions: 818594 total, 5622M resident, 383M private, 2310M shared." → bytes */
export function parseTopShared(text: string): number | null {
  const m = /MemRegions:.*?([\d.]+)([BKMGT])\s+shared/.exec(text);
  return m ? toBytes(Number(m[1]), m[2]!) : null;
}

const VIRTUAL_IFACE = /^(lo|gif|stf|anpi|utun|awdl|llw|bridge|ap|ipsec|vmenet|feth)\d*\*?$/;

/**
 * Sum received/sent bytes over physical interfaces. Uses only the <Link#n> row of each
 * interface (address rows repeat the same counters). Columns are read from the right
 * because the Address column is empty for some links.
 */
export function parseNetstat(text: string): { rxBytes: number; txBytes: number } {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 9 || !cols[2]?.startsWith('<Link#')) continue;
    if (VIRTUAL_IFACE.test(cols[0]!)) continue;
    const ib = Number(cols[cols.length - 5]);
    const ob = Number(cols[cols.length - 2]);
    if (Number.isFinite(ib)) rx += ib;
    if (Number.isFinite(ob)) tx += ob;
  }
  return { rxBytes: rx, txBytes: tx };
}

export function cpuFromTimes(prev: os.CpuInfo[], next: os.CpuInfo[], load1: number): CpuSample | null {
  if (!prev.length || prev.length !== next.length) return null;
  let user = 0;
  let sys = 0;
  let total = 0;
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]!.times;
    const b = next[i]!.times;
    const du = b.user - a.user + (b.nice - a.nice);
    const ds = b.sys - a.sys;
    const dt = du + ds + (b.idle - a.idle) + (b.irq - a.irq);
    user += du;
    sys += ds;
    total += dt;
  }
  if (total <= 0) return null;
  const pct = (n: number) => Math.round((1000 * n) / total) / 10;
  return { usagePct: pct(user + sys), userPct: pct(user), systemPct: pct(sys), cores: next.length, load1 };
}

function toBytes(n: number, unit: string): number {
  const mult: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return Math.round(n * (mult[unit] ?? 1));
}

// ── sampler ──────────────────────────────────────────────────────────

export type Exec = (file: string, args: string[]) => Promise<string>;

const defaultExec: Exec = async (file, args) => {
  const { stdout } = await execFileP(file, args, { timeout: EXEC_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  return stdout;
};

export interface SamplerOptions {
  onSample: (resources: SystemResources) => void;
  exec?: Exec;
  now?: () => number;
  cpus?: () => os.CpuInfo[];
}

export class ResourceSampler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalMs = 0;
  private running = false;
  private prevCpus: os.CpuInfo[] = [];
  private prevNet: { at: number; rx: number; tx: number } | null = null;
  private shared: { at: number; bytes: number | null } | null = null;
  private readonly history: SystemResources['history'] = { t: [], cpu: [], memory: [], pressure: [], shared: [], rx: [], tx: [] };
  private last: SystemResources | null = null;
  private readonly exec: Exec;
  private readonly now: () => number;
  private readonly cpus: () => os.CpuInfo[];

  constructor(private readonly opts: SamplerOptions) {
    this.exec = opts.exec ?? defaultExec;
    this.now = opts.now ?? Date.now;
    this.cpus = opts.cpus ?? os.cpus;
  }

  /** 0 stops sampling. Changing the interval takes effect immediately. */
  setInterval(ms: number): void {
    const next = Math.max(0, Math.round(ms));
    if (next === this.intervalMs) return;
    this.intervalMs = next;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (next > 0) void this.tick();
  }

  latest(): SystemResources | null {
    return this.last;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const res = await this.sampleNow();
      if (this.intervalMs > 0) this.opts.onSample(res);
    } finally {
      this.running = false;
      if (this.intervalMs > 0) this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }

  async sampleNow(): Promise<SystemResources> {
    // After a pause the previous counters are too old to describe "now": take a fresh
    // baseline and measure over a short gap so the first visible numbers are current.
    if (!this.last || this.now() - this.last.at > STALE_BASELINE_MS) {
      this.prevCpus = this.cpus();
      this.prevNet = null;
      await this.readNetwork(this.now()).catch(() => null);
      await new Promise((r) => setTimeout(r, BASELINE_GAP_MS));
    }
    const at = this.now();
    const [memory, network, sharedBytes] = await Promise.all([
      this.readMemory().catch(() => null),
      this.readNetwork(at).catch(() => null),
      this.readShared(at).catch(() => this.shared?.bytes ?? null),
    ]);
    const cpus = this.cpus();
    const cpu = cpuFromTimes(this.prevCpus, cpus, Math.round(os.loadavg()[0]! * 100) / 100);
    this.prevCpus = cpus;

    const h = this.history;
    h.t.push(at);
    h.cpu.push(round1(cpu?.usagePct));
    h.memory.push(round1(memory && memory.totalBytes ? (100 * memory.usedBytes) / memory.totalBytes : undefined));
    h.pressure.push(memory ? memory.pressure : null);
    h.shared.push(typeof sharedBytes === 'number' ? sharedBytes : null);
    h.rx.push(round1(network?.rxBytesPerSec));
    h.tx.push(round1(network?.txBytesPerSec));
    for (const arr of Object.values(h)) if (arr.length > HISTORY_LEN) arr.splice(0, arr.length - HISTORY_LEN);

    this.last = {
      at,
      cpu,
      memory,
      sharedBytes,
      network,
      history: {
        t: [...h.t],
        cpu: [...h.cpu],
        memory: [...h.memory],
        pressure: [...h.pressure],
        shared: [...h.shared],
        rx: [...h.rx],
        tx: [...h.tx],
      },
    };
    return this.last;
  }

  private async readMemory(): Promise<MemorySample> {
    const [vmText, sys] = await Promise.all([
      this.exec('/usr/bin/vm_stat', []),
      this.exec('/usr/sbin/sysctl', ['-n', 'hw.memsize', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level']),
    ]);
    const [memsize = '0', swapLine = '', level = '0'] = sys.trim().split('\n');
    return memoryFrom(parseVmStat(vmText), Number(memsize), parseSwapUsage(swapLine), pressureFromLevel(Number(level)));
  }

  private async readNetwork(at: number): Promise<NetworkSample | null> {
    const { rxBytes, txBytes } = parseNetstat(await this.exec('/usr/sbin/netstat', ['-ibn']));
    const prev = this.prevNet;
    this.prevNet = { at, rx: rxBytes, tx: txBytes };
    if (!prev || at <= prev.at) return null;
    const dt = (at - prev.at) / 1000;
    // Counters reset when an interface goes down; never report negative traffic.
    return {
      rxBytesPerSec: Math.max(0, (rxBytes - prev.rx) / dt),
      txBytesPerSec: Math.max(0, (txBytes - prev.tx) / dt),
    };
  }

  private async readShared(at: number): Promise<number | null> {
    if (this.shared && at - this.shared.at < SHARED_EVERY_MS) return this.shared.bytes;
    const bytes = parseTopShared(await this.exec('/usr/bin/top', ['-l', '1', '-n', '0', '-s', '0']));
    this.shared = { at, bytes };
    return bytes;
  }
}

function round1(value: number | undefined): number | null {
  return value === undefined || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}
