// «📋 برنامه هفتگی»: انتخاب هفته (قبل / این هفته / بعد) با دکمه؛ با انتخاب هر کدام برنامه‌ی همان هفته به‌صورت متن می‌آید.
// داده از getMyWeek (همان نمای «برنامه‌ی من» در پنل) می‌آید؛ اینجا فقط قالب‌بندی پیام است.
// callback: wp:p (هفته‌ی قبل) · wp:c (این هفته) · wp:n (هفته‌ی بعد)
const { getRegisteredUser, notRegisteredMessage } = require('../auth');
const employeeWeekService = require('../../services/employeeWeekService');
const weeklyPlanService = require('../../services/weeklyPlanService');
const { addDays } = require('../../utils/shiftDay');
const panelLinks = require('../panelLinks');

const LINE = '━━━━━━━━━━━━━━';
const TELEGRAM_LIMIT = 3800; // کمی کمتر از سقف ۴۰۹۶ نویسه
const WHICH = { p: -7, c: 0, n: 7 };
const WHICH_TITLE = { p: 'هفته‌ی قبل', c: 'این هفته', n: 'هفته‌ی بعد' };
const STATUS = { done: ['✅', 'انجام شد'], partial: ['🟡', 'ناقص'], not_done: ['❌', 'انجام نشد'], no_answer: ['⏳', 'بدون پاسخ'] };
const DAY_ICON = { working: '🟢', half: '🌓', off: '⚪️', holiday: '🎉', leave: '🏖', mission: '🚗' };
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // ۰ = یکشنبه (مثل calendarService.weekdayOf)
const dayName = (w) => (typeof w === 'number' ? WEEKDAYS[w] || '' : w || '');
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/** ردیف دکمه‌های انتخاب هفته؛ active = هفته‌ای که الان نمایش داده می‌شود (✔︎ می‌گیرد). */
function weekButtons(active) {
  const b = (k) => ({ text: `${active === k ? '✅ ' : ''}${k === 'p' ? '⏮ ' : k === 'n' ? '⏭ ' : '📌 '}${WHICH_TITLE[k]}`, callback_data: `wp:${k}` });
  return [b('n'), b('c'), b('p')]; // چیدمان راست‌به‌چپ: قبل | این | بعد
}

function keyboard(active) {
  const rows = [weekButtons(active)];
  const planUrl = panelLinks.miniAppLink({ view: 'plan' });
  if (panelLinks.canUseWebApp(planUrl)) rows.push([{ text: '✏️ ثبت / ویرایش برنامه', web_app: { url: planUrl }, style: 'primary' }]);
  rows.push([{ text: '🏠 منوی اصلی', callback_data: 'fl:h' }]);
  return { inline_keyboard: rows };
}

