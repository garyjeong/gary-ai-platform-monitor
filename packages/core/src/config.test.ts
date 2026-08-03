import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG } from './types.js';
import {
  getProviderPref,
  mergeConfig,
  normalizeProviderPref,
  setProviderMonitor,
} from './config.js';

describe('normalizeProviderPref', () => {
  it('fills missing fields and couples showHealth to monitor', () => {
    const on = normalizeProviderPref({ monitor: true });
    assert.equal(on.monitor, true);
    assert.equal(on.showHealth, true);
    assert.equal(on.userHidden, false);

    const off = normalizeProviderPref({ monitor: false, showHealth: true });
    assert.equal(off.monitor, false);
    assert.equal(off.showHealth, false); // forced by coupling
  });
});

describe('mergeConfig', () => {
  it('deep-merges partial provider prefs with health coupled', () => {
    const base = structuredClone(DEFAULT_CONFIG);
    base.providers.claude = {
      monitor: false,
      showHealth: false,
      userHidden: true,
    };
    const merged = mergeConfig(base, {
      providers: {
        claude: { monitor: true },
      },
    });
    assert.equal(merged.providers.claude?.monitor, true);
    assert.equal(merged.providers.claude?.showHealth, true);
    assert.equal(merged.providers.claude?.userHidden, true);
  });
});

describe('setProviderMonitor', () => {
  it('toggles monitor+health together and userHidden', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.providers.claude = {
      monitor: true,
      showHealth: true,
      userHidden: false,
    };
    const off = setProviderMonitor(cfg, 'claude', false);
    assert.equal(off.providers.claude?.monitor, false);
    assert.equal(off.providers.claude?.showHealth, false);
    assert.equal(off.providers.claude?.userHidden, true);

    const on = setProviderMonitor(off, 'claude', true);
    assert.equal(on.providers.claude?.monitor, true);
    assert.equal(on.providers.claude?.showHealth, true);
    assert.equal(on.providers.claude?.userHidden, false);
  });
});

describe('getProviderPref', () => {
  it('returns defaults for missing provider', () => {
    const p = getProviderPref(DEFAULT_CONFIG, 'missing');
    assert.equal(p.monitor, false);
    assert.equal(p.showHealth, false);
  });
});

describe('mergeConfig health/scan clamps', () => {
  it('clamps interval and preserves nested scan fields', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      health: { enabled: true, intervalSeconds: 999, showInMenuBar: false },
      scan: { intervalMinutes: 5, includeBrowserCookies: true },
    });
    assert.equal(merged.health.intervalSeconds, 60);
    assert.equal(merged.health.showInMenuBar, false);
    assert.equal(merged.scan.includeBrowserCookies, true);
    assert.equal(merged.scan.intervalMinutes, 5);
  });

  it('defaults interval when invalid', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      health: { enabled: true, intervalSeconds: Number.NaN, showInMenuBar: true },
    });
    assert.equal(merged.health.intervalSeconds, 30);
  });
});

describe('setProviderMonitor batch semantics', () => {
  it('applies multiple toggles with consistent userHidden + health', () => {
    let cfg = structuredClone(DEFAULT_CONFIG);
    cfg = setProviderMonitor(cfg, 'claude', true);
    cfg = setProviderMonitor(cfg, 'grok', true);
    cfg = setProviderMonitor(cfg, 'cursor', false);
    assert.equal(cfg.providers.claude?.monitor, true);
    assert.equal(cfg.providers.claude?.showHealth, true);
    assert.equal(cfg.providers.claude?.userHidden, false);
    assert.equal(cfg.providers.grok?.monitor, true);
    assert.equal(cfg.providers.cursor?.monitor, false);
    assert.equal(cfg.providers.cursor?.showHealth, false);
    assert.equal(cfg.providers.cursor?.userHidden, true);
  });
});
