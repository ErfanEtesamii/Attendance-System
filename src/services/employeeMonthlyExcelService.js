// اکسل ماهانه‌ی جداگانه برای هر کارمند + زیپ همه‌ی آن‌ها (ارسال خودکار آخر ماه به مدیر/حسابداری).
// ستون‌ها: ورود، خروج، حضور در شرکت، جمع کل استراحت‌ها، مانده‌ی استراحت بدون حقوق، دورکاری، ساعت مفید.
// محاسبه‌ی هر روز با تنظیمات «همان تاریخ» انجام می‌شود (settings_history)، پس تغییر سیاست استراحت روزهای قبل را عوض نمی‌کند.
const { getDb } = require('../db/connection');
const attendanceRepository = require('../repositories/attendanceRepository');
const usersRepository = require('../repositories/usersRepository');
const settingsRepository = require('../repositories/settingsRepository');
const settingsHistoryRepository = require('../repositories/settingsHistoryRepository');
const dayService = require('../engine/dayService');
const jalali = require('../utils/jalali');
const { BASE_FROM } = require('../utils/settingsHistory');

const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const toFa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const hm = (iso, tz) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : null);

// ردیف‌های روزانه‌ی یک کاربر در بازه‌ی [from, to]
function collectRows(userId, from, to, tz, ctx) {
  const recs = attendanceRepository.search({ from, to, userIds: [userId], limit: 1000 }).sort((a, b) => a.record_date.localeCompare(b.record_date));
  const rem = getDb().prepare("SELECT work_date, start_at, end_at, approved_start_at a, approved_end_at b FROM remote_work_sessions WHERE user_id = ? AND status = 'approved' AND work_date BETWEEN ? AND ?").all(userId, from, to);
  const rows = [];
  for (const r of recs) {
    if (!r.check_in_time) continue;
    const day = dayService.computeRecordDay(r, { context: ctx });
    const segs = attendanceRepository.listSegments(r.id) || [];
    const first = segs.length ? segs[0].check_in_time : r.check_in_time;
    const last = segs.length ? segs[segs.length - 1].check_out_time : r.check_out_time;
    const remote = day.remoteMinutes || 0; // دورکاری تأییدشده (ادغام‌شده)؛ همه‌اش در effective آمده
    rows.push({ date: r.record_date, jalali: toFa(jalali.isoDateToJalaliString(r.record_date)), weekday: WEEKDAYS[new Date(`${r.record_date}T12:00:00Z`).getUTCDay()], in: hm(first, tz), out: hm(last, tz), brk: day.break || 0, unpaid: day.breakUnpaid || 0, remote, effective: Math.max(0, (day.effective || 0) - remote), total: day.effective || 0 });
  }
  return rows;
}

// متن توضیح تغییر سیاست استراحت (تاریخ‌دار) تا پایان ماه؛ بدون تغییر ⇒ null
function lunchPolicyNote(toDate) {
  const registry = require('../utils/settingsRegistry');
  const h = settingsHistoryRepository.listForKey('fixedLunchDeductMinutes').filter((e) => e.from <= toDate);
  const change = h.filter((e) => e.from !== BASE_FROM).pop();
  if (!change) return null;
  const minutes = registry.deserialize('fixedLunchDeductMinutes', change.value);
  if (!(minutes > 0)) return null;
  const cur = require('../repositories/settingsRepository').getAll();
  return `از ${toFa(jalali.isoDateToJalaliString(change.from))} (${change.from}) کسر ثابت ناهار برقرار شد: هر کس دست‌کم ${toFa(cur.fixedLunchMinOverlapMinutes)} دقیقه در بازه‌ی ${toFa(cur.lunchWindowStart)} تا ${toFa(cur.lunchWindowEnd)} در شرکت باشد، به اندازه‌ی حضورش در بازه (حداکثر ${toFa(minutes)} دقیقه) کسر می‌شود؛ ناهارِ ثبت‌شده جایگزین آن است.`;
}

function policyNote(toDate) {
  const lunch = lunchPolicyNote(toDate);
  const breakNote = breakPolicyNote(toDate);
  return [breakNote, lunch].filter(Boolean).join(' ') || null;
}

function breakPolicyNote(toDate) {
  const h = settingsHistoryRepository.listForKey('paidBreakMinutes').filter((e) => e.from <= toDate);
  const changes = h.filter((e) => e.from !== BASE_FROM);
  if (!changes.length) return null;
  const registry = require('../utils/settingsRegistry');
  const val = (e) => registry.deserialize('paidBreakMinutes', e.value);
  return changes.map((e) => {
    const prev = h[h.indexOf(e) - 1];
    return `از ${toFa(jalali.isoDateToJalaliString(e.from))} (${e.from}) سیاست استراحت تغییر کرد: استراحت با حقوق ${toFa(val(e))} دقیقه‌ای شد${prev ? ` (قبل از آن ${toFa(val(prev))} دقیقه)` : ''}.`;
  }).join(' ');
}

