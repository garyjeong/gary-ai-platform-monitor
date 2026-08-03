/* global gaiPm — Status panel: per-platform usage only (no aggregate AI n%) */

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
  if (typeof w.usedAbsolute === 'number') {
    return {
      text: String(w.usedAbsolute),
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

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function render(snap) {
  if (!snap) return;

  $('#updated').textContent = `Updated ${new Date(snap.updatedAt).toLocaleTimeString()}`;

  // Status panel: only platforms that are monitored (each shown separately)
  const monitored = snap.providers.filter(
    (p) => snap.config.providers[p.meta.id]?.monitor
  );
  const found = snap.providers.filter((p) => p.detect?.found);
  $('#summary-meta').textContent = `${monitored.length} monitored · ${found.length} detected on this Mac`;

  const root = $('#providers');
  root.innerHTML = '';

  if (monitored.length === 0) {
    root.innerHTML = `<div class="empty">모니터링 중인 플랫폼이 없습니다.<br/>설정(⚙)에서 Monitor 를 켜 주세요.</div>`;
    return;
  }

  for (const p of monitored) {
    const pref = snap.config.providers[p.meta.id] || {
      monitor: true,
      showHealth: true,
    };
    const hb = healthBadge(pref.showHealth ? p.health : null);
    const card = document.createElement('article');
    card.className = 'card';

    const windows = p.usage?.windows || [];
    const winHtml =
      windows.length === 0
        ? `<div class="meta-line">${
            !p.detect?.found
              ? '이 Mac에서 감지되지 않음'
              : p.usage?.errorMessage || p.lifecycle || '사용량 데이터 없음'
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
                <span class="value ${f.pct != null ? pctClass(f.pct) : ''}">${escapeHtml(f.text)}</span>
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
    `;
    root.appendChild(card);
  }

  root.querySelectorAll('a.status-link').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const url = a.getAttribute('data-url');
      if (url) void window.gaiPm.openExternal(url);
    });
  });
}

async function boot() {
  $('#btn-refresh').addEventListener('click', async () => {
    const snap = await window.gaiPm.refresh();
    render(snap);
  });
  $('#btn-settings').addEventListener('click', () => {
    void window.gaiPm.openSettings();
  });
  $('#btn-quit').addEventListener('click', () => window.gaiPm.quit());

  window.gaiPm.onSnapshot(render);
  const snap = await window.gaiPm.getSnapshot();
  render(snap);
}

boot().catch((err) => {
  $('#summary-meta').textContent = String(err);
});
