// ساخت خودکار تسک واجبِ «بررسی گزارش روز قبلِ تیم» برای همه‌ی سرپرست‌ها (H5-الف).
// هر اجرا برای هر سرپرست (manager، و admin دارای زیردست) روزهای باقی‌مانده‌ی «هفته‌ی جاری» و «هفته‌ی بعد» را پوشش می‌دهد تا سرپرستی که
// برنامه‌ی هفته را ثبت نکرده یا جلوتر برنامه‌ریزی می‌کند هم تسک را ببیند. idempotent (اجرای دوباره چیزی تکراری نمی‌سازد)؛ روز غیرکاری،
// مرخصیِ تمام‌روز، ماه بسته و سرپرست بدون زیردست ⇒ ساخته نمی‌شود (قواعد ensureTask در teamReviewService). خطای یک سرپرست بقیه را نمی‌شکند.
// now تزریق‌پذیر برای تست. خروجی: { reviewers, created, errors }
const teamReviewService = require('../../services/teamReviewService');

async function runTeamReviewEnsure({ now = new Date() } = {}) {
  return teamReviewService.ensureAllReviewers({ now });
}

module.exports = { runTeamReviewEnsure };
