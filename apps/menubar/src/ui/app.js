/* global gaiPm — Dashboard: only Monitor-ON platforms (matches Settings copy) */

const $ = (sel) => document.querySelector(sel);
let lastSnap = null;

function pctClass(n) {
  if (n >= 85) return 'bad';
  if (n >= 60) return 'warn';
  return '';
}

const HEALTH_TEXT = {
  none: ['정상', 'ok'],
  minor: ['일부 장애', 'warn'],
  maintenance: ['점검 중', 'warn'],
  major: ['장애', 'bad'],
  critical: ['심각한 장애', 'bad'],
  unknown: ['상태 확인 불가', ''],
};

function healthBadge(h, refreshState) {
  if (!h) return { text: '—', cls: '' };
  const [text, cls] = HEALTH_TEXT[h.indicator] ?? HEALTH_TEXT.unknown;
  if (refreshState?.consecutiveFailures > 0 && !h.unreachable) {
    return { text: `${text} (확인 실패)`, cls };
  }
  return { text: h.unreachable ? '상태 확인 불가' : text, cls: h.unreachable ? '' : cls };
}

const LIFECYCLE_TEXT = {
  not_found: '이 Mac에서 감지되지 않음',
  discovered: '감지됨 · 표시 꺼짐',
  connected: '연결됨 · 최근 조회 실패',
  monitored: '',
  paused: '일시 중지',
  auth_error: '다시 로그인 필요',
  unsupported: '사용량 정보 없음',
};

const STATUS_TEXT = {
  stale: '오래된 데이터',
  error: '조회 실패',
  auth_required: '다시 로그인 필요',
  unsupported: '사용량 정보 없음',
};

const ERROR_KIND_TEXT = {
  auth: '인증 필요',
  rate_limited: '호출 제한',
  timeout: '응답 시간 초과',
  network: '네트워크 오류',
  server: '서버 오류',
  parse: '응답 형식 오류',
  unsupported: '미지원',
  unknown: '알 수 없는 오류',
};

