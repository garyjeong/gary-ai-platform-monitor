/**
 * Electron main — tray (icon only) + status dashboard + separate Settings.
 * No aggregate "AI n%" tray title. No outage notifications.
 */

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NativeImage } from 'electron';
import {
  loadConfig,
  takeSnapshot,
  updateHealthInterval,
  updateMonitor,
  updateMonitors,
  updateIncludeBrowserCookies,
  updateOpenAtLogin,
  updateShowHealth,
  type FullSnapshot,
} from '@gary-ai-platform-monitor/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let statusWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let latest: FullSnapshot | null = null;

/** Refresh mutex + queue so settings toggles never drop updates */
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;
let refreshQueuedReason = 'queued';

const isMac = process.platform === 'darwin';

function uiPath(...parts: string[]): string {
  return path.join(__dirname, 'ui', ...parts);
}

function sharedWebPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
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

  w.loadFile(uiPath('index.html'));
  w.on('blur', () => {
    if (w && !w.webContents.isDevToolsOpened()) w.hide();
  });
  return w;
}

function createSettingsWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    frame: true,
    title: 'AI Platform Monitor — Settings',
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: false,
    backgroundColor: '#1a1b1e',
    webPreferences: sharedWebPrefs(),
  });

  w.loadFile(uiPath('settings.html'));
  w.on('closed', () => {
    settingsWin = null;
  });
  return w;
}

function positionNearTray(w: BrowserWindow): void {
  if (!tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = w.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  });

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  let y = Math.round(trayBounds.y + trayBounds.height + 4);

  const wa = display.workArea;
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
      ? 'AI Platform Monitor\n(no platforms monitored)'
      : [
          'AI Platform Monitor',
          ...lines.map((l) => {
            const pct =
              typeof l.usedPercent === 'number'
                ? `${Math.round(l.usedPercent)}%`
                : '—';
            return `${l.displayName}: ${pct}`;
          }),
        ].join('\n');
  tray.setToolTip(tip);
}

function broadcast(snap: FullSnapshot): void {
  if (statusWin && !statusWin.isDestroyed()) {
    statusWin.webContents.send('snapshot', snap);
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('snapshot', snap);
  }
}

/**
 * Coalescing refresh: concurrent callers wait for one run, then at most one follow-up.
 * Settings toggles always get a fresh snapshot after their config write.
 */
async function refresh(reason = 'poll'): Promise<FullSnapshot | null> {
  if (refreshInFlight) {
    refreshQueued = true;
    refreshQueuedReason = reason;
    await refreshInFlight;
    return latest;
  }

  refreshInFlight = (async () => {
    try {
      do {
        refreshQueued = false;
        const why = refreshQueuedReason;
        try {
          latest = await takeSnapshot();
          updateTrayChrome(latest);
          broadcast(latest);
          schedulePoll();
        } catch (err) {
          console.error(`[gai-pm] refresh failed (${why})`, err);
        }
      } while (refreshQueued);
    } finally {
      refreshInFlight = null;
    }
  })();

  await refreshInFlight;
  return latest;
}

function schedulePoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  const cfg = latest?.config ?? loadConfig();
  const ms = Math.max(10, cfg.health.intervalSeconds) * 1000;
  pollTimer = setInterval(() => {
    void refresh('interval');
  }, ms);
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
  void refresh('open');
}

function openSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) {
    settingsWin = createSettingsWindow();
  }
  if (latest) settingsWin.webContents.send('snapshot', latest);
  settingsWin.show();
  settingsWin.focus();
  void refresh('settings');
}

function setupIpc(): void {
  ipcMain.handle('get-snapshot', async () => {
    if (!latest) await refresh('ipc');
    return latest;
  });

  ipcMain.handle('refresh', async () => {
    await refresh('manual');
    return latest;
  });

  ipcMain.handle(
    'set-monitor',
    async (_e, providerId: string, monitor: boolean) => {
      updateMonitor(String(providerId), Boolean(monitor));
      await refresh('set-monitor');
      return latest;
    }
  );

  ipcMain.handle(
    'set-monitors',
    async (
      _e,
      updates: Array<{ providerId: string; monitor: boolean }>
    ) => {
      const list = Array.isArray(updates) ? updates : [];
      updateMonitors(
        list.map((u) => ({
          providerId: String(u.providerId),
          monitor: Boolean(u.monitor),
        }))
      );
      await refresh('set-monitors');
      return latest;
    }
  );

  ipcMain.handle(
    'set-show-health',
    async (_e, providerId: string, show: boolean) => {
      updateShowHealth(String(providerId), Boolean(show));
      await refresh('set-show-health');
      return latest;
    }
  );

  ipcMain.handle('set-health-interval', async (_e, seconds: number) => {
    const n = Number(seconds);
    if (!Number.isFinite(n)) return latest;
    updateHealthInterval(n);
    await refresh('set-interval');
    return latest;
  });

  ipcMain.handle('set-open-at-login', async (_e, open: boolean) => {
    applyOpenAtLogin(Boolean(open));
    updateOpenAtLogin(Boolean(open));
    await refresh('set-open-at-login');
    return latest;
  });

  ipcMain.handle('set-browser-cookies', async (_e, on: boolean) => {
    updateIncludeBrowserCookies(Boolean(on));
    await refresh('set-browser-cookies');
    return latest;
  });

  ipcMain.handle('get-open-at-login', () => {
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('open-settings', () => {
    openSettingsWindow();
  });

  ipcMain.handle('quit', () => {
    app.quit();
  });

  ipcMain.handle('open-external', async (_e, url: string) => {
    const { shell } = await import('electron');
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      await shell.openExternal(url);
    }
  });
}

function applyOpenAtLogin(open: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: open,
      openAsHidden: true,
      path: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    });
  } catch (err) {
    console.error('[gai-pm] setLoginItemSettings failed', err);
  }
}

function loadTrayIcon(): NativeImage {
  const TRAY_PT = 20;
  const baseCandidates = [
    path.join(__dirname, 'icons', 'trayTemplate.png'),
    path.join(__dirname, '..', 'build', 'trayTemplate.png'),
  ];

  for (const p of baseCandidates) {
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
  const fallback = nativeImage.createFromDataURL(TRAY_FALLBACK_PNG);
  const fb = fallback.resize({ width: TRAY_PT, height: TRAY_PT, quality: 'best' });
  fb.setTemplateImage(true);
  return fb;
}

const TRAY_FALLBACK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAzUlEQVRYR+2WQQ6AIAwF6f0v3b0YN8bQQss2GmLiwjS0/2cKAuA/VwAvwAvgv8A9sHbP7Q0wA9YAGxADsQEbEAOxARsQA7EBGxADsQEbEAOxARsQA7EBGxADsQEbEAOxARsQA7EBGxADsQEbkP0C9sDWPXc3wA5YAxtgB2LABmwgBmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmLABmzABmL4AHxJ/QHkX3sMAAAAAElFTkSuQmCC';

app.whenReady().then(async () => {
  if (isMac) {
    app.dock?.hide();
  }

  const cfg = loadConfig();
  applyOpenAtLogin(cfg.openAtLogin);

  tray = new Tray(loadTrayIcon());
  tray.setIgnoreDoubleClickEvents(true);
  tray.setTitle('');
  tray.on('click', () => toggleStatusWindow());
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show Status', click: () => toggleStatusWindow() },
      { label: 'Settings…', click: () => openSettingsWindow() },
      { label: 'Refresh', click: () => void refresh('menu') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });

  setupIpc();
  statusWin = createStatusWindow();
  await refresh('startup');
});

app.on('window-all-closed', () => {
  /* tray app */
});
