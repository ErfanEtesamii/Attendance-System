// S3-9b/S3-9c: اعتبارسنجی ورودی تعطیلی و تحلیل ورودی گروهی (متن/CSV). خالص: بدون DB و بدون Express.
//
// ورودی گروهی: هر خط یک تعطیلی، به یکی از شکل‌های
//   1405/01/01 نوروز                                  (تاریخ، فاصله، عنوان)
//   1405/01/01,نوروز                                  (CSV با کاما، ; یا Tab)
//   1405/01/14,نیم‌روز مناسبتی,نیم‌روز,11:00            (ستون‌های اختیاری: نوع، ساعت پایان، دپارتمان)
//   1405/01/15,تعطیلی مالی,کامل,,مالی
// ستون‌ها: تاریخ، عنوان، نوع (full|half|کامل|نیم‌روز)، ساعت پایان نیم‌روز، دپارتمان (پر ⇒ تعطیلی دپارتمانی).
// تاریخ پیش‌فرض شمسی است (سال < ۱۷۰۰)؛ سال ≥ ۱۷۰۰ میلادی فرض می‌شود. ارقام فارسی/عربی هم پذیرفته می‌شود. خط خالی و خط شروع‌شده با # نادیده است.

const jalaali = require('jalaali-js');

const MAX_ROWS = 400;

function toAsciiDigits(s) {
  return String(s)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const pad = (n, len = 2) => String(n).padStart(len, '0');

// اعتبارسنجی یک تعطیلی (همان قواعد route). خروجی: { ok, value } | { ok:false, error }
function parseHolidayBody(body) {
  const b = body || {};
  const bad = (error) => ({ ok: false, error });
  const date = typeof b.date === 'string' ? b.date.trim() : '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return bad('تاریخ نامعتبر است (قالب YYYY-MM-DD).');
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (!title) return bad('عنوان الزامی است.');
  if (title.length > 100) return bad('عنوان حداکثر ۱۰۰ نویسه می‌تواند باشد.');

  const kind = b.kind === undefined || b.kind === '' ? 'full' : b.kind;
  if (kind !== 'full' && kind !== 'half') return bad('نوع تعطیلی باید «کامل» یا «نیم‌روز» باشد.');
  let halfEndTime = null;
  if (kind === 'half') {
    const m = typeof b.halfEndTime === 'string' ? /^\s*(\d{1,2}):(\d{2})\s*$/.exec(b.halfEndTime) : null;
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return bad('برای نیم‌روز، ساعت پایان کار (HH:MM) الزامی است.');
    halfEndTime = `${m[1].padStart(2, '0')}:${m[2]}`;
  }

  const scope = b.scope === undefined || b.scope === '' ? 'all' : b.scope;
  if (scope !== 'all' && scope !== 'department') return bad('دامنه باید «همه» یا «دپارتمان» باشد.');
  let department = '';
  if (scope === 'department') {
    department = typeof b.department === 'string' ? b.department.trim() : '';
    if (!department) return bad('برای تعطیلی دپارتمانی، نام دپارتمان الزامی است.');
    if (department.length > 100) return bad('نام دپارتمان حداکثر ۱۰۰ نویسه می‌تواند باشد.');
  }
  return { ok: true, value: { date, title, kind, halfEndTime, scope, department } };
}

// تاریخ شمسی/میلادی متنی ⇒ { date: 'YYYY-MM-DD' میلادی, jalali: 'YYYY/MM/DD' } | { error }
function parseDateText(raw) {
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(toAsciiDigits(raw).trim());
  if (!m) return { error: 'تاریخ نامعتبر است (مثل 1405/01/01).' };
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y >= 1700) {
    const iso = `${pad(y, 4)}-${pad(mo)}-${pad(da)}`;
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { error: 'تاریخ میلادی نامعتبر است.' };
    const j = jalaali.toJalaali(y, mo, da);
    return { date: iso, jalali: `${j.jy}/${pad(j.jm)}/${pad(j.jd)}` };
  }
  if (y < 1300 || y > 1599 || !jalaali.isValidJalaaliDate(y, mo, da)) return { error: 'تاریخ شمسی نامعتبر است (روز یا ماه یا سال غیرممکن).' };
  const g = jalaali.toGregorian(y, mo, da);
  return { date: `${pad(g.gy, 4)}-${pad(g.gm)}-${pad(g.gd)}`, jalali: `${y}/${pad(mo)}/${pad(da)}` };
}

