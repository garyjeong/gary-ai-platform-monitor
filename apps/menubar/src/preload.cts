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
  setOpenAtLogin: (on: boolean) => ipcRenderer.invoke('set-open-at-login', on),
  setBrowserCookies: (on: boolean) => ipcRenderer.invoke('set-browser-cookies', on),
  getOpenAtLogin: () => ipcRenderer.invoke('get-open-at-login'),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  setWidget: (patch: Record<string, unknown>) => ipcRenderer.invoke('set-widget', patch),
  resizeToContent: (height: number, width?: number) => ipcRenderer.invoke('resize-to-content', height, width),
  showMoreMenu: () => ipcRenderer.invoke('show-more-menu'),
  showWidgetMenu: () => ipcRenderer.invoke('show-widget-menu'),
  widgetDrag: (phase: 'start' | 'move' | 'end' | 'cancel', screenX?: number, screenY?: number) =>
    ipcRenderer.invoke('widget-drag', phase, screenX, screenY),
  getAppearance: () => ipcRenderer.invoke('get-appearance'),
  getResources: () => ipcRenderer.invoke('get-resources'),
  setResources: (patch: Record<string, unknown>) => ipcRenderer.invoke('set-resources', patch),
  onResources: (cb: (r: unknown) => void) => {
    const handler = (_: IpcRendererEvent, r: unknown) => cb(r);
    ipcRenderer.on('resources', handler);
    return () => ipcRenderer.removeListener('resources', handler);
  },
  onAppearance: (cb: (a: unknown) => void) => {
    const handler = (_: IpcRendererEvent, a: unknown) => cb(a);
    ipcRenderer.on('appearance', handler);
    return () => ipcRenderer.removeListener('appearance', handler);
  },
  quit: () => ipcRenderer.invoke('quit'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  onSnapshot: (cb: (snap: unknown) => void) => {
    const handler = (_: IpcRendererEvent, snap: unknown) => cb(snap);
    ipcRenderer.on('snapshot', handler);
    return () => ipcRenderer.removeListener('snapshot', handler);
  },
});
