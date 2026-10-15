// پیام «مرور شبانه» برای هر سرپرست: وضعیت امروز تیمش + مواردی که نیاز به بررسی دارند +
// تعداد درخواست مرخصی/مأموریت و اعتراض‌های منتظر پاسخ. (ادمین کل این پیام را نمی‌گیرد؛ او گزارش
// پایان روز را دارد.)

const usersRepository = require('../../repositories/usersRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const disputeRepository = require('../../repositories/disputeRepository');
const { reviewDay, summarize } = require('../../utils/dayReview');
const { formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { panelWebAppButton } = require('../panelLinks');
const { runFraudChecksSafe } = require('../../utils/fraudRunner');
const suspiciousRepository = require('../../repositories/suspiciousRepository');
const missionDecisionService = require('../../services/missionDecisionService');
const nightlyTaskReportService = require('../../services/nightlyTaskReportService');

const MAX_ATTENTION_LINES = 25;
const MAX_MISSIONS = 8; // هر ماموریت یک ردیف دکمه دارد؛ بقیه با دکمه‌ی «📥 درخواست‌های منتظر»

// C4: ماموریت‌های منتظر تأیید این سرپرست ⇒ { lines, shown } (ضدخطا؛ مرور شبانه هرگز نباید بشکند)
function missionSection(supervisor) {
  try {
    const all = missionDecisionService.pendingForSupervisor(supervisor);
    if (!all.length) return { lines: [], shown: [] };
    const shown = all.slice(0, MAX_MISSIONS);
    const lines = ['', `🚗 ماموریت‌های منتظر تأیید (${all.length}):`];
    shown.forEach((r) => lines.push(missionDecisionService.describeMission(r, usersRepository.findById(r.user_id))));
    if (all.length > shown.length) lines.push(`… و ${all.length - shown.length} مورد دیگر → «📥 درخواست‌های منتظر» (از «📂 منو»)`);
    return { lines, shown };
  } catch (err) {
    console.error('[bot][scheduler] خطا در بخش ماموریت‌ها:', err.message);
    return { lines: [], shown: [] };
  }
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function attentionLine(r) {
  const name = r.user.fullName;
  if (r.state === 'absent') return `• ${name} — غایب / بدون ثبت ورود`;
  const parts = [];
  if (r.lateMinutes > 0) parts.push(`تأخیر ${formatMinutes(r.lateMinutes)}`);
  if (r.pendingMissionRejected) parts.push('تردد از بیرون شبکه با ماموریتی که رد شد');
  if (r.noCheckout) parts.push(`ورود ${clock(r.checkIn)} ولی خروج ثبت نشده`);
  else if (r.state === 'incomplete') parts.push('رکورد ناقص');
  return `• ${name} — ${parts.join('، ')}`;
}

// تعداد «نشانه»های بررسی‌نشده‌ی تیم سرپرست (S2-5b). همان اسکوپ API پنل: همه‌ی کاربران مورد باید در تیمش باشند.
// ضدخطا: هر مشکلی ⇒ ۰ تا مرور شبانه هرگز نشکند.
function openSuspiciousCount(supervisor) {
  try {
    const teamIds = new Set(usersRepository.listUsers({ managerId: supervisor.id }).map((u) => u.id));
    return suspiciousRepository
      .list({ status: 'open', limit: 1000 })
      .filter((e) => e.user_ids.length > 0 && e.user_ids.every((id) => teamIds.has(id))).length;
  } catch (err) {
    console.error('[bot][scheduler] خطا در شمارش موارد مشکوک:', err.message);
    return 0;
  }
}

// «روز غیرکاری برای همه‌ی تیم»: هیچ‌کس امروز کاری نیست (آخر هفته/تعطیلی کامل یا دپارتمانی/روز غیرکاریِ شیفت) و کسی هم ورود نزده است (S3-8b)
function isTeamOffDay(rows) {
  return rows.length > 0 && rows.every((r) => ['weekend', 'holiday'].includes(r.calendarKind) && !r.checkIn);
}

function buildNightlyMessage(supervisor, team, today, rows = reviewDay(team, today)) {
  const t = summarize(rows);
  const teamIds = new Set(team.map((u) => u.id));
  const pendingLeave = leaveRepository.listPending().filter((r) => teamIds.has(r.user_id)).length;
  const openDisputes = disputeRepository.listOpen().filter((d) => teamIds.has(d.user_id)).length;

  const lines = [
    `🌙 مرور شبانه — ${today}`,
    `${supervisor.full_name} عزیز، وضعیت امروز تیم شما (${t.total - t.holiday} نفر):`, // تعطیلِ امروز (تعطیلی دپارتمان/…) در شمارش نمی‌آید
    '',
    `✅ حاضر / خروج ثبت‌شده: ${t.present - t.noCheckout}`,
    `⏳ بدون ثبت خروج: ${t.noCheckout}`,
    `🕘 متأخر: ${t.late}`,
    `❌ غایب: ${t.absent}`,
    `🏖 مرخصی: ${t.leave}`,
  ];

  const attention = rows.filter((r) => r.needsAttention);
  lines.push('');
  if (attention.length === 0) {
    lines.push('همه‌چیز عادی است ✅');
  } else {
    lines.push('نیازمند بررسی:');
    attention.slice(0, MAX_ATTENTION_LINES).forEach((r) => lines.push(attentionLine(r)));
    if (attention.length > MAX_ATTENTION_LINES) {
      lines.push(`… و ${attention.length - MAX_ATTENTION_LINES} مورد دیگر (در پنل ببینید)`);
    }
  }

  const openSuspicious = openSuspiciousCount(supervisor);
  if (pendingLeave > 0 || openDisputes > 0 || openSuspicious > 0) {
    lines.push('');
    if (pendingLeave > 0) lines.push(`⏳ ${pendingLeave} درخواست مرخصی/مأموریت منتظر پاسخ شماست → «📥 درخواست‌های منتظر» (از «📂 منو»)`);
    if (openDisputes > 0) lines.push(`💬 ${openDisputes} اعتراض باز منتظر پاسخ شماست → «💬 اعتراض‌ها» (از «📂 منو»)`);
    // «نشانه» است نه اتهام؛ جزئیات فقط در پنل (بخش «موارد مشکوک»)
    if (openSuspicious > 0) lines.push(`🔎 ${openSuspicious} نشانه‌ی بررسی‌نشده در تیم شما (فقط نشانه، نه اتهام) → پنل ‹ موارد مشکوک`);
  }

  lines.push(...missionSection(supervisor).lines);

  return lines.join('\n');
}

// D11: گزارش تسک‌های امروز برای سرپرست‌ها (و خلاصه‌ی شرکت برای ادمین). هر گیرنده مستقل و ضدخطا؛ شکست آن مرور شبانه‌ی اصلی را نمی‌شکند.
// دکمه‌ها: «👁 مشاهده شد» و «💬 کامنت» به‌ازای هر عضوِ دارای گزارش + «🖥 گزارش کامل در پنل» (callback_data ≤ ۶۴ بایت: rvs:<id>:<date> / rvc:<id>:<date>).
async function sendNightlyTaskReports(bot, today = todayDateString()) {
  let reports = [];
  try {
    reports = nightlyTaskReportService.buildNightlyTaskReports(today);
  } catch (err) {
    console.error('[bot][scheduler] خطا در ساخت گزارش تسک‌های شبانه:', err.message);
    return 0;
  }
  const panelBtn = panelWebAppButton({ view: 'teamreports', text: '🖥 گزارش کامل در پنل' });
  let sent = 0;
  for (const rep of reports) {
    if (!rep.reviewer.telegram_user_id) continue;
    try {
      for (let i = 0; i < rep.messages.length; i += 1) {
        const last = i === rep.messages.length - 1;
        const keyboard = [];
        if (last) {
          rep.commentTargets.forEach((t) => keyboard.push([
            { text: `👁 مشاهده شد: ${t.name}`.slice(0, 40), callback_data: `rvs:${t.userId}:${rep.date}` },
            { text: '💬 کامنت', callback_data: `rvc:${t.userId}:${rep.date}` },
          ]));
          if (panelBtn) keyboard.push([panelBtn]);
        }
        // eslint-disable-next-line no-await-in-loop
        await bot.sendMessage(rep.reviewer.telegram_user_id, rep.messages[i], keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {});
      }
      sent += 1;
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال گزارش تسک‌های شبانه:', err.message);
    }
  }
  return sent;
}

// S3-8b: Job هر روز اجرا می‌شود؛ برای هر سرپرست از تقویم کاری تیمش تصمیم می‌گیرد: اگر امروز برای کل تیم روز غیرکاری است
// (و کسی ورود نزده) پیامی نمی‌فرستد؛ در غیر این صورت مثل قبل (تعطیلی دپارتمان/آخر هفته‌ی بقیه‌ی تیم فقط در شمارش «تعطیل» می‌آید).
async function sendNightlyReview(bot) {
  const today = todayDateString();
  // جاروی شبانه‌ی تشخیص مورد مشکوک (S2-4e): ضدخطا؛ شکستش نباید ارسال مرور شبانه را مختل کند
  runFraudChecksSafe({ date: today });

  const supervisors = usersRepository
    .listUsers({ onlyActive: true })
    .filter((u) => u.role === 'manager' && u.telegram_user_id);

  // دکمه‌ی Web App: بدون کد/لینک، مستقیم وارد پنل و صفحه‌ی مرور شبانه می‌شود
  const button = panelWebAppButton({ view: 'nightly', text: '🖥 باز کردن مرور شبانه در پنل' });
  for (const sup of supervisors) {
    const team = usersRepository.listUsers({ onlyActive: true, managerId: sup.id });
    if (team.length === 0) continue;
    try {
      const rows = reviewDay(team, today);
      if (isTeamOffDay(rows)) continue;
      const keyboard = missionSection(sup).shown.map((r) => missionDecisionService.missionKeyboardRow(r));
      if (button) keyboard.push([button]);
      const options = keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {};
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(sup.telegram_user_id, buildNightlyMessage(sup, team, today, rows), options);
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال مرور شبانه:', err.message);
    }
  }
  await sendNightlyTaskReports(bot, today);
}

module.exports = { sendNightlyReview, sendNightlyTaskReports, buildNightlyMessage, isTeamOffDay, missionSection };
