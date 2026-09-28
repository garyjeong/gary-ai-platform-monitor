/* Desktop widget: one size — this Mac's resources, then pinned platforms. */
(function () {
  'use strict';
  const UI = window.GaiUI;
  const $ = (s) => document.querySelector(s);
  let lastSnap = null;
  let lastRes = null;

  function render() {
    if (!lastSnap) return;
    const now = Date.now();
    const views = UI.pinnedViews(lastSnap, now);
    const rows = [];
    // This Mac first, then the pinned platforms.
    if (lastSnap.config?.resources?.showInWidget !== false) {
      rows.push(UI.resourceCompactRows(lastRes));
      if (views.length) rows.push('<div class="wc-sep" aria-hidden="true"></div>');
    }
    rows.push(...views.map((v) => UI.compactRow(v, now)));
    $('#grid').innerHTML = rows.length ? rows.join('') : '<p class="widget-empty">설정에서 표시할 항목을 고르세요.</p>';
    const r = $('#widget').getBoundingClientRect();
    void window.gaiPm.resizeToContent(Math.ceil(r.height), Math.ceil(r.width));
  }

  /** Drag from anywhere: main moves the window by the pointer's screen delta (keeps right-click working). */
  function bindDrag(el) {
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.screenX, y: e.screenY, moved: false };
      el.setPointerCapture(e.pointerId);
      void window.gaiPm.widgetDrag('start', e.screenX, e.screenY);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.screenX - drag.x, e.screenY - drag.y) < 3) return;
      drag.moved = true;
      el.classList.add('is-dragging');
      void window.gaiPm.widgetDrag('move', e.screenX, e.screenY);
    });
    const finish = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (el.hasPointerCapture(drag.id)) el.releasePointerCapture(drag.id);
      void window.gaiPm.widgetDrag(drag.moved ? 'end' : 'cancel');
      el.classList.remove('is-dragging');
      drag = null;
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  function boot() {
    UI.injectSprite();
    bindDrag($('#widget'));
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      void window.gaiPm.showWidgetMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        void window.gaiPm.openSettings();
      }
    });
    const accent = (a) => a?.accent && document.documentElement.style.setProperty('--accent', a.accent);
    window.gaiPm.onAppearance(accent);
    window.gaiPm.getAppearance().then(accent);
    window.gaiPm.onSnapshot((snap) => {
      lastSnap = snap;
      render();
    });
    window.gaiPm.onResources((res) => {
      lastRes = res;
      render();
    });
    // Countdowns tick locally every 30s; data arrives only when the app publishes it.
    setInterval(render, 30_000);
    Promise.all([window.gaiPm.getSnapshot(), window.gaiPm.getResources()]).then(([snap, res]) => {
      lastSnap = snap;
      lastRes = res;
      render();
    });
  }

  boot();
})();
