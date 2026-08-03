/* global gaiPm */

const $ = (sel) => document.querySelector(sel);

function pctClass(n) {
  if (n >= 85) return 'bad';
  if (n >= 60) return 'warn';
  return '';
}

function healthBadge(h) {
  if (!h) return { text: '—', cls: '' };
  const ind = h.indicator;
  if (ind === 'none') return { text: 'operational', cls: 'ok' };
  if (ind === 'minor' || ind === 'maintenance') return { text: ind, cls: 'warn' };
  if (ind === 'major' || ind === 'critical') return { text: ind, cls: 'bad' };
  return { text: ind || 'unknown', cls: 'warn' };
}

function formatWindow(w) {
  if (typeof w.usedPercent === 'number') {
    return {
      text: `${Math.round(w.usedPercent)}%`,
      pct: w.usedPercent,
      sub: w.label || w.id,
    };
  }
  if (w.unit === 'tokens' && typeof w.usedAbsolute === 'number') {
    const m = w.usedAbsolute / 1e6;
    return {
      text: m >= 1 ? `${m.toFixed(1)}M tok` : `${Math.round(w.usedAbsolute)} tok`,
      pct: null,
      sub: w.label || w.id,
    };
  }
  if (w.unit === 'usd' && typeof w.usedAbsolute === 'number') {
    return {
      text: `$${w.usedAbsolute.toFixed(2)}`,
      pct: null,
      sub: w.label || w.id,
    };
  }
  return { text: '—', pct: null, sub: w.label || w.id };
}

function formatReset(sec) {
  if (!sec) return '';
  try {
    return new Date(sec * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function render(snap) {
  if (!snap) return;

  $('#updated').textContent = `Updated ${new Date(snap.updatedAt).toLocaleTimeString()}`;
  $('#tray-title').textContent = snap.menuBar?.title ?? 'AI';

  const monitored = snap.providers.filter(
    (p) => snap.config.providers[p.meta.id]?.monitor
  );
  const found = snap.providers.filter((p) => p.detect?.found);
  $('#summary-meta').textContent = `${found.length} detected · ${monitored.length} monitored · health ${snap.config.health.intervalSeconds}s`;

  const interval = String(snap.config.health.intervalSeconds || 30);
  const sel = $('#health-interval');
  if (sel.value !== interval) sel.value = interval;

  const loginEl = $('#open-at-login');
  if (loginEl && loginEl.checked !== Boolean(snap.config.openAtLogin)) {
    loginEl.checked = Boolean(snap.config.openAtLogin);
  }
  const cookieEl = $('#browser-cookies');
  if (
    cookieEl &&
    cookieEl.checked !== Boolean(snap.config.scan?.includeBrowserCookies)
  ) {
    cookieEl.checked = Boolean(snap.config.scan?.includeBrowserCookies);
  }

  const root = $('#providers');
  root.innerHTML = '';

  if (!snap.providers.length) {
    root.innerHTML = `<div class="empty">No providers registered</div>`;
    return;
  }

  for (const p of snap.providers) {
    const pref = snap.config.providers[p.meta.id] || {
      monitor: false,
      showHealth: true,
    };
    const hb = healthBadge(p.health);
    const card = document.createElement('article');
    card.className = 'card';

    const windows = p.usage?.windows || [];
    const winHtml =
      windows.length === 0
        ? `<div class="meta-line">${
            !p.detect?.found
              ? 'Not detected on this Mac'
              : !pref.monitor
                ? 'Monitoring off'
                : p.usage?.errorMessage || p.lifecycle || 'No usage data'
          }</div>`
        : `<div class="windows">${windows
            .map((w) => {
              const f = formatWindow(w);
              const bar =
                f.pct == null
                  ? ''
                  : `<div class="bar"><i class="${pctClass(f.pct)}" style="width:${Math.min(100, Math.max(0, f.pct))}%"></i></div>`;
              const reset = formatReset(w.resetsAt);
              return `<div class="win">
                <span class="label">${escapeHtml(f.sub)}${reset ? ` · ${escapeHtml(reset)}` : ''}</span>
                <span class="value ${pctClass(f.pct ?? 0)}">${escapeHtml(f.text)}</span>
                ${bar}
              </div>`;
            })
            .join('')}</div>`;

    card.innerHTML = `
      <div class="card-head">
        <span class="name">${escapeHtml(p.meta.displayName)}</span>
        <span class="badge ${hb.cls}">${escapeHtml(hb.text)}</span>
      </div>
      ${winHtml}
      <div class="meta-line">${escapeHtml(p.lifecycle)}${
        p.health?.pageUrl
          ? ` · <a data-url="${escapeHtml(p.health.pageUrl)}" class="status-link">status</a>`
          : ''
      }</div>
      <div class="toggles">
        <label class="toggle">
          <input type="checkbox" data-monitor="${escapeHtml(p.meta.id)}" ${pref.monitor ? 'checked' : ''} ${p.detect?.found ? '' : 'disabled'} />
          Monitor
        </label>
        <label class="toggle">
          <input type="checkbox" data-health="${escapeHtml(p.meta.id)}" ${pref.showHealth ? 'checked' : ''} />
          Health
        </label>
      </div>
    `;
    root.appendChild(card);
  }

  root.querySelectorAll('[data-monitor]').forEach((el) => {
    el.addEventListener('change', async (e) => {
      const id = e.target.getAttribute('data-monitor');
      const snap2 = await window.gaiPm.setMonitor(id, e.target.checked);
      render(snap2);
    });
  });

  root.querySelectorAll('[data-health]').forEach((el) => {
    el.addEventListener('change', async (e) => {
      const id = e.target.getAttribute('data-health');
      const snap2 = await window.gaiPm.setShowHealth(id, e.target.checked);
      render(snap2);
    });
  });

  root.querySelectorAll('a.status-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const url = a.getAttribute('data-url');
      if (url) void window.gaiPm.openExternal(url);
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function boot() {
  $('#btn-refresh').addEventListener('click', async () => {
    const snap = await window.gaiPm.refresh();
    render(snap);
  });
  $('#btn-quit').addEventListener('click', () => window.gaiPm.quit());
  $('#health-interval').addEventListener('change', async (e) => {
    const snap = await window.gaiPm.setHealthInterval(Number(e.target.value));
    render(snap);
  });
  $('#open-at-login').addEventListener('change', async (e) => {
    const snap = await window.gaiPm.setOpenAtLogin(e.target.checked);
    render(snap);
  });
  $('#browser-cookies').addEventListener('change', async (e) => {
    const snap = await window.gaiPm.setBrowserCookies(e.target.checked);
    render(snap);
  });

  window.gaiPm.onSnapshot(render);
  const snap = await window.gaiPm.getSnapshot();
  render(snap);
}

boot().catch((err) => {
  $('#summary-meta').textContent = String(err);
});
