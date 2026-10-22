// حالت‌های UI پنل (S5-9c): skeleton هنگام بارگذاری، پیام خالی، و خطا با «تلاش دوباره». توابع خالص (رشته‌ی HTML)، قابل‌تست در Node.
// قرارداد: همه‌ی متن‌ها escape می‌شوند؛ بدون style/on* درون‌خطی (CSP)؛ skeleton با aria-busy و متن مخصوص خوانشگر (نه فقط شکل).
(function (root) {
  'use strict';
  const FALLBACK_ESC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bar = (cls) => `<span class="sk-line ${cls || ''}"></span>`;

  // kind: 'notebook' (D1: اسکلت دفترچه‌ی دوصفحه‌ای برای «برنامه هفته بعد»؛ ستون کارمندان + دو صفحه) | 'page' (تیتر + کارت‌های آمار + جدول) | 'table' | 'cards' | 'list' | 'plan' (کادرهای رنگیِ روزانه‌ی برنامه‌ی هفتگی) | 'settings' (صفحه‌ی تنظیمات: کارت ناوبری + شبکه‌ی دو‌ستونه‌ی فیلد) | 'today' (نمای «امروز» Mini App: کارت وضعیت + دو دکمه + سه ردیف)
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
      case 'today':
        body = `<div class="sk-box sk-today-status">${bar('w30')}<span class="sk-ring"></span>${bar('w60')}</div>` +
          `<div class="sk-card sk-action-primary">${bar('w40 tall')}${bar('w60')}</div>` +
          `<div class="sk-box sk-today-times"><span>${bar('w60')}${bar('w40')}</span><span>${bar('w60')}${bar('w40')}</span><span>${bar('w60')}${bar('w40')}</span></div>`;
        break;
      case 'plan': body = `<div class="pl-board sk-plan">${Array.from({ length: 3 }, () => `<div class="pl-day sk-day">${bar('w40 tall')}${bar('w100')}${bar('w60')}</div>`).join('')}</div>`; break;
      case 'notebook':
        body = `<div class="np-layout"><div class="sk-box">${bar('w60')}${bar('w100')}${bar('w100')}${bar('w60')}${bar('w100')}</div>` +
          `<div class="nb"><div class="nb-spread"><div class="nb-page">${cards}</div><div class="nb-spring"></div><div class="nb-page">${cards}</div></div></div></div>`;
        break;
      case 'settings':
        body = `<div class="st-layout sk-settings"><div class="sk-box">${bar('w50 tall')}${bar('w100')}${bar('w100')}${bar('w100')}${bar('w100')}${bar('w60')}</div>` +
          `<div class="sk-box"><div class="sk-fields">${Array.from({ length: 6 }, () => `<div class="sk-field">${bar('w40')}${bar('w100 tall')}${bar('w60')}</div>`).join('')}</div></div></div>`;
        break;
      case 'list': body = Array.from({ length: Math.min(rows, 5) }, () => `<div class="sk-box">${bar('w60')}${bar('w40')}</div>`).join(''); break;
      default: body = `${bar('w25 tall')}<div class="sk-grid">${cards}</div><div class="sk-box">${tableRows}</div>`;
    }
    return `<div class="skeleton" role="status" aria-busy="true" aria-live="polite"><span class="sr-only">${(o.esc || FALLBACK_ESC)(label)}</span><div aria-hidden="true">${body}</div></div>`;
  }

  function emptyHtml(message, o) {
    const esc = (o && o.esc) || FALLBACK_ESC;
    const hint = o && o.hint ? `<small class="empty-hint">${esc(o.hint)}</small>` : '';
    return `<div class="empty">${(o && o.icon) || ''}${esc(message)}${hint}</div>`;
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
