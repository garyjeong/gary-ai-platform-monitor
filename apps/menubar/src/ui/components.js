/* Shared renderer for the popover, settings and floating widget.
 * Classic script: exposes window.GaiUI. Markup mirrors the v0.5 design mockup (components.css). */
(function () {
  'use strict';

  const MIN = 6e4;
  const HOUR = 36e5;
  /** A failing provider whose last success is older than this shows as "오래된 데이터". */
  const STALE_AFTER_MS = 15 * MIN;
  const PACE_NOTE_MIN = 5; // %p ahead of even pace before the pace label appears
  const WARN_PCT = 70;
  const DANGER_PCT = 90;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  // ── icon sprite ─────────────────────────────────────────────────────
  const SPRITE = `<svg id="gai-sprite" class="sprite" aria-hidden="true" focusable="false">
  <defs>
    <symbol id="i-tray" viewBox="0 0 16 16"><path d="M12.2 4.5A5.5 5.5 0 1 0 12.2 11.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></symbol>
    <symbol id="i-h-ok" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.5" fill="currentColor"/><path d="M3.5 6.1l1.7 1.7 3.3-3.5" fill="none" style="stroke:var(--glyph-knock)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-h-minor" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6 1.2a4.8 4.8 0 0 0 0 9.6z" fill="currentColor"/></symbol>
    <symbol id="i-h-major" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.5" fill="currentColor"/><path d="M6 3.1v3.4" style="stroke:var(--glyph-knock)" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="8.7" r=".95" style="fill:var(--glyph-knock)"/></symbol>
    <symbol id="i-h-maint" viewBox="0 0 12 12"><path d="M8.6 1.4a2.6 2.6 0 0 0-2.4 3.5L1.8 9.3a1 1 0 0 0 1.4 1.4l4.4-4.4a2.6 2.6 0 0 0 3.5-2.4l-1.5 1.5-1.4-.4-.4-1.4z" fill="currentColor"/></symbol>
    <symbol id="i-h-unknown" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 1.6"/><path d="M4.7 4.8a1.4 1.4 0 1 1 1.9 1.3c-.4.2-.6.4-.6.9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="8.5" r=".7" fill="currentColor"/></symbol>
    <symbol id="i-u-warn" viewBox="0 0 12 12"><path d="M6 1.5 11 10.3H1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 4.7v2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="8.7" r=".7" fill="currentColor"/></symbol>
    <symbol id="i-u-danger" viewBox="0 0 12 12"><path d="M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4Z" fill="currentColor"/><path d="M6 3.2v3.3" style="stroke:var(--glyph-knock)" stroke-width="1.6" stroke-linecap="round"/><circle cx="6" cy="8.6" r=".9" style="fill:var(--glyph-knock)"/></symbol>
    <symbol id="i-clock" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-retry" viewBox="0 0 12 12"><path d="M9.9 6.2A3.9 3.9 0 1 1 8.6 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8.2 1.2 9.6 3.3 7.4 4.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-key" viewBox="0 0 12 12"><circle cx="4" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.4 6h4.4M9.2 6v1.8M10.8 6v1.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></symbol>
    <symbol id="i-calendar" viewBox="0 0 12 12"><rect x="1.5" y="2.3" width="9" height="8.2" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 4.8h9M4 1.2v2M8 1.2v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></symbol>
    <symbol id="i-arrow-up" viewBox="0 0 12 12"><path d="M6 10V2.6M3.2 5.2 6 2.4l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-gear" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="2.2 2.2"/><circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/></symbol>
    <symbol id="i-more" viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></symbol>
    <symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11.8 1.8v2.9H8.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-power" viewBox="0 0 16 16"><path d="M8 1.8v5.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4.6 4a5 5 0 1 0 6.8 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
    <symbol id="i-lock" viewBox="0 0 16 16"><rect x="3.2" y="7" width="9.6" height="7" rx="1.8" fill="currentColor"/><path d="M5.3 7V5a2.7 2.7 0 0 1 5.4 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/></symbol>
    <symbol id="i-resize" viewBox="0 0 16 16"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-eye-off" viewBox="0 0 16 16"><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.9" fill="currentColor"/><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></symbol>
    <symbol id="i-grip" viewBox="0 0 24 8"><g fill="currentColor"><circle cx="7" cy="2" r="1.2"/><circle cx="12" cy="2" r="1.2"/><circle cx="17" cy="2" r="1.2"/><circle cx="7" cy="6" r="1.2"/><circle cx="12" cy="6" r="1.2"/><circle cx="17" cy="6" r="1.2"/></g></symbol>
    <symbol id="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></symbol>
    <symbol id="i-moon" viewBox="0 0 16 16"><path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6Z" fill="currentColor"/></symbol>
    <symbol id="i-auto" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor"/></symbol>
    <symbol id="i-wifi" viewBox="0 0 16 16"><path d="M1.8 6.2a8.8 8.8 0 0 1 12.4 0M4.1 8.6a5.5 5.5 0 0 1 7.8 0M6.3 10.9a2.4 2.4 0 0 1 3.4 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="13" r="1" fill="currentColor"/></symbol>
    <symbol id="i-battery" viewBox="0 0 22 16"><rect x="1" y="3.8" width="17.5" height="8.6" rx="2.4" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".6"/><rect x="2.8" y="5.6" width="11" height="5" rx="1.2" fill="currentColor"/><path d="M20.3 6.7v2.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".6"/></symbol>
    <symbol id="i-updown" viewBox="0 0 16 16"><path d="M5 6.2 8 3.4l3 2.8M5 9.8l3 2.8 3-2.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-check" viewBox="0 0 16 16"><path d="M3.2 8.4 6.4 11.4 12.8 4.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></symbol>
    <symbol id="i-cpu" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4.6" y="4.6" width="2.8" height="2.8" rx=".5" fill="currentColor"/><path d="M4.5 .8v1.4M7.5 .8v1.4M4.5 9.8v1.4M7.5 9.8v1.4M.8 4.5h1.4M.8 7.5h1.4M9.8 4.5h1.4M9.8 7.5h1.4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></symbol>
    <symbol id="i-mem" viewBox="0 0 12 12"><rect x="1" y="3" width="10" height="5.2" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.4 5v1.3M5.2 5v1.3M7 5v1.3M8.8 5v1.3M2.6 8.2v1.6M9.4 8.2v1.6" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></symbol>
    <symbol id="i-net" viewBox="0 0 12 12"><path d="M4 10.2V2.2M1.8 4.4 4 2.2l2.2 2.2M8 1.8v8M5.8 7.6 8 9.8l2.2-2.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  </defs>
</svg>`;
  function injectSprite() {
    if (!document.getElementById('gai-sprite')) document.body.insertAdjacentHTML('afterbegin', SPRITE);
  }

  // ── formatting ──────────────────────────────────────────────────────
  const absFmt = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
  function fmtDur(ms) {
    const m = Math.max(1, Math.ceil(ms / MIN));
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    const mm = m % 60;
    if (d > 0) return h ? `${d}일 ${h}시간` : `${d}일`;
    if (h > 0) return mm ? `${h}시간 ${mm}분` : `${h}시간`;
    return `${mm}분`;
  }
  function ago(ms) {
    if (ms < MIN) return '방금';
    const m = Math.floor(ms / MIN);
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  }
  const fmtTok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`);
  function fmtBytes(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
    if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
    return `${Math.round(n / 1e3)} KB`;
  }
  const fmtUsd = (n) => `$${n.toFixed(2)}`;
  function fmtAmount(w) {
    const n = w.usedAbsolute;
    if (typeof n !== 'number') return '—';
    if (w.unit === 'tokens') return `${fmtTok(n)} 토큰`;
    if (w.unit === 'usd') return fmtUsd(n);
    if (w.unit === 'bytes') return fmtBytes(n);
    if (w.unit === 'models') return `모델 ${Math.round(n)}개`;
    return Math.round(n).toLocaleString('ko-KR');
  }

  // ── view model ──────────────────────────────────────────────────────
  const AUTH_HINT = {
    claude: 'Claude Code 를 한 번 실행해 다시 로그인',
    codex: '터미널에서 <code>codex login</code>',
    gemini: '터미널에서 <code>gemini</code> 실행 후 로그인',
    copilot: '터미널에서 <code>gh auth login</code>',
    grok: 'grok.com 에 다시 로그인',
    cursor: 'cursor.com 에 다시 로그인',
    openrouter: 'API 키를 확인해 주세요',
  };

  function windowLabel(w) {
    const s = w.windowSeconds;
    if (s === 18000) return '5시간';
    if (s === 86400) return '1일';
    if (s === 604800) return w.windowKind === 'rolling' ? '최근 7일' : '주간';
    if (s === 2592000 || /month/i.test(w.label || '')) return '월간';
    if (/credit/i.test(w.label || '')) return '크레딧';
    return w.label || w.id;
  }

  /** Normalize one UsageWindow into what the row renderer needs. */
  function windowView(w) {
    const kind =
      w.windowKind === 'rolling'
        ? 'rolling'
        : typeof w.resetsAt === 'number'
          ? 'fixed'
          : w.unit === 'usd' && typeof w.limitAbsolute === 'number'
            ? 'credits'
            : 'plain';
    return {
      id: w.id,
      label: windowLabel(w),
      kind,
      used: typeof w.usedPercent === 'number' ? w.usedPercent : null,
      windowSec: w.windowSeconds,
      resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null,
      rate: typeof w.recentRatePerHour === 'number' ? w.recentRatePerHour : null,
      raw: w,
    };
  }

  /** Grok-style rolling totals (tokens + usd) collapse into one row. */
  function mergeAmountPairs(views) {
    const tok = views.find((v) => v.used === null && v.raw.unit === 'tokens');
    const usd = views.find((v) => v.used === null && v.raw.unit === 'usd' && v.kind !== 'credits');
    if (!tok || !usd) return views;
    const merged = { ...tok, amount: fmtAmount(tok.raw), value: fmtAmount(usd.raw), mergedKind: tok.kind };
    return views.filter((v) => v !== tok && v !== usd).concat(merged);
  }

  function providerView(p, now) {
    const u = p.usage;
    const ru = p.refresh?.usage;
    const windows = u ? mergeAmountPairs((u.windows || []).map(windowView)) : [];
    const observed = u ? u.observedAt ?? u.updatedAt : null;
    let status = 'ok';
    if (!p.detect?.found) status = 'missing';
    else if (!u) status = 'pending';
    else if (u.status === 'auth_required') status = 'auth';
    else if (u.status === 'unsupported') status = 'unsupported';
    else if (u.status === 'stale' || u.status === 'error') {
      status = windows.length && observed && now - observed > STALE_AFTER_MS ? 'stale' : 'failed';
    }
    const local = (u?.windows || []).some((w) => w.source === 'local');
    return {
      id: p.meta.id,
      name: p.meta.displayName,
      status,
      windows,
      observed,
      local,
      note: u?.note || '',
      error: u?.errorMessage || '',
      retryAt: ru?.nextAt ?? null,
      health: healthKind(p),
      healthUrl: p.health?.pageUrl || p.meta.status?.pageUrl || '',
      hint: AUTH_HINT[p.meta.id] || '',
    };
  }

  function healthKind(p) {
    const h = p.health;
    if (!h) return null;
    if (h.unreachable) return 'unknown';
    return { none: 'ok', minor: 'minor', major: 'major', critical: 'major', maintenance: 'maint' }[h.indicator] || 'unknown';
  }

  // ── pace / level ────────────────────────────────────────────────────
  function elapsedPct(w, now) {
    if (!w.windowSec || !w.resetsAt) return null;
    const total = w.windowSec * 1000;
    return clamp((100 * (total - (w.resetsAt - now))) / total, 0, 100);
  }
  /** ms before reset that the window runs out at the recent rate, or null. */
  function exhaustEarlyMs(w, now) {
    if (!w.rate || w.rate <= 0 || w.used === null || !w.resetsAt) return null;
    const remH = (w.resetsAt - now) / HOUR;
    const needH = (100 - w.used) / w.rate;
    return needH < remH ? (remH - needH) * HOUR : null;
  }
  function level(w, now, stale) {
    if (w.kind === 'rolling' || w.mergedKind === 'rolling') return 'rolling';
    if (w.used === null) return 'plain';
    if (stale) return 'stale';
    if (w.kind === 'fixed' && w.resetsAt <= now) return 'reset';
    if (w.used >= DANGER_PCT) return 'danger';
    if (w.kind === 'fixed' && exhaustEarlyMs(w, now) != null) return 'danger';
    if (w.used >= WARN_PCT) return 'warn';
    const e = elapsedPct(w, now);
    if (e != null && w.used - e >= 10) return 'warn';
    return 'normal';
  }
  const LV_TEXT = { normal: '정상', warn: '주의', danger: '위험', stale: '오래된 값', reset: '리셋 경과', rolling: '누적', plain: '' };

  // ── atoms ───────────────────────────────────────────────────────────
  const HEALTH = {
    ok: ['h-ok', '정상'],
    minor: ['h-minor', '일부 장애'],
    major: ['h-major', '장애'],
    maint: ['h-maint', '점검'],
    unknown: ['h-unknown', '상태 확인 불가'],
  };
  function healthIndicator(kind) {
    if (!kind) return '';
    const [ic, t] = HEALTH[kind];
    return `<span class="health-indicator health-indicator--${kind}" title="공식 상태 페이지: ${t}">${icon(ic)}<span>${t}</span></span>`;
  }

  const CHIPS = {
    normal: ['', '정상'],
    warn: ['u-warn', '주의'],
    danger: ['u-danger', '위험'],
    stale: ['clock', '오래된 데이터'],
    failed: ['retry', '확인 실패'],
    auth: ['key', '다시 로그인 필요'],
    reset: ['retry', '리셋 경과'],
    rolling: ['calendar', '최근 7일'],
    off: ['', '꺼짐'],
  };
  function chip(kind, text) {
    const [ic, t] = CHIPS[kind] || CHIPS.off;
    return `<span class="state-chip state-chip--${kind}">${ic ? icon(ic) : ''}${esc(text || t)}</span>`;
  }

  function freshness(v, now) {
    const obs = v.observed;
    const title = obs ? `${absFmt.format(obs)} ${v.status === 'ok' ? '' : '마지막 성공'}`.trim() : '';
    const retry = v.retryAt && v.retryAt > now ? ` · ${fmtDur(v.retryAt - now)} 후 재시도` : '';
    if (v.status === 'stale') {
      return `<span class="freshness freshness--stale" title="${esc(title)}">${icon('clock')}마지막 확인 ${ago(now - obs)}</span>`;
    }
    if (v.status === 'failed' || v.status === 'auth') {
      const base = obs ? `마지막 확인 ${ago(now - obs)}` : '확인 실패';
      return `<span class="freshness freshness--failed" title="${esc(title)}">${icon('retry')}${base}${retry}</span>`;
    }
    if (!obs) return '';
    const verb = v.local ? '기록' : '확인';
    return `<span class="freshness" title="${esc(title)}">${now - obs < MIN ? `방금 ${verb}` : `${ago(now - obs)} ${verb}`}</span>`;
  }

  function quotaRow(w, now, stale) {
    const lv = level(w, now, stale);
    if (w.used === null) {
      // Amount-only rows: rolling token/cost totals, credits without %, unlimited buckets.
      const amount = w.amount ?? (w.raw.limitAbsolute === undefined && /unlimited|무제한/i.test(w.raw.label || '') ? '무제한' : fmtAmount(w.raw));
      const value = w.value ?? '';
      const meta = lv === 'rolling' ? `${icon('calendar')}초기화 없이 누적` : '';
      return `<div class="quota-row quota-row--rolling" role="group" aria-label="${esc(w.label)} ${esc(amount)} ${esc(value)}">`
        + `<span class="quota-row__label">${esc(w.label)}</span><span class="quota-row__amount">${esc(amount)}</span>`
        + `<span class="quota-row__value">${esc(value)}</span>`
        + (meta ? `<span class="quota-row__meta"><span class="reset-label">${meta}</span></span>` : '')
        + `</div>`;
    }
    const u = Math.round(w.used);
    const fixed = w.kind === 'fixed';
    const live = fixed && lv !== 'reset' && lv !== 'stale';
    const e = live ? elapsedPct(w, now) : null;
    const tick = e != null ? `<span class="pace-tick" style="left:${e.toFixed(1)}%" title="균등 기준선 · 창의 ${Math.round(e)}% 경과"></span>` : '';
    let reset = '';
    if (fixed) {
      const abs = absFmt.format(w.resetsAt);
      reset = lv === 'reset'
        ? `<span class="reset-label" title="${esc(abs)} 초기화됨">${icon('retry')}리셋 경과 · 갱신 대기</span>`
        : `<span class="reset-label" title="${esc(abs)} 초기화">${fmtDur(w.resetsAt - now)} 후 초기화</span>`;
    } else if (w.kind === 'credits' && typeof w.raw.usedAbsolute === 'number') {
      reset = `<span class="reset-label">${fmtUsd(w.raw.limitAbsolute - w.raw.usedAbsolute)} 남음 / ${fmtUsd(w.raw.limitAbsolute)}</span>`;
    }
    let pace = '';
    if (live) {
      const early = exhaustEarlyMs(w, now);
      const d = e != null ? Math.round(w.used - e) : 0;
      if (lv === 'danger' && early != null) pace = `<span class="pace-label">지금 속도면 초기화 ${fmtDur(early)} 전 소진</span>`;
      else if (d >= PACE_NOTE_MIN) pace = `<span class="pace-label">${icon('arrow-up')}균등 대비 +${d}%p</span>`;
    }
    const g = lv === 'warn' ? icon('u-warn') : lv === 'danger' ? icon('u-danger') : '';
    return `<div class="quota-row quota-row--${lv}" role="group" aria-label="${esc(w.label)} ${u}% 사용 · ${LV_TEXT[lv] || ''}">`
      + `<span class="quota-row__label">${esc(w.label)}</span>`
      + `<span class="quota-bar"><span class="quota-bar__fill" style="width:${clamp(u, 0, 100)}%"></span>${tick}</span>`
      + `<span class="quota-row__value">${g}${u}%</span>`
      + `<span class="quota-row__meta">${reset}${pace}</span></div>`;
  }

  function providerBlock(v, now) {
    const stale = v.status === 'stale';
    let body;
    if (v.status === 'auth') {
      body = `<div class="provider-block__note">${chip('auth')}<span>${v.hint || esc(v.error)}</span></div>`
        + (v.windows.length ? v.windows.map((w) => quotaRow(w, now, true)).join('') : '');
    } else if (v.status === 'missing') {
      body = `<div class="provider-block__note">${chip('off', '감지되지 않음')}<span>이 Mac 에서 로그인 흔적을 찾지 못했습니다</span></div>`;
    } else if (v.status === 'pending') {
      body = `<div class="provider-block__note"><span>사용량을 불러오는 중…</span></div>`;
    } else if (!v.windows.length) {
      const msg = v.status === 'unsupported' ? v.note || '사용량 정보를 제공하지 않습니다' : v.error || '사용량 데이터 없음';
      body = `<div class="provider-block__note">${chip(v.status === 'unsupported' ? 'off' : 'failed', v.status === 'unsupported' ? '정보 없음' : '')}<span>${esc(msg)}</span></div>`;
    } else {
      body = v.windows.map((w) => quotaRow(w, now, stale)).join('');
    }
    const plan = v.note && v.status !== 'unsupported' ? `<span class="provider-block__plan">${esc(v.note)}</span>` : '';
    return `<section class="provider-block${stale || v.status === 'auth' ? ' is-stale' : ''}" data-id="${esc(v.id)}" aria-label="${esc(v.name)}">`
      + `<div class="provider-block__head"><span class="provider-block__name">${esc(v.name)}</span>${plan}${healthIndicator(v.health)}${freshness(v, now)}</div>`
      + body + `</section>`;
  }

  /** The one number a small surface shows for a provider. */
  function primaryWindow(v, now) {
    const pct = v.windows.filter((w) => w.used !== null);
    const live = pct.filter((w) => w.kind !== 'fixed' || w.resetsAt > now);
    const pool = live.length ? live : pct;
    if (pool.length) return pool.reduce((a, b) => (b.used > a.used ? b : a));
    return v.windows[0] || null;
  }

  function chipFor(v, on, now) {
    if (!on) return v.status === 'missing' ? '' : chip('off');
    if (v.status === 'auth') return chip('auth');
    if (v.status === 'stale') return chip('stale');
    if (v.status === 'failed') return chip('failed');
    const w = primaryWindow(v, now);
    if (!w) return v.status === 'pending' ? '' : chip('off', '정보 없음');
    if (w.used === null) return chip('rolling', `${w.label} ${w.value || w.amount || fmtAmount(w.raw)}`);
    const lv = level(w, now, false);
    return chip(lv === 'warn' || lv === 'danger' ? lv : lv === 'reset' ? 'reset' : 'normal', `${w.label} ${Math.round(w.used)}%`);
  }

  function ring(u) {
    return `<svg class="wc-ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="t" cx="8" cy="8" r="6"/><circle class="f" cx="8" cy="8" r="6" pathLength="100" stroke-dasharray="${clamp(u, 0, 100)} 100" transform="rotate(-90 8 8)"/></svg>`;
  }

  function compactRow(v, now) {
    if (v.status === 'auth') {
      const retry = v.retryAt && v.retryAt > now ? `${fmtDur(v.retryAt - now)} 후 재시도` : '';
      return `<div class="wc-row wc-row--auth"><span class="wc-glyph">${icon('key')}</span><span class="wc-name">${esc(v.name)}</span><span class="wc-val">로그인 필요</span><span class="wc-sub">${retry}</span></div>`;
    }
    const w = primaryWindow(v, now);
    if (!w) {
      return `<div class="wc-row wc-row--stale"><span class="wc-glyph">${icon('clock')}</span><span class="wc-name">${esc(v.name)}</span><span class="wc-val">—</span><span class="wc-sub">${v.status === 'pending' ? '불러오는 중' : '정보 없음'}</span></div>`;
    }
    if (w.used === null) {
      const val = w.value || w.amount || fmtAmount(w.raw);
      const sub = w.value ? `${w.label} · ${w.amount}` : w.label;
      return `<div class="wc-row wc-row--rolling"><span class="wc-glyph">${icon('calendar')}</span><span class="wc-name">${esc(v.name)}</span><span class="wc-val">${esc(val)}</span><span class="wc-sub">${esc(sub)}</span></div>`;
    }
    const stale = v.status === 'stale';
    const lv = level(w, now, stale);
    const u = Math.round(w.used);
    const g = lv === 'warn' ? icon('u-warn') : lv === 'danger' ? icon('u-danger') : '';
    let sub;
    if (stale) sub = `${icon('clock')}${ago(now - v.observed)} 값`;
    else if (lv === 'reset') sub = `${icon('retry')}리셋 경과`;
    else if (w.kind === 'fixed') sub = `${esc(w.label)} · ${fmtDur(w.resetsAt - now)}`;
    else sub = esc(w.label);
    const title = w.kind === 'fixed' ? ` title="${esc(w.label)} · ${esc(absFmt.format(w.resetsAt))} 초기화"` : '';
    return `<div class="wc-row wc-row--${lv}"${title}>${ring(u)}<span class="wc-name">${esc(v.name)}</span><span class="wc-val">${g}${u}%</span><span class="wc-sub">${sub}</span></div>`;
  }

  // ── this Mac: CPU / memory / shared memory / network ────────────────
  const GIB = 1024 ** 3;
  const RES_STALE_MS = 20_000;
  function fmtGiB(n) {
    return n >= 100 * GIB ? `${Math.round(n / GIB)} GB` : `${(n / GIB).toFixed(1)} GB`;
  }
  function fmtMiB(n) {
    return n >= GIB ? fmtGiB(n) : `${Math.round(n / 1024 ** 2)} MB`;
  }
  function fmtRate(bps) {
    if (typeof bps !== 'number') return '—';
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} KB/s`;
    return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
  }
  function fmtRateShort(bps) {
    if (typeof bps !== 'number') return '—';
    if (bps < 1024) return `${Math.round(bps)}B`;
    if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)}K`;
    return `${(bps / 1024 ** 2).toFixed(1)}M`;
  }
  const PRESSURE = { normal: ['정상', 'normal'], warn: ['주의', 'warn'], critical: ['위험', 'danger'], unknown: ['알 수 없음', 'normal'] };
  /**
   * Usage levels for the resource charts: <50% · 50–80% · 80–90% · ≥90%.
   * Percent metrics (CPU, memory used, shared memory of total) use these directly;
   * network has no percent, so it uses rate steps of 1 / 10 / 50 MB/s.
   */
  const LEVELS = ['normal', 'mid', 'warn', 'danger'];
  const LEVEL_TEXT = { normal: '50% 미만', mid: '50% 이상', warn: '80% 이상', danger: '90% 이상' };
  const pctLevel = (p) => (p >= 90 ? 'danger' : p >= 80 ? 'warn' : p >= 50 ? 'mid' : 'normal');
  const cpuLevel = pctLevel;
  const sharedLevel = (bytes, total) => pctLevel(total ? (100 * bytes) / total : 0);
  const MB = 1024 ** 2;
  const NET_TEXT = { normal: '1 MB/s 미만', mid: '1 MB/s 이상', warn: '10 MB/s 이상', danger: '50 MB/s 이상' };
  const netLevel = (bps) => (bps >= 50 * MB ? 'danger' : bps >= 10 * MB ? 'warn' : bps >= MB ? 'mid' : 'normal');
  const worse = (a, b) => LEVELS[Math.max(LEVELS.indexOf(a), LEVELS.indexOf(b))];
  /** Warning glyph only for the two top levels. */
  const levelGlyph = (lv) => (lv === 'warn' ? icon('u-warn') : lv === 'danger' ? icon('u-danger') : '');

  // ── charts: one y-axis, 2px lines, 10% area wash, crosshair on hover ──
  const chartData = new Map();
  const CHART_W = 100;
  const CHART_H = 36;

  /**
   * Split one series into runs of the same usage level so each run gets its own color.
   * A new run starts at the previous point, keeping the line continuous; null breaks it.
   */
  function seriesRuns(t, values, t0, t1, max, levelOf) {
    const span = Math.max(1, t1 - t0);
    const x = (i) => (((t[i] - t0) / span) * CHART_W).toFixed(2);
    const y = (v) => (CHART_H - 1 - (Math.min(v, max) / max) * (CHART_H - 3)).toFixed(2);
    const runs = [];
    let cur = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (typeof v !== 'number') {
        cur = null;
        continue;
      }
      const level = levelOf ? levelOf(v, i) : 'normal';
      if (!cur || cur.level !== level) {
        const joinPrev = cur && cur.idx[cur.idx.length - 1] === i - 1;
        cur = { level, idx: joinPrev ? [i - 1] : [] };
        runs.push(cur);
      }
      cur.idx.push(i);
    }
    return runs.map((r) => {
      const pts = r.idx.map((i) => `${x(i)},${y(values[i])}`);
      const first = r.idx[0];
      const last = r.idx[r.idx.length - 1];
      return {
        level: r.level,
        line: `M${pts.join('L')}`,
        area: `M${x(first)},${CHART_H}L${pts.join('L')}L${x(last)},${CHART_H}Z`,
      };
    });
  }

  /**
   * series: [{ label, values, fmt, levelOf?, thin? }] aligned with t. max: y-domain top (y starts at 0).
   * Color encodes the usage level of each point (보통 / 높음 / 매우 높음); `thin` marks a second series.
   * `compact` drops the grid and the hover readout (widget).
   */
  function timeChart(id, t, series, max, compact) {
    const n = t.length;
    if (n < 2) {
      return `<div class="chart chart--empty${compact ? ' chart--compact' : ''}"><span>측정 중</span></div>`;
    }
    const t0 = t[0];
    const t1 = t[n - 1];
    const runs = series.map((s) => ({ s, runs: seriesRuns(t, s.values, t0, t1, max, s.levelOf) }));
    if (!compact) chartData.set(id, { t, series, t0, t1 });
    const grid = compact ? '' : `<line class="chart__grid" x1="0" y1="${CHART_H - 0.5}" x2="${CHART_W}" y2="${CHART_H - 0.5}"/>`;
    return `<div class="chart${compact ? ' chart--compact' : ''}" data-chart="${esc(id)}">`
      + `<svg class="chart__svg" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" aria-hidden="true">${grid}`
      + runs.filter((r) => !r.s.thin).map((r) => r.runs.map((p) => `<path class="chart__area chart__area--${p.level}" d="${p.area}"/>`).join('')).join('')
      + runs.map((r) => r.runs.map((p) => `<path class="chart__line chart__line--${p.level}${r.s.thin ? ' chart__line--thin' : ''}" d="${p.line}"/>`).join('')).join('')
      + `<line class="chart__cross" x1="0" y1="0" x2="0" y2="${CHART_H}" visibility="hidden"/></svg>`
      + (compact ? '' : '<div class="chart__tip" hidden></div>')
      + `</div>`;
  }

  /** Crosshair + one tooltip listing every series at the nearest sample. Returns a re-apply hook. */
  function bindChartHover(root) {
    let hover = null; // { id, time }
    const show = (el) => {
      const data = chartData.get(el.dataset.chart);
      const tip = el.querySelector('.chart__tip');
      const cross = el.querySelector('.chart__cross');
      if (!data || !tip || !cross || !hover) return;
      let idx = 0;
      for (let i = 1; i < data.t.length; i++) {
        if (Math.abs(data.t[i] - hover.time) < Math.abs(data.t[idx] - hover.time)) idx = i;
      }
      const frac = (data.t[idx] - data.t0) / Math.max(1, data.t1 - data.t0);
      const xPos = (frac * CHART_W).toFixed(2);
      cross.setAttribute('x1', xPos);
      cross.setAttribute('x2', xPos);
      cross.setAttribute('visibility', 'visible');
      const age = Date.now() - data.t[idx];
      tip.innerHTML = `<b>${age < 5000 ? '지금' : `${Math.round(age / 1000)}초 전`}</b>`
        + data.series
          .map((s) => {
            const v = s.values[idx];
            const lv = typeof v === 'number' && s.levelOf ? s.levelOf(v, idx) : 'normal';
            const tag = lv === 'normal' ? '' : ` · ${(s.levelText || LEVEL_TEXT)[lv]}`;
            return `<span><i class="chart__key chart__key--${lv}${s.thin ? ' chart__key--thin' : ''}"></i>${esc(s.label)} ${esc(typeof v === 'number' ? s.fmt(v) : '—')}${tag}</span>`;
          })
          .join('');
      tip.hidden = false;
      tip.style.left = `${Math.min(Math.max(frac * 100, 20), 80)}%`;
    };
    root.addEventListener('pointermove', (e) => {
      const el = e.target.closest('.chart[data-chart]');
      if (!el) return;
      const data = chartData.get(el.dataset.chart);
      if (!data) return;
      const r = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      hover = { id: el.dataset.chart, time: data.t0 + frac * (data.t1 - data.t0) };
      show(el);
    });
    root.addEventListener('pointerout', (e) => {
      const el = e.target.closest('.chart[data-chart]');
      if (!el || el.contains(e.relatedTarget)) return;
      hover = null;
      el.querySelector('.chart__cross')?.setAttribute('visibility', 'hidden');
      const tip = el.querySelector('.chart__tip');
      if (tip) tip.hidden = true;
    });
    return () => {
      if (!hover) return;
      const el = root.querySelector(`.chart[data-chart="${CSS.escape(hover.id)}"]`);
      if (el) show(el);
    };
  }

  const pct = (v) => `${Math.round(v)}%`;

  /** `quiet`: high network/shared use is not a problem — color it, but no warning glyph. */
  function resTile(label, value, sub, chart, lv, quiet) {
    const g = quiet ? '' : levelGlyph(lv);
    return `<div class="res-tile res-tile--${lv || 'normal'}" role="group" aria-label="${esc(label)}">`
      + `<div class="res-tile__head"><span class="res-tile__label">${esc(label)}</span><span class="res-tile__value">${g}${value}</span></div>`
      + `<div class="res-tile__sub">${sub}</div>${chart}</div>`;
  }

  function spanText(t) {
    if (!t || t.length < 2) return '';
    const s = Math.round((t[t.length - 1] - t[0]) / 1000);
    return s < 90 ? `최근 ${s}초` : `최근 ${Math.round(s / 60)}분`;
  }

  const emptyHistory = { t: [], cpu: [], memory: [], pressure: [], shared: [], rx: [], tx: [] };

  function resourceBlock(res, now) {
    const head = (extra) =>
      `<div class="provider-block__head"><span class="provider-block__name">이 Mac</span>${extra || ''}</div>`;
    if (!res) {
      return `<section class="provider-block provider-block--mac" aria-label="이 Mac">${head()}<div class="provider-block__note"><span>리소스를 측정하는 중…</span></div></section>`;
    }
    const stale = now - res.at > RES_STALE_MS;
    const h = { ...emptyHistory, ...(res.history || {}) };
    const tiles = [];
    const total = res.memory?.totalBytes || 0;

    const c = res.cpu;
    tiles.push(resTile('CPU', c ? pct(c.usagePct) : '—',
      c ? `사용자 ${Math.round(c.userPct)}% · 시스템 ${Math.round(c.systemPct)}%` : '측정 중',
      timeChart('cpu', h.t, [{ label: 'CPU', values: h.cpu, fmt: pct, levelOf: cpuLevel }], 100),
      c ? cpuLevel(c.usagePct) : 'normal'));

    const m = res.memory;
    if (m && m.totalBytes) {
      const [ptext] = PRESSURE[m.pressure] || PRESSURE.unknown;
      tiles.push(resTile('메모리', `${fmtGiB(m.usedBytes)}<small> / ${fmtGiB(m.totalBytes)}</small>`,
        `압력 ${ptext} · 스왑 ${fmtMiB(m.swapUsedBytes)}`,
        timeChart('mem', h.t, [{ label: '사용', values: h.memory, fmt: pct, levelOf: pctLevel }], 100),
        pctLevel((100 * m.usedBytes) / m.totalBytes)));
    } else {
      tiles.push(resTile('메모리', '—', '측정 실패', timeChart('mem', [], [], 100), 'normal'));
    }

    const sharedNums = h.shared.filter((v) => typeof v === 'number');
    const shLevel = (v) => sharedLevel(v, total);
    tiles.push(resTile('공유 메모리', typeof res.sharedBytes === 'number' ? fmtGiB(res.sharedBytes) : '—',
      '여러 프로세스가 함께 쓰는 메모리',
      timeChart('shared', h.t, [{ label: '공유', values: h.shared, fmt: (v) => `${fmtGiB(v)} (${total ? Math.round((100 * v) / total) : 0}%)`, levelOf: shLevel }], Math.max(GIB, ...sharedNums) * 1.25),
      typeof res.sharedBytes === 'number' ? shLevel(res.sharedBytes) : 'normal', true));

    const nw = res.network;
    const netNums = [...h.rx, ...h.tx].filter((v) => typeof v === 'number');
    tiles.push(resTile('네트워크', nw ? `↓${fmtRateShort(nw.rxBytesPerSec)} ↑${fmtRateShort(nw.txBytesPerSec)}` : '—',
      '<span class="legend"><i class="chart__key chart__key--normal"></i>받기</span>'
        + '<span class="legend"><i class="chart__key chart__key--normal chart__key--thin"></i>보내기</span>',
      timeChart('net', h.t, [
        { label: '받기', values: h.rx, fmt: fmtRate, levelOf: netLevel, levelText: NET_TEXT },
        { label: '보내기', values: h.tx, fmt: fmtRate, levelOf: netLevel, levelText: NET_TEXT, thin: true },
      ], Math.max(64 * 1024, ...netNums) * 1.15),
      nw ? worse(netLevel(nw.rxBytesPerSec), netLevel(nw.txBytesPerSec)) : 'normal', true));

    const fresh = stale
      ? `<span class="freshness freshness--stale">${icon('clock')}${ago(now - res.at)} 값</span>`
      : `<span class="freshness">${spanText(h.t)}</span>`;
    const legend = `<div class="level-legend" aria-label="그래프 색: 사용률 구간 (네트워크는 1·10·50 MB/s)">`
      + LEVELS.map((lv) => `<span><i class="chart__key chart__key--${lv}"></i>${LEVEL_TEXT[lv]}</span>`).join('')
      + `</div>`;
    return `<section class="provider-block provider-block--mac${stale ? ' is-stale' : ''}" aria-label="이 Mac">${head(fresh)}<div class="res-grid">${tiles.join('')}</div>${legend}</section>`;
  }

  function resourceCompactRows(res) {
    if (!res) {
      return `<div class="wc-row wc-row--stale"><span class="wc-glyph">${icon('clock')}</span><span class="wc-name">이 Mac</span><span class="wc-val">—</span><span class="wc-sub">측정 중</span></div>`;
    }
    const h = { ...emptyHistory, ...(res.history || {}) };
    const out = [];
    const c = res.cpu;
    if (c) {
      const lv = cpuLevel(c.usagePct);
      out.push(`<div class="wc-row wc-row--${lv}"><span class="wc-glyph">${icon('cpu')}</span><span class="wc-name">CPU</span><span class="wc-val">${levelGlyph(lv)}${pct(c.usagePct)}</span>`
        + `<span class="wc-sub">${timeChart('w-cpu', h.t, [{ label: 'CPU', values: h.cpu, fmt: pct, levelOf: cpuLevel }], 100, true)}</span></div>`);
    }
    const m = res.memory;
    if (m && m.totalBytes) {
      const used = (100 * m.usedBytes) / m.totalBytes;
      const lv = pctLevel(used);
      out.push(`<div class="wc-row wc-row--${lv}"><span class="wc-glyph">${icon('mem')}</span><span class="wc-name">메모리</span><span class="wc-val">${levelGlyph(lv)}${pct(used)}</span>`
        + `<span class="wc-sub">${timeChart('w-mem', h.t, [{ label: '메모리', values: h.memory, fmt: pct, levelOf: pctLevel }], 100, true)}</span></div>`);
    }
    const nw = res.network;
    const rxNums = h.rx.filter((v) => typeof v === 'number');
    const nlv = nw ? worse(netLevel(nw.rxBytesPerSec), netLevel(nw.txBytesPerSec)) : 'normal';
    out.push(`<div class="wc-row wc-row--${nlv}"><span class="wc-glyph">${icon('net')}</span><span class="wc-name">네트워크</span><span class="wc-val">↓${nw ? fmtRateShort(nw.rxBytesPerSec) : '—'} ↑${nw ? fmtRateShort(nw.txBytesPerSec) : '—'}</span>`
      + `<span class="wc-sub">${timeChart('w-net', h.t, [{ label: '받기', values: h.rx, fmt: fmtRate, levelOf: netLevel }], Math.max(64 * 1024, ...rxNums) * 1.15, true)}</span></div>`);
    return out.join('');
  }

  // ── snapshot helpers ────────────────────────────────────────────────
  const isOn = (snap, id) => snap?.config?.providers?.[id]?.monitor === true;

  function monitoredViews(snap, now) {
    return (snap?.providers || [])
      .filter((p) => isOn(snap, p.meta.id))
      .map((p) => providerView(p, now));
  }

  function pinnedViews(snap, now) {
    const on = monitoredViews(snap, now);
    const pinned = snap?.config?.widget?.pinned || [];
    const chosen = pinned.length ? pinned.map((id) => on.find((v) => v.id === id)).filter(Boolean) : on.slice(0, 3);
    return chosen;
  }

  function summaryState(views, now) {
    const bad = views.filter((v) => v.status === 'failed' || v.status === 'stale' || v.status === 'auth');
    if (bad.length) return `${icon('u-warn')}<span>일부 확인 실패 · ${esc(bad.map((v) => v.name).join(', '))}</span>`;
    const times = views.map((v) => v.observed).filter(Boolean);
    if (!times.length) return '<span>불러오는 중…</span>';
    const newest = Math.max(...times);
    return `<span>${now - newest < MIN ? '방금 확인' : `${ago(now - newest)} 확인`}</span>`;
  }

  window.GaiUI = {
    MIN,
    esc,
    icon,
    injectSprite,
    providerView,
    providerBlock,
    compactRow,
    chipFor,
    monitoredViews,
    pinnedViews,
    summaryState,
    isOn,
    ago,
    fmtDur,
    resourceBlock,
    resourceCompactRows,
    bindChartHover,
  };
})();
