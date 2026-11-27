// آیکن کنار هر خانه‌ی آماری (کاشی)
//   • خانه‌هایی که از نویسه‌ی خودشان آیکن ندارند (حقوق، مرور شبانه، خروجی‌ها، برنامه‌ی هفته‌ی بعد، چیپ‌های تنظیمات)
//     بعد از رسم یک آیکن می‌گیرند؛ آیکن از روی متن عنوان انتخاب می‌شود. HTML خود صفحه‌ها دست نمی‌خورد.
//   • defensive: نبودن MutationObserver/AP.icon ⇒ بی‌اثر.
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const AP = window.AP;
  if (!AP || typeof AP.icon !== 'function') return;

  const CELLS = '.pf-kpis > .pf-kpi, .nt-stats > .nt-stat, .ex-chips > .ex-chip, .np-stats > .np-stat, .st-chips > .st-chip';
  const LABEL = '.pf-kpi-label, .nt-stat > span, .ex-chip > span, .st-chip-k';
  const RULES = [
    [/حقوق|تومان|پورسانت|مبلغ|پرداخت|قیمت/, 'wallet'],
    [/استراحت/, 'coffee'],
    [/تأخیر|تاخیر|متأخر|ورود/, 'in'],
    [/خروج/, 'out'],
    [/غیبت|غایب|کسری|اعتراض|هشدار/, 'alert'],
    [/مرخصی|ماموریت|مأموریت/, 'leave'],
    [/اضافه/, 'plus'],
    [/پیش‌نویس|ویرایش/, 'edit'],
    [/ثبت‌شده|ثبت شده|حاضر|تکمیل/, 'check'],
    [/ثبت نشده/, 'x'],
    [/نرخ|میانگین|درصد|وقت‌شناس|روند/, 'trend'],
    [/کارمند|نفر|پرسنل/, 'employees'],
    [/ساعت|زمان|دقیقه|شروع|پایان/, 'clock'],
    [/روز|تاریخ|ماه|هفته/, 'calendar'],
    [/گزارش|قالب|دسته|خروجی/, 'reports'],
  ];
  const pick = (txt, fallback) => { for (const [re, ic] of RULES) if (re.test(txt)) return ic; return fallback; };
  const FALLBACK = { 'pf-kpi': 'reports', 'nt-stat': 'clock', 'ex-chip': 'download', 'np-stat': 'calendar', 'st-chip': 'settings' };

  let busy = false;
  const decorate = (root) => {
    if (busy) return;
    busy = true;
    try {
      const cells = (root && root.querySelectorAll ? root : document).querySelectorAll(CELLS);
      cells.forEach((cell) => {
        if (cell.querySelector('svg, .tile-ico')) return;
        const kind = cell.classList[0];
        const lab = cell.querySelector(LABEL);
        const txt = (lab ? lab.textContent : cell.textContent) || '';
        const span = document.createElement('span');
        span.className = 'tile-ico';
        span.setAttribute('aria-hidden', 'true');
        span.innerHTML = AP.icon(pick(txt, FALLBACK[kind] || 'info'));
        cell.insertBefore(span, cell.firstChild);
        cell.classList.add('has-tile-ico');
      });
    } finally { busy = false; }
  };

  const target = document.getElementById('app') || document.querySelector('main') || document.body;
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    const run = () => { queued = false; decorate(document); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
  };
  new MutationObserver(schedule).observe(target, { childList: true, subtree: true });
  decorate(document);
})();
