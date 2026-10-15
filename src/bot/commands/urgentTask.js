// «⚡ تسک فوری» (فاز ۱۲، E3): سرپرست/ادمین از بات به یک کارمند تسک فوری می‌دهد.
// جریان: کارمند (فهرست دکمه‌ای) ← عنوان ← تاریخ (تقویم شمسی) ← ساعت مهلت (اختیاری) ← تأیید.
// هیچ منطق کسب‌وکاری اینجا نیست: همه‌ی اعتبارسنجی/اسکوپ/قفل ماه/audit/اعلان در urgentTaskService (E1) است؛
// بات فقط لایه‌ی تعامل است و نقش هر مرحله دوباره از دیتابیس خوانده می‌شود.

const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const urgentTaskService = require('../../services/urgentTaskService');
const ui = require('../ui/pickers');
const { todayDateString } = require('../../utils/serverTime');
const { addDays } = require('../../utils/shiftDay');

const FLOW = 'urgent_task';
const CANCEL = 'fl:x';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// خطاهایی که با انتخاب دوباره‌ی «تاریخ» قابل‌رفع‌اند (به‌جای لغو کل جریان)
const DATE_ERRORS = new Set(['INVALID_DATE', 'DATE_IN_PAST', 'DATE_TOO_FAR', 'NOT_WORKING_DAY', 'MONTH_CLOSED', 'DEADLINE_PASSED']);

const { faDigits } = ui;
const normalizeDigits = (s) => String(s || '')
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** کاربرِ تعیین‌کننده‌ی همین مکالمه؛ هر بار از دیتابیس (نقش/فعال‌بودن ممکن است عوض شده باشد). */
function sessionActor(sess) {
  const u = sess && sess.data && sess.data.actorId ? usersRepository.findById(sess.data.actorId) : null;
  return u && u.is_active && (u.role === 'admin' || u.role === 'manager') ? u : null;
}

async function denyAndClear(bot, chatId) {
  session.clear(chatId);
  await bot.sendMessage(chatId, '⛔️ تعیین تسک فوری فقط برای ادمین و سرپرست مجاز است.');
}

async function askDatePicker(bot, chatId) {
  const today = todayDateString();
  await ui.askDate(bot, chatId, {
    text: 'تاریخ انجام تسک را از تقویم انتخاب کنید (یا YYYY-MM-DD تایپ کنید):',
    label: 'تاریخ تسک',
    min: today,
    max: addDays(today, urgentTaskService.MAX_AHEAD_DAYS),
    quick: ui.quickDates([0, 1, 2]),
  });
}

async function handleUrgentTaskCommand(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!['admin', 'manager'].includes(user.role)) {
    await bot.sendMessage(chatId, '⛔️ تعیین تسک فوری فقط برای ادمین و سرپرست مجاز است.');
    return;
  }
  session.start(chatId, FLOW, { actorId: user.id });
  await ui.askEmployee(bot, chatId, {
    text: user.role === 'admin' ? '⚡ تسک فوری برای کدام کارمند؟' : '⚡ تسک فوری برای کدام یک از اعضای تیم شما؟',
    label: 'کارمند',
    filter: 'urgent_targets',
    actorId: user.id,
  });
}

// انتخاب کارمند از فهرست (pickerRouter). فهرست خودش اسکوپ‌دار است؛ اسکوپ نهایی را سرویس دوباره چک می‌کند.
async function handleEmployeePick(bot, chatId, sess, chosen) {
  if (!sess || sess.flow !== FLOW || sess.step !== 0 || !chosen) return;
  const actor = sessionActor(sess);
  if (!actor) return denyAndClear(bot, chatId);
  const denied = urgentTaskService.scopeFailure(actor, chosen);
  if (denied) {
    session.clear(chatId);
    await bot.sendMessage(chatId, `⛔️ ${denied.error}`);
    return;
  }
  session.update(chatId, { step: 1, data: { ...sess.data, employeeId: chosen.id, employeeName: chosen.full_name } });
  await ui.askText(bot, chatId, `عنوان تسک فوری برای ${chosen.full_name} را بنویسید (حداکثر ${faDigits(urgentTaskService.TITLE_MAX)} نویسه):`);
}