async function buildEmployeeWorkbook({ name, label, rows, note }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(label.slice(0, 31), { views: [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: 4 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const navy = 'FF1F3A5F'; const line = { style: 'thin', color: { argb: 'FFD5DDE8' } };
  const border = { top: line, bottom: line, left: line, right: line };
  const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const f = (o) => ({ name: 'Arial', size: 11, ...o });
  ws.columns = [14, 12, 12, 12, 18, 18, 20, 13, 14, 20].map((width) => ({ width }));
  ws.mergeCells('A1:J1'); Object.assign(ws.getCell('A1'), { value: `گزارش رکوردهای ${name} — ${toFa(label)}` });
  Object.assign(ws.getCell('A1'), { font: f({ size: 16, bold: true, color: { argb: 'FFFFFFFF' } }), fill: fill(navy), alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.getRow(1).height = 34;
  ws.mergeCells('A2:J2'); Object.assign(ws.getCell('A2'), { value: 'ساعت‌ها به وقت شرکت · ستون‌های مدت‌زمان با قالب ساعت:دقیقه', font: f({ size: 10, color: { argb: 'FF5B6B7F' } }), alignment: { horizontal: 'center' } });
  ws.mergeCells('A3:J3');
  if (note) Object.assign(ws.getCell('A3'), { value: `⚠ ${note}`, font: f({ bold: true, color: { argb: 'FF7A4B00' } }), fill: fill('FFFFF1C9'), alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
  ws.getRow(3).height = note ? 30 : 6;
  ['تاریخ', 'روز هفته', 'ساعت ورود', 'ساعت خروج', 'ساعت حضور در شرکت', 'جمع کل استراحت‌ها', 'مانده استراحت بدون حقوق', 'دورکاری', 'ساعت مفید حضوری', 'ساعت مفید کل (حضوری + دورکاری)'].forEach((h, i) => {
    const c = ws.getCell(4, i + 1); Object.assign(c, { value: h, font: f({ bold: true, color: { argb: 'FFFFFFFF' } }), fill: fill('FF2F5D8C'), border, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
  });
  ws.getRow(4).height = 36;
  const day = (m) => m / 1440; // مدت‌زمان به‌صورت کسری از شبانه؛ قالب [h]:mm
  const time = (s) => { if (!s) return null; const [h, m] = s.split(':').map(Number); return (h * 60 + m) / 1440; };
  const first = 5;
  const presenceDay = (x) => (x.in && x.out ? time(x.out) - time(x.in) + (time(x.out) < time(x.in) ? 1 : 0) : null); // خروج بعد از نیمه‌شب = روز بعد
  const presenceOf = (x, r) => ({ formula: `IF(OR(C${r}="",D${r}=""),"",D${r}-C${r}+IF(D${r}<C${r},1,0))`, result: presenceDay(x) === null ? '' : presenceDay(x) });
  rows.forEach((x, n) => {
    const r = first + n;
    const vals = [x.jalali, x.weekday, time(x.in), time(x.out), presenceOf(x, r), day(x.brk), day(x.unpaid), day(x.remote), day(x.effective), { formula: `H${r}+I${r}`, result: day(x.total) }];
    vals.forEach((v, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = v;
      Object.assign(c, { font: f({ bold: i >= 8, color: x.weekday === 'جمعه' && i < 2 ? { argb: 'FFB3402F' } : undefined }), border, alignment: { horizontal: 'center', vertical: 'middle' } });
      if (n % 2) c.fill = fill('FFEEF3F9');
      c.numFmt = i === 2 || i === 3 ? 'hh:mm' : (i >= 4 ? '[h]:mm' : 'General');
    });
    if (!x.out) ws.getCell(r, 4).fill = fill('FFFFE08A');
    ws.getRow(r).height = 22;
  });
  const last = first + rows.length - 1; const t = last + 1;
  ws.mergeCells(t, 1, t, 4); ws.getCell(t, 1).value = 'جمع کل';
  const sums = [
    rows.reduce((a, x) => a + (presenceDay(x) || 0), 0), rows.reduce((a, x) => a + day(x.brk), 0), rows.reduce((a, x) => a + day(x.unpaid), 0),
    rows.reduce((a, x) => a + day(x.remote), 0), rows.reduce((a, x) => a + day(x.effective), 0), rows.reduce((a, x) => a + day(x.total), 0),
  ];
  'EFGHIJ'.split('').forEach((col, i) => { ws.getCell(t, 5 + i).value = { formula: `SUM(${col}${first}:${col}${last})`, result: sums[i] }; });
  for (let i = 1; i <= 10; i += 1) {
    const c = ws.getCell(t, i); Object.assign(c, { font: f({ size: 12, bold: true, color: { argb: 'FFFFFFFF' } }), fill: fill(navy), border, alignment: { horizontal: 'center', vertical: 'middle' } });
    if (i >= 5) c.numFmt = '[h]:mm';
  }
  ws.getRow(t).height = 26;
  const s = t + 2;
  [[s, 'جمع ساعت مفید کل (ساعت، اعشاری)', `J${t}*24`, '0.00'], [s + 1, 'جمع ساعت مفید کل (دقیقه)', `ROUND(J${t}*1440,0)`, '#,##0']].forEach(([r, text, formula, nf]) => {
    ws.mergeCells(r, 1, r, 4); ws.getCell(r, 1).value = text; ws.getCell(r, 5).value = { formula, result: nf === '0.00' ? sums[5] * 24 : Math.round(sums[5] * 1440) }; ws.getCell(r, 5).numFmt = nf;
    for (let i = 1; i <= 5; i += 1) Object.assign(ws.getCell(r, i), { fill: fill('FFDCE8F5'), font: f({ bold: true, color: { argb: navy } }), alignment: { horizontal: 'center' } });
  });
  const notes = ['توضیحات',
    '• ساعت ورود = اولین ورود روز و ساعت خروج = آخرین خروج روز؛ ساعت حضور = خروج منهای ورود (اگر روز چند نوبت داشته، فاصله‌ی بین نوبت‌ها هم در آن آمده ولی در ساعت مفید حساب نشده).',
    '• جمع کل استراحت‌ها شامل استراحت‌های با حقوق و بدون حقوق است. مانده استراحت بدون حقوق = بخشی که از سهمیه‌ی استراحت با حقوق بیشتر بوده و از ساعت مفید کم می‌شود. ساعت مفید حضوری = حضورِ بیرون از دورکاری − استراحت بدون حقوق − زمان بیکاری.',
    '• دورکاری = مجموع دورکاری‌های تأییدشده‌ی همان روز، خالص: (پایان − شروع) منهای کل استراحت‌های داخل آن؛ در دورکاری سهمیه‌ی استراحت با حقوق و ناهار ثابت نیست و ربطی به بازه‌ی حضور ندارد. ساعت مفید حضوری = ساعت مفیدِ حضور در شرکت بدون دورکاری؛ ساعت مفید کل = حضوری + دورکاری. خانه‌ی خروجِ زردرنگ = رکورد ناقص. فقط روزهای دارای رکورد ورود لیست شده‌اند.'];
  notes.forEach((tx, k) => {
    const r = s + 3 + k; ws.mergeCells(r, 1, r, 10);
    Object.assign(ws.getCell(r, 1), { value: tx, font: f({ size: 10, bold: k === 0, color: { argb: k === 0 ? navy : 'FF44546A' } }), alignment: { wrapText: true, vertical: 'top', horizontal: 'right' } });
    ws.getRow(r).height = k === 0 ? 18 : 32;
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// همه‌ی کارمندان دارای رکورد در ماه ⇒ [{ user, rows }]
function collectMonth({ from, to }) {
  const ids = getDb().prepare('SELECT DISTINCT user_id FROM attendance_records WHERE record_date BETWEEN ? AND ? ORDER BY user_id').all(from, to).map((r) => r.user_id);
  const ctx = dayService.loadContext();
  const out = [];
  for (const id of ids) {
    const user = usersRepository.findById(id);
    if (!user) continue;
    const rows = collectRows(id, from, to, ctx.timezone, ctx);
    if (rows.length) out.push({ user, rows });
  }
  return out;
}

// زیپ همه‌ی کارمندان؛ نام فایل داخل زیپ: «نام کارمند - ماه سال.xlsx» (UTF-8 با پرچم استاندارد زیپ)
async function buildEmployeesZip({ year, month }) {
  const JSZip = require('jszip');
  const range = jalali.jalaliMonthRangeOf(year, month);
  const label = range.label;
  const note = policyNote(range.to);
  const zip = new JSZip();
  const used = new Set();
  const people = collectMonth(range);
  for (const { user, rows } of people) {
    const base = `${String(user.full_name).replace(/[\\/:*?"<>|]/g, '').trim() || `user-${user.id}`} - ${label}`;
    let fname = `${base}.xlsx`;
    if (used.has(fname)) fname = `${base} (${user.id}).xlsx`;
    used.add(fname);
    zip.file(fname, await buildEmployeeWorkbook({ name: user.full_name, label, rows, note }));
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, count: people.length, label, filename: `employees-${year}-${String(month).padStart(2, '0')}.zip` };
}

module.exports = { buildEmployeesZip, buildEmployeeWorkbook, collectMonth, policyNote };
