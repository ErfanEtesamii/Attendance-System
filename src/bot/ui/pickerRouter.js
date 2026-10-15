// E3 (فاز ۱۰): پردازش callbackهای انتخابگرها و ناوبری مشترک جریان‌های چندمرحله‌ای.
//   fl:x انصراف · fl:h منوی اصلی · fl:s رد شدن (فقط فیلد اختیاری)
//   dp:m:<سال>:<ماه> ماه دیگر · dp:d:<YYYY-MM-DD> انتخاب روز · dp:n بی‌اثر
//   tp:p:<صفحه> · tp:t:<HHMM> | ep:p:<صفحه> · ep:u:<id> · ep:none
// قاعده‌ها: هر callback دقیقاً یک بار answerCallbackQuery می‌گیرد؛ اگر session نیست یا مرحله عوض شده (دکمه‌ی پیام قدیمی) ⇒
// «این دکمه منقضی شده، منو را باز کنید». انتخابِ تاریخ/ساعت/رد‌شدن به‌صورت «متن» به همان handler متنیِ جریان داده می‌شود تا
// اعتبارسنجی فقط یک‌جا (در خود جریان/سرویس) باشد؛ انتخاب کارمند به handler اختصاصیِ جریان می‌رود.

const session = require('../session');
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const ui = require('./pickers');

const PICKER_RE = /^(fl|dp|tp|ep):/;

function isPickerCallback(data) {
  return typeof data === 'string' && PICKER_RE.test(data);
}

// handlerهای جریان‌ها (lazy تا چرخه‌ی require پیش نیاید)
function textHandlerOf(flow) {
  switch (flow) {
    case 'leave': return require('../commands/leave').handleLeaveText;
    case 'add_employee': return require('../commands/addEmployee').handleAddEmployeeText;
    case 'fix_record': return require('../commands/fixRecord').handleFixRecordText;
    case 'dispute_reply': return require('../commands/pendingDisputes').handleDisputeReplyText;
    case 'urgent_task': return require('../commands/urgentTask').handleUrgentTaskText;
    default: return null;
  }
}

function employeeHandlerOf(flow) {
  switch (flow) {
    case 'add_employee': return require('../commands/addEmployee').handleManagerPick;
    case 'fix_record': return require('../commands/fixRecord').handleEmployeePick;
    case 'urgent_task': return require('../commands/urgentTask').handleEmployeePick;
    default: return null;
  }
}

async function safeEdit(fn) {
  try {
    await fn();
  } catch (_) { /* «message is not modified» / پیام حذف‌شده: مهم نیست */ }
}

async function editKeyboard(bot, query, keyboard) {
  if (typeof bot.editMessageReplyMarkup !== 'function') return;
  await safeEdit(() => bot.editMessageReplyMarkup(keyboard, { chat_id: query.message.chat.id, message_id: query.message.message_id }));
}

// بعد از انتخابِ موفق، پیامِ انتخابگر به یک خط «✅ مقدار انتخاب‌شده» تبدیل و دکمه‌هایش برداشته می‌شود
async function collapse(bot, query, text) {
  if (typeof bot.editMessageText !== 'function') return;
  await safeEdit(() => bot.editMessageText(text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    reply_markup: { inline_keyboard: [] },
  }));
}

// مقدار انتخاب‌شده را به‌عنوان متنِ تایپ‌شده به handler جریان می‌دهد؛ اگر مرحله جلو رفت، پیام انتخابگر جمع می‌شود
async function feedText(bot, query, sess, text, summary) {
  const handler = textHandlerOf(sess.flow);
  if (!handler) return ui.expire(bot, query); // نباید پیش بیاید: pick بدون جریان شناخته‌شده
  const chatId = query.message.chat.id;
  const before = sess.step;
  await bot.answerCallbackQuery(query.id);
  await handler(bot, { chat: query.message.chat, from: query.from, text }, sess);
  const after = session.get(chatId);
  if (!after || after.step !== before) await collapse(bot, query, summary);
  return undefined;
}

async function goHome(bot, query) {
  const chatId = query.message.chat.id;
  await bot.answerCallbackQuery(query.id);
  ui.discardSession(chatId);
  const user = getRegisteredUser(query.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(query.from.id), { parse_mode: 'Markdown' });
    return;
  }
  const kb = require('../menu/menuRouter').buildMainKeyboard(user, { chatType: query.message.chat.type });
  await bot.sendMessage(chatId, '🏠 منوی اصلی — برای دیدن گزینه‌ها دکمه‌ی «📂 منو» (پایین صفحه) را بزنید.', kb ? { reply_markup: kb } : {});
}

async function cancelFlow(bot, query) {
  await bot.answerCallbackQuery(query.id);
  ui.discardSession(query.message.chat.id);
  await bot.sendMessage(query.message.chat.id, 'انصراف داده شد.');
}

function parseIntStrict(str) {
  return /^\d+$/.test(str || '') ? Number(str) : NaN;
}

