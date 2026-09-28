/**
 * Desktop widget: a non-activating panel on the wallpaper, behind every app window.
 * Joins every Space, snaps to screen edges and remembers its place per display.
 */

import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { AppConfig, WidgetPosition } from '@gary-ai-platform-monitor/core';

/**
 * One above kCGDesktopIconWindowLevel: over the wallpaper and Finder's desktop icons (so it
 * still takes clicks), under every app window. Electron adds this to NSNormalWindowLevel (0).
 */
const DESKTOP_LEVEL = -2147483603 + 1;
/** Distance at which a dragged widget snaps to a screen edge. */
const SNAP_PX = 24;
/** Gap kept between a snapped widget and the screen edge. */
const MARGIN_PX = 12;
/** When the widget grows, keep an edge fixed if it sits this close to the screen edge. */
const EDGE_KEEP_PX = 40;
const MIN_VISIBLE_PX = 40;

export interface WidgetHost {
  getConfig(): AppConfig;
  savePosition(position: WidgetPosition): void;
  webPreferences(): Electron.WebPreferences;
  htmlPath: string;
  /** Called after the widget is shown or closed. */
  onVisibilityChange?: () => void;
}

export class WidgetWindow {
  private win: BrowserWindow | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private placed = false;
  private drag: { cursorX: number; cursorY: number; winX: number; winY: number } | null = null;

  constructor(private readonly host: WidgetHost) {
    const recheck = () => this.ensureOnScreen();
    screen.on('display-removed', recheck);
    screen.on('display-added', recheck);
    screen.on('display-metrics-changed', recheck);
  }

  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** Create, update or close the window to match config.widget. */
  sync(): void {
    const wc = this.host.getConfig().widget;
    if (!wc.visible) {
      if (this.window) {
        this.window.close();
        this.win = null;
        this.host.onVisibilityChange?.();
      }
      return;
    }
    if (!this.window) this.create();
    else this.applyFlags();
  }

  /** Renderer reports its content size; grow/shrink while keeping snapped edges in place. */
  resizeTo(width: number, height: number): void {
    const w = this.window;
    if (!w) return;
    const nw = Math.round(Math.min(640, Math.max(120, width)));
    const nh = Math.round(Math.min(720, Math.max(36, height)));
    const b = w.getBounds();
    if (b.width === nw && b.height === nh) return;
    const wa = screen.getDisplayMatching(b).workArea;
    const keepRight = Math.abs(b.x + b.width - (wa.x + wa.width)) <= EDGE_KEEP_PX;
    const keepBottom = Math.abs(b.y + b.height - (wa.y + wa.height)) <= EDGE_KEEP_PX;
    w.setBounds({
      x: keepRight ? b.x + b.width - nw : b.x,
      y: keepBottom ? b.y + b.height - nh : b.y,
      width: nw,
      height: nh,
    });
    if (!this.placed) {
      this.place();
      this.placed = true;
      w.showInactive();
      this.host.onVisibilityChange?.();
    }
  }

  /** Drag from anywhere in the widget, driven by the renderer's pointer events. */
  /** screenX/screenY come from the renderer's pointer events (global DIP coordinates). */
  dragStart(screenX: number, screenY: number): void {
    const w = this.window;
    if (!w) return;
    const [winX = 0, winY = 0] = w.getPosition();
    this.drag = { cursorX: screenX, cursorY: screenY, winX, winY };
  }

  dragMove(screenX: number, screenY: number): void {
    const w = this.window;
    if (!w || !this.drag) return;
    w.setPosition(
      Math.round(this.drag.winX + screenX - this.drag.cursorX),
      Math.round(this.drag.winY + screenY - this.drag.cursorY),
      false
    );
  }

  dragEnd(moved: boolean): void {
    const was = this.drag;
    this.drag = null;
    if (was && moved) this.onMoved();
  }

  /** After display changes or wake: bring a lost widget back to the primary display. */
  ensureOnScreen(): void {
    const w = this.window;
    if (!w) return;
    const b = w.getBounds();
    const visible = screen.getAllDisplays().some((d) => overlap(d.workArea, b) >= MIN_VISIBLE_PX);
    if (!visible) this.placeDefault();
  }

  private create(): void {
    const w = new BrowserWindow({
      type: 'panel',
      width: 220,
      height: 120,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      roundedCorners: true,
      acceptFirstMouse: true,
      hiddenInMissionControl: true,
      vibrancy: 'popover',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
      title: 'AI 사용량 위젯',
      webPreferences: this.host.webPreferences(),
    });
    this.win = w;
    this.placed = false;
    w.setAlwaysOnTop(true, 'normal', DESKTOP_LEVEL);
    w.setVisibleOnAllWorkspaces(true, { skipTransformProcessType: true });
    this.applyFlags();
    w.loadFile(this.host.htmlPath);
    // Fallback if the renderer never reports a size.
    setTimeout(() => {
      if (this.window === w && !this.placed) {
        this.place();
        this.placed = true;
        w.showInactive();
        this.host.onVisibilityChange?.();
      }
    }, 1500);
    w.on('moved', () => this.onMoved());
    w.on('closed', () => {
      if (this.win === w) this.win = null;
    });
  }

  private applyFlags(): void {
    const w = this.window;
    if (!w) return;
    const wc = this.host.getConfig().widget;
    w.setContentProtection(wc.hideInScreenShare);
    w.setOpacity(wc.opacity / 100);
  }

  private place(): void {
    const w = this.window;
    if (!w) return;
    const pos = this.host.getConfig().widget.position;
    if (pos) {
      const display = screen.getAllDisplays().find((d) => d.id === pos.displayId);
      const [width = 0, height = 0] = w.getSize();
      const rect = { x: pos.x, y: pos.y, width, height };
      if (display && overlap(display.workArea, rect) >= MIN_VISIBLE_PX) {
        w.setPosition(pos.x, pos.y, false);
        return;
      }
    }
    this.placeDefault();
  }

  /** Top-right of the primary display, under the menu bar. */
  private placeDefault(): void {
    const w = this.window;
    if (!w) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const [width = 0] = w.getSize();
    w.setPosition(wa.x + wa.width - width - MARGIN_PX, wa.y + MARGIN_PX, false);
  }

  private onMoved(): void {
    const w = this.window;
    if (!w || this.drag) return; // snapping mid-drag would fight the cursor
    const b = w.getBounds();
    const display = screen.getDisplayMatching(b);
    const wa = display.workArea;
    let { x, y } = b;
    if (Math.abs(x - wa.x) <= SNAP_PX) x = wa.x + MARGIN_PX;
    if (Math.abs(x + b.width - (wa.x + wa.width)) <= SNAP_PX) x = wa.x + wa.width - b.width - MARGIN_PX;
    if (Math.abs(y - wa.y) <= SNAP_PX) y = wa.y + MARGIN_PX;
    if (Math.abs(y + b.height - (wa.y + wa.height)) <= SNAP_PX) y = wa.y + wa.height - b.height - MARGIN_PX;
    if (x !== b.x || y !== b.y) w.setPosition(x, y, true);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.host.savePosition({ displayId: display.id, x, y });
    }, 400);
  }
}

function overlap(a: Rectangle, b: Rectangle): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.min(w, h) : 0;
}
