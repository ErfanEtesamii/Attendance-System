const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');

async function handleAddEmployeeCommand(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin'])) {
    await bot.sendMessage(chatId, '⛔️ این دستور فقط برای ادمین کل قابل استفاده است.');
    return;
  }

  session.start(chatId, 'add_employee', {});
  await bot.sendMessage(
    chatId,
    'آیدی عددی تلگرام کارمند جدید را وارد کنید (کارمند باید یک بار /start را در این بات زده باشد تا آیدی خودش را ببیند):'
  );
}

async function handleAddEmployeeText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (sess.step === 0) {
    if (!/^\d+$/.test(text)) {
      await bot.sendMessage(chatId, 'آیدی تلگرام باید فقط عدد باشد. دوباره وارد کنید:');
      return;
    }
    if (usersRepository.findByTelegramId(text)) {
      await bot.sendMessage(chatId, 'این آیدی تلگرام قبلاً در سیستم ثبت شده است. عملیات لغو شد.');
      session.clear(chatId);
      return;
    }
    session.update(chatId, { step: 1, data: { ...sess.data, telegramUserId: text } });
    await bot.sendMessage(chatId, 'نام و نام‌خانوادگی کارمند را وارد کنید:');
    return;
  }

  if (sess.step === 1) {
    session.update(chatId, { step: 2, data: { ...sess.data, fullName: text } });
    await bot.sendMessage(chatId, 'کد پرسنلی را وارد کنید (یا "-" برای رد شدن):');
    return;
  }

  if (sess.step === 2) {
    const personnelCode = text === '-' ? null : text;
    session.update(chatId, { step: 3, data: { ...sess.data, personnelCode } });
    await bot.sendMessage(chatId, 'دپارتمان را وارد کنید (یا "-" برای رد شدن):');
    return;
  }

  if (sess.step === 3) {
    const department = text === '-' ? null : text;
    session.update(chatId, { step: 4, data: { ...sess.data, department } });
    await bot.sendMessage(chatId, 'نقش کارمند را انتخاب کنید:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'کارمند', callback_data: 'add_emp_role:employee' },
            { text: 'مدیر دپارتمان', callback_data: 'add_emp_role:manager' },
            { text: 'ادمین کل', callback_data: 'add_emp_role:admin' },
          ],
        ],
      },
    });
    return;
  }

  if (sess.step === 5) {
    let managerId = null;
    if (text !== '-') {
      if (!/^\d+$/.test(text)) {
        await bot.sendMessage(chatId, 'آیدی تلگرام مدیر باید عدد باشد یا "-" باشد. دوباره وارد کنید:');
        return;
      }
      const manager = usersRepository.findByTelegramId(text);
      if (!manager) {
        await bot.sendMessage(chatId, 'کاربری با این آیدی تلگرام به‌عنوان مدیر پیدا نشد. دوباره وارد کنید یا "-" بزنید:');
        return;
      }
      managerId = manager.id;
    }
    await finalizeAddEmployee(bot, chatId, { ...sess.data, managerId });
    return;
  }
}

async function handleAddEmployeeCallback(bot, query, sess) {
  const chatId = query.message.chat.id;
  const [, role] = query.data.split(':');
  await bot.answerCallbackQuery(query.id);

  const data = { ...sess.data, role };

  if (role === 'admin') {
    await finalizeAddEmployee(bot, chatId, { ...data, managerId: null });
    return;
  }

  session.update(chatId, { step: 5, data });
  await bot.sendMessage(chatId, 'آیدی تلگرام مدیر مستقیم را وارد کنید (یا "-" اگر ندارد):');
}

async function finalizeAddEmployee(bot, chatId, data) {
  const newUser = usersRepository.createUser({
    telegramUserId: data.telegramUserId,
    fullName: data.fullName,
    personnelCode: data.personnelCode,
    department: data.department,
    role: data.role,
    managerId: data.managerId,
  });

  auditRepository.logEvent({
    userId: newUser.id,
    action: 'employee_added_via_bot',
    details: { addedBy: 'telegram_bot' },
  });

  session.clear(chatId);
  await bot.sendMessage(
    chatId,
    `✅ کارمند «${newUser.full_name}» با نقش «${newUser.role}» با موفقیت اضافه شد.`
  );

  try {
    await bot.sendMessage(
      newUser.telegram_user_id,
      `سلام ${newUser.full_name} 👋\nشما در سیستم حضور و غیاب فرازهنر ثبت شدید. برای شروع /start را بزنید.`
    );
  } catch (err) {
    console.error('[bot] خطا در اطلاع‌رسانی به کارمند جدید:', err.message);
  }
}

module.exports = { handleAddEmployeeCommand, handleAddEmployeeText, handleAddEmployeeCallback };
