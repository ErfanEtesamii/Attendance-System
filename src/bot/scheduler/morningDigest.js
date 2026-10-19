// خلاصه‌ی صبحگاهی سرپرست (D12): ۱) گزارش‌های تسکی که «بعد از ارسال شبانه‌ی دیروز» ثبت شده‌اند (دیرهنگام/backfill)
// ۲) گزارش‌های روز کاریِ قبل که هنوز مشاهده نشده‌اند. با دکمه‌ی «🖥 گزارش‌های تیم» به صفحه‌ی D10. اجرای Job در job_runs ثبت می‌شود (wrapJob در scheduler).
// فقط در روز کاریِ خودِ گیرنده می‌فرستد؛ گیرنده‌ها و اسکوپ همان nightlyTaskReportService.recipientsMap است (سرپرست ⇒ تیم مستقیم، ادمین ⇒ همه‌ی کاربران فعال).
const settingsRepository = require('../../repositories/settingsRepository');
const logsRepo = require('../../repositories/taskLogRepository');
const reviewsRepo = require('../../repositories/reportReviewRepository');
const calendarService = require('../../engine/calendarService');
const { taskDayTally } = require('../../services/taskDayTally');
const nightlyTaskReportService = require('../../services/nightlyTaskReportService');
const { panelWebAppButton } = require('../panelLinks');
const { todayInZone, zonedTimeToUtc } = require('../../utils/time');
const { addDays } = require('../../utils/shiftDay');
const { isoDateToJalaliString } = require('../../utils/jalali');

const MAX_NAMES = 12;

const jd = (iso) => isoDateToJalaliString(iso) || iso;

// ساعت ارسال شبانه از عبارت cron مؤثر («M H * * *»)؛ نامعتبر ⇒ ۲۰:۰۰
function nightlyHHMM(settings) {
  const m = /^(\d{1,2})\s+(\d{1,2})\s/.exec(String((settingsRepository.getCronExpressions() || {}).nightlyReview || ''));
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) return '20:00';
  return `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
}

const list = (names) => (names.length > MAX_NAMES ? `${names.slice(0, MAX_NAMES).join('، ')} و ${names.length - MAX_NAMES} نفر دیگر` : names.join('، '));

/** @returns {Array<{ reviewer, text, reviewDate, late: object[], unreviewed: object[] }>} (خالص؛ بدون ارسال) */
function buildMorningDigests({ now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  const today = todayInZone(settings.timezone, now);
  const since = zonedTimeToUtc(addDays(today, -1), nightlyHHMM(settings), settings.timezone).toISOString();
  const fromDate = addDays(today, -(Number(settings.reportBackfillDays) || 2) - 1);
  const out = [];
  for (const { reviewer, members } of nightlyTaskReportService.recipientsMap().values()) {
    if (reviewer.role !== 'manager' && reviewer.role !== 'admin') continue;
    const cal = calendarService.getCalendarDay(reviewer, today, { settings });
    if (!cal.isWorkingDay) continue;
    const byId = new Map(members.map((m) => [m.id, m]));
    const lateRows = logsRepo.listAnsweredSince(members.map((m) => m.id), since, fromDate);
    const late = new Map(); // userId → Set(log_date)
    lateRows.forEach((l) => { if (!late.has(l.user_id)) late.set(l.user_id, new Set()); late.get(l.user_id).add(l.log_date); });
    const reviewDate = calendarService.getPreviousWorkingDay(reviewer, today, { settings });
    const unreviewed = [];
    if (reviewDate) {
      const withReport = new Set(logsRepo.listUserIdsWithLogsOnDate(members.map((m) => m.id), reviewDate));
      members.forEach((m) => { if (withReport.has(m.id) && !reviewsRepo.find(reviewer.id, m.id, reviewDate)) unreviewed.push(m); });
    }
    // H3: «وضعیت نهایی دیروز» برای کسانی که بعد از ارسال شبانه چیزی ثبت کرده‌اند یا هنوز تسکِ بدون وضعیت دارند (ضدخطا)
    const finalRows = [];
    if (reviewDate) {
      for (const m of members) {
        try {
          const lateForDay = late.has(m.id) && late.get(m.id).has(reviewDate);
          const t = taskDayTally(m, reviewDate, settings);
          if (!t || !t.relevant || !t.total) continue;
          if (lateForDay || t.pendingCount > 0) finalRows.push(`• ${m.full_name} — ${t.done} از ${t.total} (${t.percent}٪)${t.pendingCount ? ` · ${t.pendingCount} بدون وضعیت` : ''}`);
        } catch (err) { console.error('[bot][scheduler] وضعیت نهایی دیروز ناموفق:', err.message); }
      }
    }
    if (!late.size && !unreviewed.length && !finalRows.length) continue;
    const lines = [`☀️ خلاصه‌ی صبحگاهی گزارش تسک‌ها — ${jd(today)}`];
    if (late.size) {
      lines.push('', `🕘 گزارش‌های ثبت‌شده بعد از ارسال شبانه (${late.size} نفر):`);
      const rows = [...late.entries()].map(([uid, dates]) => `• ${byId.get(uid).full_name} — برای ${[...dates].sort().map(jd).join('، ')}`);
      lines.push(...rows.slice(0, MAX_NAMES));
      if (rows.length > MAX_NAMES) lines.push(`… و ${rows.length - MAX_NAMES} نفر دیگر`);
    }
    if (finalRows.length) {
      lines.push('', `📌 وضعیت نهایی دیروز (${jd(reviewDate)}):`, ...finalRows.slice(0, MAX_NAMES));
      if (finalRows.length > MAX_NAMES) lines.push(`… و ${finalRows.length - MAX_NAMES} نفر دیگر`);
    }
    if (unreviewed.length) lines.push('', `🔎 گزارش ${jd(reviewDate)} هنوز مشاهده نشده (${unreviewed.length} نفر): ${list(unreviewed.map((m) => m.full_name))}`);
    out.push({ reviewer, text: lines.join('\n'), reviewDate, late: [...late.keys()], finalStatus: finalRows.length, unreviewed: unreviewed.map((m) => m.id) });
  }
  return out;
}

async function sendMorningDigest(bot, { now = new Date() } = {}) {
  const digests = buildMorningDigests({ now });
  const btn = panelWebAppButton({ view: 'teamreports', text: '🖥 گزارش‌های تیم' });
  let sent = 0;
  for (const d of digests) {
    if (!d.reviewer.telegram_user_id) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(d.reviewer.telegram_user_id, d.text, btn ? { reply_markup: { inline_keyboard: [[btn]] } } : {});
      sent += 1;
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال خلاصه‌ی صبحگاهی:', err.message);
    }
  }
  return { sent, candidates: digests.length };
}

module.exports = { sendMorningDigest, buildMorningDigests, nightlyHHMM };
