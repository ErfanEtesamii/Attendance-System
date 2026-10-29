// تب «برنامه‌ی روزبه‌روز» در پرونده‌ی کارمند (فاز ۱۲، B2): شبکه‌ی ماهانه‌ی شمسی؛ هر روز برنامه‌ی مؤثر (override ← شیفت ← سراسری)
// با نشان رنگی برای روزهای «برنامه‌ی ویژه». با مجوز schedule.manage با کلیک روی روز: روز کاری با ساعت دلخواه، آف، یا برگشت به شیفت.
// API: GET /admin/users/:id/schedule?from=&to= ، PUT/DELETE /admin/users/:id/schedule/:date (قواعد و قفل ماه بسته سمت سرور).

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc } = AP;
  const J = window.Jalali;
  const fa = (v) => J.toFaDigits(String(v));
  const ui = { year: 0, month: 0 };
  const YEAR_MIN = 1300;
  const YEAR_MAX = 1500;
  const WEEK = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // شنبه … جمعه

  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function ensureMonth() {
    if (ui.year) return;
    const j = J.isoToJalali(todayIso());
    ui.year = j.jy;
    ui.month = j.jm;
  }
  function step(delta) {
    let y = ui.year;
    let m = ui.month + delta;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    if (y < YEAR_MIN || y > YEAR_MAX) return false;
    ui.year = y;
    ui.month = m;
    return true;
  }
  const range = () => ({ from: J.jalaliToIso(ui.year, ui.month, 1), to: J.jalaliToIso(ui.year, ui.month, J.monthLength(ui.year, ui.month)) });

  // وضعیت نمایشی هر روز از پاسخ API (خالص)
  function cellModel(day) {
    const eff = day.effective;
    const sp = day.schedule;
    let cls = eff.isWorkingDay ? 'sch-work' : 'sch-off';
    if (sp) cls = sp.kind === 'off' ? 'sch-sp-off' : 'sch-sp-work';
    const text = eff.isWorkingDay ? `${fa(eff.expectedStart)}–${fa(eff.expectedEnd)}` : (sp ? 'آف' : (eff.isHoliday ? 'تعطیل' : '—'));
    const title = `${J.format ? J.format(J.isoToJalali(day.date)) : day.date} — ${eff.isWorkingDay ? `${eff.expectedStart} تا ${eff.expectedEnd}` : 'غیرکاری'}${sp ? ' (برنامه‌ی ویژه)' : ''}${sp && sp.note ? ` — ${sp.note}` : ''}`;
    return { cls, text, title };
  }

  function gridHtml(days, canManage) {
    const first = days.length ? J.weekdayIndex ? J.weekdayIndex(days[0].date) : 0 : 0;
    const blanks = Array.from({ length: Math.max(0, first) }, () => '<span class="sch-cell sch-blank" aria-hidden="true"></span>').join('');
    const cells = days.map((d) => {
      const m = cellModel(d);
      const jd = J.isoToJalali(d.date).jd;
      const inner = `<span class="sch-d">${fa(jd)}</span><span class="sch-t">${esc(m.text)}</span>`;
      return canManage
        ? `<button type="button" class="sch-cell ${m.cls}" data-date="${esc(d.date)}" title="${esc(m.title)}">${inner}</button>`
        : `<span class="sch-cell ${m.cls}" title="${esc(m.title)}">${inner}</span>`;
    }).join('');
    return `<div class="sch-grid" role="grid">${WEEK.map((w) => `<span class="sch-w">${w}</span>`).join('')}${blanks}${cells}</div>
      <div class="sch-legend muted small"><span class="sch-key sch-work"></span> روز کاری عادی <span class="sch-key sch-sp-work"></span> برنامه‌ی ویژه (کار) <span class="sch-key sch-sp-off"></span> آف ویژه <span class="sch-key sch-off"></span> غیرکاری</div>`;
  }

  function editModal(u, day, done) {
    const sp = day.schedule;
    const eff = day.effective;
    const kind = sp ? sp.kind : 'default';
    AP.modal({
      title: `برنامه‌ی ${J.format ? J.format(J.isoToJalali(day.date)) : day.date} — ${u.fullName}`,
      body: `<form class="form" id="sch-form">
        <label class="field"><span>نوع روز</span><select name="kind">
          <option value="default"${kind === 'default' ? ' selected' : ''}>طبق شیفت/تنظیمات (بدون برنامه‌ی ویژه)</option>
          <option value="work"${kind === 'work' ? ' selected' : ''}>روز کاری با ساعت دلخواه</option>
          <option value="off"${kind === 'off' ? ' selected' : ''}>آف / غیرکاری</option></select></label>
        <div class="two-col" id="sch-times">
          <label class="field"><span>شروع</span><input type="time" name="startTime" value="${esc((sp && sp.startTime) || eff.expectedStart || '08:00')}" /></label>
          <label class="field"><span>پایان</span><input type="time" name="endTime" value="${esc((sp && sp.endTime) || eff.expectedEnd || '16:30')}" /></label>
        </div>
        <label class="field"><span>یادداشت (اختیاری، ≤ ۲۰۰ نویسه)</span><input type="text" name="note" maxlength="200" value="${esc((sp && sp.note) || '')}" /></label>
        <div class="form-msg err" role="alert"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ذخیره</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
      </form>`,
      onMount(body, m) {
        AP.dates.mount(body); // H4: ساعت شروع/پایان قابل‌تایپ (کیبورد عددی)؛ قبل از بستن listenerها
        const form = $('#sch-form', body);
        const sync = () => { $('#sch-times', body).hidden = form.kind.value !== 'work'; };
        sync();
        form.kind.addEventListener('change', sync);
        $('[data-cancel]', form).addEventListener('click', () => m.close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const msg = $('.form-msg', form);
          msg.textContent = '';
          const f = AP.formData(form);
          try {
            if (f.kind === 'default') {
              if (sp) {
                const sure = await AP.confirmBox({ title: 'حذف برنامه‌ی ویژه‌ی این روز', message: 'روز به شیفت/تنظیمات سراسری برمی‌گردد.', confirmText: 'حذف', danger: true });
                if (!sure) return;
                await AP.api(`/admin/users/${u.id}/schedule/${day.date}`, { method: 'DELETE' });
              }
            } else {
              await AP.api(`/admin/users/${u.id}/schedule/${day.date}`, { method: 'PUT', body: { kind: f.kind, startTime: f.kind === 'work' ? f.startTime : undefined, endTime: f.kind === 'work' ? f.endTime : undefined, note: f.note || undefined } });
            }
            AP.toast('برنامه‌ی روز ذخیره شد.');
            m.close();
            done();
          } catch (err) { msg.textContent = err.message; } // ماه بسته ⇒ ۴۰۹ با پیام فارسی سرور
        });
      },
    });
  }

  // انتخاب دسته‌ای: روزها با کشیدن موس رنگ می‌شوند (هر روزی که موس رویش می‌رود، بدون نیاز به ترتیب/پیوستگی) ⇒ یک تغییر برای همه.
  // work/off از POST /admin/schedule/bulk (قواعد و قفل ماه بسته سمت سرور)؛ «برگشت به شیفت» با DELETE روزهای دارای برنامه‌ی ویژه.
  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  function bulkModal(u, dates, days, done) {
    const fmtD = (d) => (J.format ? J.format(J.isoToJalali(d)) : d);
    const sorted = [...dates].sort();
    const from = sorted[0];
    const to = sorted[sorted.length - 1];
    // روزهای پیوسته یک بازه‌اند؛ هر بازه یک درخواست گروهی
    const runs = [];
    sorted.forEach((d) => {
      const last = runs[runs.length - 1];
      if (last && dayDiff(last[1], d) === 1) last[1] = d; else runs.push([d, d]);
    });
    AP.modal({
      title: `تغییر گروهی برنامه — ${u.fullName}`,
      body: `<form class="form" id="sch-bulk-form">
        <p class="muted">${fa(dates.length)} روز انتخاب شده${dates.length <= 8 ? ': ' + sorted.map((d) => fa(J.isoToJalali(d).jd)).join('، ') : ` (از ${esc(fmtD(from))} تا ${esc(fmtD(to))})`}</p>
        <label class="field"><span>نوع روز</span><select name="kind">
          <option value="off" selected>آف / غیرکاری</option>
          <option value="work">روز کاری با ساعت دلخواه</option>
          <option value="default">برگشت به شیفت/تنظیمات (حذف برنامه‌ی ویژه)</option></select></label>
        <div class="two-col" id="sch-bulk-times" hidden>
          <label class="field"><span>شروع</span><input type="time" name="startTime" value="08:00" /></label>
          <label class="field"><span>پایان</span><input type="time" name="endTime" value="16:30" /></label>
        </div>
        <label class="field" id="sch-bulk-note"><span>یادداشت (اختیاری، ≤ ۲۰۰ نویسه)</span><input type="text" name="note" maxlength="200" /></label>
        <div class="form-msg err" role="alert"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">اعمال روی ${fa(dates.length)} روز</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
      </form>`,
      onMount(body, m) {
        AP.dates.mount(body);
        const form = $('#sch-bulk-form', body);
        const sync = () => {
          $('#sch-bulk-times', body).hidden = form.kind.value !== 'work';
          $('#sch-bulk-note', body).hidden = form.kind.value === 'default';
        };
        sync();
        form.kind.addEventListener('change', sync);
        $('[data-cancel]', form).addEventListener('click', () => m.close());
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const msg = $('.form-msg', form);
          msg.textContent = '';
          const f = AP.formData(form);
          const btn = $('button[type="submit"]', form);
          btn.disabled = true;
          try {
            let failed = [];
            if (f.kind === 'default') {
              const withSp = sorted.filter((d) => { const day = days.find((x) => x.date === d); return day && day.schedule; });
              if (!withSp.length) { m.close(); AP.toast('روز انتخاب‌شده برنامه‌ی ویژه نداشت.'); return; }
              const sure = await AP.confirmBox({ title: 'حذف برنامه‌ی ویژه‌ی روزهای انتخاب‌شده', message: `${fa(withSp.length)} روز به شیفت/تنظیمات سراسری برمی‌گردد.`, confirmText: 'حذف', danger: true });
              if (!sure) return;
              for (const d of withSp) {
                try { await AP.api(`/admin/users/${u.id}/schedule/${d}`, { method: 'DELETE' }); } catch (err) { failed.push({ date: d, error: err.message }); }
              }
            } else {
              for (const [a, b] of runs) {
                const r = await AP.api('/admin/schedule/bulk', { method: 'POST', body: { userIds: [u.id], from: a, to: b, kind: f.kind, startTime: f.kind === 'work' ? f.startTime : undefined, endTime: f.kind === 'work' ? f.endTime : undefined, note: f.note || undefined } });
                failed.push(...(r.results || []).filter((x) => !x.ok));
              }
            }
            if (failed.length) {
              msg.textContent = `${fa(failed.length)} روز اعمال نشد: ${failed[0].error}`;
              done(); // روزهای موفق همین حالا در شبکه دیده شوند
              btn.disabled = false;
              return;
            }
            AP.toast('برنامه‌ی روزهای انتخاب‌شده ذخیره شد.');
            m.close();
            done();
          } catch (err) { msg.textContent = err.message; btn.disabled = false; }
        });
      },
    });
  }

  AP.scheduleTab = {
    html() {
      return '<div class="card" id="sch-root"></div>';
    },
    // F2-c: نمای هفتگی کارمند (views-weekly.js) از همین مودال برای «ویرایش برنامه‌ی این روز» استفاده می‌کند
    // تا منطق و قواعد B2 (قفل ماه بسته، PUT/DELETE) یک‌جا بماند. day باید شکل پاسخ GET /admin/users/:id/schedule را داشته باشد.
    editModal,
    // panel: عنصر محتوای تب؛ u: کارمند ({ id, fullName })
    mount(panel, u) {
      ensureMonth();
      const root = $('#sch-root', panel);
      const canManage = AP.can('schedule.manage');
      let days = [];
      const head = () => `<div class="sch-head"><button class="btn ghost small" data-step="-1" aria-label="ماه قبل">‹</button>
        <strong>${esc(J.MONTH_NAMES[ui.month - 1])} ${fa(ui.year)}</strong>
        <button class="btn ghost small" data-step="1" aria-label="ماه بعد">›</button>${canManage ? '<span class="muted small">برای تغییر، روی هر روز بزنید؛ برای تغییر گروهی، موس را روی چند روز بکشید.</span>' : ''}</div>`;
      async function load() {
        root.setAttribute('aria-busy', 'true');
        root.innerHTML = head() + (window.UiStates ? window.UiStates.skeletonHtml('list') : '<div class="loading">در حال بارگذاری…</div>');
        const { from, to } = range();
        try {
          const r = await AP.api(`/admin/users/${u.id}/schedule?from=${from}&to=${to}`);
          days = r.days || [];
          root.innerHTML = head() + (days.length ? gridHtml(days, canManage) : (window.UiStates ? window.UiStates.emptyHtml('روزی برای نمایش نیست.') : '<p class="muted">روزی برای نمایش نیست.</p>'));
        } catch (err) {
          root.innerHTML = head() + (window.UiStates
            ? window.UiStates.errorHtml(err.message, { icon: AP.icon('alert'), retryId: 'sch-retry', esc })
            : `<p class="form-msg err" role="alert">${esc(err.message)}</p>`);
        }
        root.removeAttribute('aria-busy');
        paintSel();
      }

      // انتخاب با کشیدن: هر روزی که موس رویش می‌رود به انتخاب اضافه می‌شود (غیرپیوسته هم می‌شود)؛ انتخاب پس از رها کردن می‌ماند
      // و نوار «تغییر وضعیت» ظاهر می‌شود. وقتی انتخابی هست، کلیک روی روز آن را اضافه/کم می‌کند. Esc انتخاب را پاک می‌کند.
      const sel = new Set();
      let painting = false;
      let startDate = null;
      let suppressClick = false;
      const cellOf = (el) => (el && el.closest ? el.closest('button.sch-cell[data-date]') : null);
      const paintSel = () => {
        $$('button.sch-cell[data-date]', root).forEach((c) => c.classList.toggle('sch-sel', sel.has(c.dataset.date)));
        root.classList.toggle('sch-dragging', painting);
        let bar = $('#sch-selbar', root);
        if (!sel.size) { if (bar) bar.remove(); return; }
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'sch-selbar';
          bar.className = 'sch-selbar';
          const grid = $('.sch-grid', root);
          if (grid) grid.parentNode.insertBefore(bar, grid); else root.appendChild(bar);
        }
        bar.innerHTML = `<strong>${fa(sel.size)} روز انتخاب شده</strong>
          <button type="button" class="btn primary small" data-sel-apply>تغییر وضعیت</button>
          <button type="button" class="btn ghost small" data-sel-clear>لغو انتخاب</button>`;
      };
      const clearSel = () => { sel.clear(); painting = false; paintSel(); };
      function onMove(e) {
        if (!painting) return;
        const c = cellOf(document.elementFromPoint(e.clientX, e.clientY));
        if (!c) return;
        if (c.dataset.date !== startDate || suppressClick) {
          if (startDate) { sel.add(startDate); startDate = null; } // روز شروع با اولین حرکت به روز دیگر وارد انتخاب می‌شود
          sel.add(c.dataset.date);
          suppressClick = true;
          paintSel();
        }
      }
      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        painting = false;
        if (suppressClick) setTimeout(() => { suppressClick = false; }, 0); // کلیکِ بعد از رها کردن نباید انتخاب را برعکس کند
        paintSel();
      }
      if (canManage) {
        root.addEventListener('pointerdown', (e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0) return; // لمس: اسکرول صفحه حفظ می‌شود
          const c = cellOf(e.target);
          if (!c) return;
          painting = true;
          suppressClick = false;
          startDate = c.dataset.date;
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
          document.addEventListener('pointercancel', onUp);
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel.size && root.isConnected) clearSel(); });
      }
      root.addEventListener('click', (e) => {
        if (suppressClick) { suppressClick = false; return; }
        if (e.target.closest('[data-sel-clear]')) { clearSel(); return; }
        if (e.target.closest('[data-sel-apply]')) { if (sel.size) bulkModal(u, [...sel], days, () => { clearSel(); load(); }); return; }
        const nav = e.target.closest('[data-step]');
        if (nav) { if (step(Number(nav.dataset.step))) { sel.clear(); load(); } return; }
        if (e.target.closest('#sch-retry')) { load(); return; }
        const cell = e.target.closest('[data-date]');
        if (cell && canManage) {
          const date = cell.dataset.date;
          // کلیک ساده: بدون انتخاب ⇒ ویرایش تک‌روز؛ با انتخاب فعال ⇒ اضافه/کم‌کردن همان روز
          if (sel.size) { if (sel.has(date)) sel.delete(date); else sel.add(date); paintSel(); return; }
          const day = days.find((d) => d.date === date);
          if (day) editModal(u, day, load);
        }
      });
      load();
    },
  };
})();
