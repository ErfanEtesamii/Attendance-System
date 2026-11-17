// «❓ راهنما»: توضیح گزینه‌های «📂 منو» بر اساس نقش (E4: بدون ارجاع به /دستور؛ H2: پشت دکمه‌ی «📂 منو»).
const { getRegisteredUser, notRegisteredMessage, hasAnyPermission } = require('../auth');

const { isAdmin } = require('../../utils/roles');
const EMPLOYEE_BUTTONS = [
  '🖥 ورود به پنل — ورود مستقیم به پنل (ادمین: همه، سرپرست: تیم من، کارمند: فقط خودم)',
  '🕒 ثبت تردد — ثبت ورود، خروج و استراحت',
  '🏠 ثبت دورکاری — شروع/استراحت/پایان دورکاری وقتی در شرکت نیستید (پس از تأیید سرپرست لحاظ می‌شود)',
  '📊 وضعیت و گزارش من — وضعیت لحظه‌ای امروز + خلاصه ساعت کاری هفته/ماه جاری',
  '📋 برنامه هفتگی — هفته‌ی قبل/این هفته/هفته‌ی بعد را انتخاب کنید تا برنامه‌اش به‌صورت متن بیاید',
  '🏖 مرخصی / 🚗 ماموریت — ثبت درخواست',
  '❓ راهنما — همین توضیح',
  'اگر پنل برایتان باز نمی‌شود (مثلاً از شبکه‌ی شرکت وصل نیستید)، همه‌ی کارها با همین دکمه‌ها قابل انجام است.',
];

// perm (فاز B): دکمه فقط وقتی در راهنما بیاید که کاربر حداقل یکی از این مجوزها را (مؤثر) داشته باشد؛ بدون perm ⇒ همیشه
const MANAGER_BUTTONS = [
  { perm: ['leave.approve', 'remote_work.review'], text: '📥 درخواست‌های منتظر — مرخصی، ماموریت و دورکاری‌های منتظر؛ همان‌جا تأیید یا رد کنید (ادمین: همه)' },
  { text: '👥 گزارش تیم — تیم و عضو را انتخاب کنید؛ گزارش به‌صورت فایل متنی می‌آید' },
  { perm: ['tasks.assign_urgent'], text: '⚡ تسک فوری — کارمند ← روز ← متن؛ بلافاصله در پنل ثبت می‌شود (ادمین: همه)' },
  { perm: ['disputes.resolve'], text: '💬 اعتراض‌ها — اعتراض‌های باز (پاسخ و بستن)' },
  { text: '👤 لیست اعضا — اعضای تیم من (ادمین: همه)' },
];

const ADMIN_BUTTONS = [
  '➕ افزودن کارمند — ثبت کارمند جدید',
  '🛠 اصلاح رکورد — اصلاح دستی یک رکورد تردد (با ثبت دلیل)',
  '🤖 تحلیلگر هوشمند — پرسش و تحلیل عملکرد',
];

async function handleHelp(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);

  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }

  const lines = ['برای دیدن همه‌ی کارها دکمه‌ی «📂 منو» (پایین صفحه) را بزنید؛ گزینه‌های آن:', '', 'گزینه‌های کارمندی:', ...EMPLOYEE_BUTTONS];

  if (user.role === 'manager' || isAdmin(user)) {
    lines.push('', 'گزینه‌های تیم:', ...MANAGER_BUTTONS.filter((b) => !b.perm || hasAnyPermission(user, b.perm)).map((b) => b.text));
  }
  if (isAdmin(user)) {
    lines.push('', 'گزینه‌های ادمین:', ...ADMIN_BUTTONS);
  }
  lines.push('', 'در هر مرحله‌ی چندمرحله‌ای، «❌ انصراف» و «🏠 منوی اصلی» زیر پیام هست.');

  await bot.sendMessage(chatId, lines.join('\n'));
}

module.exports = { handleHelp };
