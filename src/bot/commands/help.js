// «❓ راهنما»: توضیح دکمه‌های منوی پایین صفحه بر اساس نقش (E4: بدون ارجاع به /دستور).
const { getRegisteredUser, notRegisteredMessage } = require('../auth');

const EMPLOYEE_BUTTONS = [
  '🕒 ثبت تردد — ثبت ورود، خروج و استراحت',
  '📊 وضعیت من — وضعیت لحظه‌ای امروز',
  '📈 گزارش من — خلاصه ساعت کاری هفته/ماه جاری',
  '🏖 مرخصی / 🚗 ماموریت — ثبت درخواست',
  '📋 برنامه هفتگی — برنامه‌ی کاری هفته',
  '🖥 پنل — ورود به پنل (ادمین: همه، سرپرست: تیم من، کارمند: فقط خودم)',
  '❓ راهنما — همین توضیح',
];

const MANAGER_BUTTONS = [
  '👥 گزارش تیم — گزارش تیم من',
  '📥 درخواست‌های منتظر — مرخصی/ماموریت‌های منتظر تأیید (ادمین: همه)',
  '💬 اعتراض‌ها — اعتراض‌های باز (پاسخ و بستن)',
  '📝 گزارش‌های دیروز تیم — گزارش تسک‌های دیروز تیم در پنل',
  '👤 لیست اعضا — اعضای تیم من (ادمین: همه)',
];

const ADMIN_BUTTONS = [
  '➕ افزودن کارمند — ثبت کارمند جدید',
  '🛠 اصلاح رکورد — اصلاح دستی یک رکورد تردد (با ثبت دلیل)',
  '⚙️ پنل مدیریت — ورود مستقیم به پنل مدیریت',
];

async function handleHelp(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);

  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }

  const lines = ['همه‌ی کارها با دکمه‌های پایین صفحه انجام می‌شود:', '', 'دکمه‌های کارمندی:', ...EMPLOYEE_BUTTONS];

  if (user.role === 'manager' || user.role === 'admin') {
    lines.push('', 'دکمه‌های تیم:', ...MANAGER_BUTTONS);
  }
  if (user.role === 'admin') {
    lines.push('', 'دکمه‌های ادمین:', ...ADMIN_BUTTONS);
  }
  lines.push('', 'در هر مرحله‌ی چندمرحله‌ای، «❌ انصراف» و «🏠 منوی اصلی» زیر پیام هست.');

  await bot.sendMessage(chatId, lines.join('\n'));
}

module.exports = { handleHelp };
