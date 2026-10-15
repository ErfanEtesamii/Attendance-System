// E3 (فاز ۱۰): قطعه‌های UI مشترکِ جریان‌های چندمرحله‌ای بات — انتخاب با دکمه به‌جای تایپ.
//   • navRows / withNav: ردیف «❌ انصراف | 🏠 منوی اصلی» (+ «⏭ رد شدن» برای فیلد اختیاری) زیر هر مرحله.
//   • askDate: تقویم شمسی inline (ماه قبل/بعد) + دکمه‌های سریع («امروز / فردا / …»)؛ مقدار به‌صورت تاریخ میلادی YYYY-MM-DD می‌رود.
//   • askTime: ساعت در بازه‌های ۳۰ دقیقه‌ای (۴ صفحه‌ی ۶ ساعته).
//   • askEmployee: فهرست صفحه‌بندی‌شده‌ی کارمندان (+ «بدون سرپرست» اختیاری).
//   • askText: مرحله‌ی متن آزاد (فقط همین‌ها تایپ می‌مانند)، با دکمه‌ی «رد شدن» اگر فیلد اختیاری باشد.
// وضعیت هر مرحله‌ی «انتخابی» در session.data.pick نگه‌داری می‌شود (همراه شماره‌ی مرحله)؛ دکمه‌ی یک مرحله‌ی قدیمی که session
// دیگر در آن مرحله نیست ⇒ «این دکمه منقضی شده، منو را باز کنید». پردازش callbackها در ui/pickerRouter.js است.
// همه‌ی callback_dataها ≤ ۶۴ بایت (cb() در لحظه‌ی ساخت بررسی می‌کند).
// تاریخ داخلی همیشه میلادی YYYY-MM-DD (همان قالبی که leaveService/دیتابیس می‌خواهد)؛ نمایش به کاربر شمسی است.

const session = require('../session');
const usersRepository = require('../../repositories/usersRepository');
const { todayDateString } = require('../../utils/serverTime');
const { addDays } = require('../../utils/shiftDay');
const { MONTH_NAMES, jalaliPartsOfDateString, jalaliMonthRangeOf, jalaliMonthDates } = require('../../utils/jalali');

const CB = { CANCEL: 'fl:x', HOME: 'fl:h', SKIP: 'fl:s', NOOP: 'dp:n' };
const EXPIRED_TEXT = 'این دکمه منقضی شده، منو را باز کنید.';
const WEEKDAY_NAMES = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const WEEKDAY_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const EMP_PAGE_SIZE = 8;
const TIME_PAGES = [
  { label: '🌙 ۰۰–۰۶', from: 0 },
  { label: '🌅 ۰۶–۱۲', from: 6 },
  { label: '☀️ ۱۲–۱۸', from: 12 },
  { label: '🌆 ۱۸–۲۴', from: 18 },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** callback_data را تحویل می‌دهد و اگر از ۶۴ بایت بیشتر باشد خطا می‌دهد (تلگرام آن را رد می‌کند). */
function cb(data) {
  if (Buffer.byteLength(data, 'utf8') > 64) throw new Error(`callback_data بیش از ۶۴ بایت است: ${data}`);
  return data;
}

const btn = (text, data) => ({ text, callback_data: cb(data) });
const rtl = (row) => row.slice().reverse(); // کیبورد تلگرام چپ‌به‌راست چیده می‌شود؛ تقویم شمسی از راست شروع می‌شود
const faDigits = (value) => String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

// ---------------------------------------------------------------------------------------------------------------------
// تاریخ
// ---------------------------------------------------------------------------------------------------------------------

function isIsoDate(str) {
  return typeof str === 'string' && DATE_RE.test(str) && jalaliPartsOfDateString(str) !== null;
}

/** اندیس روز هفته با شنبه = ۰ … جمعه = ۶ */
function weekdayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
}

/** «دوشنبه ۱۴ دی ۱۴۰۵» */
function formatJalali(iso) {
  const p = jalaliPartsOfDateString(iso);
  if (!p) return String(iso);
  return `${WEEKDAY_NAMES[weekdayIndex(iso)]} ${faDigits(p.jd)} ${MONTH_NAMES[p.jm - 1]} ${faDigits(p.jy)}`;
}

