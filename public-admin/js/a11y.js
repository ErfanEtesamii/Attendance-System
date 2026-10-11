// دسترس‌پذیری پنل (S5-9a): تله‌ی فوکوس مودال، کیبورد برای ردیف‌های کلیک‌پذیر و سرستون‌های مرتب‌سازی.
// منطق خالص (nextIndex/sortState) بدون DOM قابل‌تست است؛ بقیه فقط به API استاندارد DOM وابسته‌اند.
(function (root) {
  'use strict';
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  // خالص: اندیس بعدی در چرخه‌ی Tab (shift = برعکس)؛ cur < 0 یعنی فوکوس بیرون است
  function nextIndex(len, cur, shift) {
    if (!(len > 0)) return -1;
    if (cur < 0) return shift ? len - 1 : 0;
    return shift ? (cur - 1 + len) % len : (cur + 1) % len;
  }
  // خالص: متن سرستون مرتب‌سازی (▲/▼) ⇒ مقدار aria-sort
  function sortState(text) {
    const t = String(text || '');
    if (t.includes('▲')) return 'ascending';
    if (t.includes('▼')) return 'descending';
    return 'none';
  }

  function focusables(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !(el.closest && el.closest('.hidden')));
  }

  // فقط وقتی فوکوس به لبه‌ی مودال رسیده (یا بیرون آن است) Tab را به لبه‌ی دیگر می‌چرخاند؛ بقیه‌ی Tabها طبیعی‌اند
  function trapTab(e, container, active) {
    if (!e || e.key !== 'Tab') return false;
    const list = focusables(container);
    if (!list.length) { e.preventDefault(); if (container.focus) container.focus(); return true; }
    const cur = list.indexOf(active);
    const inside = cur >= 0;
    const atEdge = !inside || (e.shiftKey && cur === 0) || (!e.shiftKey && cur === list.length - 1);
    if (!atEdge) return false;
    e.preventDefault();
    list[nextIndex(list.length, inside ? cur : -1, !!e.shiftKey)].focus();
    return true;
  }

  // جدول → کارت در موبایل (S5-9c): به هر سلول برچسب ستون می‌دهد (CSS زیر ۶۰۰px از data-label می‌خواند).
  // جدول‌های سرستون-مرتب‌سازی (th.sortable)، تقویم (.cal-table) و data-nostack همان اسکرول افقی را نگه می‌دارند.
  // چون display:block نقش جدول را در برخی مرورگرها می‌شکند، نقش‌های ARIA هم صریح گذاشته می‌شود.
  function stackTable(table) {
    if (!table || !table.querySelectorAll || table.hasAttribute('data-stack') || table.hasAttribute('data-nostack')) return false;
    if (String(table.className || '').includes('cal-table')) return false;
    if (table.querySelectorAll('th.sortable, th[data-sort]').length) return false;
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => String(th.textContent || '').replace(/[▲▼]/g, '').trim());
    if (!heads.length) return false;
    table.setAttribute('data-stack', '');
    table.setAttribute('role', 'table');
    table.querySelectorAll('thead, tbody').forEach((g) => g.setAttribute('role', 'rowgroup'));
    table.querySelectorAll('th').forEach((th) => th.setAttribute('role', 'columnheader'));
    table.querySelectorAll('tr').forEach((tr) => {
      tr.setAttribute('role', 'row');
      const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD');
      cells.forEach((td) => td.setAttribute('role', 'cell'));
      if (cells.some((c) => Number(c.getAttribute('colspan')) > 1)) return; // ردیف پیام خالی/تجمیعی: برچسب ندارد
      cells.forEach((td, i) => { if (heads[i] && !td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i]); });
    });
    return true;
  }

  // ردیف‌های کلیک‌پذیر و سرستون‌های مرتب‌سازی را با کیبورد قابل‌دسترس می‌کند (idempotent)
  function enhance(scope) {
    const rootEl = scope || (root && root.document);
    if (!rootEl || !rootEl.querySelectorAll) return;
    rootEl.querySelectorAll('.table-wrap table').forEach(stackTable);
    // ناحیه‌ی اسکرول افقی جدول: اگر سرریز دارد با کیبورد هم قابل‌اسکرول باشد
    rootEl.querySelectorAll('.table-wrap').forEach((el) => {
      if (el.scrollWidth > el.clientWidth && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
    rootEl.querySelectorAll('tr.clickable, th.sortable, th[data-sort]').forEach((el) => {
      el.setAttribute('data-kbd', '');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (el.tagName === 'TH') el.setAttribute('aria-sort', sortState(el.textContent));
    });
  }

  const api = { FOCUSABLE, nextIndex, sortState, focusables, trapTab, enhance, stackTable };

  if (root && root.document) {
    // Enter/Space روی عنصر قابل‌فوکوسِ کلیک‌پذیر = کلیک (فقط وقتی خودِ آن عنصر فوکوس دارد، نه کنترل داخلش)
    root.document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target;
      if (!el || !el.hasAttribute || !el.hasAttribute('data-kbd')) return;
      e.preventDefault();
      el.click();
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.A11y = api;
}(typeof window !== 'undefined' ? window : undefined));
