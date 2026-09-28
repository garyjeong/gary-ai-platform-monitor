/**
 * Preload (CommonJS, sandboxed). Exposes a narrow API; every call is re-validated in main.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('gaiPm', {
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  refresh: () => ipcRenderer.invoke('refresh'),
  setMonitor: (id: string, on: boolean) => ipcRenderer.invoke('set-monitor', id, on),
  setMonitors: (updates: Array<{ providerId: string; monitor: boolean }>) =>
    ipcRenderer.invoke('set-monitors', updates),
  setHealthInterval: (seconds: number) => ipcRenderer.invoke('set-health-interval', seconds),
  setOpenAtLogin: (on: boolean) => ipcRenderer.invoke('set-open-at-login', on),
  setBrowserCookies: (on: boolean) => ipcRenderer.invoke('set-browser-cookies', on),
  getOpenAtLogin: () => ipcRenderer.invoke('get-open-at-login'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  quit: () => ipcRenderer.invoke('quit'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onSnapshot: (cb: (snap: unknown) => void) => {
    const handler = (_: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on('snapshot', handler);
    return () => ipcRenderer.removeListener('snapshot', handler);
  },
});
