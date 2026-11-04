// «نوار بازه» — کامپوننت مشترک انتخاب بازه‌ی زمانی در کل پنل (یوزرفرندلی و یکدست)
//   • چیپ‌های سریع (امروز، ۷ روز اخیر، این ماه، ماه قبل …) با تشخیص خودکار چیپ فعال
//   • خلاصه‌ی خوانا: «۱۴ مهر ۱۴۰۵ تا ۱۳ آبان ۱۴۰۵ · ۳۰ روز»
//   • تاریخ‌های دلخواه با تقویم شمسی (ورودی‌های name=from / name=to؛ مقدار فرم همچنان میلادی است)
//   • اعتبارسنجی: «از» بعد از «تا» ⇒ پیام فارسی و درخواست ارسال نمی‌شود
//   • AP.monthStepper: ماه قبل/بعد/ماه جاری برای فرم‌های «سال + ماه»
//
// استفاده (صفحه‌هایی که فرم from/to دارند):
//   html:  AP.rangeBar.html({ from, to, presets: ['today', '7', '30', 'month'] })      ← داخل <form class="filters">
//   mount: AP.dates.mount(form); AP.rangeBar.bind(form);   ← پس از mount تقویم، قبل/بعد از listenerهای صفحه فرقی ندارد
//   بدون onApply: چیپ‌ها هر دو تاریخ را می‌نویسند و یک change روی «تا» می‌فرستند؛ listenerهای قبلی صفحه همان‌طور کار می‌کنند.
//   با onApply(from, to): کامپوننت خودش تغییرها را می‌گیرد و فقط بازه‌ی معتبر را می‌دهد.
(function () {
  'use strict';

  const AP = window.AP;
  const J = window.Jalali;
  if (!AP || !J) return;
  const { fmt, esc } = AP;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const DAY = 86400000;
  const utc = (iso) => { const g = J.parseIso(iso); return g ? Date.UTC(g.gy, g.gm - 1, g.gd) : NaN; };
  const dayCount = (from, to) => Math.round((utc(to) - utc(from)) / DAY) + 1;
  const num = (n) => J.toFaDigits(String(n));

  // ---------- چیپ‌های آماده ----------
  const monthStart = (iso) => { const j = J.isoToJalali(iso); return J.jalaliToIso(j.jy, j.jm, 1); };
  const PRESETS = {
    today: { label: 'امروز', range: () => ({ from: fmt.today(), to: fmt.today() }) },
    yesterday: { label: 'دیروز', range: () => ({ from: fmt.daysAgo(1), to: fmt.daysAgo(1) }) },
    week: { label: 'این هفته', range: () => ({ from: fmt.daysAgo(Math.max(0, J.weekdayIndex(fmt.today()))), to: fmt.today() }) },
    7: { label: '۷ روز اخیر', range: () => ({ from: fmt.daysAgo(6), to: fmt.today() }) },
    14: { label: '۱۴ روز اخیر', range: () => ({ from: fmt.daysAgo(13), to: fmt.today() }) },
    30: { label: '۳۰ روز اخیر', range: () => ({ from: fmt.daysAgo(29), to: fmt.today() }) },
    90: { label: '۹۰ روز اخیر', range: () => ({ from: fmt.daysAgo(89), to: fmt.today() }) },
    month: { label: 'این ماه', range: () => ({ from: monthStart(fmt.today()), to: fmt.today() }) },
    lastMonth: {
      label: 'ماه قبل',
      range: () => {
        const j = J.isoToJalali(fmt.today());
        const jy = j.jm === 1 ? j.jy - 1 : j.jy;
        const jm = j.jm === 1 ? 12 : j.jm - 1;
        return { from: J.jalaliToIso(jy, jm, 1), to: J.jalaliToIso(jy, jm, J.monthLength(jy, jm)) };
      },
    },
  };
  const DEFAULT_PRESETS = ['today', '7', '30', 'month', 'lastMonth', '90'];

  const matchPreset = (keys, from, to) => keys.find((k) => {
    const r = PRESETS[k].range();
    return r.from === from && r.to === to;
  }) || '';

  const summaryHtml = (from, to) => {
    if (!from || !to) return '<span class="rb-sum-empty">بازه‌ای انتخاب نشده است</span>';
    if (from > to) return '<span class="rb-sum-bad">تاریخ شروع بعد از تاریخ پایان است</span>';
    const n = dayCount(from, to);
    const body = from === to
      ? `<b>${esc(fmt.dateLong(from))}</b>`
      : `<b>${esc(fmt.dateLong(from))}</b><i>تا</i><b>${esc(fmt.dateLong(to))}</b>`;
    return `<em><strong>${num(n)}</strong> روز</em><span class="rb-sum-dates">${body}</span>`;
  };

  // ---------- html ----------
  // opts: { from, to, label, presets, fields (نمایش «از/تا»؛ پیش‌فرض true), months (تعداد ماه کامل در منوی «ماه کامل»), active }
  function html(opts) {
    const o = opts || {};
    const keys = (o.presets || DEFAULT_PRESETS).filter((k) => PRESETS[k]);
    const cur = o.active !== undefined ? o.active : matchPreset(keys, o.from, o.to);
    const chips = keys.map((k) => `<button type="button" class="rb-chip${cur === k ? ' is-active' : ''}" data-rb-preset="${k}" aria-pressed="${cur === k}">${PRESETS[k].label}</button>`).join('');
    let monthsSel = '';
    if (o.months) {
      const t = J.isoToJalali(fmt.today());
      let { jy, jm } = t;
      const opt = [];
      for (let i = 0; i < o.months; i += 1) {
        const from = J.jalaliToIso(jy, jm, 1);
        opt.push(`<option value="${from}">${esc(J.MONTH_NAMES[jm - 1])} ${num(jy)}</option>`);
        jm -= 1; if (jm < 1) { jm = 12; jy -= 1; }
      }
      monthsSel = `<label class="rb-months"><span class="sr-only">ماه کامل</span><select data-rb-month aria-label="انتخاب یک ماه کامل"><option value="">ماه کامل…</option>${opt.join('')}</select></label>`;
    }
    const fields = o.fields === false ? '' : `
      <div class="rb-fields">
        <label class="field"><span>از</span><input type="date" name="from" value="${esc(o.from || '')}" /></label>
        <span class="rb-arrow" aria-hidden="true">←</span>
        <label class="field"><span>تا</span><input type="date" name="to" value="${esc(o.to || '')}" /></label>
      </div>`;
    return `<div class="rb" data-rb>
      <div class="rb-top">
        <span class="rb-label">${AP.icon('calendar')}${esc(o.label || 'بازه‌ی زمانی')}</span>
        <div class="rb-chips" role="group" aria-label="بازه‌های آماده">${chips}${monthsSel}</div>
      </div>
      <div class="rb-foot">${fields}<div class="rb-summary" data-rb-summary aria-live="polite">${summaryHtml(o.from, o.to)}</div></div>
    </div>`;
  }

  // ---------- نوشتن مقدار بدون تحریک ----------
  function setInput(root, name, iso) {
    const el = $(`[name="${name}"]`, root);
    if (!el) return;
    el.value = iso || '';
    const vis = el.type === 'hidden' ? el.previousElementSibling : null; // ورودی ظاهری datepicker
    if (vis && vis.classList && vis.classList.contains('jdp-input')) {
      vis.value = iso ? J.formatIso(iso) : '';
      vis.removeAttribute('aria-invalid');
    }
  }
  const readInput = (root, name) => { const el = $(`[name="${name}"]`, root); return el ? String(el.value || '') : ''; };

  // ---------- bind ----------
  // root: عنصری که .rb و ورودی‌های from/to داخل آن است؛ opts.onApply(from, to, key)
  function bind(root, opts) {
    const o = opts || {};
    const rb = $('[data-rb]', root);
    if (!rb) return;
    const sum = $('[data-rb-summary]', rb);
    const chipsEl = $$('[data-rb-preset]', rb);
    const keys = chipsEl.map((b) => b.dataset.rbPreset);

    const paint = (from, to) => {
      if (sum) sum.innerHTML = summaryHtml(from, to);
      const bad = !!(from && to && from > to);
      rb.classList.toggle('is-invalid', bad);
      const cur = bad ? '' : matchPreset(keys, from, to);
      chipsEl.forEach((b) => { const on = b.dataset.rbPreset === cur; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
    };

    const apply = (from, to, key) => {
      if (o.onApply) { paint(from, to); o.onApply(from, to, key); return; }
      // بدون onApply: همان listenerهای قبلی صفحه؛ دو تاریخ بی‌صدا نوشته می‌شود و یک change می‌رود
      setInput(root, 'from', from);
      setInput(root, 'to', to);
      paint(from, to);
      const last = $('[name="to"]', root);
      if (last) last.dispatchEvent(new Event('change', { bubbles: true }));
    };

    chipsEl.forEach((b) => b.addEventListener('click', () => {
      const r = PRESETS[b.dataset.rbPreset].range();
      apply(r.from, r.to, b.dataset.rbPreset);
    }));

    const ms = $('[data-rb-month]', rb);
    if (ms) {
      ms.addEventListener('change', (e) => {
        e.stopImmediatePropagation(); // این select فقط چیپ است؛ listenerهای بعدیِ صفحه (روی همه‌ی select ها) دوباره اجرا نشوند
        if (!ms.value) return;
        const j = J.isoToJalali(ms.value);
        const end = J.jalaliToIso(j.jy, j.jm, J.monthLength(j.jy, j.jm));
        const today = fmt.today();
        apply(ms.value, end > today ? today : end, 'm');
      });
    }

    // ورودی‌های دستی: بازه‌ی نامعتبر هرگز به listenerهای صفحه نمی‌رسد (capture)
    const onField = (e) => {
      const n = e.target && e.target.name;
      if (n !== 'from' && n !== 'to') return;
      const from = readInput(root, 'from');
      const to = readInput(root, 'to');
      paint(from, to);
      if (from && to && from > to) {
        e.stopPropagation();
        if (AP.toast) AP.toast('تاریخ شروع نباید بعد از تاریخ پایان باشد.', true);
        return;
      }
      if (o.onApply) { e.stopPropagation(); if (from && to) o.onApply(from, to, ''); }
    };
    root.addEventListener('change', onField, true);
    paint(readInput(root, 'from'), readInput(root, 'to'));
    if (ms) ms.value = '';
  }

  AP.rangeBar = { html, bind, PRESETS, summaryHtml, dayCount };

  // ======================================================
  // AP.monthStepper — «سال + ماه» با دکمه‌های قبل/بعد/ماه جاری (فرم‌های ماهانه)
  //   فرم باید input[name=year] و select[name=month] داشته باشد (همان‌ها نگه داشته می‌شوند؛ مقدار فرم تغییری نمی‌کند)
  // ======================================================
  function monthStepper(form) {
    const yEl = $('input[name="year"]', form);
    const mEl = $('select[name="month"]', form);
    if (!yEl || !mEl || form.dataset.rbMonth) return;
    form.dataset.rbMonth = '1';
    const yField = yEl.closest('.field');
    const mField = mEl.closest('.field');
    if (!yField || !mField) return;
    const wrap = document.createElement('div');
    wrap.className = 'rb-month';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'انتخاب ماه');
    const mkBtn = (cls, label, txt, title) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); if (title) b.title = title; b.textContent = txt; return b; };
    const prev = mkBtn('rb-step', 'ماه قبل', '›', 'ماه قبل');
    const next = mkBtn('rb-step', 'ماه بعد', '‹', 'ماه بعد');
    const now = mkBtn('rb-chip rb-now', 'رفتن به ماه جاری', 'ماه جاری');
    yField.before(wrap);
    wrap.append(prev, mField, yField, next, now);

    const fire = () => ['input', 'change'].forEach((t) => (t === 'input' ? yEl : mEl).dispatchEvent(new Event(t, { bubbles: true })));
    const cur = () => ({ jy: Number(yEl.value) || J.isoToJalali(fmt.today()).jy, jm: Number(mEl.value) || 1 });
    const set = (jy, jm) => {
      const lo = Number(yEl.min) || 1300; const hi = Number(yEl.max) || 1500;
      if (jy < lo || jy > hi) return;
      yEl.value = String(jy); mEl.value = String(jm);
      fire();
    };
    const step = (d) => { const { jy, jm } = cur(); let ny = jy; let nm = jm + d; if (nm < 1) { nm = 12; ny -= 1; } if (nm > 12) { nm = 1; ny += 1; } set(ny, nm); };
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    now.addEventListener('click', () => { const t = J.isoToJalali(fmt.today()); set(t.jy, t.jm); });
    // ماه جاری نبودن را نشان بده
    const sync = () => { const t = J.isoToJalali(fmt.today()); const c = cur(); now.classList.toggle('is-active', c.jy === t.jy && c.jm === t.jm); };
    yEl.addEventListener('input', sync); mEl.addEventListener('change', sync); sync();
  }
  AP.monthStepper = monthStepper;
}());
