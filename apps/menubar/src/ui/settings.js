/* global gaiPm — Settings window: authoritative for dashboard visibility */

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

  const providers = [...snap.providers].sort((a, b) => {
    // Detected first, then name
    const af = a.detect?.found ? 0 : 1;
    const bf = b.detect?.found ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.meta.displayName.localeCompare(b.meta.displayName);
  });

  for (const p of providers) {
    const pref = snap.config.providers[p.meta.id] || {
      monitor: false,
      showHealth: false,
      userHidden: false,
    };
    const found = Boolean(p.detect?.found);
    const on = pref.monitor === true;
    const row = document.createElement('div');
    row.className = 'provider-row' + (found ? '' : ' dim');
    const statusBits = [
      found ? 'detected' : 'not on this Mac',
      on ? 'visible (usage + health)' : 'hidden',
      p.lifecycle,
    ];
    row.innerHTML = `
      <div class="provider-row-main">
        <div class="provider-name">${escapeHtml(p.meta.displayName)}</div>
        <div class="provider-sub">${escapeHtml(statusBits.join(' · '))}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" data-visible="${escapeHtml(p.meta.id)}" ${on ? 'checked' : ''} />
        표시
      </label>
    `;
    root.appendChild(row);
  }

  root.querySelectorAll('[data-visible]').forEach((el) => {
    el.addEventListener('change', async (e) => {
      const id = e.target.getAttribute('data-visible');
      const on = e.target.checked;
      e.target.disabled = true;
      try {
        // Single toggle: usage + health together
        const snap2 = await window.gaiPm.setMonitor(id, on);
        render(snap2);
      } finally {
        e.target.disabled = false;
      }
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

  // Bulk actions: one IPC write + one refresh (not N full snapshots)
  $('#btn-monitor-detected').addEventListener('click', async () => {
    const snap = await window.gaiPm.getSnapshot();
    if (!snap) return;
    const updates = snap.providers
      .filter((p) => {
        const want = Boolean(p.detect?.found);
        const cur = snap.config.providers[p.meta.id]?.monitor === true;
        return want !== cur;
      })
      .map((p) => ({
        providerId: p.meta.id,
        monitor: Boolean(p.detect?.found),
      }));
    if (updates.length === 0) return;
    render(await window.gaiPm.setMonitors(updates));
  });

  $('#btn-monitor-none').addEventListener('click', async () => {
    const snap = await window.gaiPm.getSnapshot();
    if (!snap) return;
    const updates = snap.providers
      .filter((p) => snap.config.providers[p.meta.id]?.monitor)
      .map((p) => ({ providerId: p.meta.id, monitor: false }));
    if (updates.length === 0) return;
    render(await window.gaiPm.setMonitors(updates));
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
