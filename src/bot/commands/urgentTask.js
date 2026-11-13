// «⚡ تسک فوری» (فاز ۱۲، E3): سرپرست/ادمین از بات به یک کارمند تسک فوری می‌دهد.
// جریان: کارمند (فهرست دکمه‌ای) ← روز (تقویم شمسی) ← متن تسک (تایپ) ← ذخیره‌ی فوری (بدون مرحله‌ی تأیید) و ثبت در پنل.
// هیچ منطق کسب‌وکاری اینجا نیست: همه‌ی اعتبارسنجی/اسکوپ/قفل ماه/audit/اعلان در urgentTaskService (E1) است؛
// بات فقط لایه‌ی تعامل است و نقش هر مرحله دوباره از دیتابیس خوانده می‌شود.

const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const urgentTaskService = require('../../services/urgentTaskService');
const ui = require('../ui/pickers');
const { todayDateString } = require('../../utils/serverTime');
const { addDays } = require('../../utils/shiftDay');

const { isAdmin, isManagerUp } = require('../../utils/roles');
const FLOW = 'urgent_task';
const CANCEL = 'fl:x';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// خطاهایی که با انتخاب دوباره‌ی «تاریخ» قابل‌رفع‌اند (به‌جای لغو کل جریان)
const DATE_ERRORS = new Set(['INVALID_DATE', 'DATE_IN_PAST', 'DATE_TOO_FAR', 'NOT_WORKING_DAY', 'MONTH_CLOSED', 'DEADLINE_PASSED']);

const { faDigits } = ui;

/** کاربرِ تعیین‌کننده‌ی همین مکالمه؛ هر بار از دیتابیس (نقش/فعال‌بودن ممکن است عوض شده باشد). */
function sessionActor(sess) {
  const u = sess && sess.data && sess.data.actorId ? usersRepository.findById(sess.data.actorId) : null;
  return u && u.is_active && (isAdmin(u) || u.role === 'manager') ? u : null;
}

async function denyAndClear(bot, chatId) {
  session.clear(chatId);
  await bot.sendMessage(chatId, '⛔️ تعیین تسک فوری فقط برای ادمین و سرپرست مجاز است.');
}

async function askDatePicker(bot, chatId, employeeName) {
  const today = todayDateString();
  await ui.askDate(bot, chatId, {
    text: `📅 تسک فوری ${employeeName ? `برای ${employeeName} ` : ''}مربوط به کدام روز است؟\nاز تقویم انتخاب کنید (یا YYYY-MM-DD تایپ کنید) 👇`,
    label: 'روز تسک',
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
  if (!isManagerUp(user)) {
    await bot.sendMessage(chatId, '⛔️ تعیین تسک فوری فقط برای ادمین و سرپرست مجاز است.');
    return;
  }
  session.start(chatId, FLOW, { actorId: user.id });
  await ui.askEmployee(bot, chatId, {
    text: isAdmin(user) ? '⚡ تسک فوری\n━━━━━━━━━━━━━━\nبرای کدام کارمند؟ 👇' : '⚡ تسک فوری\n━━━━━━━━━━━━━━\nبرای کدام یک از اعضای تیم شما؟ 👇',
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
  await askDatePicker(bot, chatId, chosen.full_name);
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

  if (sess.step === 1) { // روز
    if (!DATE_RE.test(text)) {
      await ui.retry(bot, chatId, 'فرمت تاریخ نامعتبر است. از تقویم بالا انتخاب کنید یا YYYY-MM-DD تایپ کنید:');
      return;
    }
    const data = { ...sess.data, date: text, pick: undefined };
    if (data.title) { // بازگشت از خطای تاریخ: متن را قبلاً نوشته بود ⇒ مستقیم ذخیره
      session.update(chatId, { step: 2, data });
      return save(bot, chatId, session.get(chatId), actor);
    }
    session.update(chatId, { step: 2, data });
    await ui.askText(bot, chatId, `✍️ متن تسک فوری ${data.employeeName} را بنویسید (حداکثر ${faDigits(urgentTaskService.TITLE_MAX)} نویسه):`);
    return;
  }

  if (sess.step === 2) { // متن تسک ⇒ ذخیره‌ی فوری
    if (!text) {
      await ui.retry(bot, chatId, 'متن تسک الزامی است. متن را بنویسید:');
      return;
    }
    if (text.length > urgentTaskService.TITLE_MAX) {
      await ui.retry(bot, chatId, `متن حداکثر ${faDigits(urgentTaskService.TITLE_MAX)} نویسه است (الان ${faDigits(text.length)}). کوتاه‌تر بنویسید:`);
      return;
    }
    session.update(chatId, { data: { ...sess.data, title: text, pick: undefined } });
    return save(bot, chatId, session.get(chatId), actor);
  }
}

// ثبت نهایی از طریق urgentTaskService (اعتبارسنجی/اسکوپ/قفل ماه/audit/اعلان به کارمند همه آن‌جاست)
async function save(bot, chatId, sess, actor) {
  const d = sess.data;
  const target = usersRepository.findById(d.employeeId);
  const r = urgentTaskService.assign(actor, target, { title: d.title, date: d.date, deadlineTime: null }, { source: 'bot' });
  if (r.ok) {
    session.clear(chatId);
    await bot.sendMessage(chatId, [
      '✅ تسک فوری ثبت شد',
      '━━━━━━━━━━━━━━',
      `👤 ${d.employeeName}`,
      `📅 ${ui.describeDate(d.date)}`,
      `⚡ ${d.title}`,
      '',
      `در پنل ثبت شد و به ${d.employeeName} اطلاع داده شد.${r.createdPlan ? '\n(برنامه‌ی آن هفته نداشت؛ یک برنامه‌ی خالی برایش ساخته شد.)' : ''}`,
    ].join('\n'));
    return;
  }
  if (DATE_ERRORS.has(r.code)) { // فقط روز را دوباره بپرسیم؛ متن حفظ می‌شود
    session.update(chatId, { step: 1, data: { ...d, date: undefined, pick: undefined } });
    await bot.sendMessage(chatId, `⚠️ ${r.error}`);
    await askDatePicker(bot, chatId, d.employeeName);
    return;
  }
  session.clear(chatId);
  await bot.sendMessage(chatId, `⛔️ ${r.error}`);
}

module.exports = { handleUrgentTaskCommand, handleUrgentTaskText, handleEmployeePick };
