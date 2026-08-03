/**
 * Electron main process — menu bar tray + popover window.
 * No outage notifications (product decision).
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
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  takeSnapshot,
  updateHealthInterval,
  updateMonitor,
  updateOpenAtLogin,
  updateShowHealth,
  type FullSnapshot,
} from '@gary-ai-platform-monitor/runtime';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let latest: FullSnapshot | null = null;
let refreshing = false;

const isMac = process.platform === 'darwin';

function uiPath(...parts: string[]): string {
  return path.join(__dirname, 'ui', ...parts);
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#1a1b1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  w.loadFile(uiPath('index.html'));
  w.on('blur', () => {
    if (w && !w.webContents.isDevToolsOpened()) w.hide();
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

  // Keep on screen
  const wa = display.workArea;
  x = Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - winBounds.width - 8);
  if (y + winBounds.height > wa.y + wa.height) {
    y = Math.max(wa.y + 8, trayBounds.y - winBounds.height - 4);
  }
  w.setPosition(x, y, false);
}

function setTrayTitle(title: string): void {
  if (!tray) return;
  if (isMac) {
    tray.setTitle(title);
    tray.setToolTip(`AI Platform Monitor — ${title}`);
  } else {
    tray.setToolTip(title);
  }
}

async function refresh(reason = 'poll'): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    latest = await takeSnapshot();
    setTrayTitle(latest.menuBar.title);
    win?.webContents.send('snapshot', latest);
    schedulePoll();
  } catch (err) {
    console.error(`[gai-pm] refresh failed (${reason})`, err);
  } finally {
    refreshing = false;
  }
}

function schedulePoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  const cfg = latest?.config ?? loadConfig();
  // Health wants ~30s; usage can share the same loop (adapters cache Claude 60s)
  const ms = Math.max(10, cfg.health.intervalSeconds) * 1000;
  pollTimer = setInterval(() => {
    void refresh('interval');
  }, ms);
}

function toggleWindow(): void {
  if (!win) win = createWindow();
  if (win.isVisible()) {
    win.hide();
    return;
  }
  positionNearTray(win);
  win.show();
  win.focus();
  if (latest) win.webContents.send('snapshot', latest);
  void refresh('open');
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
      updateMonitor(providerId, monitor);
      await refresh('set-monitor');
      return latest;
    }
  );

  ipcMain.handle(
    'set-show-health',
    async (_e, providerId: string, show: boolean) => {
      updateShowHealth(providerId, show);
      await refresh('set-show-health');
      return latest;
    }
  );

  ipcMain.handle('set-health-interval', async (_e, seconds: number) => {
    updateHealthInterval(seconds);
    await refresh('set-interval');
    return latest;
  });

  ipcMain.handle('set-open-at-login', async (_e, open: boolean) => {
    applyOpenAtLogin(Boolean(open));
    updateOpenAtLogin(Boolean(open));
    await refresh('set-open-at-login');
    return latest;
  });

  ipcMain.handle('get-open-at-login', () => {
    return app.getLoginItemSettings().openAtLogin;
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

app.whenReady().then(async () => {
  if (isMac) {
    app.dock?.hide();
  }

  // Sync login item with saved config (and OS state)
  const cfg = loadConfig();
  applyOpenAtLogin(cfg.openAtLogin);

  // Empty 16x16 template-ish icon; title carries the data on macOS
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(DOT_PNG) : icon);
  tray.setIgnoreDoubleClickEvents(true);
  tray.on('click', () => toggleWindow());
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open', click: () => toggleWindow() },
      { label: 'Refresh', click: () => void refresh('menu') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
  });

  setupIpc();
  win = createWindow();
  await refresh('startup');
});

// Keep running as a tray app even if all windows are closed.
app.on('window-all-closed', () => {
  /* no-op on purpose */
});

/** 1x1 dark pixel as fallback tray image */
const DOT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVQoz2NgGAWjYBSMglEwCkbBKBgFo4AaAACX8gEBqJ3xUwAAAABJRU5ErkJggg==';
