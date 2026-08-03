/* global gaiPm — Status panel: each detected/monitored platform as its own card */

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

/** Extract tier=… from errorMessage (Grok OIDC subscription note) */
function extractTier(msg) {
  if (!msg) return null;
  const m = String(msg).match(/tier=([A-Z0-9_]+)/i);
  if (!m) return null;
  return m[1]
    .replace(/^SUBSCRIPTION_TIER_/, '')
    .replace(/_/g, ' ');
}

function render(snap) {
  if (!snap) return;

  $('#updated').textContent = `Updated ${new Date(snap.updatedAt).toLocaleTimeString()}`;

  // Show every platform that is detected on this Mac, OR explicitly monitored.
  // (User must see Grok when ~/.grok exists even if list is long.)
  const visible = snap.providers.filter((p) => {
    const pref = snap.config.providers[p.meta.id];
    return Boolean(p.detect?.found) || Boolean(pref?.monitor);
  });

  // Monitored + found first, then alphabetical
  visible.sort((a, b) => {
    const am = snap.config.providers[a.meta.id]?.monitor ? 0 : 1;
    const bm = snap.config.providers[b.meta.id]?.monitor ? 0 : 1;
    if (am !== bm) return am - bm;
    const af = a.detect?.found ? 0 : 1;
    const bf = b.detect?.found ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.meta.displayName.localeCompare(b.meta.displayName);
  });

  const found = snap.providers.filter((p) => p.detect?.found);
  const monitored = snap.providers.filter(
    (p) => snap.config.providers[p.meta.id]?.monitor
  );
  $('#summary-meta').textContent = `${found.length} detected · ${monitored.length} monitored`;

  const root = $('#providers');
  root.innerHTML = '';

  if (visible.length === 0) {
    root.innerHTML = `<div class="empty">감지된 플랫폼이 없습니다.<br/>설정(⚙)에서 Monitor 를 확인하세요.</div>`;
    return;
  }

  for (const p of visible) {
    const pref = snap.config.providers[p.meta.id] || {
      monitor: false,
      showHealth: true,
    };
    const foundHere = Boolean(p.detect?.found);
    const hb = healthBadge(pref.showHealth ? p.health : null);
    const card = document.createElement('article');
    card.className =
      'card' +
      (pref.monitor ? '' : ' card-off') +
      (foundHere ? '' : ' card-missing');
    card.dataset.providerId = p.meta.id;

    const windows = pref.monitor ? p.usage?.windows || [] : [];
    const tier = extractTier(p.usage?.errorMessage);
    const titleExtra = tier ? ` · ${tier}` : '';

    let body;
    if (!foundHere) {
      body = `<div class="meta-line">이 Mac에서 아직 감지되지 않음</div>`;
    } else if (!pref.monitor) {
      body = `<div class="meta-line">감지됨 · 모니터링 꺼짐 (설정에서 Monitor 켜기)</div>`;
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
      // Grok: no % from CLI — surface a short note under values
      if (p.meta.id === 'grok' && windows.every((w) => w.usedPercent == null)) {
        body += `<div class="meta-line">구독 한도 % 는 웹/쿠키 경로 필요 · CLI 는 토큰·비용만</div>`;
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

  // Scroll Grok (or first provider) into view if requested via hash — always ensure list starts at top with monitored
  const grokCard = root.querySelector('[data-provider-id="grok"]');
  if (grokCard) {
    // mild highlight so it's easy to spot
    grokCard.classList.add('card-highlight');
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