// شکستن یک خط به ستون‌ها: Tab، یا کاما/نقطه‌ویرگول (با پشتیبانی از "نقل‌قول")، یا «تاریخ + فاصله + عنوان»
function splitLine(line) {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (/[,;]/.test(line)) {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',' || ch === ';') { cells.push(cur.trim()); cur = ''; } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }
  const m = /^(\S+)\s+(.+)$/.exec(line.trim());
  return m ? [m[1], m[2].trim()] : [line.trim()];
}

const KIND_WORDS = { full: 'full', half: 'half', کامل: 'full', 'نیم‌روز': 'half', 'نیم روز': 'half', نیمروز: 'half', نیمه: 'half' };

// یک ردیف (آرایه‌ی ستون‌ها) ⇒ { ok, value, jalali } | { ok:false, error }
function parseRow(cells) {
  const [dateTxt = '', title = '', kindTxt = '', halfTxt = '', deptTxt = ''] = cells;
  const dt = parseDateText(dateTxt);
  if (dt.error) return { ok: false, error: dt.error };
  const kindKey = kindTxt.replace(/‌/g, '‌').trim();
  let kind = 'full';
  if (kindKey) {
    kind = KIND_WORDS[kindKey] || KIND_WORDS[kindKey.toLowerCase()];
    if (!kind) return { ok: false, error: 'نوع باید «کامل» یا «نیم‌روز» باشد.' };
  }
  const department = deptTxt.trim();
  const checked = parseHolidayBody({
    date: dt.date, title, kind, halfEndTime: toAsciiDigits(halfTxt), scope: department ? 'department' : 'all', department,
  });
  return checked.ok ? { ok: true, value: checked.value, jalali: dt.jalali } : { ok: false, error: checked.error };
}

// متن گروهی یا آرایه‌ی items ⇒ { rows: [{ line, input, ok, value?, jalali?, error? }], error? }
function parseImport({ text, items }) {
  const rows = [];
  if (Array.isArray(items)) {
    if (items.length > MAX_ROWS) return { error: `حداکثر ${MAX_ROWS} ردیف در هر بار مجاز است.` };
    items.forEach((it, i) => {
      const o = it && typeof it === 'object' ? it : {};
      const cells = [o.date, o.title, o.kind, o.halfEndTime, o.department].map((c) => (c == null ? '' : String(c)));
      rows.push({ line: i + 1, input: cells.filter(Boolean).join(' | '), ...parseRow(cells) });
    });
    return { rows };
  }
  if (typeof text !== 'string' || !text.trim()) return { error: 'متن یا فهرست تعطیلات خالی است.' };
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cells = splitLine(line);
    // سطر سرستون (مثل «تاریخ,عنوان» یا «date,title») نادیده گرفته می‌شود
    if (rows.length === 0 && !/\d/.test(toAsciiDigits(cells[0] || ''))) return;
    rows.push({ line: idx + 1, input: line, ...parseRow(cells) });
  });
  if (rows.length === 0) return { error: 'هیچ ردیفی پیدا نشد.' };
  if (rows.length > MAX_ROWS) return { error: `حداکثر ${MAX_ROWS} ردیف در هر بار مجاز است.` };
  return { rows };
}

module.exports = { MAX_ROWS, parseHolidayBody, parseDateText, parseImport, toAsciiDigits };