async function handleUrgentTaskText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!sess || sess.flow !== FLOW) return;
  const actor = sessionActor(sess);
  if (!actor) return denyAndClear(bot, chatId);

  if (sess.step === 0) { // انتخاب با تایپ آیدی تلگرام
    const emp = usersRepository.findByTelegramId(text);
    if (!emp) {
      await ui.retry(bot, chatId, 'کارمندی با این آیدی پیدا نشد. از فهرست بالا انتخاب کنید یا دوباره تایپ کنید:');
      return;
    }
    return handleEmployeePick(bot, chatId, sess, emp);
  }

  if (sess.step === 1) { // عنوان
    if (!text) {
      await ui.retry(bot, chatId, 'عنوان الزامی است. عنوان تسک را بنویسید:');
      return;
    }
    if (text.length > urgentTaskService.TITLE_MAX) {
      await ui.retry(bot, chatId, `عنوان حداکثر ${faDigits(urgentTaskService.TITLE_MAX)} نویسه است (الان ${faDigits(text.length)}). کوتاه‌تر بنویسید:`);
      return;
    }
    session.update(chatId, { step: 2, data: { ...sess.data, title: text } });
    await askDatePicker(bot, chatId);
    return;
  }

  if (sess.step === 2) { // تاریخ
    if (!DATE_RE.test(text)) {
      await ui.retry(bot, chatId, 'فرمت تاریخ نامعتبر است. از تقویم بالا انتخاب کنید یا YYYY-MM-DD تایپ کنید:');
      return;
    }
    session.update(chatId, { step: 3, data: { ...sess.data, date: text } });
    await ui.askText(bot, chatId, 'ساعت مهلت را بنویسید (مثل 15:30) یا «رد شدن» را بزنید:', { skip: true });
    return;
  }

  if (sess.step === 3) { // ساعت مهلت (اختیاری؛ «-» = رد شدن)
    let deadlineTime = null;
    if (text !== '-') {
      const m = /^(\d{1,2})[:.](\d{2})$/.exec(normalizeDigits(text));
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
        await ui.retry(bot, chatId, 'ساعت نامعتبر است. مثل 15:30 بنویسید یا «رد شدن» را بزنید:', {});
        return;
      }
      deadlineTime = `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    session.update(chatId, { step: 4, data: { ...sess.data, deadlineTime } });
    await sendConfirm(bot, chatId, { ...sess.data, deadlineTime });
  }
}

async function sendConfirm(bot, chatId, d) {
  const lines = [
    '⚡ تأیید تسک فوری',
    `کارمند: ${d.employeeName}`,
    `عنوان: ${d.title}`,
    `تاریخ: ${ui.describeDate(d.date)}`,
    `مهلت: ${d.deadlineTime ? faDigits(d.deadlineTime) : 'بدون ساعت مهلت'}`,
    '',
    'ثبت شود؟',
  ];
  session.update(chatId, { data: { ...session.get(chatId).data, pick: { kind: 'confirm', step: 4 } } });
  await bot.sendMessage(chatId, lines.join('\n'), {
    reply_markup: ui.withNav([[{ text: '✅ ثبت تسک فوری', callback_data: 'ut_ok' }]]),
  });
}

async function handleUrgentTaskCallback(bot, query, sess) {
  const chatId = query.message.chat.id;
  if (!sess || sess.flow !== FLOW || sess.step !== 4 || query.data !== 'ut_ok') {
    await ui.expire(bot, query);
    return;
  }
  const actor = sessionActor(sess);
  await bot.answerCallbackQuery(query.id);
  if (!actor) return denyAndClear(bot, chatId);

  const d = sess.data;
  const target = usersRepository.findById(d.employeeId);
  const r = urgentTaskService.assign(actor, target, { title: d.title, date: d.date, deadlineTime: d.deadlineTime }, { source: 'bot' });
  if (r.ok) {
    session.clear(chatId);
    await bot.sendMessage(chatId, `✅ تسک فوری برای ${d.employeeName} ثبت شد و به او اطلاع داده شد.${r.createdPlan ? '\n(برنامه‌ی آن هفته نداشت؛ یک برنامه‌ی خالی برایش ساخته شد.)' : ''}`);
    return;
  }
  if (DATE_ERRORS.has(r.code)) { // فقط تاریخ را دوباره بپرسیم؛ بقیه‌ی پاسخ‌ها حفظ می‌شود
    session.update(chatId, { step: 2, data: { ...d, date: undefined, deadlineTime: undefined, pick: undefined } });
    await bot.sendMessage(chatId, `⚠️ ${r.error}`);
    await askDatePicker(bot, chatId);
    return;
  }
  session.clear(chatId);
  await bot.sendMessage(chatId, `⛔️ ${r.error}`);
}

module.exports = { handleUrgentTaskCommand, handleUrgentTaskText, handleUrgentTaskCallback, handleEmployeePick };
