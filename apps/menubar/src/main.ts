/**
 * Electron main — tray (icon only) + status popover + separate Settings.
 *
 * - All fetching runs in a utility process (collector-host.ts). Main never blocks on
 *   Keychain / file / network work and restarts the collector if it dies.
 * - Main is the only writer of config.json (atomic writes via core.updateConfig).
 * - No aggregate "AI n%" tray title. No outage notifications.
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  session,
  shell,
  Tray,
  utilityProcess,
  type IpcMainInvokeEvent,
  type NativeImage,
  type UtilityProcess,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  HEALTH_INTERVAL_MAX,
  HEALTH_INTERVAL_MIN,
  loadConfigWithStatus,
  setProviderMonitor,
  updateConfig,
  type AppConfig,
  type FullSnapshot,
  type ProviderPreference,
} from '@gary-ai-platform-monitor/core';
import type { FromCollector, RefreshRequest, ToCollector } from './collector-protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const UI_URL_PREFIX = pathToFileURL(UI_DIR).href + '/';

/** Popover open → refresh only streams older than this. */
const OPEN_REFRESH_STALE_MS = 60_000;
const REFRESH_WAIT_MS = 30_000;

let tray: Tray | null = null;
let statusWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;

let config: AppConfig;
let latest: FullSnapshot | null = null;
let firstSnapshotWaiters: Array<(snap: FullSnapshot | null) => void> = [];

let collector: UtilityProcess | null = null;
let collectorRestarts = 0;
let quitting = false;
let refreshSeq = 0;
const pendingRefresh = new Map<number, (snap: FullSnapshot | null) => void>();

// ── single instance ──────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => toggleStatusWindow());
  app.whenReady().then(onReady).catch((err) => {
    console.error('[gai-pm] startup failed', err);
  });
}

app.on('window-all-closed', () => {
  /* tray app: keep running */
});

app.on('before-quit', () => {
  quitting = true;
  collector?.kill();
});

// Logout, `kill`, launchd stop: go through the normal quit path so the collector is stopped.
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => app.quit());
}

// ── security: no navigation, no new windows, no permissions ─────────

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(UI_URL_PREFIX);
}

function handle<A extends unknown[], R>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error(`untrusted IPC sender for ${channel}`);
    return fn(event, ...(args as A));
  });
}

// ── collector (utility process) ──────────────────────────────────────

function send(msg: ToCollector): void {
  collector?.postMessage(msg);
}

function startCollector(): void {
  const child = utilityProcess.fork(path.join(__dirname, 'collector-host.js'), [], {
    serviceName: 'AI Platform Monitor Collector',
    stdio: 'inherit',
  });
  collector = child;

  child.on('spawn', () => {
    send({ type: 'init', config });
  });

  child.on('message', (msg: FromCollector) => {
    switch (msg.type) {
      case 'snapshot':
        collectorRestarts = 0;
        onSnapshot(msg.snapshot);
        break;
      case 'refreshed':
        onSnapshot(msg.snapshot);
        pendingRefresh.get(msg.id)?.(msg.snapshot);
        pendingRefresh.delete(msg.id);
        break;
      case 'config-proposal':
        applySeed(msg.patch);
        break;
      case 'log':
        console.error('[gai-pm collector]', msg.message);
        break;
    }
  });

  child.on('exit', (code) => {
    if (collector === child) collector = null;
    for (const resolve of pendingRefresh.values()) resolve(latest);
    pendingRefresh.clear();
    if (quitting) return;
    const delay = Math.min(60_000, 1_000 * 2 ** collectorRestarts);
    collectorRestarts += 1;
    console.error(`[gai-pm] collector exited (${code}); restarting in ${delay}ms`);
    setTimeout(startCollector, delay);
  });
}

function requestRefresh(opts: Omit<RefreshRequest, 'id'> = {}): Promise<FullSnapshot | null> {
  if (!collector) return Promise.resolve(latest);
  const id = ++refreshSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRefresh.delete(id);
      resolve(latest);
    }, REFRESH_WAIT_MS);
    pendingRefresh.set(id, (snap) => {
      clearTimeout(timer);
      resolve(snap);
    });
    send({ type: 'refresh', request: { id, ...opts } });
  });
}

