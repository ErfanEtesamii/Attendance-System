// منطق خالصِ UI تازه‌ی برنامه‌ی هفتگی و «امروزِ من» (فاز ۱۵ — C1). بدون DOM تا در تست‌های Node هم اجرا شود.
// ساخت DOM در app.js (planEl) است؛ این‌جا فقط نگاشت رنگ/وضعیت/چیپ، پیشرفت، مدل شیت جزئیات و منطق انتقال.
// سرور همیشه دوباره اعتبارسنجی می‌کند؛ فلگ‌های دکمه‌ها فقط راهنمای UI‌اند.
(function (root) {
  'use strict';

  const DAYS = 7;
  const REVIEW_KEY = 'review_team_reports'; // باید با REVIEW_KEY سرور و DailyReport یکی باشد
  const DAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // به‌ترتیب getUTCDay

  // وضعیت‌ها: متن فارسی + آیکون متنی (فقط به رنگ متکی نیستیم) + کلاس
  const STATUS = {
    pending: { label: 'در انتظار', icon: '⏳', cls: 'pl-st-pending' },
    done: { label: 'انجام شد', icon: '✓', cls: 'pl-st-done' },
    partial: { label: 'نیمه‌کاره', icon: '◐', cls: 'pl-st-partial' },
    not_done: { label: 'انجام نشد', icon: '✗', cls: 'pl-st-notdone' },
    rescheduled: { label: 'منتقل شد', icon: '↪', cls: 'pl-st-moved' },
    dropped: { label: 'حذف شد', icon: '🗑', cls: 'pl-st-dropped' },
  };
  const PRIORITY = { high: 'بالا', normal: 'معمولی', low: 'پایین' };
  const REASON_LABEL = {
    no_time: 'وقت نشد', needs_more_time: 'زمان بیشتری لازم دارد', blocked_by_others: 'منتظر دیگران',
    priority_changed: 'اولویت عوض شد', technical_issue: 'مشکل فنی', other: 'سایر',
  };

  const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

  /** تاریخ میلادی YYYY-MM-DD ± n روز (UTC؛ بدون وابستگی به منطقه‌ی زمانی). */
  function shiftDate(date, n) {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  /** نام فارسی روزِ هفته. */
  function dayName(date) {
    const d = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? '' : DAY_NAMES[d.getUTCDay()];
  }

  /** رنگ روز: index ۰..۶ (ترتیب نمایش) ⇒ { n: ۱..۷، cls: 'pl-day-n', varName: '--pl-day-n' }. */
  function dayHue(index) {
    const i = ((Number(index) % DAYS) + DAYS) % DAYS;
    const n = i + 1;
    return { n, cls: `pl-day-${n}`, varName: `--pl-day-${n}` };
  }

  /** برچسب/آیکون/کلاسِ وضعیت؛ ناشناخته ⇒ «در انتظار». */
  function statusMeta(status) {
    return STATUS[status] || STATUS.pending;
  }

  const isReview = (t) => !!t && !!t.isSystem && t.systemKey === REVIEW_KEY;
  const isOptional = (t) => !!t && t.priority === 'low' && !t.isSystem;
  /** فوریِ خودِ کارمند: assignedByUserId برابر صاحب برنامه (یا فلگ selfAssigned سرور). */
  function isSelfUrgent(task, ownerUserId) {
    if (!task || !task.isUrgent) return false;
    if (task.selfAssigned) return true;
    return ownerUserId != null && task.assignedByUserId != null && Number(task.assignedByUserId) === Number(ownerUserId);
  }

  /**
   * چیپ‌های متنی یک تسک (متن + نماد؛ فقط به رنگ متکی نیست).
   * ctx: { ownerUserId, today, fmtDate(date) }. خروجی: [{ key, label, cls }] به‌ترتیب ثابت.
   */
  function chipsFor(task, ctx = {}) {
    const t = task || {};
    const out = [];
    if (t.isSystem) out.push({ key: 'mandatory', label: '🔒 واجب', cls: 'pl-chip-mandatory' });
    if (t.isUrgent) {
      out.push(isSelfUrgent(t, ctx.ownerUserId)
        ? { key: 'urgent-self', label: '⚡ فوری (خودم)', cls: 'pl-chip-urgent' }
        : { key: 'urgent', label: '⚡ فوری', cls: 'pl-chip-urgent' });
    }
    if (t.managerLocked && !t.isUrgent && !t.isSystem) out.push({ key: 'manager', label: '🔒 از طرف سرپرست', cls: 'pl-chip-manager' });
    if (t.outOfPlan) out.push({ key: 'extra', label: 'خارج از برنامه', cls: 'pl-chip-extra' });
    if (!t.isSystem && !t.isUrgent) {
      out.push({ key: 'priority', label: `اولویت ${PRIORITY[t.priority] || PRIORITY.normal}`, cls: `pl-chip-prio pl-prio-${PRIORITY[t.priority] ? t.priority : 'normal'}` });
    }
    if (isOptional(t)) out.push({ key: 'optional', label: 'اختیاری', cls: 'pl-chip-optional' });
    const moved = t.source === 'rescheduled' || Number(t.carryCount) > 0;
    if (moved) {
      let label = '↪ منتقل‌شده';
      if (t.rescheduledFrom && ctx.today && t.rescheduledFrom === shiftDate(ctx.today, -1)) label = '↪ از دیروز';
      else if (t.rescheduledFrom) label = `↪ از ${typeof ctx.fmtDate === 'function' ? ctx.fmtDate(t.rescheduledFrom) : t.rescheduledFrom}`;
      out.push({ key: 'moved', label, cls: 'pl-chip-moved' });
    }
    return out;
  }

  /**
   * پیشرفت: شمارش مثل سرور (employeeWeekSummary): سیستمی/خارج از برنامه/حذف‌شده در total نمی‌آید.
   * ورودی: فهرست تسک‌های یک روز/هفته با status (pending|done|partial|not_done|rescheduled|dropped).
   */
  function progressOf(tasks) {
    let done = 0; let partial = 0; let total = 0;
    for (const t of tasks || []) {
      if (!t || t.isSystem || t.outOfPlan || t.status === 'dropped') continue;
      total += 1;
      if (t.status === 'done') done += 1; else if (t.status === 'partial') partial += 1;
    }
    return { done, total, percent: total ? Math.round(((done + partial * 0.5) / total) * 100) : null };
  }
  /** «۳ از ۷ انجام شد»؛ بدون تسک ⇒ ''. */
  function progressText(p) {
    if (!p || !p.total) return '';
    return `${fa(p.done)} از ${fa(p.total)} انجام شد`;
  }

  // ---------- جزئیات تسک (C3) ----------
  function sourceOf(task, ownerUserId) {
    if (task.isSystem) return { key: 'system', label: '🔒 تسک واجب (سیستمی)' };
    if (task.isUrgent) return isSelfUrgent(task, ownerUserId) ? { key: 'urgent-self', label: '⚡ فوریِ خودم' } : { key: 'urgent-manager', label: '⚡ فوریِ سرپرست' };
    if (task.managerLocked) return { key: 'manager', label: '🔒 از طرف سرپرست' };
    if (task.outOfPlan) return { key: 'extra', label: 'خارج از برنامه' };
    return { key: 'mine', label: 'برنامه‌ی خودم' };
  }

  /**
   * مدل شیت «جزئیات تسک». ctx: { ownerUserId, date (روز ردیف), today, fmtDate(date), editable (پیش‌فرض true: امکان عمل روی این روز) }.
   * actions.<k> = null (نمایش داده نشود) | { enabled, reason } — reason فقط وقتی enabled=false است و باید کنار دکمه نشان داده شود.
   */
  function detailModel(task, ctx = {}) {
    const t = task || {};
    const date = ctx.date || t.plannedDate || null;
    const today = ctx.today || null;
    const fmt = (d) => (d ? (typeof ctx.fmtDate === 'function' ? ctx.fmtDate(d) : d) : '');
    const status = t.dropped ? 'dropped' : (t.status === 'no_answer' ? 'pending' : (t.status || 'pending'));
    const meta = statusMeta(status);
    const future = !!(date && today && date > today);
    const answered = status !== 'pending';
    const review = isReview(t);
    const self = isSelfUrgent(t, ctx.ownerUserId);
    const editable = ctx.editable !== false;
    const carry = Number(t.carryCount) || 0;

    const actions = { done: null, move: null, undo: null, edit: null, remove: null };
    if (!answered) {
      if (review) actions.done = { enabled: false, reason: 'با مشاهده‌ی گزارش‌ها انجام می‌شود.' };
      else if (!editable) actions.done = { enabled: false, reason: 'این هفته فقط‌خواندنی است.' };
      else if (future) actions.done = { enabled: false, reason: 'روز آینده هنوز نرسیده است.' };
      else actions.done = { enabled: true, reason: '' };
      if (!review) {
        const maxCarry = Number(ctx.carryMax) || 0;
        if (!editable) actions.move = { enabled: false, reason: 'این هفته فقط‌خواندنی است.' };
        else if (future) actions.move = { enabled: false, reason: 'انتقال فقط برای امروز و روزهای گذشته ممکن است.' };
        else if (maxCarry > 0 && carry >= maxCarry) actions.move = { enabled: false, reason: `این تسک ${fa(carry)} بار منتقل شده و به سقف انتقال رسیده است؛ ${t.isUrgent ? 'انجامش بده یا با سرپرست هماهنگ کن.' : 'انجامش بده یا حذفش کن.'}` };
        else actions.move = { enabled: true, reason: '' };
      }
    } else {
      actions.undo = t.canUndo === false || review
        ? { enabled: false, reason: 'پاسخ این تسک قابل برداشتن نیست.' }
        : (editable ? { enabled: true, reason: '' } : { enabled: false, reason: 'این هفته فقط‌خواندنی است.' });
    }
    if (self) {
      if (answered) {
        actions.edit = { enabled: false, reason: 'به این تسک پاسخ داده‌اید.' };
        actions.remove = { enabled: false, reason: 'به این تسک پاسخ داده‌اید.' };
      } else {
        actions.edit = { enabled: true, reason: '' };
        actions.remove = { enabled: true, reason: '' };
      }
    }

    const rows = [];
    const add = (key, label, value) => { if (value) rows.push({ key, label, value }); };
    add('priority', 'اولویت', t.isSystem ? '' : `اولویت ${PRIORITY[t.priority] || PRIORITY.normal}`);
    add('date', 'روز', date ? `${dayName(date)} ${fmt(date)}` : 'هر روز / بدون روز مشخص');
    add('source', 'منبع', sourceOf(t, ctx.ownerUserId).label);
    add('deadline', 'مهلت', t.urgentDeadlineTime ? `ساعت ${fa(t.urgentDeadlineTime)}` : '');
    add('urgentNote', 'یادداشت فوری', t.urgentNote);
    add('status', 'وضعیت', `${meta.icon} ${meta.label}`);
    add('answeredAt', 'زمان پاسخ', t.answeredAt ? `${t.answeredLate ? 'دیرهنگام · ' : ''}${t.answeredAt}` : '');
    add('reason', 'علت', t.reasonCode ? `${REASON_LABEL[t.reasonCode] || t.reasonCode}${t.reasonText ? ` — ${t.reasonText}` : ''}` : '');
    add('rescheduleTo', 'منتقل‌شده به', t.rescheduleTo && t.rescheduleTo !== 'drop' ? `${dayName(t.rescheduleTo)} ${fmt(t.rescheduleTo)}` : '');
    add('history', 'سابقه‌ی انتقال', carry ? `${fa(carry)} بار منتقل شده` : '');

    return {
      title: t.title || '', description: t.description || '', note: t.note || '',
      noteEditable: status === 'done' && t.canUndo !== false && !review && editable,
      status, statusMeta: meta, chips: chipsFor(t, ctx), rows, actions, carryCount: carry, isReview: review, selfUrgent: self,
    };
  }


  // ---------- «امروزِ من» (D1) ----------
  /** وضعیتِ نمایشیِ یک پاسخِ ثبت‌شده: حذف ⇒ dropped؛ دارای مقصد انتقال ⇒ rescheduled؛ وگرنه همان status. */
  function answerStatus(a) {
    if (a && (a.dropped || a.rescheduleTo === 'drop')) return 'dropped';
    if (a && a.rescheduleTo) return 'rescheduled';
    return (a && a.status) || 'pending';
  }

  /**
   * خروجی GET /daily-tasks ⇒ مدلِ دو لیست. هر ردیف همان شکل ردیف‌های /week-board را دارد (تا chipsFor/detailModel/شیت مشترک باشند):
   *   pending: تسک‌های بی‌پاسخ (status='pending')؛ done: پاسخ‌های «انجام شد»؛ other: نیمه‌کاره/انجام‌نشده/منتقل‌شده/حذف‌شده.
   * progress همان محاسبه‌ی سرور است (در نبودش از ردیف‌ها).
   */
  function myDayModel(daily) {
    const d = daily || {};
    const pending = (d.tasks || []).map((t) => ({
      ...t, status: 'pending', note: null, canUndo: false, answeredAt: null, answeredLate: false, reasonCode: null, reasonText: null, rescheduleTo: null,
    }));
    const answered = (d.answered || []).map((a) => ({
      id: a.taskId, title: a.title || '', description: a.description || '', priority: a.priority || 'normal', plannedDate: null, source: 'answered',
      isUrgent: !!a.isUrgent, assignedByUserId: a.assignedByUserId || null, selfAssigned: !!a.selfAssigned, managerLocked: !!a.managerLocked,
      urgentNote: a.urgentNote || null, urgentDeadlineTime: a.urgentDeadlineTime || null,
      isSystem: !!a.isSystem, systemKey: a.systemKey || null, outOfPlan: !!a.outOfPlan,
      status: answerStatus(a), note: a.note || null, reasonCode: a.reasonCode || null, reasonText: a.reasonText || null, rescheduleTo: a.rescheduleTo || null,
      answeredAt: a.answeredAt || null, answeredLate: !!a.answeredLate, carryCount: Number(a.carryCount) || 0, canUndo: a.canUndo !== false,
    }));
    const done = answered.filter((t) => t.status === 'done');
    const other = answered.filter((t) => t.status !== 'done');
    return {
      date: d.date || null, today: d.today || d.date || null, fullDayOff: !!d.fullDayOff, late: !!d.late,
      nextWorkingDay: d.nextWorkingDay || null, carryMax: Number(d.taskCarryMaxTimes) || 0,
      limits: d.limits || { selfUrgentEnabled: false, selfUrgentRemaining: 0 },
      pending, done, other,
      progress: d.progress || progressOf([...pending, ...answered]),
    };
  }

  /** یافتن ردیف در مدل (pending/done/other) با شناسه. */
  function findInModel(model, id) {
    if (!model) return null;
    return model.pending.find((t) => t.id === id) || model.done.find((t) => t.id === id) || model.other.find((t) => t.id === id) || null;
  }

  // ---------- انتقال (D2) ----------
  // سرور: «انتقال = نیمه‌کاره/انجام‌نشده + علت الزامی» (همان قاعده‌ی ویزارد گزارش). این‌جا فقط گزینه‌ها و پیام‌هاست؛
  // اعتبارسنجی و ساخت بدنه با DailyReport.validateAnswer/toApiAnswer (منبع واحد) در app.js انجام می‌شود.
  const MOVE_STATUSES = [
    { value: 'not_done', label: '❌ انجام نشد' },
    { value: 'partial', label: '🟡 نیمه‌کاره' },
  ];
  /** گزینه‌های مقصد: فقط «فردا» و «تاریخ مشخص» (حذف از برنامه در این کامپوننت نیست؛ برای فوری هم ممنوع است). */
  function moveOptions(task, ctx = {}) {
    const next = ctx.nextWorkingDay || '';
    const fmt = typeof ctx.fmtDate === 'function' ? ctx.fmtDate : (x) => x;
    return [
      { value: 'tomorrow', label: next ? `فردا (روز کاریِ بعدی: ${fmt(next)})` : 'فردا (روز کاریِ بعدی)' },
      { value: 'date', label: 'تاریخ مشخص…' },
    ];
  }
  /** هشدار نرمِ روز مقصد: info = { isWorkingDay, kind, holidayTitle } (اگر روز شناخته‌شده نبود ⇒ بدون هشدار). */
  function moveWarning(date, info, fmtDate) {
    if (!date || !info || info.isWorkingDay !== false) return '';
    const fmt = typeof fmtDate === 'function' ? fmtDate : (x) => x;
    const why = info.holidayTitle ? `تعطیل — ${info.holidayTitle}` : (info.kind === 'weekend' ? 'آخر هفته' : 'غیرکاری/آف');
    return `هشدار: ${dayName(date)} ${fmt(date)} روز کاری نیست (${why}). تسک همان روز در فهرستت می‌آید.`;
  }
  /** پیام موفقیتِ انتقال برای نوار «واگرد». */
  function movedText(title, to, fmtDate) {
    const fmt = typeof fmtDate === 'function' ? fmtDate : (x) => x;
    return `«${title}» به ${to ? `${dayName(to)} ${fmt(to)}` : 'روز بعد'} منتقل شد.`;
  }

  const api = {
    DAYS, DAY_NAMES, STATUS, PRIORITY, REASON_LABEL, REVIEW_KEY,
    shiftDate, dayName, dayHue, statusMeta, chipsFor, progressOf, progressText, detailModel, sourceOf, isSelfUrgent, isReview, isOptional,
    answerStatus, myDayModel, findInModel, MOVE_STATUSES, moveOptions, moveWarning, movedText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Planner = api;
}(typeof window !== 'undefined' ? window : undefined));
