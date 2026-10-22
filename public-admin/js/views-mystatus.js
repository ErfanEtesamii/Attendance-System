// M2 («وضعیت من»): صفحه‌ی وضعیت «خودِ» کاربر برای همه‌ی نقش‌ها — از API فقط‌خواندنیِ M1 (`GET /admin/me/week`).
// M3: تیک‌زدن تسک‌های امروز از داخل همین صفحه (انجام شد / ناقص / انجام نشد + علت، برداشتن تیک، توضیح انجام، گزارش دیرهنگام) از
//   `/admin/me/tasks/*` که همان منطق Mini App (taskReportService) را صدا می‌زند. تسک سیستمی/واجب فقط‌خواندنی است.
// تسک فوریِ خودِ کاربر: وقتی تنظیم selfUrgentEnabled روشن است (GET /admin/me/urgent/config)، روی کارت «امروز» و کارت هر روزِ کاریِ امروز/آینده دکمه‌ی «⚡ تسک فوری» هست
//   و دکمه‌ی سربرگ برای هر تاریخ تا ۶۰ روز بعد؛ ویرایش/حذف فقط برای فوریِ خودش و بدون پاسخ (`/admin/me/urgent/*`؛ همه‌ی قوانین سمت سرور).
// هویت فقط از نشست است؛ این صفحه هیچ شناسه‌ی کاربری به API نمی‌فرستد.
// قطعه‌های مشترک (KPI، کارت روز، نشان برنامه) از views-weekly.js می‌آیند (AP.weekUi) تا ظاهر هر دو صفحه یکی بماند.
//   بالا: KPI هفته ← «امروز» + «برنامه‌ی هفته‌ی بعد» ← شبکه‌ی ۷ روزه‌ی هفته (جاری یا قبل با ناوبری).
// لودینگ: skeleton روتر؛ خطا: صفحه‌ی خطای روتر با «تلاش دوباره»؛ «وضعیت برنامه‌ی هفته‌ی بعد» و فهرست تسک‌ها اگر نیامد، صفحه را خراب نمی‌کنند.
// بعد از هر ثبت/واگرد، فقط محتوای `#ms-live` (KPI، امروز، شبکه‌ی هفته) از سرور دوباره ساخته می‌شود (بدون رفرش کامل صفحه).
(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt, icon } = AP;

  // وضعیت صفحه بین رفرش‌ها حفظ می‌شود (مثل ui در views-weekly.js): هفته‌ی نمایش‌داده‌شده ('' = جاری) و روزِ گزارش دیرهنگام ('' = امروز)
  const ui = { start: '', taskDate: '' };
  const MAX_REASON = 300; const MAX_NOTE = 500;
  const MSG = { done: 'تسک انجام‌شده ثبت شد.', answer: 'وضعیت تسک ثبت شد.', undo: 'تیک برداشته شد.', note: 'توضیح ذخیره شد.' };
  const ANSWER_BUTTONS = [['done', 'انجام شد', 'success'], ['partial', 'ناقص', 'ghost'], ['not_done', 'انجام نشد', 'danger']];

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

  /** بدنه‌ی POST /admin/me/tasks/answer؛ فقط فیلدهای مجاز (هیچ شناسه‌ی کاربر). علت فقط برای ناقص/انجام‌نشده می‌رود. */
  function answerBody(taskId, status, date, extra) {
    const body = { taskId: Number(taskId), status, date };
    if (status !== 'done') {
      body.reasonCode = (extra && extra.reasonCode) || '';
      const text = ((extra && extra.reasonText) || '').trim();
      if (text) body.reasonText = text;
    }
    return body;
  }

  /** اعتبارسنجی سمت کلاینتِ فرم علت (سرور دوباره چک می‌کند): متن خطا یا ''. */
  function reasonError(code, text) {
    if (!code) return 'علت را انتخاب کنید.';
    const t = String(text || '').trim();
    if (t.length > MAX_REASON) return `توضیح حداکثر ${fmt.num(MAX_REASON)} نویسه است.`;
    if (code === 'other' && t.length < 5) return 'برای علت «سایر» حداقل ۵ نویسه توضیح بنویسید.';
    return '';
  }

  // ---------- HTML ----------
  const row = (label, valueHtml) => `<div class="ms-row"><dt>${esc(label)}</dt><dd>${valueHtml}</dd></div>`;
  const emptyBox = (msg) => `<div class="card"><div class="empty" role="status">${icon('alert')}${esc(msg)}</div></div>`;

  function kpiRow(r) {
    const s = r.summary; const t = s.tasks; const a = s.attendance; const W = AP.weekUi;
    return `<div class="stat-grid">
      ${W.kpi('g-blue', 'clock', fmt.min(a.usefulMinutes), 'ساعت مفید', `${a.workedGrossMinutes ? `${a.usefulOfWorkedPercent == null ? '—' : `${fmt.num(a.usefulOfWorkedPercent)}٪`} از کل حضور ثبت‌شده (${fmt.min(a.workedGrossMinutes)})` : (a.expectedMinutes ? `از ${fmt.min(a.expectedMinutes)} مورد انتظار (${a.usefulPercent == null ? '—' : `${fmt.num(a.usefulPercent)}٪`})` : '')}${a.latePenaltyMinutes ? ` · امتیاز پس از تأخیر: ${fmt.min(a.performanceUsefulMinutes)}` : ''}`)}
      ${W.kpi('g-orange', 'alert', fmt.num(a.lateDays), 'روز تأخیر')}
      ${W.kpi('g-purple', 'clock', fmt.min(a.overtimeMinutes), 'اضافه‌کاری')}
      ${W.kpi('g-green', 'check', t.completionPercent == null ? '—' : `${fmt.num(t.completionPercent)}٪`, 'تکمیل تسک‌ها', `${fmt.num(t.total)} تسک سررسیدشده`)}
    </div>`;
  }

  // فقط‌خواندنی (فالبک وقتی فهرست تعاملی نیامد، و نمایش تسک واجب)
  function taskLine(t) {
    const [cls, label] = AP.weekUi.TASK_STATUS[t.status] || ['', t.status];
    const mandatory = t.isSystem && t.systemKey === 'review_team_reports';
    return `<li class="ms-task"><span class="ms-task-title">${mandatory ? `${AP.badge('blue', '🔒 واجب', true)} ` : ''}${t.isUrgent ? `${AP.badge('red', '⚡ فوری', true)} ` : ''}${esc(t.title)}</span>${AP.badge(cls, label)}</li>`;
  }

  // تسک بی‌پاسخ: سه دکمه (سیستمی/واجب ⇒ بدون دکمه)
  function pendingTask(t) {
    const badges = [
      t.isSystem ? AP.badge('blue', '🔒 واجب', true) : '',
      t.isUrgent ? AP.badge('red', '⚡ فوری', true) : '',
      t.optional ? AP.badge('', 'اختیاری') : '',
      t.rescheduledFrom ? AP.badge('', `↪ از ${fmt.date(t.rescheduledFrom)}`) : '',
    ].filter(Boolean).join(' ');
    const actions = t.isSystem
      ? '<div class="ms-task-sub muted">فقط‌خواندنی؛ وضعیت این تسک از پنل قابل تغییر نیست.</div>'
      : `<div class="ms-task-actions" role="group" aria-label="${esc(`وضعیت «${t.title}»`)}">${ANSWER_BUTTONS.map(([s, l, c]) => `<button type="button" class="btn ${c} small" data-act="answer" data-status="${s}" data-task="${esc(t.id)}">${esc(l)}</button>`).join('')}</div>`;
    return `<li class="ms-task ms-task-edit" data-task="${esc(t.id)}"><span class="ms-task-title">${badges ? `${badges} ` : ''}${esc(t.title)}</span>${actions}</li>`;
  }

  // تسک پاسخ‌داده‌شده: وضعیت + علت/توضیح + «برداشتن تیک» و «توضیح» (سیستمی ⇒ فقط‌خواندنی)
  function answeredTask(a) {
    const [cls, label] = AP.weekUi.TASK_STATUS[a.status] || ['', a.status];
    const reasons = AP.weekUi.REASONS || {};
    const reason = a.reasonText || (a.reasonCode ? reasons[a.reasonCode] || a.reasonCode : '');
    const readOnly = !!a.isSystem || a.canUndo === false;
    const chips = [
      a.isSystem ? AP.badge('blue', '🔒 واجب', true) : '',
      a.isUrgent ? AP.badge('red', '⚡ فوری', true) : '',
      a.answeredLate ? AP.badge('orange', 'پاسخ دیرهنگام') : '',
      a.outOfPlan ? AP.badge('', 'خارج از برنامه') : '',
      a.rescheduleTo && !a.dropped ? AP.badge('', `منتقل به ${fmt.date(a.rescheduleTo)}`) : '',
      a.dropped ? AP.badge('', 'کنارگذاشته‌شده') : '',
    ].filter(Boolean).join(' ');
    const subs = [reason ? `علت: ${esc(reason)}` : '', a.note ? `توضیح انجام: ${esc(a.note)}` : ''].filter(Boolean).join(' · ');
    const btns = readOnly ? '' : `<div class="ms-task-actions">
      <button type="button" class="btn ghost small" data-act="undo" data-task="${esc(a.taskId)}">برداشتن تیک</button>
      ${a.status === 'done' ? `<button type="button" class="btn ghost small" data-act="note" data-task="${esc(a.taskId)}">${a.note ? 'ویرایش توضیح' : 'افزودن توضیح'}</button>` : ''}</div>`;
    return `<li class="ms-task ms-task-edit" data-task="${esc(a.taskId)}"><span class="ms-task-title">${chips ? `${chips} ` : ''}${esc(a.title)}</span>${AP.badge(cls, label)}${subs ? `<div class="ms-task-sub muted">${subs}</div>` : ''}${btns}</li>`;
  }

  function progressBar(p) {
    if (!p || !p.total) return '';
    const pct = p.percent == null ? 0 : p.percent;
    return `<div class="hbar"><div class="hbar-top"><span>پیشرفت</span><span>${fmt.num(p.done)} از ${fmt.num(p.total)}${p.percent == null ? '' : ` (${fmt.num(p.percent)}٪)`}</span></div>
      <div class="hbar-track"><div class="hbar-fill" data-progress="${pct}"></div></div></div>`;
  }

  // گزارش‌های دیرهنگام: روزهای قبلی که هنوز پاسخ می‌پذیرند (امروزِ دیرهنگام در همان فهرست اصلی است)
  function backfillBlock(daily, backfill) {
    const lateMode = !!(daily && daily.ok && daily.date !== daily.today);
    const days = backfill && Array.isArray(backfill.days) ? backfill.days.filter((d) => !daily || !daily.ok || (d.date !== daily.today && d.date !== daily.date)) : [];
    if (!lateMode && !days.length) return '';
    const back = lateMode ? '<div class="ms-actions"><button type="button" class="btn ghost small" data-act="late-back">بازگشت به امروز</button></div>' : '';
    const list = days.length ? `<ul class="plain ms-tasks" aria-label="گزارش‌های دیرهنگام">${days.map((d) => `<li class="ms-task"><span class="ms-task-title">${esc(fmt.date(d.date))} · ${fmt.num(d.pendingCount)} تسک بدون پاسخ<span class="muted ms-task-sub">${esc((d.titles || []).join('، '))}</span></span><button type="button" class="btn ghost small" data-act="late-day" data-date="${esc(d.date)}">تکمیل گزارش</button></li>`).join('')}</ul>` : '';
    return `<h4 class="ms-sub">گزارش دیرهنگام</h4>${back}${list}`;
  }

  function tasksBlock(cur, today, daily, backfill) {
    if (!daily || !daily.ok) { // فهرست تعاملی نیامد ⇒ نمایش فقط‌خواندنی از هفته
      const tasks = (today && today.tasks) || [];
      const msg = daily && daily.error ? `<div class="muted ms-note" role="status">${esc(`ثبت وضعیت تسک‌ها اکنون در دسترس نیست: ${daily.error}`)}</div>` : '';
      return `${msg}${tasks.length ? `<ul class="plain ms-tasks" aria-label="تسک‌های امروز">${tasks.map(taskLine).join('')}</ul>` : '<div class="muted ms-note" role="status">برای امروز تسکی ثبت نشده است.</div>'}`;
    }
    const lateMode = daily.date !== daily.today;
    const head = lateMode ? `تسک‌های ${fmt.date(daily.date)} (گزارش دیرهنگام)` : 'تسک‌های امروز';
    const notes = [
      daily.late ? `<div class="muted ms-note" role="status">${AP.badge('orange', 'دیرهنگام')} پاسخ‌های این روز با برچسب «پاسخ دیرهنگام» ثبت می‌شوند.</div>` : '',
      daily.fullDayOff ? '<div class="muted ms-note" role="status">این روز مرخصی/مأموریت تمام‌روز است؛ گزارش تسک لازم نیست.</div>' : '',
    ].join('');
    const pending = daily.tasks || []; const answered = daily.answered || [];
    const empty = !pending.length && !answered.length && !daily.fullDayOff ? `<div class="muted ms-note" role="status">${lateMode ? 'برای این روز تسکی نیست.' : 'برای امروز تسکی ثبت نشده است.'}</div>` : '';
    return `<h4 class="ms-sub">${esc(head)}</h4>${notes}${progressBar(daily.progress)}
      ${pending.length ? `<ul class="plain ms-tasks" aria-label="${esc(head)}">${pending.map(pendingTask).join('')}</ul>` : ''}
      ${answered.length ? `<h4 class="ms-sub">پاسخ‌داده‌شده</h4><ul class="plain ms-tasks" aria-label="تسک‌های پاسخ‌داده‌شده">${answered.map(answeredTask).join('')}</ul>` : ''}
      ${empty}`;
  }

  function todayCard(cur, daily, backfill, urgentCfg) {
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
    return `<section class="card ms-today" aria-labelledby="ms-today-h">
      <h3 id="ms-today-h" tabindex="-1">امروز · ${esc(fmt.date(d.date))}</h3>
      <dl class="ms-rows">${rows.join('')}</dl>
      ${urgentCfg && urgentCfg.enabled && d.schedule.isWorkingDay ? `<div class="ms-actions"><button type="button" class="btn ghost small" data-act="su-add" data-date="${esc(d.date)}">⚡ تسک فوری برای امروز</button></div>` : ''}
      ${tasksBlock(cur, d, daily, backfill)}
      ${backfillBlock(daily, backfill)}
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

  // ---------- داده ----------
  const tasksUrl = (path, q) => `/admin/me/tasks/${path}${q ? `?${q}` : ''}`;

  async function loadAll() {
    const enc = encodeURIComponent;
    const cur = await AP.api('/admin/me/week');
    const loadDaily = (date) => AP.api(tasksUrl('today', date ? `date=${enc(date)}` : '')).catch((err) => ({ ok: false, error: err.message }));
    const [sel, next, daily0, backfill, urgentCfg, earnings] = await Promise.all([
      ui.start && ui.start !== cur.week.start ? AP.api(`/admin/me/week?start=${enc(ui.start)}`) : Promise.resolve(cur),
      AP.api(`/admin/me/week?start=${enc(cur.week.nextWeekStart)}`).catch(() => null), // غیرحیاتی: فقط نشان وضعیت برنامه
      loadDaily(ui.taskDate),
      AP.api(tasksUrl('backfill')).catch(() => null), // غیرحیاتی: بنر گزارش دیرهنگام
      AP.api('/admin/me/urgent/config').catch(() => null), // غیرحیاتی: نبودنش فقط دکمه‌های «تسک فوری» را مخفی می‌کند
      AP.api('/admin/me/earnings').then((r) => (r && r.earnings) || null).catch(() => null), // غیرحیاتی: null ⇒ کارت نمایش داده نمی‌شود
    ]);
    let daily = daily0;
    if (ui.taskDate && !(daily && daily.ok)) { ui.taskDate = ''; daily = await loadDaily(''); } // مهلت روزِ گذشته تمام شده ⇒ برگرد به امروز
    return { cur, sel, next, daily, backfill, urgentCfg, earnings };
  }

  // Phase 20: کارت «کارکرد این ماه» (null ⇒ اصلاً رندر نمی‌شود). مبلغ با count-up کوتاه فقط بار اول؛ با prefers-reduced-motion بدون انیمیشن.
  function earningsCard(e) {
    if (!e) return '';
    const amount = Math.max(0, Number(e.amountToman) || 0);
    const useful = Math.max(0, Number(e.usefulMinutes) || 0);
    return `<section class="card earn-card" id="ms-earnings" aria-labelledby="ms-earn-h">
      <div class="earn-head"><h3 id="ms-earn-h">💰 کارکرد این ماه</h3>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3S7.5 5.8 7.5 7.5 9.5 10.5 12 10.5s4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3"/></svg>
      </div>
      <p class="earn-intro">تا امروز در ${esc(e.monthLabel)} کار کرده‌ای</p>
      <p class="earn-amount"><span id="ms-earn-amount" data-amount="${amount}">${fmt.num(amount)}</span> تومان <span aria-hidden="true">✨</span></p>
      <p class="earn-useful">${fmt.min(useful)} ساعت مفید</p>
      <p class="earn-note">تخمینی؛ حقوق نهایی بر اساس تایید حسابداری است</p>
    </section>`;
  }
  function animateEarnings(root) {
    const el = $('#ms-earn-amount', root);
    if (!el || ui.earningsShown) return;
    ui.earningsShown = true;
    const amount = Number(el.dataset.amount) || 0;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !window.requestAnimationFrame || amount === 0) return;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 800);
      el.textContent = fmt.num(Math.round(amount * p));
      if (p < 1 && el.isConnected) requestAnimationFrame(tick); else el.textContent = fmt.num(amount);
    };
    requestAnimationFrame(tick);
  }

  function liveHtml(d) {
    const W = AP.weekUi;
    const grid = `<div class="week-grid">${d.sel.days.map((x) => W.dayCard(x, true, { readOnly: true, selfUrgent: !!(d.urgentCfg && d.urgentCfg.enabled) })).join('')}</div>`;
    return `${earningsCard(d.earnings)}${kpiRow(d.sel)}
        <div class="ms-top">${todayCard(d.cur, d.daily, d.backfill, d.urgentCfg)}${nextPlanCard(d.cur, d.next)}</div>
        <h3 class="ms-section-title">روزهای ${esc(weekTitle(d.sel, d.cur))}</h3>
        ${grid}`;
  }

  AP.view('mystatus', {
    skeleton: 'plan',
    perm: 'me.read',
    async render() {
      if (!AP.weekUi) throw new Error('بخش نمای هفتگی بارگذاری نشده است.');
      let data = await loadAll();
      const { cur, sel } = data;
      const html = `
        <div class="view-header">
          <div><h2>وضعیت من</h2><div class="sub">${esc(weekTitle(sel, cur))} · ${esc(sel.week.jalaliStart)} تا ${esc(sel.week.jalaliEnd)}</div></div>
          <div class="header-actions">${weekNav(sel, cur)}${data.urgentCfg && data.urgentCfg.enabled ? '<button type="button" class="btn ghost small" data-act="su-add-any">⚡ تسک فوری</button>' : ''}<button type="button" class="btn ghost small" data-print>${icon('download', 14)} چاپ</button></div>
        </div>
        <div id="ms-live">${liveHtml(data)}</div>`;

      const post = (path, body, method) => AP.api(tasksUrl(path), { method: method || 'POST', body });
      const taskOf = (id) => (data.daily && data.daily.ok ? [...(data.daily.tasks || []), ...(data.daily.answered || []).map((a) => ({ ...a, id: a.taskId }))].find((t) => Number(t.id) === Number(id)) : null);

      // بعد از موفقیت: فقط ناحیه‌ی زنده را از سرور دوباره می‌سازد؛ فوکوس روی همان تسک (یا عنوان «امروز») می‌ماند
      async function reload(page, focusId) {
        const live = $('#ms-live', page);
        if (!live) { AP.refresh(); return; }
        try { data = await loadAll(); } catch (err) { AP.toast(err.message, true); return; }
        live.innerHTML = liveHtml(data);
        bindLive(live, page);
        if (AP.refreshMyTasksCount) AP.refreshMyTasksCount(); // M4: نشان منو بعد از هر تیک/برداشتن تیک به‌روز شود (بدون انتظار)
        const target = (focusId != null && $(`[data-task="${focusId}"] button`, live)) || $('#ms-today-h', live);
        if (target && target.focus) target.focus({ preventScroll: true });
      }
      async function act(page, fn, okMsg, btn, focusId) {
        const r = await AP.attempt(fn, okMsg, btn);
        if (r) await reload(page, focusId);
        return !!r;
      }

      function openReasonForm(page, t, status) {
        const codes = (data.daily && data.daily.reasonCodes) || Object.keys(AP.weekUi.REASONS || {});
        const labels = AP.weekUi.REASONS || {};
        AP.modal({
          title: `${status === 'partial' ? 'ناقص' : 'انجام نشد'}: ${t.title}`,
          body: `<form class="form" id="ms-reason-form">
            <label class="field"><span>علت</span><select name="reasonCode" required><option value="">انتخاب کنید…</option>${codes.map((c) => `<option value="${esc(c)}">${esc(labels[c] || c)}</option>`).join('')}</select></label>
            <label class="field"><span>توضیح (برای «سایر» حداقل ۵ نویسه)</span><textarea name="reasonText" rows="3" maxlength="${MAX_REASON}"></textarea></label>
            <div class="form-msg" role="alert"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">ثبت</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
          </form>`,
          onMount(body, m) {
            const form = $('#ms-reason-form', body);
            $('[data-cancel]', form).addEventListener('click', () => m.close());
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              const err = reasonError(f.reasonCode, f.reasonText);
              if (err) { $('.form-msg', form).textContent = err; return; }
              const ok = await act(page, () => post('answer', answerBody(t.id, status, data.daily.date, f)), MSG.answer, $('button[type=submit]', form), t.id);
              if (ok) m.close();
            });
          },
        });
      }

      function openNoteForm(page, t) {
        AP.modal({
          title: `توضیح انجام: ${t.title}`,
          body: `<form class="form" id="ms-note-form">
            <label class="field"><span>توضیح (اختیاری؛ خالی ⇒ پاک می‌شود)</span><textarea name="note" rows="3" maxlength="${MAX_NOTE}">${esc(t.note || '')}</textarea></label>
            <div class="modal-actions"><button class="btn primary" type="submit">ذخیره</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
          </form>`,
          onMount(body, m) {
            const form = $('#ms-note-form', body);
            $('[data-cancel]', form).addEventListener('click', () => m.close());
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              const ok = await act(page, () => post('note', { taskId: Number(t.id), date: data.daily.date, note: f.note || '' }, 'PATCH'), MSG.note, $('button[type=submit]', form), t.id);
              if (ok) m.close();
            });
          },
        });
      }

      // تسک فوریِ خودِ کاربر: افزودن (task=null) یا ویرایش؛ اعتبارسنجی/قوانین واقعی سمت سرور (selfUrgentTaskService)
      const urgentTaskOf = (id) => data.sel.days.flatMap((d) => d.tasks || []).find((t) => Number(t.taskId) === Number(id));
      function openUrgentForm(page, task, date) {
        const edit = !!task;
        AP.modal({
          title: edit ? `ویرایش تسک فوری: ${task.title}` : '⚡ تسک فوری برای خودم',
          body: `<form class="form" id="ms-urgent-form">
            <div class="form-grid">
              <label class="field"><span>عنوان</span><input name="title" required maxlength="120" value="${esc(edit ? task.title : '')}" placeholder="مثلاً: ارسال پیش‌فاکتور به مشتری" /></label>
              <label class="field"><span>تاریخ انجام</span><input type="date" name="date" required value="${esc(date || fmt.today())}" /></label>
              <label class="field"><span>شروع (اختیاری)</span><input type="time" name="startTime" value="${esc(edit ? task.scheduledStartTime || task.startTime || '' : '')}" /></label>
              <label class="field"><span>پایان (اختیاری)</span><input type="time" name="endTime" value="${esc(edit ? task.urgentDeadlineTime || task.endTime || '' : '')}" /></label>
              <label class="field"><span>توضیح (اختیاری)</span><textarea name="description" rows="3" maxlength="500">${esc(edit ? task.description || '' : '')}</textarea></label>
            </div>
            <p class="muted">${edit ? 'تاریخ را فقط داخل همین هفته می‌توانید تغییر دهید؛ بعد از ثبت پاسخ، تسک دیگر قابل ویرایش یا حذف نیست.' : 'تسک با برچسب «⚡ فوری» به برنامه‌ی همان روزتان اضافه می‌شود و سرپرست‌تان باخبر می‌شود. تا قبل از ثبت پاسخ می‌توانید آن را ویرایش یا حذف کنید.'}</p>
            <div class="form-msg" role="alert"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">${edit ? 'ذخیره' : 'ثبت تسک فوری'}</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
          </form>`,
          onMount(body, m) {
            AP.dates.mount(body);
            const form = $('#ms-urgent-form', body);
            $('[data-cancel]', form).addEventListener('click', () => m.close());
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              if (!String(f.title || '').trim()) { $('.form-msg', form).textContent = 'عنوان تسک فوری الزامی است.'; return; }
              const payload = { title: f.title, date: f.date, description: f.description || '', startTime: f.startTime || '', endTime: f.endTime || '' };
              const ok = await act(page, () => AP.api(edit ? `/admin/me/urgent/${task.taskId}` : '/admin/me/urgent', { method: edit ? 'PATCH' : 'POST', body: payload }),
                edit ? 'تسک فوری ویرایش شد.' : 'تسک فوری اضافه شد.', $('button[type=submit]', form), edit ? task.taskId : null);
              if (ok) m.close();
            });
          },
        });
      }

      // اتصال کنترل‌های «ناحیه‌ی زنده» (بعد از هر بازسازی دوباره صدا زده می‌شود)
      function bindLive(root, page) {
        $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.go, b.dataset.param)));
        $$('[data-act="open-reviews"]', root).forEach((b) => b.addEventListener('click', () => AP.go('teamreports', b.dataset.date)));
        $$('[data-act="answer"]', root).forEach((b) => b.addEventListener('click', () => {
          const t = taskOf(b.dataset.task);
          if (!t || !data.daily || !data.daily.ok) return;
          if (b.dataset.status === 'done') { act(page, () => post('answer', answerBody(t.id, 'done', data.daily.date)), MSG.done, b, t.id); return; }
          openReasonForm(page, t, b.dataset.status);
        }));
        $$('[data-act="undo"]', root).forEach((b) => b.addEventListener('click', () => {
          const t = taskOf(b.dataset.task);
          if (!t || !data.daily || !data.daily.ok) return;
          act(page, () => post('undo', { taskId: Number(t.id), date: data.daily.date }), MSG.undo, b, t.id);
        }));
        $$('[data-act="note"]', root).forEach((b) => b.addEventListener('click', () => {
          const t = taskOf(b.dataset.task);
          if (t && data.daily && data.daily.ok) openNoteForm(page, t);
        }));
        $$('[data-act="su-add"]', root).forEach((b) => b.addEventListener('click', () => openUrgentForm(page, null, b.dataset.date)));
        $$('[data-act="su-edit"]', root).forEach((b) => b.addEventListener('click', () => {
          const t = urgentTaskOf(b.dataset.task);
          if (t) openUrgentForm(page, t, t.plannedDate);
        }));
        $$('[data-act="su-del"]', root).forEach((b) => b.addEventListener('click', async () => {
          const t = urgentTaskOf(b.dataset.task);
          const yes = await AP.confirmBox({ title: 'حذف تسک فوری', message: `تسک فوری «${t ? t.title : ''}» حذف شود؟`, confirmText: 'حذف', danger: true });
          if (yes) act(page, () => AP.api(`/admin/me/urgent/${Number(b.dataset.task)}`, { method: 'DELETE' }), 'تسک فوری حذف شد.', b);
        }));
        $$('[data-act="late-day"]', root).forEach((b) => b.addEventListener('click', () => { ui.taskDate = b.dataset.date; reload(page); }));
        $$('[data-act="late-back"]', root).forEach((b) => b.addEventListener('click', () => { ui.taskDate = ''; reload(page); }));
      }

      return {
        html,
        mount(page) {
          $$('[data-week-nav]', page).forEach((b) => b.addEventListener('click', () => {
            if (b.disabled) return;
            ui.start = b.dataset.weekNav;
            AP.refresh();
          }));
          $$('[data-act="su-add-any"]', page).forEach((b) => b.addEventListener('click', () => openUrgentForm(page, null, '')));
          bindLive($('#ms-live', page) || page, page);
          animateEarnings(page);
        },
      };
    },
  });

  AP.myStatus = { todayStatus, weekTitle, answerBody, reasonError, ui };
})();