/** «دوشنبه ۱۴ دی ۱۴۰۵ (2027-01-04)» — برای پیام تأییدِ انتخاب */
function describeDate(iso) {
  return `${formatJalali(iso)} (${iso})`;
}

function shiftMonth(jy, jm, delta) {
  const index = jy * 12 + (jm - 1) + delta;
  return { jy: Math.floor(index / 12), jm: (index % 12) + 1 };
}

function inRange(iso, min, max) {
  return (!min || iso >= min) && (!max || iso <= max);
}

/** سطرهای تقویم یک ماه شمسی. pick = { jy, jm, min, max, quick:[{text,date}] } */
function calendarRows(pick, today = todayDateString()) {
  const { jy, jm, min = null, max = null, quick = [] } = pick;
  const rows = [];

  const quickBtns = quick.filter((q) => isIsoDate(q.date) && inRange(q.date, min, max)).map((q) => btn(q.text, `dp:d:${q.date}`));
  if (quickBtns.length) rows.push(quickBtns);

  const prev = shiftMonth(jy, jm, -1);
  const next = shiftMonth(jy, jm, 1);
  const prevOk = !min || jalaliMonthRangeOf(prev.jy, prev.jm).to >= min;
  const nextOk = !max || jalaliMonthRangeOf(next.jy, next.jm).from <= max;
  rows.push(rtl([
    prevOk ? btn('▸ ماه قبل', `dp:m:${prev.jy}:${prev.jm}`) : btn(' ', CB.NOOP),
    btn(`${MONTH_NAMES[jm - 1]} ${faDigits(jy)}`, CB.NOOP),
    nextOk ? btn('ماه بعد ◂', `dp:m:${next.jy}:${next.jm}`) : btn(' ', CB.NOOP),
  ]));
  rows.push(rtl(WEEKDAY_SHORT.map((w) => btn(w, CB.NOOP))));

  const dates = jalaliMonthDates(jy, jm);
  const cells = Array(weekdayIndex(dates[0])).fill(null).concat(dates);
  while (cells.length % 7 !== 0) cells.push(null);
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(rtl(cells.slice(i, i + 7).map((iso) => {
      if (!iso) return btn(' ', CB.NOOP);
      const jd = jalaliPartsOfDateString(iso).jd;
      if (!inRange(iso, min, max)) return btn('·', CB.NOOP);
      return btn(iso === today ? `•${faDigits(jd)}` : faDigits(jd), `dp:d:${iso}`);
    })));
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// ساعت
// ---------------------------------------------------------------------------------------------------------------------

function isTime(str) {
  return typeof str === 'string' && TIME_RE.test(str);
}

/** همه‌ی اسلات‌های ۳۰ دقیقه‌ای یک صفحه (۱۲ تا) که بعد از `after` (انحصاری) باشند. */
function timeSlots(page, after = null) {
  const start = TIME_PAGES[page].from;
  const out = [];
  for (let h = start; h < start + 6; h += 1) {
    for (const m of ['00', '30']) {
      const t = `${String(h).padStart(2, '0')}:${m}`;
      if (!after || t > after) out.push(t);
    }
  }
  return out;
}

/** صفحه‌ی پیش‌فرض: بعد از `after` اولین اسلاتِ موجود؛ بدون آن، صفحه‌ی ۰۶–۱۲ (ساعت‌های کاری). */
function defaultTimePage(after = null) {
  if (!after) return 1;
  for (let p = 0; p < TIME_PAGES.length; p += 1) if (timeSlots(p, after).length) return p;
  return TIME_PAGES.length - 1;
}

function timeRows(pick) {
  const page = Math.min(Math.max(Number(pick.page) || 0, 0), TIME_PAGES.length - 1);
  const slots = timeSlots(page, pick.after || null);
  const rows = [TIME_PAGES.map((p, i) => btn(i === page ? `✅ ${p.label}` : p.label, `tp:p:${i}`))];
  if (!slots.length) rows.push([btn('در این بازه ساعتی نیست', CB.NOOP)]);
  for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4).map((t) => btn(t, `tp:t:${t.replace(':', '')}`)));
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// کارمند
// ---------------------------------------------------------------------------------------------------------------------

