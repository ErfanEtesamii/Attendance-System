// داشبورد دورکاری بات: تمام داده‌های حساس هر بار از DB خوانده می‌شود و callback_data فقط شناسه‌ی کمکی است.
const session = require('../session');
const { cb } = require('../ui/pickers');
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const remoteWork = require('../../services/remoteWorkService');
const gate = require('../../services/remoteWorkGate');
const report = require('../../services/remoteTaskReportService');
const audit = require('../../repositories/auditRepository');
const rate = require('../../repositories/rateLimitRepository');
const panelLinks = require('../panelLinks');
const { formatMinutes } = require('../../utils/workHours');

const line = '━━━━━━━━━━━━━━';
const time = (iso) => new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
const button = (text, data, style) => ({ text, callback_data: cb(data), ...(style ? { style } : {}) });
const duration = (from, now) => Math.max(0, Math.floor((new Date(now) - new Date(from)) / 60000));
const sessionBreakMinutes = (s) => (s.breaks || []).reduce((n, b) => (b.end_at ? n + duration(b.start_at, b.end_at) : n), 0);

function buildView(state, access, now = new Date()) {
  const open = state.openSession;
  if (!open && !access.ok) {
    const rows = [];
    if ((access.code === 'ONSITE_TODAY' || access.code === 'ONSITE_OPEN' || access.code === 'MISSION_TODAY') && panelLinks.canUseWebApp(panelLinks.miniAppLink())) {
      rows.push([{ text: '🕒 ثبت تردد', web_app: { url: panelLinks.miniAppLink() } }, button('📊 وضعیت من', 'mn:status')]);
    }
    rows.push([button('🏠 منوی اصلی', 'rw:m')]);
    return { text: `🏠 دورکاری\n${line}\n⛔️ ${access.error}`, reply_markup: { inline_keyboard: rows } };
  }
  if (!open) {
    const closed = state.sessions.filter((s) => s.end_at);
    const fa = (n) => n.toLocaleString('fa-IR');
    const dur = (mins) => { const h = Math.floor(mins / 60); const m = mins % 60; return h && m ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : h ? `${fa(h)} ساعت` : `${fa(m)} دقیقه`; };
    const net = (s) => { const g = duration(s.start_at, s.end_at); const b = Math.min(g, sessionBreakMinutes(s)); return { g, b, u: g - b }; };
    const blocks = closed.map((s, i) => {
      const { b, u } = net(s);
      return [`🔹 ثبت ${fa(i + 1)}`, `   🟢 شروع: ${time(s.start_at)}`, `   🔴 پایان: ${time(s.end_at)}`, `   ☕ استراحت: ${b ? dur(b) : 'بدون استراحت'}`, `   ✅ مفید: ${dur(u)}`].join('\n');
    });
    const tot = closed.reduce((t, s) => { const n = net(s); return { g: t.g + n.g, b: t.b + n.b, u: t.u + n.u }; }, { g: 0, b: 0, u: 0 });
    const summary = closed.length ? [line, `📊 مجموع امروز (${fa(closed.length)} ثبت)`, `   ⏱ کل: ${dur(tot.g)}`, `   ☕ استراحت: ${tot.b ? dur(tot.b) : 'بدون استراحت'}`, `   ✅ مفید: ${dur(tot.u)}`] : [];
    return { text: ['🏠 دورکاری', line, 'وضعیت: ⚪️ دورکاری شروع نشده', ...(blocks.length ? ['', blocks.join('\n\n')] : []), ...summary, line, '⏳ تأییدنشده — پس از بررسی و تأیید سرپرست در حساب شما لحاظ می‌شود.'].join('\n'), reply_markup: { inline_keyboard: [[button('🟢 شروع دورکاری', 'rw:s', 'success')], [button('📋 سوابق من', 'rw:h'), button('🔄 به‌روزرسانی', 'rw:o')], [button('🏠 منوی اصلی', 'rw:m')]] } };
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

// ---------- گزارش تسک‌ها هنگام پایان دورکاری (flow = remote_end) ----------
// مراحل: عنوان تسک (متن) ← مدت (دکمه یا متن: ۴۵ | ۱:۳۰ | ۲ ساعت) ← «تسک بعدی» یا «ثبت و پایان». اعتبارسنجی و ثبت نهایی در remoteTaskReportService.
const FLOW_END = 'remote_end';
const FLOW_REVISE = 'remote_revise'; // اصلاح تسک‌ها پس از ردِ ادمین؛ data.sessionId = نشستِ ردشده
const isFlow = (sess) => !!sess && (sess.flow === FLOW_END || sess.flow === FLOW_REVISE);
const QUICK = [15, 30, 45, 60, 90, 120];
const fa = (n) => Number(n).toLocaleString('fa-IR');

function netNow(sess, now) {
  if (sess.flow === FLOW_REVISE) { const r = require('../../repositories/remoteWorkRepository').findSessionFull(sess.data.sessionId); return r && r.end_at ? report.netMinutes(r, r.end_at).net : 0; }
  const open = remoteWork.getToday(sess.data.userId, { now }).openSession;
  return open ? report.netMinutes({ id: open.id, start_at: open.start_at }, now).net : 0;
}
function listText(tasks) { return tasks.map((t, i) => `${fa(i + 1)}) ${t.title} — ${report.faDuration(t.minutes)}`).join('\n'); }
function summaryView(sess, now, note) {
  const tasks = sess.data.tasks; const net = netNow(sess, now); const total = tasks.reduce((n, t) => n + t.minutes, 0);
  const cov = report.requirements().coveragePercent; const need = Math.ceil((net * cov) / 100);
  const revise = sess.flow === FLOW_REVISE;
  const lines = [revise ? '✏️ اصلاح تسک‌های دورکاری (پس از رد)' : '🔴 پایان دورکاری', line, ...(note ? [note, ''] : []), tasks.length ? listText(tasks) : 'هنوز تسکی ثبت نشده است.', line,
    `⏱ جمع تسک‌ها: ${report.faDuration(total)} | ساعت خالص دورکاری: ${report.faDuration(net)}`];
  if (need > 0) lines.push(total >= need ? '✅ پوشش زمان کافی است.' : `⚠️ دست‌کم ${report.faDuration(need)} باید با تسک توضیح داده شود (هنوز ${report.faDuration(need - total)} مانده).`);
  const rows = [[button('➕ تسک بعدی', 'rw:ta', 'primary')]];
  if (revise && tasks.length) rows.push(tasks.slice(0, 8).map((_, i) => button(`🗑 ${fa(i + 1)}`, `rw:td:${i}`, 'danger')));
  if (tasks.length) rows.push(revise ? [button('📨 ارسال مجدد برای ادمین', 'rw:ef', 'success')] : [button('🗑 حذف آخرین', 'rw:tu', 'danger'), button('✅ ثبت و پایان دورکاری', 'rw:ef', 'success')]);
  rows.push([button(revise ? '↩️ انصراف' : '↩️ انصراف (ادامه‌ی کار)', 'rw:ec')]);
  return { text: lines.join('\n'), reply_markup: { inline_keyboard: rows } };
}
async function askTitle(bot, chatId, sess) {
  session.update(chatId, { step: 1 });
  const n = sess.data.tasks.length;
  await bot.sendMessage(chatId, `📝 ${n ? 'تسک بعدی' : 'تسک اول'}\n${line}\nچه کاری انجام دادی؟ اسم/توضیح کوتاهش را بنویس (حداکثر ۱۲۰ نویسه).`, { reply_markup: { inline_keyboard: [[button('↩️ انصراف (ادامه‌ی کار)', 'rw:ec')]] } });
}

async function startEndFlow(bot, chatId, query, user, open, now) {
  session.start(chatId, FLOW_END, { userId: user.id, sessionId: open.id, tasks: [], title: null });
  const sess = session.get(chatId);
  const net = report.netMinutes({ id: open.id, start_at: open.start_at }, now).net;
  const cov = report.requirements().coveragePercent;
  await replace(bot, query, { text: ['🔴 پایان دورکاری', line, `ساعت خالص دورکاری تا الان: ${report.faDuration(net)}`, 'قبل از پایان، کارهایی را که انجام دادی یکی‌یکی بنویس و بگو هرکدام چقدر طول کشید.',
    cov ? `جمع زمان تسک‌ها باید دست‌کم ${fa(cov)}٪ این ساعت باشد و از آن بیشتر نشود.` : 'جمع زمان تسک‌ها نباید از این ساعت بیشتر شود.', 'این تسک‌ها در «برنامه امروز»ت و برای سرپرست ثبت می‌شوند.'].join('\n') });
  return askTitle(bot, chatId, sess);
}

async function startReviseFlow(bot, chatId, query, user, row, mode, now) {
  const tasks = require('../../repositories/remoteWorkRepository').listSessionTasks(row.id).map((t) => ({ title: t.title, minutes: t.minutes }));
  session.start(chatId, FLOW_REVISE, { userId: user.id, sessionId: row.id, tasks, title: null });
  const sess = session.get(chatId);
  session.update(chatId, { step: 3 });
  const hint = mode === 'add' ? '➕ تسک‌های جاافتاده را اضافه کن تا جمع زمان با ساعت دورکاری بخواند.' : '✂️ با دکمه‌های 🗑 تسک اضافه را حذف کن، یا حذف کن و دوباره با مدت درست بنویس.';
  const view = summaryView(session.get(chatId), now, [row.review_note ? `💬 دلیل ادمین: ${row.review_note}` : '', hint].filter(Boolean).join('\n'));
  if (mode === 'add') { await bot.sendMessage(chatId, view.text, { reply_markup: view.reply_markup }); return askTitle(bot, chatId, sess); }
  return bot.sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
}

async function handleRemoteEndText(bot, msg, sess) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user || user.id !== sess.data.userId) { session.clear(chatId); return; }
  const text = String(msg.text || '').trim();
  if (sess.step === 1) { // عنوان
    const title = text.replace(/\s+/g, ' ');
    if (!title || title.length > 120) return bot.sendMessage(chatId, 'عنوان باید بین ۱ تا ۱۲۰ نویسه باشد؛ دوباره بنویس.');
    session.update(chatId, { step: 2, data: { ...sess.data, title } });
    const rows = [QUICK.slice(0, 3), QUICK.slice(3)].map((r) => r.map((m) => button(report.faDuration(m), `rw:t:${m}`, 'primary')));
    rows.push([button('↩️ انصراف (ادامه‌ی کار)', 'rw:ec')]);
    return bot.sendMessage(chatId, `⏱ «${title}» چقدر از وقتت را گرفت؟\nیکی از دکمه‌ها را بزن یا مدت را بنویس (مثلاً ۴۰ یا ۱:۳۰ یا ۲ ساعت).`, { reply_markup: { inline_keyboard: rows } });
  }
  if (sess.step === 2) { // مدت (متنی)
    const minutes = report.parseMinutes(text);
    if (!minutes) return bot.sendMessage(chatId, 'مدت نامعتبر است؛ مثلاً ۴۰ (دقیقه) یا ۱:۳۰ یا ۲ ساعت بنویس.');
    return addTask(bot, chatId, sess, minutes);
  }
  return bot.sendMessage(chatId, 'برای ادامه از دکمه‌های زیر پیام قبلی استفاده کن.');
}

