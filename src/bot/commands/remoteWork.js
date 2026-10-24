// داشبورد دورکاری بات: تمام داده‌های حساس هر بار از DB خوانده می‌شود و callback_data فقط شناسه‌ی کمکی است.
const session = require('../session');
const { cb } = require('../ui/pickers');
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const remoteWork = require('../../services/remoteWorkService');
const gate = require('../../services/remoteWorkGate');
const audit = require('../../repositories/auditRepository');
const rate = require('../../repositories/rateLimitRepository');
const panelLinks = require('../panelLinks');
const { formatMinutes } = require('../../utils/workHours');

const line = '━━━━━━━━━━━━━━';
const time = (iso) => new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
const button = (text, data, style) => ({ text, callback_data: cb(data), ...(style ? { style } : {}) });
const duration = (from, now) => Math.max(0, Math.floor((now - new Date(from)) / 60000));

function buildView(state, access, now = new Date()) {
  const open = state.openSession;
  if (!open && !access.ok) {
    const rows = [];
    if ((access.code === 'ONSITE_TODAY' || access.code === 'MISSION_TODAY') && panelLinks.canUseWebApp(panelLinks.miniAppLink())) {
      rows.push([{ text: '🕒 ثبت تردد', web_app: { url: panelLinks.miniAppLink() } }, button('📊 وضعیت من', 'mn:status')]);
    }
    rows.push([button('🏠 منوی اصلی', 'rw:m')]);
    return { text: `🏠 دورکاری\n${line}\n⛔️ ${access.error}`, reply_markup: { inline_keyboard: rows } };
  }
  if (!open) {
    const closed = state.sessions.filter((s) => s.end_at);
    const total = closed.reduce((n, s) => n + duration(s.start_at, s.end_at), 0);
    return { text: ['🏠 دورکاری', line, 'وضعیت: ⚪️ دورکاری شروع نشده', ...(closed.length ? [`امروز: ${closed.length.toLocaleString('fa-IR')} ثبت | مجموع: ${formatMinutes(total)}`] : []), line, 'ساعت‌های دورکاری پس از بررسی سرپرست در آخر هفته لحاظ می‌شود.'].join('\n'), reply_markup: { inline_keyboard: [[button('🟢 شروع دورکاری', 'rw:s', 'success')], [button('📋 سوابق من', 'rw:h'), button('🔄 به‌روزرسانی', 'rw:o')], [button('🏠 منوی اصلی', 'rw:m')]] } };
  }
  const openBreak = state.openBreak;
  const breaks = open.breaks || [];
  const breakMinutes = breaks.reduce((n, b) => n + duration(b.start_at, b.end_at || now), 0);
  const total = duration(open.start_at, now);
  if (openBreak) return { text: ['🏠 دورکاری', line, `وضعیت: ☕ در حال استراحت (از ${time(openBreak.start_at)}، ${formatMinutes(duration(openBreak.start_at, now))})`, `شروع دورکاری: ${time(open.start_at)} | مدت کل: ${formatMinutes(total)}`, line].join('\n'), reply_markup: { inline_keyboard: [[button('▶️ ادامه‌ی کار', 'rw:r', 'success')], [button('🔴 پایان دورکاری', `rw:e:${open.id}`, 'danger')], [button('🔄 به‌روزرسانی', 'rw:o'), button('🏠 منوی اصلی', 'rw:m')]] } };
  return { text: ['🏠 دورکاری', line, 'وضعیت: 🟢 در حال کار', `شروع: ${time(open.start_at)} | مدت: ${formatMinutes(total)}`, `استراحت‌ها: ${formatMinutes(breakMinutes)} (${breaks.length.toLocaleString('fa-IR')} بار)`, line, '⏳ تأییدنشده — پس از بررسی سرپرست لحاظ می‌شود.'].join('\n'), reply_markup: { inline_keyboard: [[button('☕ شروع استراحت', 'rw:b', 'primary'), button('🔴 پایان دورکاری', `rw:e:${open.id}`, 'danger')], [button('🔄 به‌روزرسانی', 'rw:o'), button('🏠 منوی اصلی', 'rw:m')]] } };
}

function dashboard(user, now) { const state = remoteWork.getToday(user.id, { now }); return buildView(state, state.openSession ? { ok: true } : gate.checkStart(user, { now }), now); }
async function replace(bot, query, view) {
  try { await bot.editMessageText(view.text, { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: view.reply_markup }); }
  catch (err) { if (!/message is not modified/i.test(err.message || '')) await bot.sendMessage(query.message.chat.id, view.text, { reply_markup: view.reply_markup }); }
}
function limited(user) { return rate.hit('bot-remote', `bot-remote:${user.id}`, 10 * 60 * 1000).count > 30; }
function reject(user, code) { audit.logEvent({ userId: user.id, action: 'remote_work_rejected', details: { via: 'bot', code } }); }

