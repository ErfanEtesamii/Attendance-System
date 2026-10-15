const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const auditRepository = require('../../repositories/auditRepository');
const ui = require('../ui/pickers');

// E3: هر مرحله زیرش «❌ انصراف | 🏠 منوی اصلی» دارد؛ فیلدهای اختیاری «⏭ رد شدن»؛ سرپرست از فهرست دکمه‌ای انتخاب می‌شود
// (تایپ فقط برای آیدی/نام/کد/دپارتمان می‌ماند؛ آیدی سرپرست هنوز تایپ‌شده هم پذیرفته می‌شود). نقش ادمین هر بار سمت سرور چک می‌شود.

async function handleAddEmployeeCommand(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin'])) {
    await bot.sendMessage(chatId, '⛔️ این گزینه فقط برای ادمین کل در دسترس است.');
    return;
  }

  session.start(chatId, 'add_employee', { adminId: user.id });
  await ui.askText(
    bot,
    chatId,
    'آیدی عددی تلگرام کارمند جدید را وارد کنید (کارمند باید یک بار این بات را باز کرده و «Start» را زده باشد تا آیدی خودش را ببیند):'
  );
}

// ادمینِ همین مکالمه هنوز ادمین فعال است؟ (دکمه‌ی پیام قدیمی بعد از تغییر نقش اجرا نمی‌شود)
function sessionAdmin(sess) {
  const admin = sess && sess.data && sess.data.adminId ? usersRepository.findById(sess.data.adminId) : null;
  return admin && admin.is_active && admin.role === 'admin' ? admin : null;
}

async function handleAddEmployeeText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (sess.step === 0) {
    if (!/^\d+$/.test(text)) {
      await ui.retry(bot, chatId, 'آیدی تلگرام باید فقط عدد باشد. دوباره وارد کنید:');
      return;
    }
    if (usersRepository.findByTelegramId(text)) {
      await bot.sendMessage(chatId, 'این آیدی تلگرام قبلاً در سیستم ثبت شده است. عملیات لغو شد.');
      session.clear(chatId);
      return;
    }
    session.update(chatId, { step: 1, data: { ...sess.data, telegramUserId: text } });
    await ui.askText(bot, chatId, 'نام و نام‌خانوادگی کارمند را وارد کنید:');
    return;
  }

  if (sess.step === 1) {
    if (!text) {
      await ui.retry(bot, chatId, 'نام نمی‌تواند خالی باشد. نام و نام‌خانوادگی را وارد کنید:');
      return;
    }
    session.update(chatId, { step: 2, data: { ...sess.data, fullName: text } });
    await ui.askText(bot, chatId, 'کد پرسنلی را وارد کنید (یا با دکمه‌ی «رد شدن» ادامه دهید):', { skip: true });
    return;
  }

  if (sess.step === 2) {
    const personnelCode = text === '-' ? null : text;
    session.update(chatId, { step: 3, data: { ...sess.data, personnelCode } });
    await ui.askText(bot, chatId, 'دپارتمان را وارد کنید (یا با دکمه‌ی «رد شدن» ادامه دهید):', { skip: true });
    return;
  }

  if (sess.step === 3) {
    const department = text === '-' ? null : text;
    session.update(chatId, { step: 4, data: { ...sess.data, department } });
    await bot.sendMessage(chatId, 'نقش کارمند را انتخاب کنید:', {
      reply_markup: ui.withNav([[
        { text: 'کارمند', callback_data: 'add_emp_role:employee' },
        { text: 'سرپرست', callback_data: 'add_emp_role:manager' },
        { text: 'ادمین کل', callback_data: 'add_emp_role:admin' },
      ]]),
    });
    return;
  }

  if (sess.step === 5) {
    let managerId = null;
    if (text !== '-') {
      if (!/^\d+$/.test(text)) {
        await ui.retry(bot, chatId, 'سرپرست را از فهرست بالا انتخاب کنید (یا آیدی عددی تلگرامش را تایپ کنید):');
        return;
      }
      const manager = usersRepository.findByTelegramId(text);
      if (!manager || !manager.is_active || !['manager', 'admin'].includes(manager.role)) {
        await ui.retry(bot, chatId, 'سرپرست فعالی با این آیدی پیدا نشد. از فهرست بالا انتخاب کنید یا دوباره تایپ کنید:');
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
  // دکمه‌ی نقشِ مرحله‌ی قدیمی/نامعتبر ⇒ «این دکمه منقضی شده»
  if (!sess || sess.flow !== 'add_employee' || sess.step !== 4 || !['employee', 'manager', 'admin'].includes(role)) {
    await ui.expire(bot, query);
    return;
  }
  if (!sessionAdmin(sess)) {
    session.clear(chatId);
    await bot.answerCallbackQuery(query.id, { text: 'اجازه این عملیات را ندارید.', show_alert: true });
    return;
  }
  await bot.answerCallbackQuery(query.id);

  const data = { ...sess.data, role };

  if (role === 'admin') {
    await finalizeAddEmployee(bot, chatId, { ...data, managerId: null });
    return;
  }

  session.update(chatId, { step: 5, data });
  await ui.askEmployee(bot, chatId, { text: 'سرپرست مستقیم را انتخاب کنید:', label: 'سرپرست', filter: 'managers', allowNone: true, noneText: 'بدون سرپرست' });
}

// انتخاب سرپرست از فهرست (pickerRouter): chosen = کاربر انتخاب‌شده یا null برای «بدون سرپرست»
async function handleManagerPick(bot, chatId, sess, chosen) {
  if (!sess || sess.flow !== 'add_employee' || sess.step !== 5) return;
  if (!sessionAdmin(sess)) {
    session.clear(chatId);
    await bot.sendMessage(chatId, 'اجازه این عملیات را ندارید.');
    return;
  }
  if (chosen && (!chosen.is_active || !['manager', 'admin'].includes(chosen.role))) {
    await ui.retry(bot, chatId, 'این کاربر به‌عنوان سرپرست قابل انتخاب نیست. دیگری را انتخاب کنید:');
    return;
  }
  await finalizeAddEmployee(bot, chatId, { ...sess.data, managerId: chosen ? chosen.id : null });
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
    const kb = require('../menu/menuRouter').buildMainKeyboard(newUser, { chatType: 'private' });
    await bot.sendMessage(
      newUser.telegram_user_id,
      `سلام ${newUser.full_name} 👋\nشما در سیستم حضور و غیاب فرازهنر ثبت شدید. برای شروع، دکمه‌ی «📂 منو» (پایین صفحه) را بزنید.`,
      kb ? { reply_markup: kb } : {}
    );
  } catch (err) {
    console.error('[bot] خطا در اطلاع‌رسانی به کارمند جدید:', err.message);
  }
}

module.exports = { handleAddEmployeeCommand, handleAddEmployeeText, handleAddEmployeeCallback, handleManagerPick };
