// F2 (فاز ۱۲): «نمای هفتگی کارمند» در پنل مدیریت — از API فقط‌خواندنیِ F1 (`GET /admin/users/:id/week`).
// F2-a (انجام‌شده): نوار بالا (نام، شیفت مؤثر، ناوبری هفته، وضعیت برنامه)، ردیف خلاصه‌ی عملکرد (KPI) و حالت‌های لودینگ/خالی/خطا.
// F2-b (انجام‌شده): شبکه‌ی ۷ روزه — کارت هر روز با نوار حضور، چیپ‌های رنگی (تأخیر/آف/مرخصی/تعطیل/...) و فهرست تسک‌ها (اولویت/فوری/وضعیت/علت)؛
//   دسکتاپ: ستونی کنار هم. موبایل: کارت‌ها زیر هم و با <details> قابل جمع‌شدن.
// F2-c (این بخش): امکانات مدیریتی روی کارت هر روز — «⚡ تسک فوری» (فرم مشترک E3 از views-teamreports.js)،
//   «ویرایش برنامه‌ی این روز» (مودال مشترک B2 از views-schedule.js/AP.scheduleTab)، «مشاهده شد»/کامنت سرپرست (همان API گزارش‌های تیم)،
//   دکمه‌ی چاپ (window.print؛ با قاعده‌ی چاپ سراسری پنل + بازشدن اجباری کارت‌های روز موقع چاپ)، و پرداخت نهاییِ کیبورد/ARIA/۳۲۰px.
(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt, icon } = AP;

  const PLAN_STATUS = { submitted: ['approved', 'ثبت‌شده'], draft: ['pending', 'پیش‌نویس'] };
  const planBadge = (plan) => {
    const [cls, label] = plan ? (PLAN_STATUS[plan.status] || ['rejected', plan.status]) : ['rejected', 'ثبت نشده'];
    return AP.badge(cls, label, true);
  };

  // وضعیت صفحه بین رفرش‌ها حفظ می‌شود (مثل profileUi.days در views-main.js)؛ با عوض‌شدن کارمند، هفته به «جاری» برمی‌گردد.
  const ui = { userId: null, start: '' };

  function kpi(group, ic, value, label, hint) {
    return `<div class="stat"><div class="stat-icon ${group}">${icon(ic)}</div><div class="stat-value u-stat-value-sm">${value}</div><div class="stat-label">${esc(label)}</div>${hint ? `<div class="stat-hint">${hint}</div>` : ''}</div>`;
  }

  function completionBar(tasks) {
    const pct = tasks.completionPercent;
    return `<div class="hbar"><div class="hbar-top"><span>تکمیل تسک‌های هفته</span><span>${pct == null ? '—' : `${fmt.num(pct)}٪`}</span></div>
      <div class="hbar-track"><div class="hbar-fill" data-progress="${pct == null ? 0 : pct}"></div></div>
      <div class="muted task-summary-meta">${fmt.num(tasks.done)} انجام‌شده، ${fmt.num(tasks.partial)} ناقص، ${fmt.num(tasks.notDone)} انجام‌نشده از ${fmt.num(tasks.total)} سررسیدشده</div></div>`;
  }

  function weekHeader(r) {
    const u = r.user;
    const shiftText = u.shift ? `${esc(u.shift.name)} (${esc(u.shift.startTime || '')}–${esc(u.shift.endTime || '')})` : 'بدون شیفت اختصاصی';
    return `
      <div class="card profile-head">
        ${AP.avatar(u.fullName, 'lg')}
        <div class="grow">
          <h2>${esc(u.fullName)}</h2>
          <div class="tags">
            ${AP.badge(u.role === 'admin' ? 'purple' : u.role === 'manager' ? 'blue' : '', AP.ROLE[u.role])}
            ${AP.badge('', u.department || 'بدون دپارتمان')}
            ${planBadge(r.plan)}
            ${r.summary.closed.allClosed ? AP.badge('', 'ماه بسته (فقط‌خواندنی)') : r.summary.closed.partlyClosed ? AP.badge('', 'بخشی از هفته در ماه بسته') : ''}
          </div>
          <div class="muted mt profile-meta">شیفت مؤثر امروز: ${shiftText}</div>
        </div>
        <div class="header-actions">
          <div class="week-nav" role="group" aria-label="ناوبری هفته">
            <button type="button" class="btn ghost small" data-week-nav="${esc(r.week.prevWeekStart)}">◀ هفته‌ی قبل</button>
            <button type="button" class="btn ghost small" data-week-nav="${esc(r.week.today)}" ${r.week.isCurrentWeek ? 'disabled' : ''}>هفته‌ی جاری</button>
            <button type="button" class="btn ghost small" data-week-nav="${esc(r.week.nextWeekStart)}">هفته‌ی بعد ▶</button>
          </div>
        </div>
      </div>
      <p class="sub week-range">هفته‌ی ${esc(r.week.jalaliStart)} تا ${esc(r.week.jalaliEnd)}</p>`;
  }

  // برچسب‌های «نوع روز» (مثل DAY_KIND_LABEL سمت سرور در employeeWeekService، ولی به‌شکل نشان رنگی)
  const KIND_BADGE = {
    half: ['', 'نیم‌روز'],
    off: ['', 'غیرکاری'],
    holiday: ['holiday', null], // متن از holidayTitle ساخته می‌شود
    leave: ['leave', 'مرخصی'],
    mission: ['mission', 'مأموریت'],
  };
  // همان متن دلایل D10/E تا با بقیه‌ی پنل یکسان بماند (views-teamreports.js)
  const REASONS = { no_time: 'وقت نشد', needs_more_time: 'زمان بیشتری لازم دارد', blocked_by_others: 'منتظر دیگران', priority_changed: 'اولویت عوض شد', technical_issue: 'مشکل فنی', other: 'سایر' };
  const TASK_STATUS = { done: ['green', 'انجام شد'], partial: ['orange', 'ناقص'], not_done: ['red', 'انجام نشد'], no_answer: ['', 'بدون پاسخ'] };

  function dayChips(d) {
    const att = d.attendance;
    const kindDef = KIND_BADGE[d.kind];
    const chips = [
      kindDef ? AP.badge(kindDef[0], d.kind === 'holiday' ? `تعطیل${d.holidayTitle ? `: ${d.holidayTitle}` : ''}` : kindDef[1], true) : '',
      d.override ? AP.badge('blue', 'برنامه‌ی ویژه‌ی روز', true) : '',
      d.absent ? AP.badge('absent', 'غایب', true) : '',
      att && att.hasCheckIn && att.lateMinutes > 0 ? AP.badge('late', `تأخیر ${fmt.min(att.lateMinutes)}`) : '',
      att && att.hasCheckIn && att.earlyLeaveMinutes > 0 ? AP.badge('red', `زودتر رفتن ${fmt.min(att.earlyLeaveMinutes)}`) : '',
      att && att.hasCheckIn && att.overtimeMinutes > 0 ? AP.badge('blue', `اضافه‌کاری ${fmt.min(att.overtimeMinutes)}`) : '',
      att && att.isOpen ? AP.badge('', 'باز (بدون خروج)', true) : '',
      d.monthClosed ? AP.badge('', 'ماه بسته') : '',
    ];
    return chips.filter(Boolean).join('');
  }

  function dayAttendanceLine(d) {
    if (!d.schedule.isWorkingDay) return '';
    const att = d.attendance;
    const times = att && att.hasCheckIn
      ? `${fmt.clock(att.checkIn)} – ${att.checkOut ? fmt.clock(att.checkOut) : '…'}`
      : (d.isFuture || d.isToday ? 'هنوز ثبت نشده' : '—');
    const planned = d.schedule.start && d.schedule.end ? `برنامه: ${esc(d.schedule.start)}–${esc(d.schedule.end)}` : '';
    const eff = att && att.hasCheckIn && att.effectiveMinutes != null ? `ساعت مفید: ${fmt.min(att.effectiveMinutes)}` : '';
    return `<div class="day-att"><span>${esc(times)}</span><span class="muted">${esc(planned)}</span></div>${eff ? `<div class="muted text-xs">${esc(eff)}</div>` : ''}`;
  }

  // H5-ب: تسک واجبِ سرپرست — «🔒 واجب» + فقط‌خواندنی + پیشرفت «x از y گزارش مشاهده شد»؛ دکمه‌ی «مشاهده‌ی گزارش‌ها» فقط برای خودِ سرپرست
  // (صفحه‌ی teamreports با اسکوپ کاربرِ جاری کار می‌کند؛ برای ادمینی که برنامه‌ی دیگری را می‌بیند فقط وضعیت نمایش داده می‌شود).
  const REVIEW_KEY = 'review_team_reports';
  function reviewProgressText(r) {
    if (!r) return '';
    if (r.notYet) return `گزارش‌های ${fmt.date(r.reviewDate)} هنوز ثبت نشده‌اند.`;
    if (!r.reportCount) return `گزارشی برای ${fmt.date(r.reviewDate)} ثبت نشده است.`;
    if (r.complete) return `همه‌ی گزارش‌ها مشاهده شد (${fmt.num(r.reviewedCount)} از ${fmt.num(r.reportCount)})`;
    return `${fmt.num(r.reviewedCount)} از ${fmt.num(r.reportCount)} گزارش مشاهده شد`;
  }
  function mandatoryTaskRow(t, isSelf) {
    const [cls, label] = TASK_STATUS[t.status] || ['', t.status];
    const r = t.review || null;
    const pct = r && !r.notYet && r.reportCount > 0 ? Math.round((r.reviewedCount / r.reportCount) * 100) : null;
    return `<li class="day-task is-mandatory">
      <div class="title">${AP.badge('blue', '🔒 واجب', true)}${esc(t.title)}<span class="sr-only">تسک سیستمی؛ فقط‌خواندنی</span></div>
      <div class="day-task-meta">${AP.badge(cls, label)}</div>
      ${r ? `<div class="rv-progress-text" role="status">${esc(reviewProgressText(r))}</div>` : ''}
      ${pct == null ? '' : `<div class="rv-progress" role="progressbar" aria-label="پیشرفت مشاهده‌ی گزارش‌ها" aria-valuemin="0" aria-valuemax="${r.reportCount}" aria-valuenow="${r.reviewedCount}"><div class="rv-progress-fill" data-progress="${pct}"></div></div>`}
      ${r && !r.notYet && isSelf && AP.can('taskreports.read') ? `<button type="button" class="btn ghost small rv-open" data-act="open-reviews" data-date="${esc(r.reviewDate)}">مشاهده‌ی گزارش‌ها</button>` : ''}
    </li>`;
  }

  function taskRow(t, isSelf, opts) {
    if (t.isSystem && t.systemKey === REVIEW_KEY) return mandatoryTaskRow(t, isSelf);
    const [cls, label] = TASK_STATUS[t.status] || ['', t.status];
    const reasonText = t.reasonText || (t.reasonCode ? REASONS[t.reasonCode] || t.reasonCode : '');
    const meta = [
      AP.badge(cls, label),
      t.rescheduleTo ? AP.badge('', `منتقل به ${esc(fmt.date(t.rescheduleTo))}`) : '',
      t.dropped ? AP.badge('', 'کنارگذاشته‌شده') : '',
      t.answeredLate ? AP.badge('orange', 'پاسخ دیرهنگام') : '',
      t.outOfPlan ? AP.badge('', 'خارج از برنامه') : '',
    ].filter(Boolean).join('');
    return `<li class="day-task${t.isUrgent ? ' is-urgent' : ''}">
      <div class="title">${t.isUrgent ? AP.badge('red', t.selfAssigned ? '⚡ فوری (خودش)' : '⚡ فوری', true) : ''}${t.priority === 'high' && !t.isUrgent ? AP.badge('late', 'اولویت بالا') : ''}${esc(t.title)}</div>
      ${t.isUrgent && ((t.selfAssigned && t.scheduledStartTime && t.urgentDeadlineTime) || (!t.selfAssigned && t.assignedBy)) ? `<div class="muted text-xs">${t.selfAssigned ? `زمان: ${esc(t.scheduledStartTime)} تا ${esc(t.urgentDeadlineTime)}` : `از طرف: ${esc(t.assignedBy)}${t.urgentDeadlineTime ? ` · مهلت ${esc(t.urgentDeadlineTime)}` : ''}`}</div>` : ''}
      <div class="day-task-meta">${meta}</div>
      ${reasonText ? `<div class="reason">${esc(reasonText)}</div>` : ''}
      ${t.note ? `<div class="reason">توضیح انجام: ${esc(t.note)}</div>` : ''}
      ${selfUrgentTaskActions(t, opts)}
    </li>`;
  }

  // تسک فوریِ خودِ کاربر در «وضعیت من»: ویرایش/حذف فقط برای فوریِ خودش و تا وقتی پاسخی ندارد (سرور دوباره چک می‌کند: NOT_SELF_URGENT / HAS_ANSWERS)
  function selfUrgentTaskActions(t, opts) {
    if (!(opts && opts.selfUrgent && t.isUrgent && t.selfAssigned && t.status === 'no_answer' && t.taskId)) return '';
    return `<div class="ms-task-actions" role="group" aria-label="${esc(`تسک فوری «${t.title}»`)}">
      <button type="button" class="btn ghost small" data-act="su-edit" data-task="${esc(t.taskId)}">ویرایش</button>
      <button type="button" class="btn ghost small" data-act="su-del" data-task="${esc(t.taskId)}">حذف</button></div>`;
  }

  // F2-c: اقدامات مدیریتی هر روز — فقط دکمه‌هایی که کاربر جاری مجوزشان را دارد ساخته می‌شوند (نمایش هم‌راستا با سرور؛ اجرای واقعی سمت سرور دوباره چک می‌شود)
  function dayActions(d, isSelf, opts) {
    if (opts && opts.readOnly) { // M2: «وضعیت من» فقط‌خواندنی است (بدون اقدام مدیریتی)؛ تنها اقدام: «⚡ تسک فوری» برای خودِ کاربر (روز کاریِ امروز/آینده) وقتی تنظیم فعال است
      const canAdd = !!(opts.selfUrgent && d.schedule && d.schedule.isWorkingDay && (d.isToday || d.isFuture));
      return canAdd ? `<div class="day-card-actions"><button type="button" class="btn ghost small" data-act="su-add" data-date="${esc(d.date)}">⚡ تسک فوری</button></div>` : '';
    }
    const hasReport = (d.tasks || []).some((t) => t.status !== 'no_answer');
    const btns = [
      AP.can('tasks.assign_urgent') && !isSelf ? `<button type="button" class="btn ghost small" data-act="urgent" data-date="${esc(d.date)}">⚡ تسک فوری</button>` : '',
      AP.can('schedule.manage') ? `<button type="button" class="btn ghost small" data-act="schedule" data-date="${esc(d.date)}">${icon('clock', 14)} ویرایش برنامه‌ی روز</button>` : '',
      AP.can('reviews.write') && !d.isFuture && hasReport ? `<button type="button" class="btn ghost small" data-act="seen" data-date="${esc(d.date)}">${d.review && d.review.reviewed ? 'ویرایش کامنت' : 'مشاهده شد'}</button>` : '',
    ].filter(Boolean).join('');
    return btns ? `<div class="day-card-actions">${btns}</div>` : '';
  }

  function dayCard(d, isSelf, opts) {
    const tasks = d.tasks || [];
    const taskList = tasks.length
      ? `<ul class="day-tasks">${tasks.map((t) => taskRow(t, isSelf, opts)).join('')}</ul>`
      : `<div class="muted text-xs">تسکی برای این روز ثبت نشده است.</div>`;
    const reviewNote = d.review && d.review.reviewed
      ? `<div class="muted day-reviewed">${icon('check', 14)} مشاهده‌شده توسط سرپرست${d.review.reviews[0] && d.review.reviews[0].comment ? `: «${esc(d.review.reviews[0].comment)}»` : ''}</div>` : '';
    return `<details class="card day-card${d.isToday ? ' is-today' : ''}" open>
      <summary>
        <div class="day-card-date">${esc(fmt.date(d.date))}</div>
        <div class="day-chips">${dayChips(d)}</div>
      </summary>
      <div class="day-card-body">
        ${dayAttendanceLine(d)}
        ${taskList}
        ${reviewNote}
        ${dayActions(d, isSelf, opts)}
      </div>
    </details>`;
  }

  function weekGrid(r) {
    const isSelf = AP.state.me && r.user.id === AP.state.me.id;
    return `<div class="week-grid">${r.days.map((d) => dayCard(d, isSelf)).join('')}</div>`;
  }

  function kpiRow(r) {
    const s = r.summary;
    const t = s.tasks;
    const a = s.attendance;
    return `
      <div class="stat-grid">
        ${kpi('g-green', 'check', t.completionPercent == null ? '—' : `${fmt.num(t.completionPercent)}٪`, 'تکمیل تسک‌ها', `${fmt.num(t.total)} تسک سررسیدشده`)}
        ${kpi('g-blue', 'clock', fmt.min(a.usefulMinutes), 'ساعت مفید', a.expectedMinutes ? `از ${fmt.min(a.expectedMinutes)} مورد انتظار (${a.usefulPercent == null ? '—' : `${fmt.num(a.usefulPercent)}٪`})` : '')}
        ${kpi('g-orange', 'alert', fmt.num(a.lateDays), 'روز تأخیر')}
        ${kpi('g-red', 'alert', fmt.num(t.urgent), 'تسک فوری', t.selfUrgent ? `${fmt.num(t.selfUrgent)} توسط خود کارمند` : '')}
        ${kpi('g-purple', 'clock', fmt.min(a.overtimeMinutes), 'اضافه‌کاری')}
        ${kpi('g-gray', 'alert', fmt.num(a.noReportDays), 'روز بدون گزارش')}
      </div>
      <div class="card">${completionBar(t)}</div>`;
  }

  // M2/M3 («وضعیت من»): استفاده‌ی مجدد از همین قطعه‌ها (بدون کپی؛ REASONS برای فهرست علت‌ها در M3)؛ dayCard با { readOnly: true } دکمه‌های مدیریتی را نمی‌سازد.
  AP.weekUi = { kpi, dayCard, planBadge, TASK_STATUS, REASONS };

  AP.view('weekly', {
    skeleton: 'plan',
    perm: 'team.week_view',
    navId: 'employees',
    async render(param) {
      if (!param) throw new Error('کارمندی انتخاب نشده است.');
      const userId = Number(param);
      if (ui.userId !== userId) { ui.userId = userId; ui.start = ''; } // کارمند عوض شد ⇒ برگشت به هفته‌ی جاری
      const r = await AP.api(`/admin/users/${userId}/week${ui.start ? `?start=${encodeURIComponent(ui.start)}` : ''}`);

      const html = `
        <div class="view-header">
          <button class="btn ghost small" data-go="profile" data-param="${userId}">→ بازگشت به پروفایل کارمند</button>
          <div class="header-actions">${AP.can('team.week_view') ? `<button type="button" class="btn ghost small" data-go="nextplan" data-param="${userId}">📓 برنامه‌ی هفته بعد</button>` : ''}<button type="button" class="btn ghost small" data-print>${icon('download', 14)} چاپ</button></div>
        </div>
        ${weekHeader(r)}
        ${kpiRow(r)}
        ${weekGrid(r)}`;

      return {
        html,
        mount(page) {
          $$('[data-go]', page).forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.go, b.dataset.param)));
          $$('[data-week-nav]', page).forEach((b) => b.addEventListener('click', () => {
            if (b.disabled) return;
            ui.start = b.dataset.weekNav;
            AP.refresh();
          }));
          // اکشن‌های مدیریتی کارت هر روز؛ هر سه پس از موفقیت کل هفته را رفرش می‌کنند (AP.refresh)
          // H5-ب: «مشاهده‌ی گزارش‌ها» ⇒ صفحه‌ی گزارش‌های تیم برای روزِ گزارش‌ها (پارامتر مسیر = تاریخ)
          $$('[data-act="open-reviews"]', page).forEach((b) => b.addEventListener('click', () => AP.go('teamreports', b.dataset.date)));
          $$('[data-act="urgent"]', page).forEach((b) => b.addEventListener('click', () => {
            AP.openUrgentTaskForm(userId, r.user.fullName, () => AP.refresh(), b.dataset.date);
          }));
          $$('[data-act="schedule"]', page).forEach((b) => b.addEventListener('click', async () => {
            if (!AP.scheduleTab || !AP.scheduleTab.editModal) return;
            try {
              const sr = await AP.api(`/admin/users/${userId}/schedule?from=${b.dataset.date}&to=${b.dataset.date}`);
              const day = (sr.days || [])[0];
              if (!day) { AP.toast('اطلاعات این روز یافت نشد.', true); return; }
              AP.scheduleTab.editModal({ id: userId, fullName: r.user.fullName }, day, () => AP.refresh());
            } catch (err) { AP.toast(err.message, true); }
          }));
          $$('[data-act="seen"]', page).forEach((b) => b.addEventListener('click', async () => {
            const res = await AP.askReason({ title: 'مشاهده‌ی گزارش روز', label: 'کامنت برای کارمند (اختیاری)', confirmText: 'ثبت «مشاهده شد»', required: false });
            if (res === null || res === undefined || res === false) return;
            const comment = typeof res === 'string' ? res : (res && res.reason) || '';
            const ok = await AP.attempt(() => AP.api('/admin/report-reviews', { method: 'POST', body: { subjectUserId: userId, reportDate: b.dataset.date, ...(comment ? { comment } : {}) } }), 'ثبت شد.');
            if (ok !== false) AP.refresh();
          }));
        },
      };
    },
  });
})();