async function handleRemoteWork(bot, msg) {
  if (!msg.chat || msg.chat.type !== 'private' || !msg.from) return;
  const user = getRegisteredUser(msg.from.id);
  if (!user) return bot.sendMessage(msg.chat.id, notRegisteredMessage(msg.from.id));
  session.clear(msg.chat.id);
  const view = dashboard(user, new Date());
  return bot.sendMessage(msg.chat.id, view.text, { reply_markup: view.reply_markup });
}

async function handleRemoteWorkCallback(bot, query) {
  const chat = query.message && query.message.chat;
  await bot.answerCallbackQuery(query.id);
  if (!chat || chat.type !== 'private' || !query.from) return;
  const user = getRegisteredUser(query.from.id);
  if (!user) return bot.sendMessage(chat.id, notRegisteredMessage(query.from.id));
  if (limited(user)) return bot.sendMessage(chat.id, 'تعداد درخواست‌ها زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.');
  const data = String(query.data || ''); const now = new Date();
  const show = () => replace(bot, query, dashboard(user, now));
  if (data === 'rw:m') return require('../menu/menuRouter').sendMenu(bot, chat.id, user);
  if (data === 'rw:o' || data === 'rw:x') return show();
  const state = remoteWork.getToday(user.id, { now });
  if (data === 'rw:h') return replace(bot, query, { text: '🏠 سوابق دورکاری\n' + line + '\n' + (remoteWork.getHistory(user.id, { days: 7, now }).sessions.slice(0, 20).map((s) => `${s.work_date}: ${time(s.start_at)} تا ${s.end_at ? time(s.end_at) : 'باز'} — ${s.status === 'approved' ? '✅ تأیید شد' : s.status === 'rejected' ? '❌ رد شد' : '⏳ منتظر بررسی'}`).join('\n') || 'سابقه‌ای نیست.'), reply_markup: { inline_keyboard: [[button('↩️ برگشت', 'rw:x')]] } });
  if (data === 'rw:s') { const a = gate.checkStart(user, { now }); if (!a.ok) { reject(user, a.code); return show(); } return replace(bot, query, { text: `🟢 شروع دورکاری\n${line}\nشما در فرازهنر حضور ندارید. می‌توانید ساعت خود را به‌عنوان دورکار ثبت کنید و پس از بررسی سرپرست مربوطه، در آخر هفته ساعتتان لحاظ می‌شود.\nشروع کنم؟`, reply_markup: { inline_keyboard: [[button('✅ بله، شروع کن', 'rw:s!', 'success')], [button('↩️ انصراف', 'rw:x')]] } }); }
  if (data === 'rw:s!') { const a = gate.checkStart(user, { now }); if (!a.ok) { reject(user, a.code); return show(); } const r = remoteWork.start(user, { ip: null, now, source: 'bot' }); if (!r.ok) return show(); await show(); return; }
  if (data === 'rw:b' || data === 'rw:r') { const r = data === 'rw:b' ? remoteWork.breakStart(user, { ip: null, now, source: 'bot' }) : remoteWork.breakEnd(user, { ip: null, now, source: 'bot' }); if (!r.ok) return bot.sendMessage(chat.id, r.error); return show(); }
  const endId = /^rw:e(!?)\:(\d+)$/.exec(data);
  if (endId) { const open = state.openSession; if (!open || String(open.id) !== endId[2]) return show(); if (!endId[1]) return replace(bot, query, { text: `🔴 پایان دورکاری\n${line}\nشروع: ${time(open.start_at)} | مدت: ${formatMinutes(duration(open.start_at, now))}\n${state.openBreak ? '☕ استراحت بازِ شما هم همین حالا بسته می‌شود.\n' : ''}پایان بدهم؟`, reply_markup: { inline_keyboard: [[button('✅ بله، پایان بده', `rw:e!:${open.id}`, 'danger')], [button('↩️ ادامه‌ی کار', 'rw:x')]] } }); const r = remoteWork.end(user, { ip: null, now, source: 'bot' }); if (!r.ok) return show(); return show(); }
  return show();
}

module.exports = { handleRemoteWork, handleRemoteWorkCallback, buildView };
