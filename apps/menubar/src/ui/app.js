/* Popover: monitored platforms only (one toggle covers usage + status). */
(function () {
  'use strict';
  const UI = window.GaiUI;
  const $ = (s) => document.querySelector(s);
  let lastSnap = null;
  let lastRes = null;
  let reapplyHover = () => undefined;

  function render(snap) {
    if (!snap) return;
    lastSnap = snap;
    const now = Date.now();
    const views = UI.monitoredViews(snap, now).sort((a, b) => a.name.localeCompare(b.name));
    $('#state').innerHTML = views.length ? UI.summaryState(views, now) : '<span>켠 플랫폼 없음</span>';
    const blocks = [];
    if (snap.config?.resources?.showInPopover !== false) blocks.push(UI.resourceBlock(lastRes, now));
    blocks.push(...views.map((v) => UI.providerBlock(v, now)));
    if (!views.length) blocks.push('<p class="popover-empty">켠 플랫폼이 없습니다. 설정에서 플랫폼을 켜 주세요.</p>');
    $('#list').innerHTML = blocks.join('');
    reapplyHover();
    const toggle = $('#widget-toggle');
    if (document.activeElement !== toggle) toggle.checked = Boolean(snap.config?.widget?.visible);
    fitWindow();
  }

  /** Size the native window to the content (max 560px; the list scrolls beyond that). */
  function fitWindow() {
    const pop = $('#popover');
    const header = pop.querySelector('.popover-header');
    const footer = pop.querySelector('.popover-footer');
    // The list stretches to fill the window, so measure its children, not the list itself.
    const content = [...$('#list').children].reduce((h, el) => h + el.getBoundingClientRect().height, 0);
    const need = header.offsetHeight + content + footer.offsetHeight + 6;
    void window.gaiPm.resizeToContent(Math.min(560, Math.max(140, need)));
  }

  async function refresh() {
    render(await window.gaiPm.refresh());
  }

  function boot() {
    UI.injectSprite();
    reapplyHover = UI.bindChartHover($('#list'));
    $('#btn-settings').addEventListener('click', () => void window.gaiPm.openSettings());
    $('#btn-more').addEventListener('click', () => void window.gaiPm.showMoreMenu());
    $('#widget-toggle').addEventListener('change', async (e) => {
      render(await window.gaiPm.setWidget({ visible: e.target.checked }));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') void window.gaiPm.hideWindow();
      else if (e.metaKey && e.key === 'r') {
        e.preventDefault();
        void refresh();
      } else if (e.metaKey && e.key === ',') {
        e.preventDefault();
        void window.gaiPm.openSettings();
      } else if (e.metaKey && e.key === 'q') {
        e.preventDefault();
        void window.gaiPm.quit();
      }
    });
    window.gaiPm.onAppearance(applyAppearance);
    window.gaiPm.onSnapshot(render);
    window.gaiPm.onResources((res) => {
      lastRes = res;
      if (lastSnap && document.visibilityState === 'visible') render(lastSnap);
    });
    window.gaiPm.getResources().then((res) => {
      lastRes = res;
    });
    // Countdowns and "n분 전" age locally; this never triggers a fetch.
    setInterval(() => {
      if (lastSnap && document.visibilityState === 'visible') render(lastSnap);
    }, 30_000);
    window.gaiPm.getAppearance().then(applyAppearance);
    window.gaiPm.getSnapshot().then(render);
  }

  function applyAppearance(a) {
    if (a?.accent) document.documentElement.style.setProperty('--accent', a.accent);
  }

  boot();
})();
