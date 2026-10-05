// پیام «مرور شبانه» برای هر سرپرست: وضعیت امروز تیمش + مواردی که نیاز به بررسی دارند +
// تعداد درخواست مرخصی/مأموریت و اعتراض‌های منتظر پاسخ. (ادمین کل این پیام را نمی‌گیرد؛ او گزارش
// پایان روز را دارد.)

const usersRepository = require('../../repositories/usersRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const disputeRepository = require('../../repositories/disputeRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const { reviewDay, summarize } = require('../../utils/dayReview');
const { formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { panelWebAppButton } = require('../panelLinks');

const MAX_ATTENTION_LINES = 25;

function clock(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function attentionLine(r) {
  const name = r.user.fullName;
  if (r.state === 'absent') return `• ${name} — غایب / بدون ثبت ورود`;
  const parts = [];
  if (r.lateMinutes > 0) parts.push(`تأخیر ${formatMinutes(r.lateMinutes)}`);
  if (r.noCheckout) parts.push(`ورود ${clock(r.checkIn)} ولی خروج ثبت نشده`);
  else if (r.state === 'incomplete') parts.push('رکورد ناقص');
  return `• ${name} — ${parts.join('، ')}`;
}

function buildNightlyMessage(supervisor, team, today) {
  const rows = reviewDay(team, today);
  const t = summarize(rows);
  const teamIds = new Set(team.map((u) => u.id));
  const pendingLeave = leaveRepository.listPending().filter((r) => teamIds.has(r.user_id)).length;
  const openDisputes = disputeRepository.listOpen().filter((d) => teamIds.has(d.user_id)).length;

  const lines = [
    `🌙 مرور شبانه — ${today}`,
    `${supervisor.full_name} عزیز، وضعیت امروز تیم شما (${t.total} نفر):`,
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

  if (pendingLeave > 0 || openDisputes > 0) {
    lines.push('');
    if (pendingLeave > 0) lines.push(`⏳ ${pendingLeave} درخواست مرخصی/مأموریت منتظر پاسخ شماست → /pending_leaves`);
    if (openDisputes > 0) lines.push(`💬 ${openDisputes} اعتراض باز منتظر پاسخ شماست → /pending_disputes`);
  }

  return lines.join('\n');
}

async function sendNightlyReview(bot) {
  const today = todayDateString();
  if (holidaysRepository.isHoliday(today)) return;

  const supervisors = usersRepository
    .listUsers({ onlyActive: true })
    .filter((u) => u.role === 'manager' && u.telegram_user_id);

  // دکمه‌ی Web App: بدون کد/لینک، مستقیم وارد پنل و صفحه‌ی مرور شبانه می‌شود
  const button = panelWebAppButton({ view: 'nightly', text: '🖥 باز کردن مرور شبانه در پنل' });
  for (const sup of supervisors) {
    const team = usersRepository.listUsers({ onlyActive: true, managerId: sup.id });
    if (team.length === 0) continue;
    try {
      const options = button ? { reply_markup: { inline_keyboard: [[button]] } } : {};
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(sup.telegram_user_id, buildNightlyMessage(sup, team, today), options);
    } catch (err) {
      console.error('[bot][scheduler] خطا در ارسال مرور شبانه:', err.message);
    }
  }
}

module.exports = { sendNightlyReview, buildNightlyMessage };