/** پیام(های) متنی برنامه‌ی یک هفته. خروجی: آرایه‌ی رشته (هر کدام کمتر از سقف تلگرام). */
function formatWeek(week, title) {
  const w = week.week || {};
  const head = [`📋 برنامه‌ی ${title}`, `🗓 ${fa(w.jalaliStart || '')} تا ${fa(w.jalaliEnd || '')}`, LINE];
  const blocks = [];
  for (const d of week.days || []) {
    const tasks = (d.tasks || []).filter((t) => !t.deleted);
    const sched = d.schedule && d.schedule.start && d.schedule.end ? ` ⏰ ${fa(d.schedule.start)}–${fa(d.schedule.end)}` : '';
    const today = d.isToday ? ' 📍امروز' : '';
    const lines = [`${DAY_ICON[d.kind] || '▫️'} ${dayName(d.weekday)} ${fa(d.jalali || '')}${today}`, `   ${d.kindLabel || ''}${sched}`];
    if (d.kind === 'holiday' && d.holidayTitle) lines.push(`   🎉 ${d.holidayTitle}`);
    if (!tasks.length) {
      if (d.kind === 'working' || d.kind === 'half') lines.push('   ▫️ تسکی ثبت نشده');
    } else {
      for (const t of tasks) {
        const [icon, label] = STATUS[t.status] || ['▫️', ''];
        const pre = t.isUrgent ? '⚡ ' : '';
        lines.push(`   ${icon} ${pre}${t.title || ''}${label && (d.isFuture ? false : true) ? ` — ${label}` : ''}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  const t = (week.summary || {}).tasks || {};
  const total = (t.done || 0) + (t.partial || 0) + (t.notDone || 0) + (t.noAnswer || 0);
  const foot = total
    ? [LINE, `📊 خلاصه: ✅ ${fa(t.done || 0)} انجام‌شده · 🟡 ${fa(t.partial || 0)} ناقص · ❌ ${fa(t.notDone || 0)} انجام‌نشده · ⏳ ${fa(t.noAnswer || 0)} بدون پاسخ`].join('\n')
    : `${LINE}\n📊 هنوز تسکی برای این هفته ثبت نشده است.`;

  // تقسیم به پیام‌های کوچک‌تر از سقف تلگرام (فقط بین بلوک‌های روز)
  const messages = [];
  let cur = head.join('\n');
  const pieces = [];
  for (const blk of [...blocks, foot]) {
    if (blk.length <= TELEGRAM_LIMIT) { pieces.push(blk); continue; }
    let part = '';
    for (const line of blk.split('\n')) { // روزِ خیلی شلوغ: بین خط‌ها تقسیم می‌شود
      if (part && part.length + line.length + 1 > TELEGRAM_LIMIT) { pieces.push(part); part = line; } else part += `${part ? '\n' : ''}${line}`;
    }
    if (part) pieces.push(part);
  }
  for (const blk of pieces) {
    if (cur.length + blk.length + 2 > TELEGRAM_LIMIT) { messages.push(cur); cur = blk; } else cur += `\n\n${blk}`;
  }
  messages.push(cur);
  return messages;
}

function weekStartFor(which, now = new Date()) {
  const ctx = weeklyPlanService.context(now);
  return addDays(ctx.thisWeek, WHICH[which]);
}

async function handleWeeklyPlan(bot, msg) {
  const chatId = msg.chat.id;
  const user = getRegisteredUser(msg.from.id);
  if (!user) {
    await bot.sendMessage(chatId, notRegisteredMessage(msg.from.id), { parse_mode: 'Markdown' });
    return;
  }
  await bot.sendMessage(chatId, `📋 برنامه هفتگی\n${LINE}\nبرنامه‌ی کدام هفته را می‌خواهید؟ 👇`, { reply_markup: keyboard(null) });
}

async function handleWeeklyPlanCallback(bot, query) {
  const chat = query.message && query.message.chat;
  const user = query.from ? getRegisteredUser(query.from.id) : null;
  const which = String(query.data || '').slice(3);
  if (!chat || chat.type !== 'private' || !user) {
    await bot.answerCallbackQuery(query.id, { text: 'شما در سیستم ثبت نیستید.', show_alert: true });
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(WHICH, which)) {
    await bot.answerCallbackQuery(query.id, { text: 'این دکمه منقضی شده، منو را باز کنید.', show_alert: true });
    return;
  }
  const result = employeeWeekService.getMyWeek(user, { start: weekStartFor(which) });
  if (!result.ok) {
    await bot.answerCallbackQuery(query.id, { text: result.error || 'برنامه‌ی این هفته در دسترس نیست.', show_alert: true });
    return;
  }
  await bot.answerCallbackQuery(query.id);
  const parts = formatWeek(result, WHICH_TITLE[which]);
  for (let i = 0; i < parts.length; i += 1) {
    const last = i === parts.length - 1;
    await bot.sendMessage(chat.id, parts[i], last ? { reply_markup: keyboard(which) } : undefined);
  }
}

module.exports = { handleWeeklyPlan, handleWeeklyPlanCallback, formatWeek, weekStartFor, keyboard };