function onSnapshot(snap: FullSnapshot): void {
  latest = snap;
  updateTrayChrome(snap);
  broadcast(snap);
  const waiters = firstSnapshotWaiters;
  firstSnapshotWaiters = [];
  for (const w of waiters) w(snap);
}

function waitForSnapshot(timeoutMs = 15_000): Promise<FullSnapshot | null> {
  if (latest) return Promise.resolve(latest);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(latest), timeoutMs);
    firstSnapshotWaiters.push((snap) => {
      clearTimeout(timer);
      resolve(snap);
    });
  });
}

// ── config (single writer) ───────────────────────────────────────────

function writeConfig(mutate: (cfg: AppConfig) => AppConfig): AppConfig {
  try {
    config = updateConfig(mutate);
  } catch (err) {
    // Keep running with the in-memory change; the next write retries.
    console.error('[gai-pm] config write failed', err);
    config = mutate(config);
  }
  send({ type: 'config', config });
  return config;
}

function applySeed(patch: Record<string, ProviderPreference>): void {
  writeConfig((cfg) => {
    const providers = { ...cfg.providers };
    for (const [id, pref] of Object.entries(patch)) {
      if (!providers[id]) providers[id] = pref;
    }
    return { ...cfg, providers };
  });
}

function knownProviderIds(): Set<string> {
  return new Set((latest?.providers ?? []).map((p) => p.meta.id));
}

function allowedExternalHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const p of latest?.providers ?? []) {
    const url = p.meta.status?.pageUrl;
    if (!url) continue;
    try {
      hosts.add(new URL(url).host);
    } catch {
      // ignore malformed metadata
    }
  }
  return hosts;
}

// ── windows ──────────────────────────────────────────────────────────

function sharedWebPrefs(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
  };
}

function createStatusWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 420,
    height: 580,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1a1b1e',
    webPreferences: sharedWebPrefs(),
  });
  w.loadFile(path.join(UI_DIR, 'index.html'));
  w.on('blur', () => {
    if (!w.webContents.isDevToolsOpened()) w.hide();
  });
  return w;
}

function createSettingsWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    frame: true,
    title: 'AI Platform Monitor — 설정',
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#1a1b1e',
    webPreferences: sharedWebPrefs(),
  });
  w.loadFile(path.join(UI_DIR, 'settings.html'));
  w.on('closed', () => {
    settingsWin = null;
  });
  return w;
}

function positionNearTray(w: BrowserWindow): void {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = w.getBounds();
  // Tray hidden (notch / menu bar manager) → bounds can be zero: use the cursor's display.
  const anchor =
    trayBounds.width > 0
      ? { x: trayBounds.x, y: trayBounds.y }
      : screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(anchor);
  const wa = display.workArea;

  let x =
    trayBounds.width > 0
      ? Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2)
      : wa.x + wa.width - winBounds.width - 8;
  let y = trayBounds.width > 0 ? Math.round(trayBounds.y + trayBounds.height + 4) : wa.y + 8;

  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - winBounds.width - 8);
  if (y + winBounds.height > wa.y + wa.height) {
    y = Math.max(wa.y + 8, trayBounds.y - winBounds.height - 4);
  }
  w.setPosition(x, y, false);
}

function updateTrayChrome(snap: FullSnapshot): void {
  if (!tray) return;
  tray.setTitle('');
  const lines = snap.menuBar.lines ?? [];
  const tip =
    lines.length === 0
      ? 'AI Platform Monitor\n(표시 중인 플랫폼 없음)'
      : [
          'AI Platform Monitor',
          ...lines.map((l) => {
            const pct = typeof l.usedPercent === 'number' ? `${Math.round(l.usedPercent)}%` : '—';
            return `${l.displayName}: ${pct}`;
          }),
        ].join('\n');
  tray.setToolTip(tip);
}

