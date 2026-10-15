// H5 بخش ۲: پیشرفتِ «مشاهده‌ی گزارش‌ها» برای تسک واجبِ سرپرست (review_team_reports) — فقط محاسبه/نمایش؛ منطق D9 دست‌نخورده می‌ماند.
// خروجی برای هر تسکِ واجب: { reviewDate, notYet, reportCount, reviewedCount, noReportCount, complete }
//   reviewDate  = «روز قبل» برای تسکِ آن روز (آخرین روز کاریِ قبل در تقویم سرپرست؛ از تقویم محاسبه می‌شود و ذخیره نمی‌شود)
//   notYet      = reviewDate هنوز نرسیده (تسکِ روزهای آینده) ⇒ گزارشی برای مشاهده وجود ندارد
//   complete    = هیچ عضوِ دارای گزارشِ مشاهده‌نشده نمانده (همان قاعده‌ی done خودکار D9)
// ضدخطا: هر مشکلی ⇒ null (نمایش پیشرفت حذف می‌شود؛ خودِ تسک/گیت دست نمی‌خورد).
const settingsRepository = require('../repositories/settingsRepository');
const teamReview = require('./teamReviewService');
const { sanitizeText } = require('../utils/sanitize');

/** پیشرفت تسکِ واجبِ روز taskDate برای سرپرست user؛ today = امروزِ همان سرپرست. state اختیاری: کش reviewState (تاریخ ← state). */
function progressFor(user, taskDate, today, settings = settingsRepository.getAll(), cache = new Map()) {
  try {
    if (!teamReview.isReviewer(user) || !taskDate) return null;
    const reviewDate = teamReview.reviewDateFor(user, taskDate, settings);
    if (!reviewDate) return null;
    if (reviewDate > today) return { reviewDate, notYet: true, reportCount: 0, reviewedCount: 0, noReportCount: 0, complete: false };
    if (!cache.has(reviewDate)) cache.set(reviewDate, teamReview.reviewState(user, reviewDate, settings));
    const s = cache.get(reviewDate);
    return { reviewDate, notYet: false, reportCount: s.reportCount, reviewedCount: s.reviewedCount, noReportCount: s.noReport.length, complete: s.complete };
  } catch (err) {
    console.error('[teamReview] پیشرفت مشاهده ناموفق (نادیده گرفته شد):', sanitizeText(err && err.message ? err.message : String(err), 200));
    return null;
  }
}

/**
 * روی فهرستی از تسک‌ها (هر شکلی که کلید systemKey/plannedDate یا taskId/…) فیلد review را درجا اضافه می‌کند؛ فقط برای REVIEW_KEY.
 * dateOf(task) تاریخ تسک را برمی‌گرداند (پیش‌فرض plannedDate).
 */
function decorate(user, tasks, today, { settings = settingsRepository.getAll(), dateOf = (t) => t.plannedDate } = {}) {
  if (!teamReview.isReviewer(user) || !Array.isArray(tasks)) return tasks;
  const cache = new Map();
  for (const t of tasks) {
    if (t && t.systemKey === teamReview.REVIEW_KEY) t.review = progressFor(user, dateOf(t), today, settings, cache);
  }
  return tasks;
}

module.exports = { progressFor, decorate };
