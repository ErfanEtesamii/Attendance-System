// D1 (فاز ۱۳): صفحه‌ی «📓 برنامه هفته بعد» در پنل — مشاهده‌ی برنامه‌ی هفته‌ی هر کارمند با ظاهر دفترچه (AP.notebook.renderWeek از C2).
// داده: GET /admin/plan-overview (فهرست کارمندان با وضعیت برنامه؛ اسکوپ سمت سرور) و GET /admin/users/:id/plan (مدل هفته؛ B1).
// E1: ویرایش درجا (افزودن/ویرایش/حذف با واگرد) از plan-editor.js؛ نوار «N تغییر هنوز به کارمند اطلاع داده نشده» + «📣 اطلاع به کارمند» (POST /admin/users/:id/plan/notify).
// نمایش منو/دکمه با AP.can فقط راهنمای UI است؛ کنترل واقعی (مجوز/اسکوپ/قفل/اعتبارسنجی/همزمانی) سمت سرور است.
(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, icon } = AP;

  // وضعیت صفحه بین رفرش‌ها حفظ می‌شود (الگوی ui در views-weekly.js): کارمند انتخاب‌شده، هفته، جست‌وجو و فیلتر.
  const ui = { userId: null, start: '', search: '', onlyNone: false };

  const PLAN_STATUS = { submitted: ['approved', 'ثبت‌شده'], draft: ['pending', 'پیش‌نویس'], none: ['rejected', 'ثبت نشده'] };
  const LOCK_LABEL = { week_started: 'فقط‌خواندنی (هفته شروع شده)', month_closed: 'فقط‌خواندنی (ماه بسته)' };

  // ---------- توابع خالص ----------
  function addDaysIso(iso, n) {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /** فیلتر سمت کلاینت: جست‌وجو در نام/دپارتمان + «فقط بدون برنامه». (اسکوپ نقش سمت سرور اعمال شده؛ این فقط فیلتر نمایش است.) */
  function filterEmployees(list, { search = '', onlyNone = false } = {}) {
    const q = String(search || '').trim().toLowerCase();
    return (list || []).filter((e) => (!onlyNone || e.planStatus === 'none')
      && (!q || `${e.fullName} ${e.department || ''}`.toLowerCase().includes(q)));
  }

  function editBadge(plan) {
    if (plan.editable) return AP.badge('approved', '✎ قابل ویرایش', true);
    const label = LOCK_LABEL[plan.lockReason] || 'فقط‌خواندنی (بدون مجوز ویرایش)';
    return AP.badge('', label, true);
  }

  /** شیفت مؤثر هفته: نام شیفت + ساعت اولین روز کاری؛ بدون شیفت ⇒ «بدون شیفت اختصاصی». */
  function shiftText(days) {
    const withShift = (days || []).find((d) => d.schedule && d.schedule.shift);
    if (!withShift) return 'بدون شیفت اختصاصی';
    const work = days.find((d) => d.schedule && d.schedule.shift && d.schedule.start && d.schedule.end);
    const hours = work ? ` (${work.schedule.start}–${work.schedule.end})` : '';
    return `${withShift.schedule.shift.name}${hours}`;
  }

  // ---------- HTML ----------
  function employeeButton(e, selectedId) {
    const [cls, label] = PLAN_STATUS[e.planStatus] || PLAN_STATUS.none;
    const managerConfigured = e.managerConfigured ? AP.badge('approved', 'تنظیم‌شده توسط سرپرست', true) : '';
    const warn = e.needsAttention ? '<span class="np-warn"><span aria-hidden="true">⚠</span><span class="sr-only">نیازمند توجه</span></span>' : '';
    return `<li><button type="button" class="np-emp${e.id === selectedId ? ' is-active' : ''}" data-np-user="${esc(e.id)}"${e.id === selectedId ? ' aria-current="true"' : ''}>
      <span class="np-emp-name">${esc(e.fullName)}</span>
      <span class="np-emp-dep muted">${esc(e.department || 'بدون دپارتمان')}</span>
      <span class="np-emp-tags">${AP.badge(cls, label, true)}${managerConfigured}${warn}</span>
    </button></li>`;
  }

  function listHtml(list, selectedId) {
    const shown = filterEmployees(list, ui);
    if (!shown.length) return `<li class="np-list-empty muted" role="status">${list.length ? 'کارمندی با این فیلتر پیدا نشد.' : 'کارمندی برای نمایش وجود ندارد.'}</li>`;
    return shown.map((e) => employeeButton(e, selectedId)).join('');
  }

  function sideHtml(ov, selectedId) {
    return `<aside class="card np-side" aria-label="انتخاب کارمند">
      <label class="sr-only" for="np-search">جست‌وجوی کارمند</label>
      <input id="np-search" type="search" aria-label="جست‌وجوی کارمند" placeholder="جست‌وجوی نام یا دپارتمان…" value="${esc(ui.search)}" autocomplete="off" />
      <label class="check np-only"><input type="checkbox" id="np-only-none"${ui.onlyNone ? ' checked' : ''} /> فقط بدون برنامه</label>
      <ul id="np-list" class="plain np-list" aria-label="فهرست کارمندان (${esc(ov.employees.length)} نفر)">${listHtml(ov.employees, selectedId)}</ul>
    </aside>`;
  }

  function weekNavHtml(ov) {
    return `<div class="week-nav" role="group" aria-label="ناوبری هفته">
      <button type="button" class="btn ghost small" data-week-nav="${esc(addDaysIso(ov.weekStart, -7))}">◀ هفته‌ی قبل</button>
      <button type="button" class="btn ghost small" data-week-nav="" ${ov.isNextWeek ? 'disabled' : ''}>هفته‌ی بعد</button>
      <button type="button" class="btn ghost small" data-week-nav="${esc(addDaysIso(ov.weekStart, 7))}">هفته‌ی بعدتر ▶</button>
    </div>`;
  }

  const emptyBox = (msg) => `<div class="card"><div class="empty" role="status">${icon('employees')}${esc(msg)}</div></div>`;

  function mainHtml(ov, userId, r, err) {
    if (!userId) return emptyBox('برای دیدن برنامه‌ی هفته، یک کارمند را از فهرست انتخاب کنید.');
    if (err) {
      if (err.status === 403) return `<div class="card"><div class="empty" role="alert">${icon('alert')}دسترسی غیرمجاز: ${esc(err.message)}</div></div>`;
      return `<div class="card"><div class="empty" role="alert">${icon('alert')}${esc(err.message)}<div class="mt"><button type="button" class="btn ghost" id="np-retry">تلاش دوباره</button></div></div></div>`;
    }
    const me = ov.employees.find((e) => e.id === userId) || {};
    const plan = r.plan;
    const [cls, label] = PLAN_STATUS[plan.id ? (plan.status === 'submitted' ? 'submitted' : 'draft') : 'none'];
    const empty = !plan.id
      ? `<div id="np-empty" class="notice np-empty" role="status">برای این هفته برنامه‌ای ثبت نشده است.${plan.editable ? ' می‌توانید برای این کارمند تسک اضافه کنید.' : ''}</div>` : '';
    return `<div class="card profile-head np-head">
        ${AP.avatar(r.employee.fullName, 'lg')}
        <div class="grow">
          <h2>${esc(r.employee.fullName)}</h2>
          <div class="tags">
            ${me.role ? AP.badge(me.role === 'admin' ? 'purple' : me.role === 'manager' ? 'blue' : '', AP.ROLE[me.role] || me.role) : ''}
            ${AP.badge('', me.department || 'بدون دپارتمان')}
            ${AP.badge(cls, label, true)}
            ${plan.managerConfigured ? AP.badge('approved', 'تنظیم‌شده توسط سرپرست', true) : ''}
            ${editBadge(plan)}
          </div>
          <div class="muted np-shift">شیفت مؤثر: ${esc(shiftText(r.days)).replace(/\((\d{1,2}:\d{2})–(\d{1,2}:\d{2})\)/, '(<bdi dir="ltr">$1–$2</bdi>)')}</div>
        </div>
        <div class="header-actions"><button type="button" class="btn ghost small" data-go-weekly="${esc(userId)}">📊 نمای هفتگی (عملکرد)</button></div>
      </div>
      ${empty}
      ${AP.can('plan.edit_team') ? `<div id="np-unnotified"></div><div id="np-banner"></div><div id="np-undo"></div><p id="np-status" class="muted np-status" role="status" aria-live="polite"></p>` : ''}
      <div id="np-notebook" class="np-notebook"></div>`;
  }

  // دفترچه + (در صورت مجوز) ویرایش درجا. model بعد از هر ذخیره با پاسخ سرور (وضعیت تازه‌ی برنامه) جایگزین و دفترچه دوباره ساخته می‌شود.
  function mountNotebook(page, host, first, userId) {
    const nb = AP.notebook;
    const label = `دفترچه‌ی برنامه‌ی ${first.employee.fullName}`;
    let model = first;
    let editor = null;
    let manage = null; // E3: ساعت روز / تسک فوری / یادداشت سرپرست (plan-manage.js؛ مستقل از قفل ویرایش تسک‌ها)
    const els = { status: $('#np-status', page), banner: $('#np-banner', page), undo: $('#np-undo', page), unnotified: $('#np-unnotified', page) };
    const emptyNote = $('#np-empty', page);
    const canEditUi = () => AP.can('plan.edit_team') && !!model.plan.editable;
    const unnotified = () => (canEditUi() ? model.plan.unnotifiedChanges || 0 : 0);

    function drawBar() {
      if (!els.unnotified) return;
      els.unnotified.replaceChildren();
      const n = unnotified();
      if (!n) return;
      els.unnotified.appendChild(nb.h('div', { class: 'notice np-unnotified', attrs: { role: 'status' } },
        `${nb.fa(n)} تغییر هنوز به کارمند اطلاع داده نشده است. `, nb.btn('📣 اطلاع به کارمند', { onClick: notify })));
    }

    function draw() {
      if (editor) editor.reset();
      host.replaceChildren(nb.renderWeek(model, { label, edit: editor && canEditUi() ? editor.options() : null, manage: manage ? manage.options() : null }));
      if (emptyNote) emptyNote.hidden = !!model.plan.id;
      drawBar();
    }

    async function notify() {
      try {
        const res = await AP.api(`/admin/users/${userId}/plan/notify`, { method: 'POST', body: { weekStart: model.weekStart } });
        model = res; draw();
        AP.toast(res.notified === false ? 'اعلان پیش‌تر ارسال شده بود.' : 'اعلان برای کارمند ارسال شد.');
      } catch (err) {
        if (err.data && err.data.code === 'NOTHING_TO_NOTIFY') { // هم‌زمان توسط دیگری اطلاع داده شده ⇒ نوار را با وضعیت تازه به‌روز کن
          try { model = await fetchModel(); draw(); } catch (_) { /* خطای تازه‌سازی مهم نیست؛ توست زیر کافی است */ }
        }
        AP.toast(err.message, true);
      }
    }
    const fetchModel = () => AP.api(`/admin/users/${userId}/plan?start=${encodeURIComponent(model.weekStart)}`);

    if (AP.can('plan.edit_team')) {
      editor = AP.planEditor.create({ userId, getModel: () => model, applyModel: (m) => { model = m; draw(); }, fetchModel, els });
      // ترک صفحه با تغییرِ اطلاع‌داده‌نشده: بستن/رفرش تب ⇒ هشدار مرورگر؛ ناوبری داخل پنل ⇒ یادآوری با توست (روتر قابل‌لغو نیست)
      const guard = (e) => { if (unnotified() > 0) { e.preventDefault(); e.returnValue = ''; } };
      window.addEventListener('beforeunload', guard);
      AP.onLeave = () => {
        window.removeEventListener('beforeunload', guard);
        editor.dispose();
        if (unnotified() > 0) AP.toast(`${nb.fa(unnotified())} تغییر هنوز به کارمند اطلاع داده نشده است.`, true);
      };
    }
    if (AP.planManage) manage = AP.planManage.create({ userId, userName: first.employee.fullName, getModel: () => model, applyModel: (m) => { model = m; draw(); }, fetchModel });
    draw();
  }

  AP.view('nextplan', {
    skeleton: 'notebook',
    perm: 'team.week_view',
    nav: { icon: 'attendance', label: '📓 برنامه هفته بعد', group: 'کارمندان و تردد' },
    async render(param) {
      const q = ui.start ? `?start=${encodeURIComponent(ui.start)}` : '';
      const ov = await AP.api(`/admin/plan-overview${q}`); // خطا ⇒ صفحه‌ی خطای روتر (با «تلاش دوباره»)

      const picked = param ? Number(param) : ui.userId;
      const userId = Number.isInteger(picked) && picked > 0 ? picked : null;
      ui.userId = userId;

      let r = null; let err = null;
      if (userId) {
        try { r = await AP.api(`/admin/users/${userId}/plan${q}`); } catch (e) { err = e; }
      }

      const html = `
        <div class="view-header">
          <div><h2 class="np-title">📓 برنامه‌ی هفته</h2><p class="sub">هفته‌ی ${esc(ov.jalaliStart)} تا ${esc(ov.jalaliEnd)}${ov.isNextWeek ? ' (هفته‌ی بعد)' : ''}</p></div>
          <div class="header-actions">${weekNavHtml(ov)}<button type="button" class="btn ghost small" data-print>${icon('download', 14)} چاپ</button></div>
        </div>
        <div class="np-layout">
          ${sideHtml(ov, userId)}
          <section class="np-main" aria-label="برنامه‌ی هفته‌ی کارمند">${mainHtml(ov, userId, r, err)}</section>
        </div>`;

      return {
        html,
        mount(page) {
          $$('[data-week-nav]', page).forEach((b) => b.addEventListener('click', () => {
            if (b.disabled) return;
            ui.start = b.dataset.weekNav; // '' = هفته‌ی بعد (پیش‌فرض سرور)
            AP.refresh();
          }));
          const printBtn = $('[data-print]', page);
          if (printBtn) printBtn.addEventListener('click', () => window.print());

          const list = $('#np-list', page);
          const redraw = () => { if (list) list.innerHTML = listHtml(ov.employees, userId); bindList(); };
          function bindList() {
            $$('[data-np-user]', page).forEach((b) => b.addEventListener('click', () => AP.go('nextplan', b.dataset.npUser)));
          }
          const search = $('#np-search', page);
          if (search) search.addEventListener('input', () => { ui.search = search.value; redraw(); });
          const only = $('#np-only-none', page);
          if (only) only.addEventListener('change', () => { ui.onlyNone = !!only.checked; redraw(); });
          bindList();
          const activeEmp = $('.np-emp.is-active', page); // موبایل: ریل افقی؛ کارمند انتخاب‌شده در دید بماند
          if (activeEmp && list && list.scrollWidth > list.clientWidth) { // فقط scrollLeft خودِ ریل (scrollIntoView کل صفحه را جابه‌جا می‌کند)
            const a = activeEmp.getBoundingClientRect(); const l = list.getBoundingClientRect();
            list.scrollLeft += (a.left + a.width / 2) - (l.left + l.width / 2);
          }

          const retry = $('#np-retry', page);
          if (retry) retry.addEventListener('click', () => AP.refresh());
          const weekly = $('[data-go-weekly]', page);
          if (weekly) weekly.addEventListener('click', () => AP.go('weekly', weekly.dataset.goWeekly));

          const host = $('#np-notebook', page);
          if (host && r) mountNotebook(page, host, r, userId);
        },
      };
    },
  });

  AP.nextPlan = { filterEmployees, addDaysIso, shiftText, ui };
})();
