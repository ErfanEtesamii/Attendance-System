const { getRegisteredUser, notRegisteredMessage } = require('../auth');

const EMPLOYEE_COMMANDS = [
  '/status — وضعیت لحظه‌ای من',
  '/report — خلاصه ساعت کاری هفته/ماه جاری',
  '/leave — ثبت درخواست مرخصی یا مأموریت',
  '/help — همین راهنما',
];

const MANAGER_COMMANDS = [
  '/list_employees — لیست اعضای تیم من',
  '/team_report — گزارش تیم من',
  '/pending_leaves — درخواست‌های مرخصی در انتظار تأیید تیم من',
];

const ADMIN_COMMANDS = [
  '/add_employee — افزودن کارمند جدید',
  '/list_employees — لیست همه کارمندان',
  '/team_report — گزارش کل تیم‌ها',
  '/pending_leaves — همه درخواست‌های مرخصی در انتظار',
  '/fix_record — اصلاح دستی یک رکورد تردد',
];

async function handleHelp(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);

  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }

  const lines = ['دستورات کارمندی:', ...EMPLOYEE_COMMANDS];

  if (user.role === 'manager') {
    lines.push('', 'دستورات مدیریتی:', ...MANAGER_COMMANDS);
  } else if (user.role === 'admin') {
    lines.push('', 'دستورات ادمین:', ...ADMIN_COMMANDS);
  }

  await bot.sendMessage(chatId, lines.join('\n'));
}

module.exports = { handleHelp };