/** Only visible windows get live pushes; a window gets `latest` when shown. */
function broadcast(snap: FullSnapshot): void {
  for (const w of [statusWin, settingsWin]) {
    if (w && !w.isDestroyed() && w.isVisible()) w.webContents.send('snapshot', snap);
  }
}

function toggleStatusWindow(): void {
  if (!statusWin || statusWin.isDestroyed()) statusWin = createStatusWindow();
  if (statusWin.isVisible()) {
    statusWin.hide();
    return;
  }
  positionNearTray(statusWin);
  statusWin.show();
  statusWin.focus();
  if (latest) statusWin.webContents.send('snapshot', latest);
  void requestRefresh({ staleAfterMs: OPEN_REFRESH_STALE_MS });
}

function openSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) settingsWin = createSettingsWindow();
  settingsWin.show();
  settingsWin.focus();
  if (latest) settingsWin.webContents.send('snapshot', latest);
}

// ── IPC ──────────────────────────────────────────────────────────────

function setupIpc(): void {
  handle('get-snapshot', () => waitForSnapshot());

  // Manual refresh: bypasses TTLs, never a server Retry-After or auth backoff.
  handle('refresh', () => requestRefresh({}));

  handle('set-monitor', async (_e, providerId: unknown, monitor: unknown) => {
    const id = String(providerId);
    if (!knownProviderIds().has(id)) throw new Error(`unknown provider: ${id}`);
    writeConfig((cfg) => setProviderMonitor(cfg, id, Boolean(monitor)));
    return monitor ? requestRefresh({ providerId: id }) : waitForSnapshot();
  });

  handle('set-monitors', async (_e, updates: unknown) => {
    const known = knownProviderIds();
    const list = (Array.isArray(updates) ? updates : [])
      .map((u) => ({ providerId: String(u?.providerId), monitor: Boolean(u?.monitor) }))
      .filter((u) => known.has(u.providerId));
    writeConfig((cfg) => list.reduce((acc, u) => setProviderMonitor(acc, u.providerId, u.monitor), cfg));
    return requestRefresh({ staleAfterMs: OPEN_REFRESH_STALE_MS });
  });

  handle('set-health-interval', async (_e, seconds: unknown) => {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n < HEALTH_INTERVAL_MIN || n > HEALTH_INTERVAL_MAX) return latest;
    writeConfig((cfg) => ({ ...cfg, health: { ...cfg.health, intervalSeconds: Math.round(n) } }));
    return waitForSnapshot();
  });

  handle('set-open-at-login', async (_e, open: unknown) => {
    const actual = applyOpenAtLogin(Boolean(open));
    writeConfig((cfg) => ({ ...cfg, openAtLogin: actual }));
    return waitForSnapshot();
  });

  handle('set-browser-cookies', async (_e, on: unknown) => {
    writeConfig((cfg) => ({ ...cfg, scan: { ...cfg.scan, includeBrowserCookies: Boolean(on) } }));
    return waitForSnapshot();
  });

  handle('get-open-at-login', () => readOpenAtLogin());

  handle('open-settings', () => openSettingsWindow());

  handle('hide-window', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.hide();
  });

  handle('quit', () => app.quit());

  handle('open-external', async (_e, raw: unknown) => {
    let url: URL;
    try {
      url = new URL(String(raw));
    } catch {
      return;
    }
    if (url.protocol !== 'https:' || !allowedExternalHosts().has(url.host)) return;
    await shell.openExternal(url.toString());
  });
}

// ── login item (macOS 13+ SMAppService via Electron 44) ──────────────

function readOpenAtLogin(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return config.openAtLogin;
  }
}

/**
 * Register/unregister the SMAppService login item. Returns the requested value:
 * ad-hoc signed builds may not register reliably, and v0.3 left a legacy login item
 * that SMAppService cannot see, so the OS read-back is not trustworthy here.
 */
