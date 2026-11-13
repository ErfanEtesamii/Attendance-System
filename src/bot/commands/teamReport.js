// «👥 گزارش تیم»: تیم‌ها (ادمین: هر سرپرست یک تیم؛ سرپرست: فقط تیم خودش) ← اعضا ← گزارش به‌صورت «فایل متنی».
//   tr:t:<سرپرست|0> فهرست اعضای یک تیم · tr:a:<سرپرست|0> گزارش کل تیم · tr:u:<کاربر> گزارش یک نفر · tr:b بازگشت به تیم‌ها
// قواعد: نقش و اسکوپ هر بار از دیتابیس خوانده می‌شود (سرپرست فقط زیردستان مستقیم؛ ادمین همه به‌جز خودش)؛
// گزارش هفته از همان getWeek پنل می‌آید (اسکوپ را خودِ سرویس هم چک می‌کند).
const { getRegisteredUser, notRegisteredMessage, hasRole } = require('../auth');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const employeeWeekService = require('../../services/employeeWeekService');
const weeklyPlan = require('./weeklyPlan');
const ui = require('../ui/pickers');
const { summarizeRange } = require('../../engine/dayService');
const { formatMinutes } = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { jalaliMonthToDateRange, isoDateToJalaliString } = require('../../utils/jalali');
const { isAdmin } = require('../../utils/roles');

const LINE = '━━━━━━━━━━━━━━';
const NO_MANAGER = 0;
const { faDigits } = ui;
const btn = (text, data, style) => ({ text, callback_data: ui.cb(data), ...(style ? { style } : {}) });
const rtl = (row) => row.slice().reverse();

function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** تیم‌های قابل‌دیدن برای viewer: [{ key, name, members[] }] (فقط اعضای فعال). */
function teamsFor(viewer) {
  const active = usersRepository.listUsers({ onlyActive: true }).filter((u) => u.id !== viewer.id);
  if (!isAdmin(viewer)) return [{ key: viewer.id, name: viewer.full_name, members: active.filter((u) => u.manager_id === viewer.id) }].filter((t) => t.members.length);
  const byManager = new Map();
  for (const u of active) {
    const key = u.manager_id && usersRepository.findById(u.manager_id) ? u.manager_id : NO_MANAGER;
    if (!byManager.has(key)) byManager.set(key, []);
    byManager.get(key).push(u);
  }
  const teams = [];
  for (const [key, members] of byManager) {
    const mgr = key === NO_MANAGER ? null : usersRepository.findById(key);
    teams.push({ key, name: mgr ? mgr.full_name : 'بدون سرپرست', members });
  }
  return teams.sort((a, b) => (a.key === NO_MANAGER) - (b.key === NO_MANAGER) || a.name.localeCompare(b.name, 'fa'));
}

const teamOf = (viewer, key) => teamsFor(viewer).find((t) => t.key === key) || null;

// ---------------------------------------------------------------------------------------------------------------------
// متن گزارش (خالص)
// ---------------------------------------------------------------------------------------------------------------------

function attendanceBlock(member) {
  const today = todayDateString();
  const month = jalaliMonthToDateRange();
  const week = summarizeRange(attendanceRepository.listByUserAndRange(member.id, daysAgoDateString(6), today));
  const mon = summarizeRange(attendanceRepository.listByUserAndRange(member.id, month.from, month.to));
  return {
    week, mon, monthLabel: month.label,
    lines: [
      '🗓 هفت روز اخیر:',
      `  ساعت مفید کاری: ${formatMinutes(week.totalEffective)}`,
      `  تأخیر: ${week.lateCount} | خروج زودهنگام: ${week.earlyLeaveCount} | رکورد ناقص: ${week.incompleteCount}`,
      '',
      `📆 از ابتدای ${month.label} تا امروز:`,
      `  ساعت مفید کاری: ${formatMinutes(mon.totalEffective)}`,
      `  تأخیر: ${mon.lateCount} | خروج زودهنگام: ${mon.earlyLeaveCount} | رکورد ناقص: ${mon.incompleteCount}`,
    ],
  };
}

/** گزارش کامل یک نفر: حضور (هفته/ماه) + برنامه و وضعیت تسک‌های هفته‌ی جاری. */
function buildMemberReport(viewer, member) {
  const a = attendanceBlock(member);
  const lines = [`📊 گزارش ${member.full_name}`, `تاریخ گزارش: ${isoDateToJalaliString(todayDateString()) || todayDateString()}`, LINE, ...a.lines, '', LINE];
  const wk = employeeWeekService.getWeek(viewer, member.id, {});
  if (wk.ok) lines.push(...weeklyPlan.formatWeek(wk, 'این هفته').join('\n\n').split('\n'));
  else lines.push('برنامه‌ی هفته در دسترس نیست.');
  return lines.join('\n');
}