/**
 * filter: 'any' (همه‌ی کاربران؛ فعال‌ها اول) | 'managers' (کاربر فعالِ سرپرست یا ادمین)
 *   | 'urgent_targets' (E3: کارمندان فعالِ قابل‌دریافتِ تسک فوری؛ actorId ادمین ⇒ همه به‌جز خودش، سرپرست ⇒ فقط زیردستان مستقیم)
 */
function candidateUsers(filter, pick = {}) {
  let list = usersRepository.listUsers({});
  if (filter === 'urgent_targets') {
    const actor = pick && pick.actorId ? usersRepository.findById(pick.actorId) : null;
    list = list.filter((u) => u.is_active && actor && u.id !== actor.id && (actor.role === 'admin' || (actor.role === 'manager' && u.manager_id === actor.id)));
  } else if (filter === 'managers') list = list.filter((u) => u.is_active && ['manager', 'admin'].includes(u.role));
  return list.sort((a, b) => (Number(b.is_active) - Number(a.is_active)) || String(a.full_name).localeCompare(String(b.full_name), 'fa'));
}

function employeeLabel(u) {
  const role = u.role === 'manager' ? ' — سرپرست' : u.role === 'admin' ? ' — ادمین' : '';
  return `${u.is_active ? '' : '🔴 '}${u.full_name}${role}`.slice(0, 48);
}