async function handleDate(bot, query, sess, pick, parts) {
  const [action, a, b] = parts;
  if (action === 'n') return bot.answerCallbackQuery(query.id);
  if (pick.kind !== 'date') return ui.expire(bot, query);

  if (action === 'm') {
    const jy = parseIntStrict(a);
    const jm = parseIntStrict(b);
    if (!(jy >= 1300 && jy <= 1600 && jm >= 1 && jm <= 12)) return ui.expire(bot, query);
    const next = { ...pick, jy, jm };
    session.update(query.message.chat.id, { data: { ...sess.data, pick: next } });
    await bot.answerCallbackQuery(query.id);
    return editKeyboard(bot, query, ui.dateKeyboard(next));
  }

  if (action === 'd') {
    const iso = parts.slice(1).join(':');
    if (!ui.isIsoDate(iso) || !ui.inRange(iso, pick.min, pick.max)) {
      return bot.answerCallbackQuery(query.id, { text: 'این تاریخ قابل انتخاب نیست.', show_alert: true });
    }
    return feedText(bot, query, sess, iso, `✅ ${pick.label || 'تاریخ'}: ${ui.describeDate(iso)}`);
  }
  return ui.expire(bot, query);
}

async function handleTime(bot, query, sess, pick, parts) {
  const [action, a] = parts;
  if (pick.kind !== 'time') return ui.expire(bot, query);

  if (action === 'p') {
    const page = parseIntStrict(a);
    if (!(page >= 0 && page < ui.TIME_PAGES.length)) return ui.expire(bot, query);
    const next = { ...pick, page };
    session.update(query.message.chat.id, { data: { ...sess.data, pick: next } });
    await bot.answerCallbackQuery(query.id);
    return editKeyboard(bot, query, ui.timeKeyboard(next));
  }

  if (action === 't') {
    const time = /^\d{4}$/.test(a || '') ? `${a.slice(0, 2)}:${a.slice(2)}` : '';
    if (!ui.isTime(time) || (pick.after && time <= pick.after)) {
      return bot.answerCallbackQuery(query.id, { text: 'این ساعت قابل انتخاب نیست.', show_alert: true });
    }
    return feedText(bot, query, sess, time, `✅ ${pick.label || 'ساعت'}: ${time}`);
  }
  return ui.expire(bot, query);
}

async function handleEmployee(bot, query, sess, pick, parts) {
  const [action, a] = parts;
  if (pick.kind !== 'emp') return ui.expire(bot, query);
  const chatId = query.message.chat.id;

  if (action === 'p') {
    const page = parseIntStrict(a);
    if (!(page >= 0)) return ui.expire(bot, query);
    const next = { ...pick, page };
    session.update(chatId, { data: { ...sess.data, pick: next } });
    await bot.answerCallbackQuery(query.id);
    return editKeyboard(bot, query, ui.employeeKeyboard(next));
  }

  const handler = employeeHandlerOf(sess.flow);
  if (!handler) return ui.expire(bot, query);

  let chosen = null;
  if (action === 'none') {
    if (!pick.allowNone) return ui.expire(bot, query);
  } else if (action === 'u') {
    const id = parseIntStrict(a);
    chosen = ui.candidateUsers(pick.filter || 'any', pick).find((u) => u.id === id) || null;
    if (!chosen) return bot.answerCallbackQuery(query.id, { text: 'این گزینه قابل انتخاب نیست.', show_alert: true });
  } else {
    return ui.expire(bot, query);
  }

  const before = sess.step;
  await bot.answerCallbackQuery(query.id);
  await handler(bot, chatId, sess, chosen);
  const after = session.get(chatId);
  if (!after || after.step !== before) await collapse(bot, query, `✅ ${pick.label || 'انتخاب'}: ${chosen ? chosen.full_name : (pick.noneText || 'بدون انتخاب')}`);
  return undefined;
}

/** نقطه‌ی ورود از bot.on('callback_query'). همیشه یک‌بار answerCallbackQuery می‌زند. */
async function handlePickerCallback(bot, query) {
  const data = String(query.data || '');
  if (!query.message || !query.message.chat) return ui.expire(bot, query);
  const chatId = query.message.chat.id;

  if (data === ui.CB.HOME) return goHome(bot, query); // منوی اصلی همیشه کار می‌کند (حتی بدون session)

  const sess = session.get(chatId);
  if (!sess) return ui.expire(bot, query);
  if (data === ui.CB.CANCEL) return cancelFlow(bot, query);

  const pick = sess.data && sess.data.pick;
  if (!pick || pick.step !== sess.step) return ui.expire(bot, query); // دکمه‌ی مرحله‌ی قدیمی

  if (data === ui.CB.SKIP) {
    if (pick.kind !== 'text' || !pick.skippable) return ui.expire(bot, query);
    return feedText(bot, query, sess, '-', '⏭ رد شد.');
  }

  const [prefix, ...parts] = data.split(':');
  if (prefix === 'dp') return handleDate(bot, query, sess, pick, parts);
  if (prefix === 'tp') return handleTime(bot, query, sess, pick, parts);
  if (prefix === 'ep') return handleEmployee(bot, query, sess, pick, parts);
  return ui.expire(bot, query);
}

module.exports = { isPickerCallback, handlePickerCallback };
