// «🤖 تحلیلگر هوشمند» در بات (فقط ادمین): همان ایجنت پنل. گفتگو در session ‏(flow=ai_chat، ۱۰ دقیقه بی‌پاسخی ⇒ پایان).
// عملیات پیشنهادی ایجنت با دکمه‌ی inline «تأیید/لغو» اجرا می‌شود (همان actions.js: مجوز، اسکوپ، انقضا، audit).
const fs = require('fs');
const session = require('../session');
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const { hasPermission } = require('../../middleware/permissions');
const agent = require('../../services/aiAgent/agent');
const actions = require('../../services/aiAgent/actions');
const { takeExport } = require('../../services/aiAgent/moreTools');
const auditRepository = require('../../repositories/auditRepository');
const config = require('../../config');

const CHUNK = 3800;
const MAX_TURNS = 6;
const hits = new Map(); // adminId → [timestamps] (محدودیت ‌پرسش در دقیقه)

function limited(adminId) {
  const now = Date.now();
  const arr = (hits.get(adminId) || []).filter((t) => now - t < 60000);
  if (arr.length >= config.ai.perMinuteLimit) { hits.set(adminId, arr); return true; }
  arr.push(now); hits.set(adminId, arr); return false;
}

function split(text) {
  const out = [];
  let rest = String(text);
  while (rest.length > CHUNK) {
    let cut = rest.lastIndexOf('\n', CHUNK);
    if (cut < CHUNK / 2) cut = CHUNK;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

async function handleAiChat(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) return bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
  if (!hasPermission(user.role, 'ai.assistant')) return bot.sendMessage(chatId, '⛔️ این بخش فقط برای ادمین است.');
  if (!agent.isEnabled()) return bot.sendMessage(chatId, 'ایجنت هوش مصنوعی فعال نیست (تنظیمات AI_* در .env).');
  session.start(chatId, 'ai_chat', { history: [] });
  return bot.sendMessage(chatId, '🤖 تحلیلگر هوشمند فعال شد. سؤالتان را بنویسید (مثلاً «گزارش تأخیر این ماه»).\nبرای خروج یکی از دکمه‌های «📂 منو» را بزنید؛ بعد از ۱۰ دقیقه بی‌پاسخی هم پایان می‌یابد.');
}

async function handleAiText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user || !hasPermission(user.role, 'ai.assistant')) { session.clear(chatId); return null; }
  if (limited(user.id)) return bot.sendMessage(chatId, 'تعداد پرسش‌ها زیاد است؛ یک دقیقه صبر کنید.');
  const history = sess.data.history;
  history.push({ role: 'user', content: String(msg.text).slice(0, 2000) });
  while (history.length > MAX_TURNS) history.shift();
  session.update(chatId, {});
  try { await bot.sendChatAction(chatId, 'typing'); } catch (_) { /* بی‌اهمیت */ }
  try {
    const out = await agent.chat({ adminUser: user, messages: history });
    history.push({ role: 'assistant', content: out.reply });
    try { auditRepository.logEvent({ userId: user.id, action: 'ai_assistant_query', details: { via: 'telegram', question: String(msg.text).slice(0, 300), tools: out.tools.map((t) => t.name), tokens: out.usage } }); } catch (_) { /* بهترین‌تلاش */ }
    for (const part of split(out.reply)) await bot.sendMessage(chatId, part);
    for (const p of out.pending || []) {
      await bot.sendMessage(chatId, `${p.summary}\n\n(۱۵ دقیقه مهلت)`, { reply_markup: { inline_keyboard: [[{ text: '✅ تأیید و اجرا', callback_data: `aic:${p.id}` }, { text: '✖ لغو', callback_data: `aix:${p.id}` }]] } });
    }
    for (const f of out.files || []) {
      const e = takeExport(user.id, f.token);
      if (e) await bot.sendDocument(chatId, fs.createReadStream(e.file), {}, { filename: e.name, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
  } catch (err) {
    history.pop();
    const known = err instanceof agent.AiAgentError;
    if (!known) console.error('[bot][ai] خطا:', err.message);
    return bot.sendMessage(chatId, `⚠️ ${known ? err.message : 'سرویس هوش مصنوعی خطا داد.'}`);
  }
  return null;
}

async function handleAiCallback(bot, query) {
  const data = String(query.data || '');
  const user = getRegisteredUser(query.from.id);
  if (!user || !hasPermission(user.role, 'ai.assistant')) return bot.answerCallbackQuery(query.id, { text: 'مجاز نیستید.', show_alert: true });
  const verb = data.startsWith('aic:') ? 'confirm' : 'cancel';
  const id = Number(data.slice(4));
  let text;
  try {
    const r = verb === 'confirm' ? actions.confirm(user, id) : actions.cancel(user, id);
    text = (verb === 'confirm' ? '✅ ' : '✖ ') + r.message;
  } catch (err) {
    if (!(err instanceof actions.ActionError)) throw err;
    text = `⚠️ ${err.message}`;
  }
  try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id }); } catch (_) { /* قدیمی */ }
  await bot.answerCallbackQuery(query.id);
  return bot.sendMessage(query.message.chat.id, text);
}

module.exports = { handleAiChat, handleAiText, handleAiCallback, split };
