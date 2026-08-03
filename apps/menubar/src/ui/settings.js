/* global gaiPm — Dedicated Settings window */

const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function render(snap) {
  if (!snap) return;

  const interval = String(snap.config.health.intervalSeconds || 30);
  const sel = $('#health-interval');
  if (sel && sel.value !== interval) sel.value = interval;

  const loginEl = $('#open-at-login');
  if (loginEl) loginEl.checked = Boolean(snap.config.openAtLogin);

  const cookieEl = $('#browser-cookies');
  if (cookieEl) {
    cookieEl.checked = Boolean(snap.config.scan?.includeBrowserCookies);
  }

  const root = $('#provider-settings');
  root.innerHTML = '';

  const providers = [...snap.providers].sort((a, b) =>
    a.meta.displayName.localeCompare(b.meta.displayName)
  );

  for (const p of providers) {
    const pref = snap.config.providers[p.meta.id] || {
      monitor: false,
      showHealth: true,
    };
    const found = Boolean(p.detect?.found);
    const row = document.createElement('div');
    row.className = 'provider-row' + (found ? '' : ' dim');
    row.innerHTML = `
      <div class="provider-row-main">
        <div class="provider-name">${escapeHtml(p.meta.displayName)}</div>
        <div class="provider-sub">${found ? 'detected' : 'not on this Mac'} · ${escapeHtml(p.lifecycle)}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" data-monitor="${escapeHtml(p.meta.id)}" ${pref.monitor ? 'checked' : ''} />
        Monitor
      </label>
      <label class="toggle">
        <input type="checkbox" data-health="${escapeHtml(p.meta.id)}" ${pref.showHealth ? 'checked' : ''} />
        Health
      </label>
    `;
    root.appendChild(row);
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
}

async function boot() {
  $('#btn-refresh').addEventListener('click', async () => {
    render(await window.gaiPm.refresh());
  });
  $('#health-interval').addEventListener('change', async (e) => {
    render(await window.gaiPm.setHealthInterval(Number(e.target.value)));
  });
  $('#open-at-login').addEventListener('change', async (e) => {
    render(await window.gaiPm.setOpenAtLogin(e.target.checked));
  });
  $('#browser-cookies').addEventListener('change', async (e) => {
    render(await window.gaiPm.setBrowserCookies(e.target.checked));
  });

  window.gaiPm.onSnapshot(render);
  render(await window.gaiPm.getSnapshot());
}

boot().catch((err) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<p class="hint">${String(err)}</p>`
  );
});