async function addTask(bot, chatId, sess, minutes) {
  const tasks = [...sess.data.tasks, { title: sess.data.title, minutes }];
  session.update(chatId, { step: 3, data: { ...sess.data, tasks, title: null } });
  const fresh = session.get(chatId);
  const view = summaryView(fresh, new Date(), `✅ ثبت شد: ${tasks[tasks.length - 1].title} — ${report.faDuration(minutes)}`);
  return bot.sendMessage(chatId, view.text, { reply_markup: view.reply_markup });
}

async function handleEndFlowCallback(bot, chat, query, user, data, now) {
  const chatId = chat.id;
  const sess = session.get(chatId);
  if (!sess || !isFlow(sess) || sess.data.userId !== user.id) { await bot.sendMessage(chatId, 'این مکالمه منقضی شده است؛ دوباره «🔴 پایان دورکاری» را بزن.'); return replace(bot, query, dashboard(user, now)); }
  if (data === 'rw:ec') { session.clear(chatId); return replace(bot, query, dashboard(user, now)); }
  const quick = /^rw:t:(\d+)$/.exec(data);
  if (quick) { if (sess.step !== 2 || !sess.data.title) return; return addTask(bot, chatId, sess, Number(quick[1])); }
  if (data === 'rw:ta') return askTitle(bot, chatId, sess);
  const del = /^rw:td:(\d+)$/.exec(data);
  if (del) {
    if (sess.flow !== FLOW_REVISE) return undefined;
    const tasks = sess.data.tasks.filter((_, i) => i !== Number(del[1])); session.update(chatId, { step: 3, data: { ...sess.data, tasks } });
    return replace(bot, query, summaryView(session.get(chatId), now, '🗑 تسک حذف شد.'));
  }
  if (data === 'rw:ef' && sess.flow === FLOW_REVISE) {
    const r = report.reviseAfterReject(user, sess.data.sessionId, sess.data.tasks, { ip: null, now, source: 'bot' });
    if (!r.ok) return replace(bot, query, summaryView(sess, now, `⛔️ ${r.error}`));
    session.clear(chatId);
    return replace(bot, query, { text: ['📨 دوباره برای ادمین ارسال شد', line, listText(r.tasks), line, `⏱ جمع تسک‌ها: ${report.faDuration(r.totalMinutes)}`, '⏳ منتظر بررسی ادمین بمان؛ نتیجه برایت اعلام می‌شود.'].join('\n'), reply_markup: { inline_keyboard: [[button('🏠 دورکاری', 'rw:o'), button('🏠 منوی اصلی', 'rw:m')]] } });
  }
  if (data === 'rw:tu') {
    const tasks = sess.data.tasks.slice(0, -1); session.update(chatId, { step: 3, data: { ...sess.data, tasks } });
    const view = summaryView(session.get(chatId), now, '🗑 آخرین تسک حذف شد.'); return replace(bot, query, view);
  }
  if (data === 'rw:ef') {
    const r = report.endWithTasks(user, sess.data.tasks, { ip: null, now, source: 'bot' });
    if (!r.ok) { const view = summaryView(sess, now, `⛔️ ${r.error}`); return replace(bot, query, view); }
    session.clear(chatId);
    const text = ['✅ دورکاری پایان یافت', line, listText(r.tasks), line, `⏱ جمع تسک‌ها: ${report.faDuration(r.totalMinutes)}`,
      '📋 گزارش ثبت شد؛ پس از تأیید سرپرست، تسک‌ها در برنامه‌ی هفتگی‌ات می‌نشینند.', '⏳ تأییدنشده — پس از بررسی سرپرست لحاظ می‌شود.'].join('\n');
    return replace(bot, query, { text, reply_markup: { inline_keyboard: [[button('🏠 دورکاری', 'rw:o'), button('🏠 منوی اصلی', 'rw:m')]] } });
  }
  return undefined;
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
  if (endId) {
    const open = state.openSession; if (!open || String(open.id) !== endId[2]) return show();
    if (report.requirements().required) return startEndFlow(bot, chat.id, query, user, open, now); // گزارش تسک‌ها پیش از پایان
    if (!endId[1]) return replace(bot, query, { text: `🔴 پایان دورکاری\n${line}\nشروع: ${time(open.start_at)} | مدت: ${formatMinutes(duration(open.start_at, now))}\n${state.openBreak ? '☕ استراحت بازِ شما هم همین حالا بسته می‌شود.\n' : ''}پایان بدهم؟`, reply_markup: { inline_keyboard: [[button('✅ بله، پایان بده', `rw:e!:${open.id}`, 'danger')], [button('↩️ ادامه‌ی کار', 'rw:x')]] } });
    const r = remoteWork.end(user, { ip: null, now, source: 'bot' }); if (!r.ok) return show(); return show();
  }
  const rv = /^rw:rv([ads]):(\d+)$/.exec(data);
  if (rv) {
    const row = require('../../repositories/remoteWorkRepository').findSessionFull(Number(rv[2]));
    if (!row || row.user_id !== user.id || row.status !== 'rejected') { await bot.sendMessage(chat.id, 'این دورکاری دیگر در وضعیت «ردشده» نیست (شاید قبلاً دوباره ارسال شده).'); return undefined; }
    if (rv[1] === 's') {
      const r = report.reviseAfterReject(user, row.id, null, { ip: null, now, source: 'bot' });
      if (!r.ok) { await bot.sendMessage(chat.id, `⛔️ ${r.error}`); return undefined; }
      return replace(bot, query, { text: ['📨 دوباره برای ادمین ارسال شد', line, listText(r.tasks), '⏳ منتظر بررسی ادمین بمان؛ نتیجه برایت اعلام می‌شود.'].join('\n'), reply_markup: { inline_keyboard: [[button('🏠 دورکاری', 'rw:o')]] } });
    }
    return startReviseFlow(bot, chat.id, query, user, row, rv[1] === 'a' ? 'add' : 'del', now);
  }
  if (data.startsWith('rw:t') || data === 'rw:ec' || data === 'rw:ef') return handleEndFlowCallback(bot, chat, query, user, data, now);
  return show();
}

module.exports = { handleRemoteWork, handleRemoteWorkCallback, handleRemoteEndText, buildView };
