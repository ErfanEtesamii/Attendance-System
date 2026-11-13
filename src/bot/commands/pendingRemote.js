// R6 (فاز ۱۴): «🏠 دورکاری‌های منتظر» — خلاصه‌ی صف بررسی دورکاری برای سرپرست/ادمین و دکمه‌ی باز کردن همان صف در پنل.
// تأیید/رد در پنل انجام می‌شود (اصلاح ساعت و تصمیم هم‌پوشانی با حضوری از بات ممکن نیست)؛ اسکوپ را remoteWorkAdminService.pendingSummary اعمال می‌کند.
const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const remoteAdmin = require('../../services/remoteWorkAdminService');
const { panelWebAppButton } = require('../panelLinks');
const { isoDateToJalaliString } = require('../../utils/jalali');
const session = require('../session');
const ui = require('../ui/pickers');
const usersRepository = require('../../repositories/usersRepository');
const { formatMinutes } = require('../../utils/workHours');

const MAX_LINES = 15;

/** متن خلاصه (خالص؛ برای تست). summary = خروجی pendingSummary. */
function buildSummaryText(summary) {
  const lines = [`🏠 دورکاری‌های منتظر بررسی: ${summary.total} ثبت`];
  for (const e of summary.employees.slice(0, MAX_LINES)) {
    lines.push(`• ${e.fullName} — ${e.count} ثبت (قدیمی‌ترین: ${isoDateToJalaliString(e.oldestWorkDate) || e.oldestWorkDate})`);
  }
  if (summary.employees.length > MAX_LINES) lines.push(`و ${summary.employees.length - MAX_LINES} نفر دیگر`);
  lines.push('', 'تأیید، رد و اصلاح ساعت در صف دورکاری پنل انجام می‌شود.');
  return lines.join('\n');
}

async function handlePendingRemote(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  if (!hasRole(user, ['admin', 'manager'])) {
    await bot.sendMessage(chatId, '⛔️ این گزینه فقط برای سرپرستان و ادمین در دسترس است.');
    return;
  }
  const summary = remoteAdmin.pendingSummary(user);
  if (!summary.ok) {
    await bot.sendMessage(chatId, summary.error);
    return;
  }
  if (summary.total === 0) {
    await bot.sendMessage(chatId, 'هیچ دورکاریِ منتظر بررسی ندارید. ✅');
    return;
  }
  const btn = panelWebAppButton({ view: 'remote', text: '🖥 صف دورکاری' });
  await bot.sendMessage(chatId, buildSummaryText(summary), btn ? { reply_markup: { inline_keyboard: [[btn]] } } : undefined);
}


// ---------------------------------------------------------------------------------------------------------------------
// کارت‌های تأیید/رد دورکاری داخل خود بات (هر ثبت یک کارت)
//   rr:a:<id> تأیید · rr:r:<id> شروع رد (علت اجباری، مگر مالک)
// تصمیم از remoteAdmin.approve / reject می‌گذرد (همان سرویس پنل: اسکوپ، قفل ماه، audit، اعلان به کارمند)؛ اینجا فقط تعامل است.
// ---------------------------------------------------------------------------------------------------------------------
const CARD_MAX = 10;
const LINE = '━━━━━━━━━━━━━━';
const REJECT_MIN = 3;
const CANCEL_WORD = 'انصراف';
const clock = (iso) => new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

/** ثبت‌های «بسته‌شده و منتظر» که actor مجاز به تصمیم رویشان است (قدیمی‌ترین اول). */
function pendingItems(actor) {
  const r = remoteAdmin.listQueue(actor, { status: 'pending', week: 'all', limit: 100 });
  if (!r.ok) return { ok: false, error: r.error, items: [] };
  const items = r.items.filter((i) => !i.isOpen && i.canReview).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
  return { ok: true, items };
}

function cardText(item) {
  const lines = [
    `🏠 دورکاری #${item.id}`,
    LINE,
    `👤 ${item.employee ? item.employee.fullName : '—'}`,
    `📅 ${item.jalaliDate || item.workDate}`,
    `⏱ ${clock(item.startAt)} تا ${item.endAt ? clock(item.endAt) : '—'}`,
  ];
  if (item.workedMinutes !== null && item.workedMinutes !== undefined) lines.push(`✅ مفید: ${formatMinutes(item.workedMinutes)}${item.breakMinutes ? ` | ☕ استراحت: ${formatMinutes(item.breakMinutes)}` : ''}`);
  if (item.autoClosed) lines.push('⚠️ پایان توسط سیستم ثبت شده (کارمند خروج نزده)');
  if (item.overlapsOnsite) lines.push('⚠️ همین روز حضور حضوری هم دارد؛ تصمیم‌گیری فقط در پنل ممکن است.');
  return lines.join('\n');
}

function cardKeyboard(item) {
  const reject = { text: '❌ رد', callback_data: ui.cb(`rr:r:${item.id}`), style: 'danger' };
  if (item.overlapsOnsite) {
    const panel = panelWebAppButton({ view: 'remote', text: '🖥 بررسی در پنل' });
    return { inline_keyboard: [panel ? [panel, reject] : [reject]] };
  }
  return { inline_keyboard: [[{ text: '✅ تأیید', callback_data: ui.cb(`rr:a:${item.id}`), style: 'success' }, reject]] };
}

