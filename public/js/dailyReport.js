// منطق خالصِ ویزارد گزارش روزانه‌ی تسک‌ها (D7-ب). بدون DOM تا در تست‌های Node هم اجرا شود.
// سرور همیشه دوباره اعتبارسنجی می‌کند؛ این‌جا فقط برای پیام سریع و ساخت بدنه‌ی درخواست است.
(function (root) {
  'use strict';

  const STATUS = [
    { value: 'done', label: 'انجام شد', icon: '✅' },
    { value: 'partial', label: 'نیمه‌کاره', icon: '🟡' },
    { value: 'not_done', label: 'انجام نشد', icon: '❌' },
  ];
  // کدها باید با REASON_CODES سرور یکی باشند (taskReportService)
  const REASONS = [
    { value: 'no_time', label: 'وقت نشد' },
    { value: 'needs_more_time', label: 'زمان بیشتری لازم دارد' },
    { value: 'blocked_by_others', label: 'منتظر دیگران' },
    { value: 'priority_changed', label: 'اولویت عوض شد' },
    { value: 'technical_issue', label: 'مشکل فنی' },
    { value: 'other', label: 'سایر' },
  ];
  const RESCHEDULE = [
    { value: 'tomorrow', label: 'فردا' },
    { value: 'date', label: 'تاریخ دیگر' },
    { value: 'drop', label: 'حذف از برنامه' },
  ];
  const LIMITS = { reasonText: 300, otherMin: 5, extraTitle: 120, extraDesc: 500, maxExtra: 10, reviewComment: 300 };
  // D9: تسک سیستمیِ سرپرست («بررسی گزارش تیم»). کلید باید با REVIEW_KEY سرور (teamReviewService) یکی باشد.
  const REVIEW_KEY = 'review_team_reports';
  const REVIEW_REACTIONS = [
    { value: 'like', label: 'پسندیدم', icon: '👍' },
    { value: 'great', label: 'عالی بود', icon: '🌟' },
    { value: 'thanks', label: 'ممنون', icon: '🙏' },
  ];
  const isReviewTask = (t) => !!t && t.systemKey === REVIEW_KEY;
  // گزینه‌های اعتبارسنجی برای یک تسک: تسک سیستمی انتقال ندارد و «انجام شد»ش فقط با مشاهده‌ی واقعی (خودکار) ثبت می‌شود
  const taskOpts = (t, opts) => (isReviewTask(t) ? { ...(opts || {}), reviewTask: true } : (opts || {}));
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const emptyAnswer = () => ({ status: '', reasonCode: '', reasonText: '', resType: 'tomorrow', resDate: '' });

  /** پیام خطای فارسی برای یک پاسخ؛ رشته‌ی خالی = معتبر. */
  function validateAnswer(a, { today, reviewTask } = {}) {
    if (reviewTask && (!a || a.status !== 'not_done')) return 'گزارش‌ها را مشاهده کنید یا «انجام نشد + علت» را بزنید.';
    if (!a || !STATUS.some((s) => s.value === a.status)) return 'وضعیت این تسک را انتخاب کنید.';
    if (a.status === 'done') return '';
    if (!REASONS.some((r) => r.value === a.reasonCode)) return 'علت را انتخاب کنید.';
    const text = norm(a.reasonText);
    if (text.length > LIMITS.reasonText) return `متن علت حداکثر ${fa(LIMITS.reasonText)} نویسه است.`;
    if (a.reasonCode === 'other' && text.length < LIMITS.otherMin) return `برای «سایر» حداقل ${fa(LIMITS.otherMin)} نویسه توضیح بنویسید.`;
    if (reviewTask) return ''; // تسک سیستمی: انتقال/حذف ندارد
    if (!RESCHEDULE.some((r) => r.value === a.resType)) return 'نوع انتقال را انتخاب کنید.';
    if (a.resType === 'date') {
      if (!DATE_RE.test(a.resDate || '')) return 'تاریخ انتقال را انتخاب کنید.';
      if (today && a.resDate <= today) return 'تاریخ انتقال باید بعد از امروز باشد.';
    }
    return '';
  }

  /** یک پاسخ ⇒ شکل API (/check-out و /daily-report). */
  function toApiAnswer(taskId, a, { reviewTask } = {}) {
    const out = { taskId, status: a.status };
    if (a.status === 'done') return out;
    out.reasonCode = a.reasonCode;
    const text = norm(a.reasonText);
    if (text) out.reasonText = text;
    if (reviewTask) return out; // سرور انتقال/حذفِ تسک سیستمی را رد می‌کند
    out.reschedule = a.resType === 'date' ? { type: 'date', date: a.resDate } : { type: a.resType };
    return out;
  }

  function validateExtra(e) {
    const title = norm(e && e.title);
    if (!title) return 'عنوان کار خارج از برنامه را بنویسید.';
    if (title.length > LIMITS.extraTitle) return `عنوان حداکثر ${fa(LIMITS.extraTitle)} نویسه است.`;
    if (norm(e && e.description).length > LIMITS.extraDesc) return `توضیح حداکثر ${fa(LIMITS.extraDesc)} نویسه است.`;
    return '';
  }

  /**
   * بدنه‌ی درخواست. answers: Map|Object از taskId ⇒ پاسخ؛ فقط پاسخ‌های معتبر می‌روند.
   * extras ردیف‌های خالی را کنار می‌گذارد. date فقط برای /daily-report دیرهنگام.
   */
  function buildBody({ tasks, answers, extras, date }, { today } = {}) {
    const get = (id) => (answers instanceof Map ? answers.get(id) : answers && answers[id]);
    const list = [];
    for (const t of tasks || []) {
      const a = get(t.id);
      if (a && !validateAnswer(a, taskOpts(t, { today }))) list.push(toApiAnswer(t.id, a, { reviewTask: isReviewTask(t) }));
    }
    const extra = (extras || []).filter((e) => norm(e && e.title) && !validateExtra(e))
      .map((e) => { const o = { title: norm(e.title) }; const d = norm(e.description); if (d) o.description = d; return o; });
    const body = { answers: list, extra };
    if (date) body.date = date;
    return body;
  }

  const unanswered = (tasks, answers, opts) => (tasks || []).filter((t) => {
    const a = answers instanceof Map ? answers.get(t.id) : answers && answers[t.id];
    return !a || !!validateAnswer(a, taskOpts(t, opts));
  });

  /** خلاصه‌ی مرور: چند تا انجام/نیمه/نشده/بی‌پاسخ. */
  function summarize(tasks, answers) {
    const s = { done: 0, partial: 0, not_done: 0, missing: 0 };
    for (const t of tasks || []) {
      const a = answers instanceof Map ? answers.get(t.id) : answers && answers[t.id];
      if (a && s[a.status] !== undefined) s[a.status] += 1; else s.missing += 1;
    }
    return s;
  }

  /** بذر پاسخ‌ها از بدنه‌ی قبلیِ ارسال‌نشده (بعد از 409 گیت برنامه‌ی هفتگی) تا کاربر دوباره تایپ نکند. */
  function seedFromBody(tasks, body) {
    const m = new Map();
    const prev = body && Array.isArray(body.answers) ? body.answers : [];
    for (const t of tasks || []) {
      const p = prev.find((x) => x.taskId === t.id);
      if (!p) continue;
      const r = p.reschedule || {};
      m.set(t.id, {
        status: p.status, reasonCode: p.reasonCode || '', reasonText: p.reasonText || '',
        resType: r.type || 'tomorrow', resDate: r.date || '',
      });
    }
    return m;
  }

  /** فهرست N روز آینده بعد از امروز برای انتخاب تاریخ انتقال (ISO). */
  function futureDates(today, n = 30) {
    const [y, m, d] = String(today).split('-').map(Number);
    return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d + i + 1)).toISOString().slice(0, 10));
  }

  /**
   * پیام تشویقیِ پاسخِ سرور (D8) برای نمایش در toast: آخرین پیامِ done (۱۰۰٪ روز همیشه روی آخرین done است)؛
   * اگر done نبود، تشکرِ «علتش را نوشتی». خالی ⇒ ''.
   */
  function encouragementOf(res) {
    const list = res && Array.isArray(res.encouragements) ? res.encouragements.filter((e) => e && typeof e.text === 'string' && e.text) : [];
    const done = list.filter((e) => e.status === 'done');
    const pick = done.length ? done[done.length - 1] : list[0];
    return pick ? pick.text : '';
  }

  /** «۴ از ۵ انجام شد (۸۰٪)» + «۲ کار خارج از برنامه»؛ خلاصه‌ی ناقص ⇒ ''. */
  function reportLine(r) {
    if (!r || typeof r !== 'object') return '';
    const parts = [];
    if (r.total) parts.push(`${fa(r.done || 0)} از ${fa(r.total)} انجام شد${r.percent == null ? '' : ` (${fa(r.percent)}٪)`}`);
    else parts.push('تسک برنامه‌ریزی‌شده ندارد');
    if (r.extra) parts.push(`${fa(r.extra)} کار خارج از برنامه`);
    return parts.join(' · ');
  }

  /** اعتبارسنجی کامنت/واکنشِ «مشاهده شد»؛ رشته‌ی خالی = معتبر. */
  function validateReview({ comment, reaction } = {}) {
    if (norm(comment).length > LIMITS.reviewComment) return `کامنت حداکثر ${fa(LIMITS.reviewComment)} نویسه است.`;
    if (reaction && !REVIEW_REACTIONS.some((r) => r.value === reaction)) return 'واکنش نامعتبر است.';
    return '';
  }

  /** بدنه‌ی POST /report-reviews؛ کامنت/واکنشِ خالی فرستاده نمی‌شود. */
  function buildReviewBody({ subjectUserId, reportDate, comment, reaction }) {
    const body = { subjectUserId, reportDate };
    const c = norm(comment);
    if (c) body.comment = c;
    if (reaction) body.reaction = reaction;
    return body;
  }

  const api = { STATUS, REASONS, RESCHEDULE, LIMITS, REVIEW_KEY, REVIEW_REACTIONS, isReviewTask, taskOpts, reportLine, validateReview, buildReviewBody, emptyAnswer, validateAnswer, toApiAnswer, validateExtra, buildBody, unanswered, summarize, seedFromBody, futureDates, encouragementOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DailyReport = api;
}(typeof window !== 'undefined' ? window : undefined));
