/* global gaiPm — Dashboard: only Monitor-ON platforms (matches Settings copy) */

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
    const n = w.usedAbsolute;
    const text =
      n >= 1e6 ? `${(n / 1e6).toFixed(1)}M tokens` : `${Math.round(n).toLocaleString()} tokens`;
    return { text, pct: null, sub: w.label || w.id };
  }
  if (w.unit === 'usd' && typeof w.usedAbsolute === 'number') {
    return {
      text: `$${w.usedAbsolute.toFixed(2)}`,
      pct: null,
      sub: w.label || w.id,
    };
  }
  if (w.unit === 'queries' && typeof w.usedPercent === 'number') {
    return {
      text: `${Math.round(w.usedPercent)}%`,
      pct: w.usedPercent,
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

function extractTier(msg) {
  if (!msg) return null;
  const m = String(msg).match(/tier=([A-Z0-9_]+)/i);
  if (!m) return null;
  return m[1].replace(/^SUBSCRIPTION_TIER_/, '').replace(/_/g, ' ');
}

function render(snap) {
  if (!snap) return;

  $('#updated').textContent = `Updated ${new Date(snap.updatedAt).toLocaleTimeString()}`;

  // Dashboard = visible platforms only (usage + health unified toggle)
  const monitored = snap.providers
    .filter((p) => snap.config.providers[p.meta.id]?.monitor === true)
    .sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));

  const found = snap.providers.filter((p) => p.detect?.found);
  $('#summary-meta').textContent = `${monitored.length} 표시 · ${found.length} 감지됨 · ⚙ 설정에서 선택`;

  const root = $('#providers');
  root.innerHTML = '';

  if (monitored.length === 0) {
    root.innerHTML = `<div class="empty">표시 중인 플랫폼이 없습니다.<br/><strong>⚙ 설정</strong>에서 플랫폼을 켜 주세요.</div>`;
    return;
  }

  for (const p of monitored) {
    const pref = snap.config.providers[p.meta.id] || {
      monitor: true,
      showHealth: true,
    };
    const foundHere = Boolean(p.detect?.found);
    const hb = healthBadge(pref.showHealth ? p.health : null);
    const card = document.createElement('article');
    card.className = 'card' + (foundHere ? '' : ' card-missing');
    card.dataset.providerId = p.meta.id;

    const windows = p.usage?.windows || [];
    const tier = extractTier(p.usage?.errorMessage);
    const titleExtra = tier ? ` · ${tier}` : '';

    let body;
    if (!foundHere) {
      body = `<div class="meta-line">이 Mac에서 아직 감지되지 않음 — CLI 로그인 후 새로고침</div>`;
    } else if (windows.length === 0) {
      body = `<div class="meta-line">${escapeHtml(
        p.usage?.errorMessage || p.lifecycle || '사용량 데이터 없음'
      )}</div>`;
    } else {
      body = `<div class="windows">${windows
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
      if (p.meta.id === 'grok' && windows.every((w) => w.usedPercent == null)) {
        body += `<div class="meta-line">% 없음 · Settings에서 browser cookies 켜고 grok.com 로그인 필요</div>`;
      }
    }

    card.innerHTML = `
      <div class="card-head">
        <span class="name">${escapeHtml(p.meta.displayName)}${escapeHtml(titleExtra)}</span>
        <span class="badge ${hb.cls}">${escapeHtml(hb.text)}</span>
      </div>
      ${body}
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
