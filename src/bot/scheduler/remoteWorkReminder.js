// R6 (فاز ۱۴): یادآوری هفتگی صف دورکاری برای سرپرست‌ها. هر هفته یک بار (dedupeKey به شروع هفته‌ی جاری بسته است) به هر سرپرستی که
// دورکاریِ بسته‌شده‌ی منتظر بررسی دارد (و ادمین‌ها فقط برای کارمندان بدون سرپرستِ فعال) اعلان پنل + تلگرام با دکمه‌ی «صف دورکاری» می‌رود.
// زمان‌بندی: همان cron مؤثرِ job «weeklyReport» (پیش‌فرض ابتدای هفته)؛ job جدید/تنظیم جدید لازم نیست. صف خالی ⇒ هیچ اعلانی نمی‌رود.
// خطای یک گیرنده بقیه را نمی‌شکند. now تزریق‌پذیر برای تست. خروجی: { checked, reminded, errors }
const remoteAdmin = require('../../services/remoteWorkAdminService');
const weeklyPlan = require('../../services/weeklyPlanService');
const { notify } = require('../../services/notificationService');
const { panelWebAppButton } = require('../panelLinks');
const { sanitizeText } = require('../../utils/sanitize');

async function runRemoteWorkWeeklyReminder({ now = new Date() } = {}) {
  const out = { checked: 0, reminded: 0, errors: 0 };
  const weekStart = weeklyPlan.context(now).thisWeek;
  const button = panelWebAppButton({ view: 'remote', text: '🖥 صف دورکاری' });
  for (const { user, summary } of remoteAdmin.reminderTargets()) {
    out.checked += 1;
    try {
      const names = summary.employees.slice(0, 5).map((e) => `${e.fullName} (${e.count})`).join('، ');
      const more = summary.employees.length > 5 ? ` و ${summary.employees.length - 5} نفر دیگر` : '';
      const res = await notify(user.id, {
        type: 'remote_work_review_reminder',
        title: `یادآوری: ${summary.total} دورکاری منتظر بررسی شماست`,
        body: `${names}${more}\nتا بررسی نشوند در حضور و غیاب و حقوق حساب نمی‌شوند.`,
        link: '#/remote',
        data: { total: summary.total, weekStart },
        dedupeKey: `remote_work_weekly:${user.id}:${weekStart}`,
        telegram: true,
        telegramButton: button || undefined,
      });
      if (res && res.created) out.reminded += 1;
    } catch (err) {
      out.errors += 1;
      console.error('[remoteWorkReminder] خطا برای', user.id, sanitizeText(err && err.message ? err.message : String(err), 200));
    }
  }
  return out;
}

module.exports = { runRemoteWorkWeeklyReminder };