/** گزارش خلاصه‌ی کل تیم: برای هر عضو یک بلوک کوتاه. */
function buildTeamReport(viewer, team) {
  const lines = [`👥 گزارش تیم ${team.name} — ${team.members.length} نفر`, `تاریخ گزارش: ${isoDateToJalaliString(todayDateString()) || todayDateString()}`, LINE];
  for (const m of team.members) {
    const a = attendanceBlock(m);
    const wk = employeeWeekService.getWeek(viewer, m.id, {});
    const t = wk.ok ? (wk.summary || {}).tasks || {} : null;
    lines.push(
      '', `👤 ${m.full_name}`,
      `  ⏱ ۷ روز: ${formatMinutes(a.week.totalEffective)} | تأخیر: ${a.week.lateCount} | ناقص: ${a.week.incompleteCount}`,
      `  📆 ${a.monthLabel}: ${formatMinutes(a.mon.totalEffective)} | تأخیر: ${a.mon.lateCount}`,
      t ? `  📋 تسک‌های هفته: ✅ ${t.done || 0} · 🟡 ${t.partial || 0} · ❌ ${t.notDone || 0} · ⏳ ${t.noAnswer || 0}` : '  📋 تسک‌های هفته: در دسترس نیست',
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// صفحه‌ها
// ---------------------------------------------------------------------------------------------------------------------

function teamsView(viewer) {
  const teams = teamsFor(viewer);
  if (!teams.length) return { text: '👥 گزارش تیم\nهیچ کارمند فعالی برای گزارش‌گیری یافت نشد.', markup: { inline_keyboard: [[btn('🏠 منوی اصلی', ui.CB.HOME)]] } };
  const buttons = teams.map((t) => btn(`👥 ${t.name} (${faDigits(t.members.length)})`, `tr:t:${t.key}`, 'primary'));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(rtl(buttons.slice(i, i + 2)));
  rows.push([btn('🏠 منوی اصلی', ui.CB.HOME)]);
  return { text: `👥 گزارش تیم\n${LINE}\nگزارش کدام تیم را می‌خواهید؟ 👇`, markup: { inline_keyboard: rows } };
}

function membersView(viewer, team, { canGoBack }) {
  const rows = [[btn(`📦 گزارش کل تیم (${faDigits(team.members.length)} نفر)`, `tr:a:${team.key}`, 'success')]];
  const people = team.members.map((m) => btn(ui.employeeLabel(m), `tr:u:${m.id}`));
  for (let i = 0; i < people.length; i += 2) rows.push(rtl(people.slice(i, i + 2)));
  const nav = [];
  if (canGoBack) nav.push(btn('🔙 تیم‌ها', 'tr:b'));
  nav.push(btn('🏠 منوی اصلی', ui.CB.HOME));
  rows.push(nav);
  return { text: `👥 تیم ${team.name}\n${LINE}\nگزارش کدام عضو را می‌خواهید؟ (به‌صورت فایل متنی ارسال می‌شود) 👇`, markup: { inline_keyboard: rows } };
}

async function show(bot, query, view) {
  if (query && query.message && typeof bot.editMessageText === 'function') {
    try {
      await bot.editMessageText(view.text, { chat_id: query.message.chat.id, message_id: query.message.message_id, reply_markup: view.markup });
      return;
    } catch (err) {
      if (/not modified/i.test(err.message || '')) return;
    }
  }
  await bot.sendMessage(query.message.chat.id, view.text, { reply_markup: view.markup });
}

async function sendReportFile(bot, chatId, text, name, caption) {
  const buffer = Buffer.from(`\uFEFF${text}\n`, 'utf8'); // BOM: نوت‌پد ویندوز فارسی را درست نشان بدهد
  await bot.sendDocument(chatId, buffer, { caption }, { filename: `${name}-${todayDateString()}.txt`, contentType: 'text/plain' });
}

async function handleTeamReport(bot, msg) {
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
  const teams = teamsFor(user);
  if (teams.length === 1) { // یک تیم بیشتر نیست (سرپرست) ⇒ مستقیم اعضا
    const v = membersView(user, teams[0], { canGoBack: false });
    await bot.sendMessage(chatId, v.text, { reply_markup: v.markup });
    return;
  }
  const v = teamsView(user);
  await bot.sendMessage(chatId, v.text, { reply_markup: v.markup });
}

async function handleTeamReportCallback(bot, query) {
  const chat = query.message && query.message.chat;
  const viewer = query.from ? getRegisteredUser(query.from.id) : null;
  if (!chat || chat.type !== 'private' || !viewer) {
    await bot.answerCallbackQuery(query.id, { text: 'شما در سیستم ثبت نیستید.', show_alert: true });
    return;
  }
  if (!hasRole(viewer, ['admin', 'manager'])) {
    await bot.answerCallbackQuery(query.id, { text: '⛔️ این گزینه برای نقش شما در دسترس نیست.', show_alert: true });
    return;
  }
  const [, action, arg] = String(query.data || '').split(':');
  const expired = () => bot.answerCallbackQuery(query.id, { text: ui.EXPIRED_TEXT, show_alert: true });
  const multi = isAdmin(viewer) && teamsFor(viewer).length > 1;

  if (action === 'b') {
    await bot.answerCallbackQuery(query.id);
    return show(bot, query, teamsView(viewer));
  }
  if (action === 't' || action === 'a') {
    const key = Number(arg);
    const team = Number.isInteger(key) && key >= 0 ? teamOf(viewer, key) : null;
    if (!team) return expired();
    if (action === 't') {
      await bot.answerCallbackQuery(query.id);
      return show(bot, query, membersView(viewer, team, { canGoBack: multi }));
    }
    await bot.answerCallbackQuery(query.id, { text: '⏳ در حال ساخت فایل گزارش…' });
    return sendReportFile(bot, chat.id, buildTeamReport(viewer, team), `team-report-${team.key}`, `👥 گزارش تیم ${team.name} (${faDigits(team.members.length)} نفر)`);
  }
  if (action === 'u') {
    const id = Number(arg);
    const member = Number.isInteger(id) ? usersRepository.findById(id) : null;
    const allowed = member && teamsFor(viewer).some((t) => t.members.some((m) => m.id === member.id)); // اسکوپ سمت سرور
    if (!allowed) return expired();
    await bot.answerCallbackQuery(query.id, { text: '⏳ در حال ساخت فایل گزارش…' });
    return sendReportFile(bot, chat.id, buildMemberReport(viewer, member), `report-${member.id}`, `📊 گزارش ${member.full_name}`);
  }
  return expired();
}

module.exports = { handleTeamReport, handleTeamReportCallback, teamsFor, buildMemberReport, buildTeamReport };
