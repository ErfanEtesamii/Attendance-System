// E1 (فاز ۱۳): ویرایش درجای برنامه‌ی هفته‌ی کارمند توسط ادمین/سرپرست (افزودن، ویرایش، حذف با واگرد) روی دفترچه‌ی «برنامه هفته بعد».
// هر عمل با یک API granular (A2) ذخیره می‌شود؛ پاسخ = وضعیت تازه‌ی برنامه (applyModel). بدون optimistic برای افزودن/ویرایش (فرم تا موفقیت باز می‌ماند)؛
// حذف: ردیف پنهان می‌شود و در خطا برمی‌گردد. PLAN_CONFLICT ⇒ بنر «تازه‌سازی» + حفظ داده‌ی فرم و بازکردن دوباره‌ی آن بعد از تازه‌سازی.
// E2-الف: انتقال تسک به روز دیگر (PATCH plannedDate) و جابه‌جایی بالا/پایین داخل کارت (POST reorder) با منوی کیبوردی؛ بدون optimistic (خطا ⇒ هیچ تغییری در UI نمی‌ماند)،
// بعد از موفقیت اعلان aria-live (els.status) و بازگرداندن فوکوس به دکمه‌ی همان تسک.
// وابستگی‌ها (AP.api، AP.toast، AP.confirmBox، AP.notebook) تزریق/خوانده می‌شوند تا با DOM ساختگی قابل‌تست باشد. گیت اصلی (مجوز/اسکوپ/قفل/اعتبارسنجی) سمت سرور است.
(function () {
  'use strict';
  const AP = (window.AP = window.AP || {});

  const TITLE_MAX = 120; // همان قواعد validateTask سرور (فقط راهنمای UI؛ سرور دوباره چک می‌کند)
  const DESC_MAX = 500;
  const UNDO_MS = 8000;
  const PRIORITY_LABELS = [['low', 'کم'], ['normal', 'معمولی'], ['high', 'بالا']];
  // کد خطای سرور ⇒ فیلد فرم (خطای اعتبارسنجی کنار فیلد)
  const FIELD_OF = { TITLE_REQUIRED: 'title', TITLE_TOO_LONG: 'title', DESCRIPTION_TOO_LONG: 'description', INVALID_PRIORITY: 'priority', INVALID_DATE: 'day', DATE_OUT_OF_WEEK: 'day' };
  // خطاهایی که یعنی «وضعیت برنامه عوض شده»؛ راه‌حل = تازه‌سازی (بنر)
  const STALE_CODES = new Set(['PLAN_CONFLICT', 'TASK_NOT_FOUND', 'PLAN_LOCKED', 'MONTH_CLOSED']);

  let seq = 0;

  /**
   * @param {object} o { userId, getModel(), applyModel(model), fetchModel(): Promise<model>, els: { status, banner, undo } }
   * @returns {{ options(), reset(), dispose() }} options() ⇒ opts.edit برای AP.notebook.renderWeek
   */
  function create({ userId, getModel, applyModel, fetchModel, els }) {
    const nb = AP.notebook;
    const h = nb.h;
    const slots = new Map(); // date('' = هر روز) ⇒ جای افزودن
    const rows = new Map(); // taskId ⇒ ردیف
    const ctrls = new Map(); // taskId ⇒ { up, down, move } (E2-الف)
    const zones = new Map(); // date('' = هر روز) ⇒ کارت (ناحیه‌ی رها کردن؛ E2-ب)
    let drag = null; // { task, row } وقتی کشیدن در جریان است
    let hl = null; // { el, c } هایلایت فعلی مقصد
    let busy = false;
    let draft = null; // داده‌ی فرمِ ذخیره‌نشده هنگام PLAN_CONFLICT
    let undoTimer = null;
    let active = null; // فرم باز (فقط یکی)

    const setStatus = (t) => { if (els.status) els.status.textContent = t; };
    const clearNode = (n) => { if (n) n.replaceChildren(); };

    function closeActive() { if (active) { active.restore(); active = null; } }

    // ---------- فرم درجا ----------
    function openForm({ mode, container, task = null, date = null, values = null, note = '' }) {
      closeActive();
      const model = getModel();
      const uid = `npf-${++seq}`;
      const init = values || (task
        ? { title: task.title, description: task.description || '', priority: task.priority, day: task.plannedDate || '' }
        : { title: '', description: '', priority: 'normal', day: date || '' });

      const errs = {};
      const field = (key, label, control) => {
        control.setAttribute('id', `${uid}-${key}`);
        control.setAttribute('aria-describedby', `${uid}-${key}-err`);
        errs[key] = h('span', { class: 'nb-field-error', attrs: { id: `${uid}-${key}-err` } });
        return h('label', { class: 'nb-field', attrs: { for: `${uid}-${key}` } }, h('span', { class: 'nb-field-label', text: label }), control, errs[key]);
      };
      const f = {
        title: h('input', { class: 'nb-input', attrs: { type: 'text', maxlength: TITLE_MAX, required: true, autocomplete: 'off' } }),
        description: h('textarea', { class: 'nb-input', attrs: { rows: 3, maxlength: DESC_MAX } }),
        priority: h('select', { class: 'nb-input' }, ...PRIORITY_LABELS.map(([v, l]) => h('option', { attrs: { value: v }, text: l }))),
        day: h('select', { class: 'nb-input' }, h('option', { attrs: { value: '' }, text: 'هر روز' }), ...(model.days || []).map((d) => h('option', { attrs: { value: d.date }, text: nb.dayTitle(d) }))),
      };
      f.title.value = init.title; f.description.value = init.description; f.priority.value = init.priority; f.day.value = init.day;

      // تسک چند‌روزه: فقط هنگام افزودنِ تسک روزدار؛ برای هر روزِ کاریِ بازه یک تسک ساخته می‌شود
      const dayOpts = () => (model.days || []).map((d) => h('option', { attrs: { value: d.date }, text: nb.dayTitle(d) }));
      f.multi = h('input', { attrs: { type: 'checkbox', id: `${uid}-multi` } });
      f.from = h('select', { class: 'nb-input' }, ...dayOpts());
      f.to = h('select', { class: 'nb-input' }, ...dayOpts());
      f.from.value = date || ((model.days || [])[0] || {}).date || '';
      f.to.value = f.from.value;
      const range = h('div', { class: 'nb-multi__range', attrs: { hidden: true } },
        h('label', { class: 'nb-field' }, h('span', { class: 'nb-field-label', text: 'از روز' }), f.from),
        h('label', { class: 'nb-field' }, h('span', { class: 'nb-field-label', text: 'تا روز' }), f.to),
        h('p', { class: 'nb-multi__hint', text: 'برای هر روزِ کاری و نیم‌روزِ این بازه یک تسک ساخته می‌شود (آف، تعطیل و مرخصی رد می‌شود).' }));
      f.multi.addEventListener('change', () => { if (f.multi.checked) range.removeAttribute('hidden'); else range.setAttribute('hidden', ''); });
      const multiBlock = (mode === 'add' && date)
        ? h('div', { class: 'nb-multi' }, h('label', { class: 'nb-multi__check', attrs: { for: `${uid}-multi` } }, f.multi, 'تسک چند روزه'), range)
        : null;

      const general = h('p', { class: 'nb-form-error', attrs: { role: 'alert' } });
      if (note) general.textContent = note;
      const saveBtn = nb.btn(mode === 'add' ? 'افزودن' : 'ذخیره', { type: 'submit' });
      const cancelBtn = nb.btn('انصراف', { variant: 'ghost', onClick: () => closeActive() });
      const form = h('form', { class: 'nb-form', attrs: { novalidate: true, 'aria-label': mode === 'add' ? (date ? 'افزودن تسک' : 'افزودن روتین') : 'ویرایش تسک' } },
        field('title', 'عنوان', f.title), field('description', 'توضیح (اختیاری)', f.description),
        field('priority', 'اولویت', f.priority), (mode === 'add' && !date) ? null : field('day', 'روز', f.day), multiBlock, general, // روتین جدید: فقط اولویت؛ خودکار برای همه‌ی روزها
        h('div', { class: 'nb-form-actions' }, saveBtn, cancelBtn));

      const ctx = { mode, task, date, f, errs, general, saveBtn, cancelBtn };
      form.addEventListener('submit', (e) => { if (e && e.preventDefault) e.preventDefault(); return submit(ctx); });

      const orig = Array.from(container.children);
      container.replaceChildren(form);
      active = { restore: () => container.replaceChildren(...orig) };
      if (f.title.focus) f.title.focus();
      return ctx;
    }

    const read = (f) => ({ title: String(f.title.value || ''), description: String(f.description.value || ''), priority: f.priority.value || 'normal', day: f.day.value || '' });
    const clearErrors = (ctx) => { for (const k of Object.keys(ctx.errs)) { ctx.errs[k].textContent = ''; ctx.errs[k].removeAttribute('role'); } ctx.general.textContent = ''; };
    function showFieldError(ctx, key, msg) {
      ctx.errs[key].textContent = msg;
      ctx.errs[key].setAttribute('role', 'alert');
      ctx.f[key].setAttribute('aria-invalid', 'true');
      if (ctx.f[key].focus) ctx.f[key].focus();
    }
    const setBusy = (ctx, on) => { ctx.saveBtn.disabled = on; ctx.cancelBtn.disabled = on; };

    // ---------- بنر ناسازگاری ----------
    function showConflict(message) {
      if (!els.banner) return;
      els.banner.replaceChildren(h('div', { class: 'notice danger', attrs: { role: 'alert' } }, `${message} `, nb.btn('تازه‌سازی', { onClick: refreshNow })));
    }
    async function refreshNow() {
      try {
        const fresh = await fetchModel();
        clearNode(els.banner);
        const d = draft;
        applyModel(fresh); // نمای دفترچه دوباره ساخته می‌شود (reset ⇒ slotها/ردیف‌های تازه)
        if (d) reopen(d);
      } catch (err) { AP.toast(err.message, true); }
    }
    // داده‌ی فرمِ ذخیره‌نشده را بعد از تازه‌سازی دوباره باز می‌کند؛ اگر تسکِ ویرایشی دیگر نیست، به‌عنوان «افزودن» (با توضیح)
    function reopen(d) {
      const model = getModel();
      draft = null;
      if (d.mode === 'edit') {
        const task = [...(model.days || []).flatMap((x) => x.tasks || []), ...(model.anyDay || [])].find((t) => t.id === d.taskId);
        if (task && rows.get(task.id) && task.canEdit) { openForm({ mode: 'edit', container: rows.get(task.id), task, values: d.values }); return; }
        const slot = slots.get(d.values.day || '');
        if (slot) openForm({ mode: 'add', container: slot, values: d.values, note: 'تسک اصلی دیگر وجود ندارد؛ اطلاعات فرم برای افزودن به‌عنوان تسک جدید حفظ شد.' });
        return;
      }
      const slot = slots.get(d.date || '') || slots.get(d.values.day || '');
      if (slot) openForm({ mode: 'add', container: slot, date: d.date, values: d.values });
    }

    // ---------- ذخیره‌ی افزودن/ویرایش ----------
    async function submit(ctx) {
      if (busy) return; // ارسال دوباره‌ی هم‌زمان
      clearErrors(ctx);
      const v = read(ctx.f);
      if (!v.title.trim()) { showFieldError(ctx, 'title', 'عنوان تسک الزامی است.'); return; }
      const model = getModel();
      if (ctx.mode === 'add' && ctx.f.multi && ctx.f.multi.checked) return submitMulti(ctx, v);
      const body = { title: v.title, description: v.description, plannedDate: v.day || null, priority: v.priority, expectedVersion: model.plan.version };
      busy = true; setBusy(ctx, true); setStatus('در حال ذخیره…');
      try {
        const res = ctx.mode === 'add'
          ? await AP.api(`/admin/users/${userId}/plan/tasks`, { method: 'POST', body: { weekStart: model.weekStart, ...body } })
          : await AP.api(`/admin/plan-tasks/${ctx.task.id}`, { method: 'PATCH', body });
        draft = null; active = null;
        applyModel(res);
        AP.toast(ctx.mode === 'add' ? 'تسک اضافه شد.' : (res.changed === false ? 'تغییری برای ذخیره نبود.' : 'تغییر ذخیره شد.'));
      } catch (err) {
        const code = err.data && err.data.code;
        if (STALE_CODES.has(code)) {
          if (code === 'PLAN_CONFLICT') draft = { mode: ctx.mode, taskId: ctx.task ? ctx.task.id : null, date: ctx.date, values: v }; // فرم باز می‌ماند و داده حفظ می‌شود
          showConflict(err.message);
        } else if (FIELD_OF[code] && ctx.errs[FIELD_OF[code]]) showFieldError(ctx, FIELD_OF[code], err.message);
        else { ctx.general.textContent = err.message; AP.toast(err.message, true); }
      } finally { busy = false; setBusy(ctx, false); setStatus(''); }
    }

    // تسک چند‌روزه: برای هر روزِ کاری/نیم‌روزِ بازه‌ی [از، تا] یک تسک (پشت‌سرهم؛ نسخه‌ی برنامه بعد از هر افزودن تازه می‌شود)
    async function submitMulti(ctx, v) {
      const model = getModel();
      const from = ctx.f.from.value; const to = ctx.f.to.value;
      if (!from || !to || from > to) { ctx.general.textContent = 'بازه نامعتبر است: «تا روز» باید بعد از «از روز» (یا همان روز) باشد.'; return; }
      const dates = (model.days || []).filter((d) => d.date >= from && d.date <= to && (d.kind === 'working' || d.kind === 'half')).map((d) => d.date);
      if (!dates.length) { ctx.general.textContent = 'در این بازه روز کاری وجود ندارد.'; return; }
      busy = true; setBusy(ctx, true); setStatus('در حال ذخیره…');
      let done = 0;
      try {
        for (const date of dates) {
          const res = await AP.api(`/admin/users/${userId}/plan/tasks`, { method: 'POST', body: { weekStart: model.weekStart, title: v.title, description: v.description, plannedDate: date, priority: v.priority, expectedVersion: getModel().plan.version } });
          done += 1;
          draft = null; active = null;
          applyModel(res);
        }
        AP.toast(`تسک برای ${done} روز اضافه شد.`);
      } catch (err) {
        const code = err.data && err.data.code;
        if (done) { AP.toast(`فقط ${done} از ${dates.length} روز ثبت شد: ${err.message}`, true); }
        else if (STALE_CODES.has(code)) showConflict(err.message);
        else { ctx.general.textContent = err.message; AP.toast(err.message, true); }
      } finally { busy = false; setBusy(ctx, false); setStatus(''); }
    }

    // ---------- حذف + واگرد ----------
    async function remove(task, row) {
      if (busy) return;
      const ok = await AP.confirmBox({ title: 'حذف تسک', message: `تسک «${task.title}» حذف شود؟`, confirmText: 'حذف', danger: true });
      if (!ok) return;
      busy = true; row.hidden = true; setStatus('در حال ذخیره…');
      try {
        const res = await AP.api(`/admin/plan-tasks/${task.id}`, { method: 'DELETE', body: { expectedVersion: getModel().plan.version } });
        applyModel(res);
        AP.toast('تسک حذف شد.');
        showUndo(task);
      } catch (err) {
        row.hidden = false; // خطا ⇒ ردیف برمی‌گردد
        const code = err.data && err.data.code;
        if (STALE_CODES.has(code)) showConflict(err.message); else AP.toast(err.message, true);
      } finally { busy = false; setStatus(''); }
    }

    function showUndo(task) {
      if (!els.undo) return;
      clearTimeout(undoTimer);
      els.undo.replaceChildren(h('div', { class: 'notice ok', attrs: { role: 'status' } }, `«${task.title}» حذف شد. `, nb.btn('واگرد', { onClick: () => undo(task) })));
      undoTimer = setTimeout(() => clearNode(els.undo), UNDO_MS);
    }
    // واگرد = افزودن دوباره با همان داده (سرور soft-delete می‌کند؛ تسکِ تازه در انتهای فهرست می‌نشیند)
    async function undo(task) {
      if (busy) return;
      clearTimeout(undoTimer); clearNode(els.undo);
      const model = getModel();
      busy = true; setStatus('در حال ذخیره…');
      try {
        const res = await AP.api(`/admin/users/${userId}/plan/tasks`, {
          method: 'POST',
          body: { weekStart: model.weekStart, title: task.title, description: task.description || '', plannedDate: task.plannedDate || null, priority: task.priority, expectedVersion: model.plan.version },
        });
        applyModel(res);
        AP.toast('تسک بازگردانی شد.');
      } catch (err) {
        const code = err.data && err.data.code;
        if (STALE_CODES.has(code)) showConflict(err.message); else AP.toast(err.message, true);
      } finally { busy = false; setStatus(''); }
    }

    // ---------- E2-الف: انتقال و ترتیب (مسیر بدون drag) ----------
    const groupOf = (model, id) => {
      for (const d of model.days || []) if ((d.tasks || []).some((t) => t.id === id)) return d.tasks;
      return (model.anyDay || []).some((t) => t.id === id) ? model.anyDay : null;
    };
    const dayLabel = (model, date) => {
      if (!date) return 'هر روز';
      const d = (model.days || []).find((x) => x.date === date);
      return d ? nb.weekdayName(d) : date;
    };
    // انتقال به روزِ آف/تعطیل/مرخصی/مأموریت مجاز است؛ فقط یادآوری نرم (هشدار رسمی B1 بعد از ذخیره در مدل تازه می‌آید)
    const OFF_KINDS = nb.NON_WORK || ['off', 'holiday', 'leave', 'mission']; // منبع واحد: notebook.js
    function offNote(model, date) {
      const d = date && (model.days || []).find((x) => x.date === date);
      return d && OFF_KINDS.includes(d.kind) ? ` توجه: این روز ${d.kindLabel || 'کاری نیست'} است.` : '';
    }
    function focusAfter(id, prefer) {
      const c = ctrls.get(id) || {};
      const el = prefer.map((k) => c[k]).find((x) => x && !x.disabled) || rows.get(id);
      if (el && el.focus) el.focus();
    }
    // یک عمل ذخیره‌ی منفرد: call() ⇒ مدل تازه؛ message(res) ⇒ متن اعلان aria-live؛ prefer = ترتیب دکمه‌های مناسب فوکوس
    async function mutate(task, call, message, prefer) {
      if (busy) return;
      busy = true; setStatus('در حال ذخیره…');
      try {
        const res = await call();
        applyModel(res); // دفترچه دوباره ساخته می‌شود (reset ⇒ ردیف‌ها/دکمه‌های تازه)
        setStatus(message(res));
        focusAfter(task.id, prefer);
      } catch (err) {
        setStatus('');
        const code = err.data && err.data.code;
        if (STALE_CODES.has(code)) showConflict(err.message); else AP.toast(err.message, true);
      } finally { busy = false; }
    }
    /** date = 'YYYY-MM-DD' یا null («هر روز») */
    function moveTo(task, date) {
      const model = getModel();
      const target = date || null;
      if ((task.plannedDate || null) === target) return Promise.resolve();
      return mutate(task,
        () => AP.api(`/admin/plan-tasks/${task.id}`, { method: 'PATCH', body: { plannedDate: target, expectedVersion: model.plan.version } }),
        () => `تسک «${task.title}» به ${dayLabel(model, target)} منتقل شد.${offNote(model, target)}`, ['move']);
    }
    /** dir = -1 (بالا) | +1 (پایین): جابه‌جایی با همسایه‌ی قابل‌جابه‌جایی در همان کارت (سیستمی/فوری شمرده نمی‌شوند؛ همان قاعده‌ی reorder سرور) */
    function shift(task, dir) {
      const model = getModel();
      const group = groupOf(model, task.id);
      if (!group) return Promise.resolve();
      const movable = group.filter((x) => x.canEdit && !x.isSystem && !x.isUrgent);
      const i = movable.findIndex((x) => x.id === task.id);
      let j = i + dir;
      while (j >= 0 && j < movable.length && !!movable[j].managerLocked !== !!task.managerLocked) j += dir; // همسایه‌ی هم‌کادر (کادر سرپرست جدا از کادر عادی نمایش داده می‌شود)
      if (i < 0 || j < 0 || j >= movable.length) return Promise.resolve();
      const order = movable.map((x) => x.id);
      [order[i], order[j]] = [order[j], order[i]];
      return reorder(task, order, dir < 0 ? ['up', 'down'] : ['down', 'up']);
    }
    function reorder(task, order, prefer) {
      const model = getModel();
      return mutate(task,
        () => AP.api(`/admin/users/${userId}/plan/reorder`, { method: 'POST', body: { weekStart: model.weekStart, order, expectedVersion: model.plan.version } }),
        (res) => {
          const g = groupOf(res, task.id) || [];
          return `تسک «${task.title}» به جایگاه ${nb.fa(g.findIndex((x) => x.id === task.id) + 1)} از ${nb.fa(g.length)} منتقل شد.`;
        }, prefer);
    }

    // ---------- E2-ب: drag & drop بومی (دسکتاپ) ----------
    const cls = (el, c, on) => { if (el && el.classList) el.classList[on ? 'add' : 'remove'](c); };
    function clearHl() { if (hl) { cls(hl.el, hl.c, false); hl = null; } }
    function setHl(el, c) { if (hl && hl.el === el && hl.c === c) return; clearHl(); if (el) { cls(el, c, true); hl = { el, c }; } }
    const sameZone = (task, zone) => (task.plannedDate || null) === (zone || null);
    const movableOf = (id) => (groupOf(getModel(), id) || []).filter((x) => x.canEdit && !x.isSystem && !x.isUrgent);
    function endDrag() { if (drag) cls(drag.row, 'is-dragging', false); drag = null; clearHl(); }

    const dnd = {
      start(task, row, e) {
        if (busy) { if (e && e.preventDefault) e.preventDefault(); return; } // در حال ذخیره ⇒ کشیدن ممنوع
        drag = { task, row };
        if (e && e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; if (e.dataTransfer.setData) e.dataTransfer.setData('text/plain', String(task.id)); } // فایرفاکس بدون setData درگ را شروع نمی‌کند
        cls(row, 'is-dragging', true);
      },
      /** روزِ دیگر ⇒ هایلایت کارت؛ همان روز + ردیفِ قابل‌جابه‌جایی ⇒ هایلایت ردیف (ترتیب)؛ غیر از این ⇒ رها کردن بی‌اثر (preventDefault نمی‌شود) */
      over(zone, e, target) {
        if (!drag) return; // کشیدن بیرونی (فایل/متن) نادیده گرفته می‌شود
        const task = drag.task;
        const allow = () => { if (e.preventDefault) e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; };
        if (!sameZone(task, zone)) { allow(); setHl(zones.get(zone || ''), 'is-drop-target'); return; }
        if (target && target.id !== task.id && !!target.managerLocked === !!task.managerLocked && movableOf(task.id).some((x) => x.id === target.id)) { allow(); setHl(rows.get(target.id), 'is-drop-row'); } else clearHl();
      },
      drop(zone, e, target) {
        if (!drag) return undefined;
        if (e.preventDefault) e.preventDefault();
        const task = drag.task;
        endDrag();
        if (busy) return undefined;
        if (!sameZone(task, zone)) return moveTo(task, zone || null);
        if (!target || target.id === task.id || !!target.managerLocked !== !!task.managerLocked) return undefined;
        const movable = movableOf(task.id);
        const i = movable.findIndex((x) => x.id === task.id);
        const j = movable.findIndex((x) => x.id === target.id);
        if (i < 0 || j < 0) return undefined;
        const order = movable.map((x) => x.id);
        order.splice(i, 1); order.splice(j, 0, task.id); // تسک در جایگاهِ ردیف مقصد می‌نشیند
        return reorder(task, order, ['up', 'down']);
      },
      end: endDrag,

      // ---------- E2-ج: لمس/قلم (pointer events؛ HTML5 DnD روی موبایل کار نمی‌کند) ----------
      // شروع فقط از دستگیره‌ی ⠿ (touch-action:none در CSS) تا اسکرول صفحه با کشیدن ردیف تداخل نکند. ماوس همان درگ بومی است.
      pStart(task, row, e) {
        if (!e || e.pointerType === 'mouse' || busy || drag || typeof document === 'undefined') return;
        if (e.preventDefault) e.preventDefault();
        drag = { task, row, pointerId: e.pointerId };
        cls(row, 'is-dragging', true);
        const last = { zone: undefined, target: null };
        const cleanup = () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', cancel);
        };
        const owns = (ev) => drag && (ev.pointerId === undefined || drag.pointerId === undefined || ev.pointerId === drag.pointerId);
        function move(ev) {
          if (!owns(ev)) return;
          if (ev.preventDefault) ev.preventDefault();
          autoScroll(ev.clientY);
          const hit = hitTest(ev.clientX, ev.clientY);
          last.zone = hit ? hit.zone : undefined; last.target = hit ? hit.target : null;
          if (hit) dnd.over(hit.zone, {}, hit.target); else clearHl();
        }
        function up(ev) {
          if (!owns(ev)) return undefined;
          cleanup();
          if (last.zone === undefined) { endDrag(); return undefined; } // خارج از همه‌ی ناحیه‌ها ⇒ لغو
          return dnd.drop(last.zone, {}, last.target);
        }
        function cancel(ev) { if (!owns(ev)) return; cleanup(); endDrag(); }
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', cancel);
      },
    };

    // نقطه‌ی لمس ⇒ { zone (date|null), target (تسک زیر انگشت یا null) }؛ فقط ناحیه‌های همین دفترچه (data-zone)
    function hitTest(x, y) {
      if (typeof document === 'undefined' || !document.elementFromPoint) return null;
      const el = document.elementFromPoint(x, y);
      if (!el || !el.closest) return null;
      const zoneEl = el.closest('[data-zone]');
      if (!zoneEl) return null;
      const rowEl = el.closest('[data-task-id]');
      const id = rowEl ? Number(rowEl.getAttribute('data-task-id')) : null;
      const m = getModel();
      const target = id ? [...(m.days || []).flatMap((d) => d.tasks || []), ...(m.anyDay || [])].find((t) => t.id === id) || null : null;
      return { zone: zoneEl.getAttribute('data-zone') || null, target };
    }
    // نزدیک لبه‌ی بالا/پایین نمایشگر صفحه را آرام اسکرول می‌کند تا بشود به کارت‌های دورتر رسید
    function autoScroll(y) {
      if (typeof window === 'undefined' || !window.scrollBy || !(window.innerHeight > 0)) return;
      if (y < 70) window.scrollBy(0, -14); else if (y > window.innerHeight - 70) window.scrollBy(0, 14);
    }

    return {
      /** opts.edit برای renderWeek */
      options: () => ({
        enabled: true,
        onAdd: (date, slot) => openForm({ mode: 'add', container: slot, date }),
        onEdit: (task, row) => openForm({ mode: 'edit', container: row, task }),
        onDelete: remove,
        onMove: (task, date) => moveTo(task, date),
        onShift: (task, dir) => shift(task, dir),
        onRow: (id, el, c) => { rows.set(id, el); ctrls.set(id, c || {}); },
        onZone: (date, el) => zones.set(date || '', el),
        dnd,
        onSlot: (date, el) => slots.set(date || '', el),
      }),
      /** قبل از هر رسم دوباره‌ی دفترچه: ثبت‌های قبلی (DOM قدیمی) پاک می‌شود */
      reset() { slots.clear(); rows.clear(); ctrls.clear(); zones.clear(); drag = null; hl = null; active = null; },
      dispose() { clearTimeout(undoTimer); },
      moveTo, shift, // E2: هسته‌ی مشترک برای drag & drop (بخش‌های بعدی) و مسیر کیبوردی
    };
  }

  AP.planEditor = { create, FIELD_OF, STALE_CODES, TITLE_MAX, DESC_MAX, UNDO_MS };
})();