/** کارت‌های دورکاری را می‌فرستد؛ تعداد کارت‌های فرستاده‌شده و باقی‌مانده را برمی‌گرداند. */
async function sendRemoteCards(bot, chatId, actor) {
  const r = pendingItems(actor);
  if (!r.ok || !r.items.length) return { sent: 0, rest: 0 };
  const shown = r.items.slice(0, CARD_MAX);
  for (const item of shown) await bot.sendMessage(chatId, cardText(item), { reply_markup: cardKeyboard(item) });
  const rest = r.items.length - shown.length;
  if (rest > 0) {
    const panel = panelWebAppButton({ view: 'remote', text: '🖥 صف دورکاری در پنل' });
    await bot.sendMessage(chatId, `و ${rest.toLocaleString('fa-IR')} دورکاری دیگر هم منتظر است؛ بقیه را در پنل بررسی کنید.`, panel ? { reply_markup: { inline_keyboard: [[panel]] } } : undefined);
  }
  return { sent: shown.length, rest };
}

async function finishCard(bot, chatId, messageId, text) {
  if (!messageId) return;
  try { await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }); } catch (_) { /* پیام قدیمی/ویرایش‌شده */ }
}

async function handleRemoteDecisionCallback(bot, query) {
  const chat = query.message && query.message.chat;
  const actor = query.from ? getRegisteredUser(query.from.id) : null;
  if (!chat || chat.type !== 'private' || !actor) {
    await bot.answerCallbackQuery(query.id, { text: 'شما در سیستم ثبت نیستید.', show_alert: true });
    return;
  }
  if (!hasRole(actor, ['admin', 'manager'])) {
    await bot.answerCallbackQuery(query.id, { text: 'اجازه‌ی این عملیات را ندارید.', show_alert: true });
    return;
  }
  const m = /^rr:([ar]):(\d+)$/.exec(String(query.data || ''));
  if (!m) { await ui.expire(bot, query); return; }
  const id = Number(m[2]);

  if (m[1] === 'r') { // شروع رد: علت را با پیام بعدی می‌گیریم
    const found = pendingItems(actor).items.find((i) => i.id === id);
    if (!found) { await bot.answerCallbackQuery(query.id, { text: 'این ثبت قبلاً بررسی شده یا در دسترس شما نیست.', show_alert: true }); return; }
    session.start(chat.id, 'remote_reject', { sessionId: id, messageId: query.message.message_id });
    await bot.answerCallbackQuery(query.id);
    const owner = actor.role === 'owner';
    await bot.sendMessage(chat.id, owner
      ? `✍️ علت رد دورکاری #${id} را بنویسید (اختیاری؛ برای رد بدون علت «-» بفرستید).`
      : `✍️ علت رد دورکاری #${id} را بنویسید (الزامی، حداقل ${REJECT_MIN.toLocaleString('fa-IR')} نویسه).`, { reply_markup: ui.withNav([]) });
    return;
  }

  const r = remoteAdmin.approve(actor, id, {}, { ip: null });
  if (!r.ok) {
    const text = r.code === 'ONSITE_OVERLAP' ? 'این روز حضور حضوری هم دارد؛ تصمیم‌گیری را در پنل انجام دهید.' : r.error;
    await bot.answerCallbackQuery(query.id, { text, show_alert: true });
    return;
  }
  await bot.answerCallbackQuery(query.id, { text: r.alreadyApproved ? 'قبلاً تأیید شده بود.' : 'تأیید شد ✅' });
  const emp = r.session && usersRepository.findById(r.session.userId || (r.session.employee && r.session.employee.id));
  await finishCard(bot, chat.id, query.message.message_id, `${query.message.text || `🏠 دورکاری #${id}`}\n\n✅ تأیید شد${emp ? ` — برای ${emp.full_name} در پنل ثبت شد.` : ' و در پنل ثبت شد.'}`);
}

async function handleRemoteRejectText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const actor = getRegisteredUser(msg.from.id);
  const text = (msg.text || '').trim();
  if (text === CANCEL_WORD) { session.clear(chatId); await bot.sendMessage(chatId, 'انصراف داده شد. دورکاری همچنان منتظر تصمیم است.'); return; }
  if (!actor || !hasRole(actor, ['admin', 'manager'])) { session.clear(chatId); await bot.sendMessage(chatId, '⛔️ اجازه‌ی این عملیات را ندارید.'); return; }
  const note = actor.role === 'owner' && text === '-' ? '' : text;
  if (note.length < REJECT_MIN && actor.role !== 'owner') {
    await bot.sendMessage(chatId, `علت رد الزامی است (حداقل ${REJECT_MIN.toLocaleString('fa-IR')} نویسه). دوباره بنویسید یا «${CANCEL_WORD}» بفرستید.`);
    return; // جریان باز می‌ماند
  }
  const r = remoteAdmin.reject(actor, sess.data.sessionId, { reviewNote: note }, { ip: null });
  session.clear(chatId);
  if (!r.ok) { await bot.sendMessage(chatId, `⛔️ ${r.error}`); return; }
  await finishCard(bot, chatId, sess.data.messageId, `🏠 دورکاری #${sess.data.sessionId}\n\n❌ رد شد.`);
  await bot.sendMessage(chatId, '❌ دورکاری رد شد و به کارمند اطلاع داده شد.');
}

/** تعداد دورکاری‌های قابل‌تصمیم (برای نشانگر دکمه‌ی منو). */
function pendingCount(actor) {
  const r = pendingItems(actor);
  return r.ok ? r.items.length : 0;
}

module.exports = { handlePendingRemote, buildSummaryText, sendRemoteCards, pendingItems, pendingCount, handleRemoteDecisionCallback, handleRemoteRejectText };
