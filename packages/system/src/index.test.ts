import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { CpuInfo } from 'node:os';
import {
  cpuFromTimes,
  memoryFrom,
  parseNetstat,
  parseSwapUsage,
  parseTopShared,
  parseVmStat,
  pressureFromLevel,
  ResourceSampler,
} from './index.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../../fixtures/system/${name}`, import.meta.url), 'utf8');

describe('parsers (real macOS 26 output)', () => {
  it('vm_stat → Activity Monitor style "used" memory', () => {
    const vm = parseVmStat(fixture('vm_stat.txt'));
    assert.equal(vm.pageSize, 16384);
    assert.ok((vm.pages['anonymous pages'] ?? 0) > 0);
    const mem = memoryFrom(vm, 24 * 1024 ** 3, { totalBytes: 0, usedBytes: 0 }, 'normal');
    const p = (k: string) => (vm.pages[k] ?? 0) * 16384;
    assert.equal(mem.usedBytes, p('anonymous pages') - p('pages purgeable') + p('pages wired down') + p('pages occupied by compressor'));
    assert.ok(mem.usedBytes < mem.totalBytes);
  });

  it('swap usage and pressure level', () => {
    const s = parseSwapUsage('total = 1024.00M  used = 266.75M  free = 757.25M  (encrypted)');
    assert.equal(s.totalBytes, 1024 * 1024 ** 2);
    assert.equal(s.usedBytes, Math.round(266.75 * 1024 ** 2));
    assert.equal(pressureFromLevel(1), 'normal');
    assert.equal(pressureFromLevel(2), 'warn');
    assert.equal(pressureFromLevel(4), 'critical');
  });

  it('top header → shared memory bytes', () => {
    const shared = parseTopShared(fixture('top-header.txt'));
    assert.ok(shared !== null && shared > 100 * 1024 ** 2, String(shared));
    assert.equal(parseTopShared('MemRegions: 1 total, 5G resident, 2M private, 1.5G shared.'), 1.5 * 1024 ** 3);
    assert.equal(parseTopShared('no such line'), null);
  });

  it('netstat sums physical links once, skipping loopback/VPN/virtual', () => {
    const { rxBytes, txBytes } = parseNetstat(fixture('netstat-ibn.txt'));
    const en0 = fixture('netstat-ibn.txt').split('\n').find((l) => /^en0\s.*<Link#/.test(l))!.trim().split(/\s+/);
    // Only en* links carry traffic in the fixture; loopback (lo0) and utun are excluded.
    assert.ok(rxBytes >= Number(en0[en0.length - 5]));
    assert.ok(txBytes >= Number(en0[en0.length - 2]));
    const lo0 = fixture('netstat-ibn.txt').split('\n').find((l) => /^lo0\s.*<Link#/.test(l))!.trim().split(/\s+/);
    assert.ok(rxBytes < Number(en0[en0.length - 5]) + Number(lo0[lo0.length - 5]));
  });

  it('cpu usage from per-core time deltas', () => {
    const t = (user: number, sys: number, idle: number): CpuInfo => ({
      model: 'm',
      speed: 0,
      times: { user, nice: 0, sys, idle, irq: 0 },
    });
    const cpu = cpuFromTimes([t(100, 50, 850), t(0, 0, 1000)], [t(200, 100, 900), t(50, 0, 1150)], 2.5);
    // user 150, sys 50, idle 200 of 400 total → 50% (37.5% user, 12.5% sys)
    assert.deepEqual(cpu, { usagePct: 50, userPct: 37.5, systemPct: 12.5, cores: 2, load1: 2.5 });
    assert.equal(cpuFromTimes([], [t(1, 1, 1)], 0), null);
  });
});

describe('ResourceSampler', () => {
  it('computes network rates between samples and samples shared memory sparingly', async () => {
    let t = 1_000_000;
    let rx = 1_000_000;
    let topCalls = 0;
    const exec = async (file: string) => {
      if (file.endsWith('vm_stat')) return fixture('vm_stat.txt');
      if (file.endsWith('sysctl')) return '25769803776\ntotal = 1024.00M  used = 10.00M  free = 1014.00M\n2\n';
      if (file.endsWith('top')) {
        topCalls += 1;
        return fixture('top-header.txt');
      }
      return `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#14> 02:00:00:00:00:01 1 0 ${rx} 1 0 500 0\n`;
    };
    const cpus = () => [{ model: 'm', speed: 0, times: { user: t / 1000, nice: 0, sys: 0, idle: t / 1000, irq: 0 } }];
    const s = new ResourceSampler({ onSample: () => undefined, exec, now: () => t, cpus });
    const first = await s.sampleNow();
    // First call takes a baseline first; with a frozen clock the rate is not computable yet.
    assert.equal(first.network, null);
    assert.equal(first.memory?.pressure, 'warn');
    t += 2_000;
    rx += 4_000;
    const second = await s.sampleNow();
    assert.equal(second.network?.rxBytesPerSec, 2_000);
    // Aligned history: the first sample had no network rate yet.
    assert.deepEqual(second.history.rx, [null, 2_000]);
    assert.equal(second.history.t.length, 2);
    assert.equal(second.history.shared[1], second.sharedBytes);
    assert.deepEqual(second.history.pressure, ['warn', 'warn']);
    assert.equal(topCalls, 1); // within 30 s → cached
    assert.ok(second.cpu && second.cpu.usagePct === 50);
  });
});