function relTime(ms) {
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  if (m < 1) return '1분 미만';
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

function ago(ts, now) {
  if (!ts) return '';
  return now - ts < 60000 ? '방금' : `${relTime(now - ts)} 전`;
}

function absTime(sec) {
  try {
    return new Date(sec * 1000).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

function formatValue(w) {
  if (typeof w.usedPercent === 'number') return { text: `${Math.round(w.usedPercent)}%`, pct: w.usedPercent };
  if (typeof w.usedAbsolute !== 'number') return { text: '—', pct: null };
  const n = w.usedAbsolute;
  if (w.unit === 'tokens') {
    return { text: n >= 1e6 ? `${(n / 1e6).toFixed(1)}M 토큰` : `${Math.round(n).toLocaleString()} 토큰`, pct: null };
  }
  if (w.unit === 'usd') return { text: `$${n.toFixed(2)}`, pct: null };
  if (w.unit === 'bytes') return { text: formatBytes(n), pct: null };
  return { text: Math.round(n).toLocaleString(), pct: null };
}

/** Right-hand caption: countdown, reset passed, or rolling window. */
function resetCaption(w, now) {
  if (w.windowKind === 'rolling') return { text: '', passed: false, title: '초기화 없이 누적되는 창' };
  if (typeof w.resetsAt !== 'number') return { text: '', passed: false, title: '' };
  const ms = w.resetsAt * 1000 - now;
  if (ms <= 0) return { text: '리셋 경과 · 갱신 대기', passed: true, title: absTime(w.resetsAt) };
  return { text: `${relTime(ms)} 후 초기화`, passed: false, title: absTime(w.resetsAt) };
}

/** Korean label from the window length when known; adapter label otherwise. */
function windowLabel(w) {
  const secs = w.windowSeconds;
  if (secs === 18000) return '5시간';
  if (secs === 86400) return '1일';
  if (secs === 604800) return w.windowKind === 'rolling' ? '최근 7일' : '7일';
  return w.label || w.id;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function freshnessLine(p, now) {
  const u = p.usage;
  if (!u) return '';
  const observed = u.observedAt ?? u.updatedAt;
  const state = p.refresh?.usage;
  const failing = u.status !== 'ok' && u.status !== 'unsupported';
  if (!failing) return observed ? `${ago(observed, now)} 확인` : '';
  const bits = [];
  const why = STATUS_TEXT[u.status] ?? '조회 실패';
  const kind = u.errorKind && u.errorKind !== 'auth' ? ERROR_KIND_TEXT[u.errorKind] : '';
  bits.push(kind ? `${why} (${kind})` : why);
  if (u.windows?.length && observed) bits.push(`마지막 확인 ${ago(observed, now)}`);
  if (state?.nextAt && state.nextAt > now) bits.push(`${relTime(state.nextAt - now)} 후 재시도`);
  return bits.join(' · ');
}

function render(snap) {
  if (!snap) return;
  lastSnap = snap;
  const now = Date.now();

  $('#updated').textContent = `${ago(Date.parse(snap.updatedAt), now)} 갱신`;

  const monitored = snap.providers
    .filter((p) => snap.config.providers[p.meta.id]?.monitor === true)
    .sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));

  const found = snap.providers.filter((p) => p.detect?.found);
  $('#summary-meta').textContent = `${monitored.length}개 표시 · ${found.length}개 감지됨`;

  const root = $('#providers');
  root.innerHTML = '';

  if (monitored.length === 0) {
    root.innerHTML = `<div class="empty">표시 중인 플랫폼이 없습니다.<br/><strong>설정</strong>에서 플랫폼을 켜 주세요.</div>`;
    return;
  }

  for (const p of monitored) {
    const foundHere = Boolean(p.detect?.found);
    const hb = healthBadge(p.health, p.refresh?.health);
    const card = document.createElement('article');
    const status = p.usage?.status;
    const dim = status === 'stale' || status === 'auth_required' || status === 'error';
    card.className = 'card' + (foundHere ? '' : ' card-missing') + (dim ? ' card-stale' : '');
    card.dataset.providerId = p.meta.id;

    const windows = p.usage?.windows || [];
    const note = p.usage?.note ? ` · ${p.usage.note}` : '';

    let body;
    if (!foundHere) {
      body = `<div class="meta-line">이 Mac에서 아직 감지되지 않음 — 로그인 후 새로고침</div>`;
    } else if (windows.length === 0) {
      const msg = STATUS_TEXT[status] ?? LIFECYCLE_TEXT[p.lifecycle] ?? '사용량 데이터 없음';
      const detail = p.usage?.errorMessage ? ` — ${p.usage.errorMessage}` : '';
      body = `<div class="meta-line">${escapeHtml(msg + detail)}</div>`;
    } else {
      body = `<div class="windows">${windows
        .map((w) => {
          const v = formatValue(w);
          const reset = resetCaption(w, now);
          const current = !reset.passed;
          const bar =
            v.pct == null
              ? ''
              : `<div class="bar${current ? '' : ' bar-passed'}"><i class="${current ? pctClass(v.pct) : ''}" style="width:${Math.min(100, Math.max(0, v.pct))}%"></i></div>`;
          const label = windowLabel(w);
          return `<div class="win">
            <span class="label" title="${escapeHtml(reset.title)}">${escapeHtml(label)}${reset.text ? ` · ${escapeHtml(reset.text)}` : ''}</span>
            <span class="value ${current && v.pct != null ? pctClass(v.pct) : ''}${current ? '' : ' passed'}">${escapeHtml(v.text)}</span>
            ${bar}
          </div>`;
        })
        .join('')}</div>`;
    }

    const lifecycleText = LIFECYCLE_TEXT[p.lifecycle] ?? '';
    const fresh = freshnessLine(p, now);
    const metaBits = [fresh || lifecycleText].filter(Boolean);
    card.innerHTML = `
      <div class="card-head">
        <span class="name">${escapeHtml(p.meta.displayName)}${escapeHtml(note)}</span>
        <span class="badge ${hb.cls}">${escapeHtml(hb.text)}</span>
      </div>
      ${body}
      <div class="meta-line">${escapeHtml(metaBits.join(' · '))}${
        p.health?.pageUrl
          ? `${metaBits.length ? ' · ' : ''}<a href="#" data-url="${escapeHtml(p.health.pageUrl)}" class="status-link">상태 페이지</a>`
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
  $('#btn-refresh').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      render(await window.gaiPm.refresh());
    } finally {
      btn.disabled = false;
    }
  });
  $('#btn-settings').addEventListener('click', () => {
    void window.gaiPm.openSettings();
  });
  $('#btn-close').addEventListener('click', () => void window.gaiPm.hideWindow());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void window.gaiPm.hideWindow();
  });

  window.gaiPm.onSnapshot(render);
  // Countdowns and "n분 전" labels age locally; no fetch involved.
  setInterval(() => {
    if (lastSnap && document.visibilityState === 'visible') render(lastSnap);
  }, 30_000);
  render(await window.gaiPm.getSnapshot());
}

boot().catch((err) => {
  $('#summary-meta').textContent = String(err);
});
