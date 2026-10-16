// E1 (فاز ۱۳): ویرایش درجای برنامه‌ی هفته‌ی کارمند توسط ادمین/سرپرست (افزودن، ویرایش، حذف با واگرد) روی دفترچه‌ی «برنامه هفته بعد».
// هر عمل با یک API granular (A2) ذخیره می‌شود؛ پاسخ = وضعیت تازه‌ی برنامه (applyModel). بدون optimistic برای افزودن/ویرایش (فرم تا موفقیت باز می‌ماند)؛
// حذف: ردیف پنهان می‌شود و در خطا برمی‌گردد. PLAN_CONFLICT ⇒ بنر «تازه‌سازی» + حفظ داده‌ی فرم و بازکردن دوباره‌ی آن بعد از تازه‌سازی.
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

      const general = h('p', { class: 'nb-form-error', attrs: { role: 'alert' } });
      if (note) general.textContent = note;
      const saveBtn = nb.btn(mode === 'add' ? 'افزودن' : 'ذخیره', { type: 'submit' });
      const cancelBtn = nb.btn('انصراف', { variant: 'ghost', onClick: () => closeActive() });
      const form = h('form', { class: 'nb-form', attrs: { novalidate: true, 'aria-label': mode === 'add' ? 'افزودن تسک' : 'ویرایش تسک' } },
        field('title', 'عنوان', f.title), field('description', 'توضیح (اختیاری)', f.description),
        field('priority', 'اولویت', f.priority), field('day', 'روز', f.day), general,
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

    return {
      /** opts.edit برای renderWeek */
      options: () => ({
        enabled: true,
        onAdd: (date, slot) => openForm({ mode: 'add', container: slot, date }),
        onEdit: (task, row) => openForm({ mode: 'edit', container: row, task }),
        onDelete: remove,
        onRow: (id, el) => rows.set(id, el),
        onSlot: (date, el) => slots.set(date || '', el),
      }),
      /** قبل از هر رسم دوباره‌ی دفترچه: ثبت‌های قبلی (DOM قدیمی) پاک می‌شود */
      reset() { slots.clear(); rows.clear(); active = null; },
      dispose() { clearTimeout(undoTimer); },
    };
  }

  AP.planEditor = { create, FIELD_OF, STALE_CODES, TITLE_MAX, DESC_MAX, UNDO_MS };
})();