function applyOpenAtLogin(open: boolean): boolean {
  if (!app.isPackaged) {
    // A dev run would register the bare Electron binary as a login item.
    console.warn('[gai-pm] open-at-login is only applied in the packaged app');
    return open;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: open });
    const status = app.getLoginItemSettings().status;
    if (open && status !== 'enabled') {
      console.warn(`[gai-pm] login item status after register: ${status}`);
    }
  } catch (err) {
    console.error('[gai-pm] setLoginItemSettings failed', err);
  }
  return open;
}

/**
 * Startup reconciliation (packaged only):
 * - enabled            → config on
 * - requires-approval  → the user switched it off in System Settings → config off
 * - not-registered + config on → migrate from the v0.3 legacy login item to SMAppService
 * Never turns the config off just because SMAppService has no record (legacy item may exist).
 */
function reconcileLoginItem(): void {
  if (!app.isPackaged) return;
  let status: string | undefined;
  try {
    status = app.getLoginItemSettings().status;
  } catch {
    return;
  }
  if (status === 'enabled' && !config.openAtLogin) {
    writeConfig((cfg) => ({ ...cfg, openAtLogin: true }));
  } else if (status === 'requires-approval' && config.openAtLogin) {
    writeConfig((cfg) => ({ ...cfg, openAtLogin: false }));
  } else if (status === 'not-registered' && config.openAtLogin) {
    applyOpenAtLogin(true);
  }
}

// ── tray icon ────────────────────────────────────────────────────────

function loadTrayIcon(): NativeImage {
  const TRAY_PT = 20;
  const candidates = [
    path.join(__dirname, 'icons', 'trayTemplate.png'),
    path.join(__dirname, '..', 'build', 'trayTemplate.png'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      let img = nativeImage.createFromPath(p);
      if (img.isEmpty()) continue;
      const size = img.getSize();
      if (size.width !== TRAY_PT || size.height !== TRAY_PT) {
        img = img.resize({ width: TRAY_PT, height: TRAY_PT, quality: 'best' });
      }
      img.setTemplateImage(true);
      return img;
    } catch {
      // next
    }
  }
  const fallback = nativeImage
    .createFromDataURL(TRAY_FALLBACK_PNG)
    .resize({ width: TRAY_PT, height: TRAY_PT, quality: 'best' });
  fallback.setTemplateImage(true);
  return fallback;
}

/** 32×32 template ring + bar (valid PNG; used only if the bundled icon is missing). */
const TRAY_FALLBACK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAcUlEQVR42u2Xyw0AIAhDndP998C7F2L5tCaQcC0vRKCuNfFhmJO0wmUgFkxq8RAEIpgGERUJQ2S0EdbIfEiQVvY4PelZA4ChtN6o7SuhLgzAAMgBtI8hfRFJrGL6MZI4x3RDImHJJEyphC2X+ZhMlMQB/U1TNJBxyd0AAAAASUVORK5CYII=';

// ── startup ──────────────────────────────────────────────────────────

async function onReady(): Promise<void> {
  if (process.platform === 'darwin') app.dock?.hide();

  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));

  const loaded = loadConfigWithStatus();
  config = loaded.config;
  if (loaded.recoveredFrom) {
    console.error(`[gai-pm] unreadable config moved to ${loaded.recoveredFrom}; using defaults`);
  }
  reconcileLoginItem();

  tray = new Tray(loadTrayIcon());
  tray.setIgnoreDoubleClickEvents(true);
  tray.setTitle('');
  tray.setToolTip('AI Platform Monitor');
  tray.on('click', () => toggleStatusWindow());
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: '상태 보기', click: () => toggleStatusWindow() },
      { label: '설정…', click: () => openSettingsWindow() },
      { label: '새로고침', click: () => void requestRefresh({}) },
      { type: 'separator' },
      { label: 'AI Platform Monitor 종료', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });

  setupIpc();
  startCollector();

  powerMonitor.on('suspend', () => send({ type: 'pause' }));
  powerMonitor.on('lock-screen', () => send({ type: 'pause' }));
  powerMonitor.on('resume', () => send({ type: 'resume' }));
  powerMonitor.on('unlock-screen', () => send({ type: 'resume' }));

  statusWin = createStatusWindow();
}
