// حالت‌های UI پنل (S5-9c): skeleton هنگام بارگذاری، پیام خالی، و خطا با «تلاش دوباره». توابع خالص (رشته‌ی HTML)، قابل‌تست در Node.
// قرارداد: همه‌ی متن‌ها escape می‌شوند؛ بدون style/on* درون‌خطی (CSP)؛ skeleton با aria-busy و متن مخصوص خوانشگر (نه فقط شکل).
(function (root) {
  'use strict';
  const FALLBACK_ESC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bar = (cls) => `<span class="sk-line ${cls || ''}"></span>`;

  // kind: 'page' (تیتر + کارت‌های آمار + جدول) | 'table' | 'cards' | 'list'
  function skeletonHtml(kind, opts) {
    const o = opts || {};
    const rows = Math.max(1, Math.min(12, Number(o.rows) || 6));
    const label = o.label || 'در حال بارگذاری…';
    const tableRows = Array.from({ length: rows }, () => `<div class="sk-row">${bar('w30')}${bar('w20')}${bar('w20')}${bar('w15')}</div>`).join('');
    const cards = Array.from({ length: 4 }, () => `<div class="sk-card">${bar('w50')}${bar('w30 tall')}</div>`).join('');
    let body;
    switch (kind) {
      case 'table': body = `<div class="sk-box">${tableRows}</div>`; break;
      case 'cards': body = `<div class="sk-grid">${cards}</div>`; break;
      case 'list': body = Array.from({ length: Math.min(rows, 5) }, () => `<div class="sk-box">${bar('w60')}${bar('w40')}</div>`).join(''); break;
      default: body = `${bar('w25 tall')}<div class="sk-grid">${cards}</div><div class="sk-box">${tableRows}</div>`;
    }
    return `<div class="skeleton" role="status" aria-busy="true" aria-live="polite"><span class="sr-only">${(o.esc || FALLBACK_ESC)(label)}</span><div aria-hidden="true">${body}</div></div>`;
  }

  function emptyHtml(message, o) {
    const esc = (o && o.esc) || FALLBACK_ESC;
    return `<div class="empty">${(o && o.icon) || ''}${esc(message)}</div>`;
  }

  // خطا: پیام + دکمه‌ی «تلاش دوباره» (id برای اتصال listener در جای فراخوان)؛ role=alert تا خوانشگر اعلام کند
  function errorHtml(message, o) {
    const x = o || {};
    const esc = x.esc || FALLBACK_ESC;
    const retry = x.retryId ? `<div class="mt"><button type="button" class="btn ghost" id="${esc(x.retryId)}">${esc(x.retryText || 'تلاش دوباره')}</button></div>` : '';
    return `<div class="card"><div class="empty" role="alert">${x.icon || ''}${esc(message || 'خطای ناشناخته')}${retry}</div></div>`;
  }

  const api = { skeletonHtml, emptyHtml, errorHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.UiStates = api;
}(typeof window !== 'undefined' ? window : undefined));
