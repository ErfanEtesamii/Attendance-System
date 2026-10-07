// datepicker شمسی سبک (S3-10b) — RTL، کیبوردی، بدون وابستگی/CDN. به jalali.js (S3-10a) وابسته است.
// کاربر تاریخ شمسی می‌بیند/تایپ می‌کند (ارقام فارسی/انگلیسی)؛ مقدار نهایی فرم **میلادی YYYY-MM-DD** است:
//   input ظاهری اسم خود را به یک input مخفی می‌دهد و ISO را آنجا می‌نویسد، پس AP.formData همان ISO را می‌خواند.
// هنوز در هیچ صفحه‌ای اعمال نشده (S3-11).
//
// استفاده:  const dp = JalaliDatepicker.attach(inputEl, { min:'2026-01-01', max:'2027-01-01', value:'2026-03-21', onChange(iso){} });
//           dp.getValue() → 'YYYY-MM-DD' | ''؛ dp.setValue(iso|''), dp.open(), dp.close(), dp.destroy()
// کیبورد (روی تقویم): ←/→ روز بعد/قبل (RTL: → = روز قبل)، ↑/↓ هفته، PageUp/PageDown ماه، Shift+Page سال، Home/End اول/آخر ماه، Enter/Space انتخاب، Esc بستن.
// روی input: ↓ باز می‌کند؛ Enter/blur تایپ را اعتبارسنجی می‌کند (نامعتبر ⇒ aria-invalid و مقدار مخفی خالی).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./jalali.js'));
  else root.JalaliDatepicker = factory(root.Jalali);
}(typeof self !== 'undefined' ? self : this, function (J) {
  'use strict';

  var DAY_MS = 86400000;
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  // ---------- منطق خالص (بدون DOM؛ قابل تست) ----------
  function isoToUtc(iso) { var g = J.parseIso(iso); return Date.UTC(g.gy, g.gm - 1, g.gd); }
  function utcToIso(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function addDays(iso, n) { return utcToIso(isoToUtc(iso) + n * DAY_MS); }
  // افزودن ماه شمسی؛ روز در ماه کوتاه‌تر کلمپ می‌شود (۳۱ شهریور + ۱ ماه ⇒ ۳۰ مهر)
  function addMonths(iso, n) {
    var j = J.isoToJalali(iso);
    var idx = j.jy * 12 + (j.jm - 1) + n;
    var jy = Math.floor(idx / 12), jm = idx - jy * 12 + 1;
    return J.jalaliToIso(jy, jm, Math.min(j.jd, J.monthLength(jy, jm)));
  }
  function clamp(iso, min, max) { if (min && iso < min) return min; if (max && iso > max) return max; return iso; }

  // شبکه‌ی ماه: هفته‌ها از شنبه تا جمعه؛ خانه‌های خالی ابتدا/انتها null
  function monthGrid(jy, jm) {
    var len = J.monthLength(jy, jm);
    var first = J.weekdayIndex(J.jalaliToIso(jy, jm, 1));
    var cells = [];
    var i;
    for (i = 0; i < first; i += 1) cells.push(null);
    for (i = 1; i <= len; i += 1) cells.push({ jd: i, iso: J.jalaliToIso(jy, jm, i), weekday: (first + i - 1) % 7 });
    while (cells.length % 7) cells.push(null);
    var weeks = [];
    for (i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  // کلید → تاریخ جدید (یا null اگر کلید مربوط نیست). RTL: ArrowRight = قبل.
  function navigate(iso, key, shift) {
    switch (key) {
      case 'ArrowRight': return addDays(iso, -1);
      case 'ArrowLeft': return addDays(iso, 1);
      case 'ArrowUp': return addDays(iso, -7);
      case 'ArrowDown': return addDays(iso, 7);
      case 'PageUp': return shift ? addMonths(iso, -12) : addMonths(iso, -1);
      case 'PageDown': return shift ? addMonths(iso, 12) : addMonths(iso, 1);
      case 'Home': { var a = J.isoToJalali(iso); return J.jalaliToIso(a.jy, a.jm, 1); }
      case 'End': { var b = J.isoToJalali(iso); return J.jalaliToIso(b.jy, b.jm, J.monthLength(b.jy, b.jm)); }
      default: return null;
    }
  }

  function localToday() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // ---------- DOM ----------
  var uid = 0;

  function attach(input, opts) {
    opts = opts || {};
    var doc = input.ownerDocument;
    var id = 'jdp' + (uid += 1);
    var min = opts.min && J.parseIso(opts.min) ? opts.min : '';
    var max = opts.max && J.parseIso(opts.max) ? opts.max : '';
    var value = '';      // ISO انتخاب‌شده
    var cursor = '';     // ISO روزی که فوکوس کیبورد دارد
    var view = null;     // { jy, jm } ماه نمایش‌داده‌شده
    var pop = null;

    // input مخفی حامل مقدار میلادی؛ اسم/required از input ظاهری به آن منتقل می‌شود
    var hidden = doc.createElement('input');
    hidden.type = 'hidden';
    var name = input.getAttribute('name');
    if (name) { hidden.name = name; input.removeAttribute('name'); }
    input.parentNode.insertBefore(hidden, input.nextSibling);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('dir', 'ltr');
    input.setAttribute('placeholder', input.getAttribute('placeholder') || '۱۴۰۵/۰۱/۰۱');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-haspopup', 'dialog');
    input.setAttribute('aria-expanded', 'false');
    input.classList.add('jdp-input');

    function inRange(iso) { return (!min || iso >= min) && (!max || iso <= max); }

    function commit(iso, silent) {
      value = iso || '';
      hidden.value = value;
      input.value = value ? J.formatIso(value) : '';
      input.removeAttribute('aria-invalid');
      if (!silent) {
        hidden.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
        if (typeof opts.onChange === 'function') opts.onChange(value);
      }
    }

    // تایپ کاربر: خالی ⇒ پاک؛ معتبر و در بازه ⇒ ISO؛ غیر این ⇒ نامعتبر (مقدار مخفی خالی تا فرم نامعتبر را نفرستد)
    function applyTyped() {
      var text = input.value.trim();
      if (!text) { if (value) commit('', false); input.removeAttribute('aria-invalid'); return; }
      var iso = J.parseToIso(text);
      if (iso && inRange(iso)) { if (iso !== value) commit(iso, false); else input.value = J.formatIso(iso); return; }
      value = ''; hidden.value = '';
      input.setAttribute('aria-invalid', 'true');
    }

    function isOpen() { return !!pop; }

    function render() {
      var grid = monthGrid(view.jy, view.jm);
      var today = opts.today || localToday();
      var prevOk = !min || J.jalaliToIso(view.jy, view.jm, 1) > min;
      var lastIso = J.jalaliToIso(view.jy, view.jm, J.monthLength(view.jy, view.jm));
      var nextOk = !max || lastIso < max;
      var h = '<div class="jdp-head">' +
        '<button type="button" class="jdp-nav" data-act="prev-year" aria-label="سال قبل">«</button>' +
        '<button type="button" class="jdp-nav" data-act="prev-month" aria-label="ماه قبل"' + (prevOk ? '' : ' disabled') + '>‹</button>' +
        '<div class="jdp-title" aria-live="polite">' + J.MONTH_NAMES[view.jm - 1] + ' ' + J.toFaDigits(String(view.jy)) + '</div>' +
        '<button type="button" class="jdp-nav" data-act="next-month" aria-label="ماه بعد"' + (nextOk ? '' : ' disabled') + '>›</button>' +
        '<button type="button" class="jdp-nav" data-act="next-year" aria-label="سال بعد">»</button></div>';
      h += '<div class="jdp-grid" role="grid" aria-label="' + J.MONTH_NAMES[view.jm - 1] + ' ' + J.toFaDigits(String(view.jy)) + '"><div class="jdp-row" role="row">';
      J.WEEKDAY_NAMES.forEach(function (n, i) { h += '<span class="jdp-wd' + (i === 6 ? ' jdp-fri' : '') + '" role="columnheader" title="' + n + '">' + n.charAt(0) + '</span>'; });
      h += '</div>';
      grid.forEach(function (week) {
        h += '<div class="jdp-row" role="row">';
        week.forEach(function (c) {
          if (!c) { h += '<span class="jdp-cell jdp-empty" role="gridcell"></span>'; return; }
          var dis = !inRange(c.iso);
          var cls = 'jdp-cell jdp-day' + (c.weekday === 6 ? ' jdp-fri' : '') + (c.iso === today ? ' jdp-today' : '') + (c.iso === value ? ' jdp-selected' : '');
          h += '<button type="button" role="gridcell" class="' + cls + '" data-iso="' + c.iso + '" tabindex="' + (c.iso === cursor ? '0' : '-1') + '"' +
            (c.iso === value ? ' aria-selected="true"' : '') + (dis ? ' disabled' : '') + ' aria-label="' + J.formatIso(c.iso, { long: true }) + '">' + J.toFaDigits(String(c.jd)) + '</button>';
        });
        h += '</div>';
      });
      h += '</div><div class="jdp-foot"><button type="button" class="jdp-link" data-act="today"' + (inRange(today) ? '' : ' disabled') + '>امروز</button>' +
        '<button type="button" class="jdp-link" data-act="clear">پاک‌کردن</button></div>';
      pop.innerHTML = h;
    }

    function focusCursor() { var el = pop && pop.querySelector('.jdp-day[data-iso="' + cursor + '"]'); if (el) el.focus(); }

    function goto(iso, focus) {
      iso = clamp(iso, min, max);
      cursor = iso;
      var j = J.isoToJalali(iso);
      view = { jy: j.jy, jm: j.jm };
      render();
      if (focus) focusCursor();
    }

    function position() {
      var r = input.getBoundingClientRect();
      var win = doc.defaultView;
      pop.style.top = (r.bottom + win.pageYOffset + 4) + 'px';
      var w = pop.offsetWidth || 280;
      var left = r.right + win.pageXOffset - w; // لبه‌ی راست popup با لبه‌ی راست input (RTL)
      pop.style.left = Math.max(8, left) + 'px';
    }

    function open() {
      if (pop || input.disabled || input.readOnly) return;
      applyTyped();
      pop = doc.createElement('div');
      pop.className = 'jdp-pop';
      pop.id = id;
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'انتخاب تاریخ شمسی');
      pop.setAttribute('dir', 'rtl');
      doc.body.appendChild(pop);
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', id);
      goto(value || clamp(opts.today || localToday(), min, max), false);
      position();
      pop.addEventListener('mousedown', function (e) { e.preventDefault(); }); // blur input نشود
      pop.addEventListener('click', onClick);
      pop.addEventListener('keydown', onKey);
      doc.addEventListener('mousedown', onOutside, true);
    }

    function close(refocus) {
      if (!pop) return;
      doc.removeEventListener('mousedown', onOutside, true);
      pop.remove();
      pop = null;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
      if (refocus) input.focus();
    }

    function pick(iso) { commit(iso, false); close(true); }

    function onClick(e) {
      var day = e.target.closest('.jdp-day');
      if (day && !day.disabled) return pick(day.getAttribute('data-iso'));
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return undefined;
      var act = btn.getAttribute('data-act');
      if (act === 'prev-month') goto(addMonths(cursor, -1), false);
      else if (act === 'next-month') goto(addMonths(cursor, 1), false);
      else if (act === 'prev-year') goto(addMonths(cursor, -12), false);
      else if (act === 'next-year') goto(addMonths(cursor, 12), false);
      else if (act === 'today') pick(clamp(opts.today || localToday(), min, max));
      else if (act === 'clear') { commit('', false); close(true); }
      return undefined;
    }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { close(false); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('jdp-day')) { e.preventDefault(); if (!e.target.disabled) pick(e.target.getAttribute('data-iso')); return; }
      if (!e.target.classList.contains('jdp-day')) return;
      var next = navigate(cursor, e.key, e.shiftKey);
      if (next) { e.preventDefault(); goto(next, true); }
    }

    function onOutside(e) { if (pop && !pop.contains(e.target) && e.target !== input) close(false); }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(); focusCursor(); }
      else if (e.key === 'Enter') { applyTyped(); if (isOpen()) close(false); }
      else if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); close(false); }
    });
    input.addEventListener('click', function () { if (!isOpen()) open(); });
    input.addEventListener('blur', function () { if (!isOpen()) applyTyped(); });

    if (opts.value && J.parseIso(opts.value)) commit(opts.value, true);

    return {
      open: open,
      close: function () { close(false); },
      isOpen: isOpen,
      getValue: function () { return value; },
      setValue: function (iso) { commit(iso && J.parseIso(iso) ? iso : '', true); },
      destroy: function () { close(false); if (name) input.setAttribute('name', name); hidden.remove(); input.classList.remove('jdp-input'); },
    };
  }

  return { attach: attach, monthGrid: monthGrid, addDays: addDays, addMonths: addMonths, navigate: navigate };
}));