function employeeRows(pick) {
  const all = candidateUsers(pick.filter || 'any', pick);
  const pages = Math.max(1, Math.ceil(all.length / EMP_PAGE_SIZE));
  const page = Math.min(Math.max(Number(pick.page) || 0, 0), pages - 1);
  const rows = all.slice(page * EMP_PAGE_SIZE, (page + 1) * EMP_PAGE_SIZE).map((u) => [btn(employeeLabel(u), `ep:u:${u.id}`)]);
  if (!all.length) rows.push([btn('کاربری برای انتخاب نیست', CB.NOOP)]);
  if (pages > 1) {
    rows.push(rtl([
      page > 0 ? btn('▸ قبلی', `ep:p:${page - 1}`) : btn(' ', CB.NOOP),
      btn(`${faDigits(page + 1)} از ${faDigits(pages)}`, CB.NOOP),
      page < pages - 1 ? btn('بعدی ◂', `ep:p:${page + 1}`) : btn(' ', CB.NOOP),
    ]));
  }
  if (pick.allowNone) rows.push([btn(pick.noneText || 'بدون انتخاب', 'ep:none')]);
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// ناوبری مشترک
// ---------------------------------------------------------------------------------------------------------------------

/** ردیف‌های پایین هر مرحله. cancelData: callback انصرافِ همان جریان (پیش‌فرض fl:x). skip ⇒ ردیف «رد شدن» بالای آن. */
function navRows({ cancelData = CB.CANCEL, skip = false, skipText = '⏭ رد شدن' } = {}) {
  const rows = [];
  if (skip) rows.push([btn(skipText, CB.SKIP)]);
  rows.push([btn('❌ انصراف', cancelData), btn('🏠 منوی اصلی', CB.HOME)]);
  return rows;
}

function withNav(rows, opts) {
  return { inline_keyboard: [...rows, ...navRows(opts)] };
}

function dateKeyboard(pick) {
  return withNav(calendarRows(pick), { cancelData: pick.cancelData });
}
function timeKeyboard(pick) {
  return withNav(timeRows(pick), { cancelData: pick.cancelData });
}
function employeeKeyboard(pick) {
  return withNav(employeeRows(pick), { cancelData: pick.cancelData });
}

// ---------------------------------------------------------------------------------------------------------------------
// ارسال مرحله‌ها (هر کدام وضعیت مرحله را در session ثبت می‌کند؛ باید بعد از session.update(step) صدا زده شوند)
// ---------------------------------------------------------------------------------------------------------------------

function savePick(chatId, pick) {
  const sess = session.get(chatId);
  if (!sess) return null;
  const full = { ...pick, step: sess.step };
  session.update(chatId, { data: { ...sess.data, pick: full } });
  return full;
}

/** دکمه‌های سریعِ تاریخ: [{text, date}] برای «امروز / فردا / پس‌فردا» (offsetها نسبت به today). */
function quickDates(offsets, today = todayDateString()) {
  const names = { '-1': 'دیروز', 0: 'امروز', 1: 'فردا', 2: 'پس‌فردا' };
  return offsets.map((n) => ({ text: names[n] || `${faDigits(n)} روز بعد`, date: addDays(today, n) }));
}

async function askDate(bot, chatId, { text, label, min = null, max = null, quick = [], cancelData } = {}) {
  const today = todayDateString();
  let anchor = today;
  if (min && anchor < min) anchor = min;
  if (max && anchor > max) anchor = max;
  const { jy, jm } = jalaliPartsOfDateString(anchor);
  const pick = savePick(chatId, { kind: 'date', label, min, max, quick, jy, jm, cancelData }) || { kind: 'date', min, max, quick, jy, jm, cancelData };
  return bot.sendMessage(chatId, text, { reply_markup: dateKeyboard(pick) });
}

async function askTime(bot, chatId, { text, label, after = null, cancelData } = {}) {
  const base = { kind: 'time', label, after, page: defaultTimePage(after), cancelData };
  const pick = savePick(chatId, base) || base;
  return bot.sendMessage(chatId, text, { reply_markup: timeKeyboard(pick) });
}

async function askEmployee(bot, chatId, { text, label, filter = 'any', allowNone = false, noneText, cancelData, actorId } = {}) {
  const base = { kind: 'emp', label, filter, allowNone, noneText, page: 0, cancelData, actorId };
  const pick = savePick(chatId, base) || base;
  return bot.sendMessage(chatId, text, { reply_markup: employeeKeyboard(pick) });
}

/** مرحله‌ی متن آزاد. skip ⇒ دکمه‌ی «رد شدن» که همان «-» را به مرحله می‌دهد. extraRows: ردیف‌های inline اضافه بالای ناوبری. */
async function askText(bot, chatId, text, { skip = false, skipText, cancelData, extraRows = [] } = {}) {
  savePick(chatId, { kind: 'text', skippable: !!skip, label: 'رد شد', cancelData });
  return bot.sendMessage(chatId, text, { reply_markup: withNav(extraRows, { cancelData, skip, skipText }) });
}

/** پیام خطا/تکرار پرسش در همان مرحله (دکمه‌های مرحله‌ی قبل همچنان کار می‌کنند)؛ فقط ناوبری را زیرش می‌گذارد. */
async function retry(bot, chatId, text, { cancelData } = {}) {
  return bot.sendMessage(chatId, text, { reply_markup: withNav([], { cancelData }) });
}

/** مکالمه‌ی نیمه‌کاره را کنار می‌گذارد؛ پیوستِ نیمه‌کاره‌ی مرخصی (فایل یتیم) هم پاک می‌شود. */
function discardSession(chatId) {
  const sess = session.get(chatId);
  session.clear(chatId);
  if (sess && sess.data && sess.data.attachment && sess.data.attachment.id) {
    try {
      Promise.resolve(require('../../services/attachmentService').remove(sess.data.attachment.id)).catch(() => {});
    } catch (_) { /* پاک‌سازی فایل ضدخطاست */ }
  }
  return sess;
}

/** پاسخ به callbackِ منقضی (session نیست / مرحله عوض شده / دکمه‌ی قدیمی). */
async function expire(bot, query) {
  await bot.answerCallbackQuery(query.id, { text: EXPIRED_TEXT, show_alert: true });
}

module.exports = {
  CB, EXPIRED_TEXT, EMP_PAGE_SIZE, TIME_PAGES,
  cb, faDigits, isIsoDate, isTime, weekdayIndex, formatJalali, describeDate, shiftMonth, inRange,
  calendarRows, timeSlots, defaultTimePage, timeRows, candidateUsers, employeeRows, employeeLabel,
  navRows, withNav, dateKeyboard, timeKeyboard, employeeKeyboard,
  quickDates, askDate, askTime, askEmployee, askText, retry, discardSession, expire,
};
