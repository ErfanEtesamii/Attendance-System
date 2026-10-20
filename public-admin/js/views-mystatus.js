// M2 («وضعیت من»): صفحه‌ی فقط‌نمایشِ وضعیت «خودِ» کاربر برای همه‌ی نقش‌ها — از API فقط‌خواندنیِ M1 (`GET /admin/me/week`).
// هویت فقط از نشست است؛ این صفحه هیچ شناسه‌ی کاربری به API نمی‌فرستد. تیک‌زدن تسک‌ها در M3 اضافه می‌شود (اینجا فقط نمایش).
// قطعه‌های مشترک (KPI، کارت روز، نشان برنامه) از views-weekly.js می‌آیند (AP.weekUi) تا ظاهر هر دو صفحه یکی بماند.
//   بالا: KPI هفته ← «امروز» + «برنامه‌ی هفته‌ی بعد» ← شبکه‌ی ۷ روزه‌ی هفته (جاری یا قبل با ناوبری).
// لودینگ: skeleton روتر؛ خطا: صفحه‌ی خطای روتر با «تلاش دوباره»؛ «وضعیت برنامه‌ی هفته‌ی بعد» اگر نیامد، صفحه را خراب نمی‌کند.
(function () {
  'use strict';
  const AP = window.AP;
  const { $$, esc, fmt, icon } = AP;

  // وضعیت صفحه بین رفرش‌ها حفظ می‌شود (مثل ui در views-weekly.js): هفته‌ی نمایش‌داده‌شده ('' = جاری)
  const ui = { start: '' };

  // ---------- توابع خالص ----------
  /** وضعیت «امروز» از روی روز هفته: [کلاس نشان، متن]. */
  function todayStatus(d) {
    if (!d) return ['', '—'];
    if (d.kind === 'leave') return ['leave', 'مرخصی'];
    if (d.kind === 'mission') return ['mission', 'مأموریت'];
    if (d.kind === 'holiday') return ['holiday', 'تعطیل'];
    if (d.kind === 'off') return ['', 'غیرکاری'];
    const att = d.attendance;
    if (att && att.hasCheckIn) return att.isOpen ? ['approved', 'حاضر'] : ['', 'خروج ثبت شده'];
    return ['pending', 'هنوز ورود نزده'];
  }

  /** عنوان هفته‌ی نمایش‌داده‌شده نسبت به هفته‌ی جاری. */
  function weekTitle(sel, cur) {
    if (sel.week.start === cur.week.start) return 'این هفته';
    if (sel.week.start === cur.week.prevWeekStart) return 'هفته‌ی قبل';
    return 'هفته‌ی انتخاب‌شده';
  }

  // ---------- HTML ----------
  const row = (label, valueHtml) => `<div class="ms-row"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>`;
  const emptyBox = (msg) => `<div class="card"><div class="empty" role="status">${icon('alert')}${esc(msg)}</div></div>`;

  function kpiRow(r) {
    const s = r.summary; const t = s.tasks; const a = s.attendance; const W = AP.weekUi;
    return `<div class="stat-grid">
      ${W.kpi('g-blue', 'clock', fmt.min(a.usefulMinutes), 'ساعت مفید', a.expectedMinutes ? `از ${fmt.min(a.expectedMinutes)} مورد انتظار (${a.usefulPercent == null ? '—' : `${fmt.num(a.usefulPercent)}٪`})` : '')}
      ${W.kpi('g-orange', 'alert', fmt.num(a.lateDays), 'روز تأخیر')}
      ${W.kpi('g-purple', 'clock', fmt.min(a.overtimeMinutes), 'اضافه‌کاری')}
      ${W.kpi('g-green', 'check', t.completionPercent == null ? '—' : `${fmt.num(t.completionPercent)}٪`, 'تکمیل تسک‌ها', `${fmt.num(t.total)} تسک سررسیدشده`)}
    </div>`;
  }

  function taskLine(t) {
    const [cls, label] = AP.weekUi.TASK_STATUS[t.status] || ['', t.status];
    const mandatory = t.isSystem && t.systemKey === 'review_team_reports';
    return `<li class="ms-task"><span class="ms-task-title">${mandatory ? `${AP.badge('blue', '🔒 واجب', true)} ` : ''}${t.isUrgent ? `${AP.badge('red', '⚡ فوری', true)} ` : ''}${esc(t.title)}</span>${AP.badge(cls, label)}</li>`;
  }

  function todayCard(cur) {
    const d = cur.days.find((x) => x.isToday);
    if (!d) return emptyBox('اطلاعات امروز در دسترس نیست.');
    const [cls, label] = todayStatus(d);
    const att = d.attendance; const hasIn = !!(att && att.hasCheckIn);
    const rows = [row('وضعیت', AP.badge(cls, label, true))];
    if (d.schedule.isWorkingDay) {
      const planned = d.schedule.start && d.schedule.end
        ? `<bdi>${esc(d.schedule.start)}–${esc(d.schedule.end)}</bdi>${d.schedule.plannedMinutes ? ` <span class="muted">(${esc(fmt.min(d.schedule.plannedMinutes))})</span>` : ''}` : '—';
      rows.push(row('برنامه‌ی امروز', planned));
      rows.push(row('ورود', hasIn ? esc(fmt.clock(att.checkIn)) : 'ثبت نشده'));
      rows.push(row('خروج', hasIn && att.checkOut ? esc(fmt.clock(att.checkOut)) : (hasIn ? 'هنوز خارج نشده' : '—')));
      rows.push(row('ساعت مفید تا الان', hasIn && att.effectiveMinutes != null ? esc(fmt.min(att.effectiveMinutes)) : '—'));
      const chips = [
        hasIn && att.lateMinutes > 0 ? AP.badge('late', `تأخیر ${fmt.min(att.lateMinutes)}`) : '',
        hasIn && att.earlyLeaveMinutes > 0 ? AP.badge('red', `زودتر رفتن ${fmt.min(att.earlyLeaveMinutes)}`) : '',
        hasIn && att.overtimeMinutes > 0 ? AP.badge('blue', `اضافه‌کاری ${fmt.min(att.overtimeMinutes)}`) : '',
      ].filter(Boolean).join('');
      if (chips) rows.push(row('تأخیر / اضافه‌کاری', `<span class="ms-chips">${chips}</span>`));
    } else if (d.holidayTitle) rows.push(row('مناسبت', esc(d.holidayTitle)));
    const tasks = d.tasks || [];
    const taskBlock = tasks.length
      ? `<ul class="plain ms-tasks" aria-label="تسک‌های امروز">${tasks.map(taskLine).join('')}</ul>`
      : '<div class="muted ms-note" role="status">برای امروز تسکی ثبت نشده است.</div>';
    return `<section class="card ms-today" aria-labelledby="ms-today-h">
      <h3 id="ms-today-h">امروز · ${esc(fmt.date(d.date))}</h3>
      <dl class="ms-rows">${rows.join('')}</dl>
      <h4 class="ms-sub">تسک‌های امروز</h4>
      ${taskBlock}
    </section>`;
  }

  function nextPlanCard(cur, next) {
    const range = `${esc(cur.week.nextWeekStart ? fmt.dateLong(cur.week.nextWeekStart) : '')}`;
    const body = next
      ? row('وضعیت', AP.weekUi.planBadge(next.plan)) + row('تعداد تسک‌های ثبت‌شده', next.days && next.plan ? fmt.num(next.days.reduce((n, x) => n + (x.tasks || []).length, 0)) : '—')
      : '';
    const link = AP.can('team.week_view') ? `<div class="ms-actions"><button type="button" class="btn ghost small" data-go="nextplan">📓 باز کردن دفترچه‌ی برنامه‌ی هفته بعد</button></div>` : '';
    return `<section class="card ms-next" aria-labelledby="ms-next-h">
      <h3 id="ms-next-h">برنامه‌ی هفته‌ی بعد</h3>
      <div class="muted ms-note">از ${range}</div>
      ${next ? `<dl class="ms-rows">${body}</dl>` : '<div class="muted ms-note" role="status">وضعیت برنامه‌ی هفته‌ی بعد در دسترس نیست.</div>'}
      ${link}
    </section>`;
  }

  function weekNav(sel, cur) {
    return `<div class="week-nav" role="group" aria-label="ناوبری هفته">
      <button type="button" class="btn ghost small" data-week-nav="${esc(sel.week.prevWeekStart)}">◀ هفته‌ی قبل</button>
      <button type="button" class="btn ghost small" data-week-nav="${esc(cur.week.today)}" ${sel.week.isCurrentWeek ? 'disabled' : ''}>هفته‌ی جاری</button>
    </div>`;
  }

  AP.view('mystatus', {
    skeleton: 'plan',
    perm: 'me.read',
    async render() {
      if (!AP.weekUi) throw new Error('بخش نمای هفتگی بارگذاری نشده است.');
      const cur = await AP.api('/admin/me/week');
      const enc = encodeURIComponent;
      const [sel, next] = await Promise.all([
        ui.start && ui.start !== cur.week.start ? AP.api(`/admin/me/week?start=${enc(ui.start)}`) : Promise.resolve(cur),
        AP.api(`/admin/me/week?start=${enc(cur.week.nextWeekStart)}`).catch(() => null), // غیرحیاتی: فقط نشان وضعیت برنامه
      ]);
      const W = AP.weekUi;
      const grid = `<div class="week-grid">${sel.days.map((d) => W.dayCard(d, true, { readOnly: true })).join('')}</div>`;
      const html = `
        <div class="view-header">
          <div><h2>وضعیت من</h2><div class="sub">${esc(weekTitle(sel, cur))} · ${esc(sel.week.jalaliStart)} تا ${esc(sel.week.jalaliEnd)}</div></div>
          <div class="header-actions">${weekNav(sel, cur)}<button type="button" class="btn ghost small" data-print>${icon('download', 14)} چاپ</button></div>
        </div>
        ${kpiRow(sel)}
        <div class="ms-top">${todayCard(cur)}${nextPlanCard(cur, next)}</div>
        <h3 class="ms-section-title">روزهای ${esc(weekTitle(sel, cur))}</h3>
        ${grid}`;
      return {
        html,
        mount(page) {
          $$('[data-go]', page).forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.go, b.dataset.param)));
          $$('[data-week-nav]', page).forEach((b) => b.addEventListener('click', () => {
            if (b.disabled) return;
            ui.start = b.dataset.weekNav;
            AP.refresh();
          }));
          $$('[data-act="open-reviews"]', page).forEach((b) => b.addEventListener('click', () => AP.go('teamreports', b.dataset.date)));
        },
      };
    },
  });

  AP.myStatus = { todayStatus, weekTitle, ui };
})();
