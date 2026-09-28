/* Settings window. Rows are kept by id and patched in place so focus survives live updates. */
(function () {
  'use strict';
  const UI = window.GaiUI;
  const $ = (s) => document.querySelector(s);
  const MAX_PINNED = 3;
  let lastSnap = null;
  let rowsKey = '';

  const DETECT_TEXT = {
    claude: 'Claude Code 로그인 확인됨',
    codex: 'Codex CLI 로그인 확인됨',
    gemini: 'Gemini CLI 로그인 확인됨',
    grok: 'Grok CLI 기록 확인됨 · 사용률(%)은 쿠키 필요',
    openrouter: 'API 키 확인됨',
    cursor: 'Cursor 설치 확인됨 · 사용량은 쿠키 필요',
    copilot: 'GitHub CLI 로그인 확인됨',
    ollama: '로컬 서버 확인됨 · 사용 한도 없음',
    opencode: 'OpenCode 설치 확인됨',
  };

  function setChecked(el, value) {
    if (el && document.activeElement !== el) el.checked = Boolean(value);
  }

  function describe(p, view) {
    if (!p.detect?.found) return '이 Mac 에서 찾지 못함';
    if (view.status === 'auth') return '로그인 만료 · 다시 로그인 필요';
    return DETECT_TEXT[p.meta.id] || '설치 확인됨';
  }

  function renderPlatforms(snap, now) {
    const providers = [...snap.providers].sort((a, b) => {
      const af = a.detect?.found ? 0 : 1;
      const bf = b.detect?.found ? 0 : 1;
      return af - bf || a.meta.displayName.localeCompare(b.meta.displayName);
    });
    const root = $('#platform-rows');
    const key = providers.map((p) => p.meta.id).join(',');
    if (key !== rowsKey) {
      rowsKey = key;
      root.innerHTML = providers
        .map(
          (p) =>
            `<div class="grow" data-row="${UI.esc(p.meta.id)}"><div class="grow__text"><label class="grow__label" for="plat-${UI.esc(p.meta.id)}">${UI.esc(p.meta.displayName)}</label><p class="grow__desc"></p></div>`
            + `<span data-chip></span><input id="plat-${UI.esc(p.meta.id)}" type="checkbox" role="switch" class="switch" data-plat="${UI.esc(p.meta.id)}"></div>`
        )
        .join('');
    }
    for (const p of providers) {
      const row = root.querySelector(`[data-row="${CSS.escape(p.meta.id)}"]`);
      if (!row) continue;
      const on = UI.isOn(snap, p.meta.id);
      const view = UI.providerView(p, now);
      row.classList.toggle('is-off', !on);
      row.querySelector('.grow__desc').textContent = describe(p, view);
      row.querySelector('[data-chip]').innerHTML = UI.chipFor(view, on, now);
      setChecked(row.querySelector('[data-plat]'), on);
    }
  }

  function renderWidget(snap) {
    const w = snap.config.widget || {};
    setChecked($('#set-widget'), w.visible);
    const opacity = $('#set-opacity');
    if (document.activeElement !== opacity) opacity.value = String(w.opacity ?? 90);
    $('#opacity-out').textContent = `불투명 ${opacity.value}%`;
    setChecked($('#set-fullscreen'), w.overFullScreen);
    setChecked($('#set-share'), w.hideInScreenShare);

    const on = snap.providers.filter((p) => UI.isOn(snap, p.meta.id));
    const pinned = effectivePins(snap);
    const full = pinned.length >= MAX_PINNED;
    $('#pin-chips').innerHTML = on.length
      ? on
          .map((p) => {
            const pressed = pinned.includes(p.meta.id);
            return `<button type="button" class="pin-chip" data-pin="${UI.esc(p.meta.id)}" aria-pressed="${pressed}"${!pressed && full ? ' disabled' : ''}>${pressed ? UI.icon('check') : ''}${UI.esc(p.meta.displayName)}</button>`;
          })
          .join('')
      : '<span class="grow__desc">켠 플랫폼이 없습니다</span>';
    $('#pin-count').textContent = `${pinned.length}/${MAX_PINNED} 선택`;
  }

  /** Empty pin list means "first 3 monitored" — show that as the current selection. */
  function effectivePins(snap) {
    const on = snap.providers.filter((p) => UI.isOn(snap, p.meta.id)).map((p) => p.meta.id);
    const pinned = (snap.config.widget?.pinned || []).filter((id) => on.includes(id));
    return pinned.length ? pinned : on.slice(0, MAX_PINNED);
  }

  function render(snap) {
    if (!snap) return;
    lastSnap = snap;
    const now = Date.now();
    setChecked($('#set-login'), snap.config.openAtLogin);
    setChecked($('#set-cookies'), snap.config.scan?.includeBrowserCookies);
    setChecked($('#set-res-popover'), snap.config.resources?.showInPopover !== false);
    setChecked($('#set-res-widget'), snap.config.resources?.showInWidget !== false);
    renderPlatforms(snap, now);
    renderWidget(snap);
  }

  async function act(promise) {
    try {
      render(await promise);
      $('#settings-error').hidden = true;
    } catch (err) {
      const el = $('#settings-error');
      el.textContent = `저장하지 못했습니다: ${err?.message || err}`;
      el.hidden = false;
      if (lastSnap) render(lastSnap);
    }
  }

  function boot() {
    UI.injectSprite();
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.plat) void act(window.gaiPm.setMonitor(t.dataset.plat, t.checked));
      else if (t.id === 'set-login') void act(window.gaiPm.setOpenAtLogin(t.checked));
      else if (t.id === 'set-cookies') void act(window.gaiPm.setBrowserCookies(t.checked));
      else if (t.id === 'set-widget') void act(window.gaiPm.setWidget({ visible: t.checked }));
      else if (t.id === 'set-res-popover') void act(window.gaiPm.setResources({ showInPopover: t.checked }));
      else if (t.id === 'set-res-widget') void act(window.gaiPm.setResources({ showInWidget: t.checked }));
      else if (t.id === 'set-fullscreen') void act(window.gaiPm.setWidget({ overFullScreen: t.checked }));
      else if (t.id === 'set-share') void act(window.gaiPm.setWidget({ hideInScreenShare: t.checked }));
      else if (t.id === 'set-opacity') void act(window.gaiPm.setWidget({ opacity: Number(t.value) }));
    });
    $('#set-opacity').addEventListener('input', (e) => {
      $('#opacity-out').textContent = `불투명 ${e.target.value}%`;
    });
    $('#pin-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pin]');
      if (!b || !lastSnap) return;
      const id = b.dataset.pin;
      const pins = effectivePins(lastSnap);
      const next = pins.includes(id) ? pins.filter((x) => x !== id) : [...pins, id].slice(0, MAX_PINNED);
      void act(window.gaiPm.setWidget({ pinned: next }));
    });
    document.addEventListener('keydown', (e) => {
      if (e.metaKey && e.key === 'w') {
        e.preventDefault();
        void window.gaiPm.hideWindow();
      }
    });
    window.gaiPm.onAppearance((a) => a?.accent && document.documentElement.style.setProperty('--accent', a.accent));
    window.gaiPm.getAppearance().then((a) => a?.accent && document.documentElement.style.setProperty('--accent', a.accent));
    window.gaiPm.onSnapshot(render);
    setInterval(() => lastSnap && document.visibilityState === 'visible' && render(lastSnap), 30_000);
    window.gaiPm.getSnapshot().then(render);
  }

  boot();
})();
