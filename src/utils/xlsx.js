// S5-1a: هسته‌ی خروجی xlsx (exceljs) + fallback خودکار به CSV.
//
// قرارداد:
//   • exceljs «اختیاری» است (optionalDependencies با نسخه‌ی دقیق در package.json) و فقط هنگام اولین خروجی xlsx، با require تنبل، بارگذاری می‌شود؛
//     پس نبودِ ماژول (یا خرابی نصب) هرگز مانع بالا آمدن سرور نیست.
//   • buildWorkbook: یک یا چند شیت، همه RTL، سرستون فریز (ردیف ۱)، فیلتر خودکار روی سرستون، سرستون پررنگ. بدون ماژول ⇒ XlsxUnavailableError.
//   • sendTable: همان امضای ساده‌ی sendCsv + req. پیش‌فرض CSV (رفتار قبلی routeها بدون تغییر)؛ فقط با ?format=xlsx فایل xlsx می‌دهد.
//     اگر exceljs در دسترس نباشد، همان داده را CSV می‌دهد و با هدر X-Export-Fallback / X-Export-Notice (متن فارسیِ URL-encoded) و یک warning در لاگ اعلام می‌کند.
//   • S5-1b: sendSheets — خروجی چندشیتی (شیت‌ها را سرویس گزارش می‌سازد)؛ CSV همان قالب قدیمی را نگه می‌دارد.
//   • S5-1c: خنثی‌سازی formula injection در همه‌ی سلول‌ها (utils/exportSafety.js)، callback onExport برای audit (قبل از ارسال بدنه)،
//     و streaming: وقتی مجموع ردیف‌ها از آستانه (XLSX_STREAM_ROWS، پیش‌فرض ۵۰۰۰) بیشتر باشد، فایل با WorkbookWriter مستقیم روی پاسخ نوشته می‌شود
//     (بدون ساخت کل workbook/buffer در حافظه).

const { sendCsv } = require('./csv');
const { neutralizeCell, neutralizeRow } = require('./exportSafety');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FALLBACK_NOTICE = 'کتابخانه‌ی exceljs روی سرور نصب نیست؛ به‌جای xlsx فایل CSV داده شد. برای فعال‌شدن xlsx دستور npm install را اجرا و سرویس را ری‌استارت کنید.';

class XlsxUnavailableError extends Error {
  constructor(reason) {
    super(`exceljs در دسترس نیست${reason ? `: ${reason}` : ''}`);
    this.name = 'XlsxUnavailableError';
    this.code = 'XLSX_UNAVAILABLE';
  }
}

// ---------- بارگذاری تنبل ----------
let loader = () => require('exceljs');
let cached; // undefined = هنوز تلاش نشده؛ null = در دسترس نیست؛ وگرنه ماژول
let lastError = '';
let warned = false;

function loadExcelJs() {
  if (cached !== undefined) return cached;
  try {
    cached = loader();
    if (!cached || typeof cached.Workbook !== 'function') throw new Error('ماژول exceljs کلاس Workbook ندارد');
  } catch (err) {
    cached = null;
    lastError = err && err.message ? String(err.message).split('\n')[0] : 'خطای نامشخص';
  }
  return cached;
}

const isAvailable = () => loadExcelJs() !== null;

// فقط برای تست: loader جایگزین (مثلاً تابعی که throw می‌کند) و ریست حالت
function _setLoaderForTest(fn) {
  loader = fn || (() => require('exceljs'));
  cached = undefined;
  lastError = '';
  warned = false;
}

// ---------- ساخت workbook ----------
// نام شیت اکسل: حداکثر ۳۱ نویسه، بدون \ / * ? : [ ]، بدون ' در ابتدا/انتها، یکتا (بدون توجه به حروف)
function sanitizeSheetName(name, used = []) {
  let base = String(name == null ? '' : name).replace(/[\\/*?:[\]]/g, '_').replace(/^'+|'+$/g, '').trim();
  if (!base) base = 'Sheet';
  base = base.slice(0, 31);
  const taken = new Set(used.map((n) => n.toLowerCase()));
  let out = base;
  for (let i = 2; taken.has(out.toLowerCase()); i += 1) {
    const suffix = ` (${i})`;
    out = base.slice(0, 31 - suffix.length) + suffix;
  }
  return out;
}

const SHEET_VIEWS = () => [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 1 }];

function styleHeaderRow(head) {
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } }; });
}

function columnWidth(headers, rows, index) {
  let max = String(headers[index] == null ? '' : headers[index]).length;
  for (const r of rows) {
    const v = r[index];
    if (v === null || v === undefined) continue;
    const len = (v instanceof Date ? 16 : String(v).length);
    if (len > max) max = len;
  }
  return Math.min(60, Math.max(10, max + 2));
}

/**
 * @param {{ sheets: Array<{ name: string, headers: string[], rows: Array<Array<string|number|boolean|Date|null>> }>, creator?: string }} spec
 * @returns ExcelJS.Workbook
 * @throws {XlsxUnavailableError} اگر exceljs نصب/قابل‌بارگذاری نباشد
 */
function buildWorkbook(spec) {
  const ExcelJS = loadExcelJs();
  if (!ExcelJS) throw new XlsxUnavailableError(lastError);
  if (!spec || !Array.isArray(spec.sheets) || !spec.sheets.length) throw new TypeError('حداقل یک شیت لازم است.');

  const wb = new ExcelJS.Workbook();
  wb.creator = spec.creator || 'Attendance System';
  wb.created = new Date();
  const usedNames = [];

  for (const s of spec.sheets) {
    if (!Array.isArray(s.headers) || !s.headers.length) throw new TypeError('هر شیت باید سرستون داشته باشد.');
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const name = sanitizeSheetName(s.name, usedNames);
    usedNames.push(name);

    // RTL + فریز ردیف اول
    const ws = wb.addWorksheet(name, { views: SHEET_VIEWS() });
    styleHeaderRow(ws.addRow(s.headers.map(neutralizeCell)));
    for (const r of rows) ws.addRow(neutralizeRow(r).map((v) => (v === undefined ? null : v)));
    s.headers.forEach((_, i) => { ws.getColumn(i + 1).width = columnWidth(s.headers, rows, i); });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } };
  }
  return wb;
}

async function workbookToBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------- پاسخ HTTP ----------
function requestedFormat(req) {
  const raw = req && req.query ? req.query.format : undefined;
  if (raw === undefined || raw === '') return { ok: true, value: 'csv' };
  const v = String(raw).toLowerCase();
  return v === 'csv' || v === 'xlsx' ? { ok: true, value: v } : { ok: false };
}

const baseName = (filename) => String(filename).replace(/\.(csv|xlsx)$/i, '');

function sendCsvFallback(res, filename, headers, rows) {
  res.setHeader('X-Export-Fallback', 'csv');
  res.setHeader('X-Export-Notice', encodeURIComponent(FALLBACK_NOTICE));
  if (!warned) {
    warned = true;
    console.warn(`[xlsx] ${FALLBACK_NOTICE}${lastError ? ` (علت: ${lastError})` : ''}`);
  }
  sendCsv(res, `${baseName(filename)}.csv`, headers, rows);
}

// ---------- streaming (S5-1c) ----------
function streamThreshold() {
  const n = parseInt(process.env.XLSX_STREAM_ROWS, 10);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

/**
 * نوشتن workbook مستقیم روی جریان خروجی (exceljs WorkbookWriter): هر ردیف commit می‌شود و کل فایل در حافظه جمع نمی‌شود.
 * ظاهر شیت‌ها (RTL، فریز، فیلتر، سرستون) با نسخه‌ی buffer یکسان است. پیش‌شرط: exceljs در دسترس است.
 * @param {import('stream').Writable} out
 */
async function writeWorkbookStream(out, spec) {
  const ExcelJS = loadExcelJs();
  if (!ExcelJS) throw new XlsxUnavailableError(lastError);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = spec.creator || 'Attendance System';
  wb.created = new Date();
  const usedNames = [];
  for (const s of spec.sheets) {
    const rows = Array.isArray(s.rows) ? s.rows : [];
    const name = sanitizeSheetName(s.name, usedNames);
    usedNames.push(name);
    const ws = wb.addWorksheet(name, { views: SHEET_VIEWS() });
    ws.columns = s.headers.map((_, i) => ({ width: columnWidth(s.headers, rows, i) }));
    const head = ws.addRow(s.headers.map(neutralizeCell));
    styleHeaderRow(head);
    head.commit();
    for (const r of rows) ws.addRow(neutralizeRow(r).map((v) => (v === undefined ? null : v))).commit();
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.headers.length } };
    await ws.commit();
  }
  await wb.commit();
}

function safeOnExport(onExport, info) {
  if (typeof onExport !== 'function') return;
  try {
    onExport(info);
  } catch (err) {
    console.error('[xlsx] onExport (audit) ناموفق بود؛ خروجی ادامه می‌یابد:', err);
  }
}

// فیلدهای استاندارد audit برای هر خروجی (از info در onExport): قالب درخواستی و واقعاً تحویل‌شده، fallback، streaming، شیت‌ها
function exportAuditFields(info) {
  const out = { format: info.format, requestedFormat: info.requested };
  if (info.fallback) out.fallback = true;
  if (info.streamed) out.streamed = true;
  if (info.sheets && info.sheets.length) out.sheets = info.sheets;
  return out;
}

const countRows = (sheets) => sheets.reduce((t, s) => t + (Array.isArray(s.rows) ? s.rows.length : 0), 0);

/**
 * خروجی چندشیتی. پیش‌فرض CSV (همان قالب قدیمی routeها از opts.csv)؛ با ?format=xlsx فایل xlsx با همه‌ی شیت‌ها.
 * بدون exceljs ⇒ CSV + هدرهای fallback. هرگز reject نمی‌شود.
 * @param {Array<{name:string, headers:string[], rows:any[][]}> | (() => Array)} sheets آرایه یا تابعی که فقط برای xlsx (و فقط وقتی exceljs هست) صدا زده می‌شود
 * @param {object} [opts] { csv: {headers, rows} (اجباری وقتی sheets تابع است؛ وگرنه پیش‌فرض شیت اول)،
 *                          onExport(info) — قبل از ارسال بدنه (برای audit؛ اگر throw کند خروجی ادامه می‌یابد) }
 *   info = { format: 'csv'|'xlsx', requested, fallback, streamed, rowCount, sheets }
 */
async function sendSheets(req, res, filename, sheets, opts = {}) {
  const fmt = requestedFormat(req);
  if (!fmt.ok) return res.status(400).json({ error: 'پارامتر format باید csv یا xlsx باشد.', code: 'INVALID_FORMAT' });
  const base = baseName(filename);
  const csv = opts.csv || (Array.isArray(sheets) && sheets[0] ? { headers: sheets[0].headers, rows: sheets[0].rows } : null);
  if (!csv) throw new TypeError('sendSheets: برای sheets تابعی، opts.csv لازم است.');
  const info = { format: 'csv', requested: fmt.value, fallback: false, streamed: false, rowCount: csv.rows.length, sheets: [] };

  if (fmt.value === 'csv') {
    safeOnExport(opts.onExport, info);
    return sendCsv(res, `${base}.csv`, csv.headers, csv.rows);
  }
  if (!isAvailable()) {
    safeOnExport(opts.onExport, { ...info, fallback: true });
    return sendCsvFallback(res, filename, csv.headers, csv.rows);
  }

  const safe = `${base}.xlsx`.replace(/[^a-zA-Z0-9._-]/g, '_');
  let streamed = false;
  try {
    const list = typeof sheets === 'function' ? sheets() : sheets;
    const rowCount = countRows(list);
    streamed = rowCount > streamThreshold();
    const xinfo = { ...info, format: 'xlsx', streamed, rowCount, sheets: list.map((x) => x.name) };
    if (!streamed) {
      const buf = await workbookToBuffer(buildWorkbook({ sheets: list }));
      safeOnExport(opts.onExport, xinfo);
      res.setHeader('Content-Type', XLSX_MIME);
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
      return res.send(buf);
    }
    safeOnExport(opts.onExport, xinfo);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    await writeWorkbookStream(res, { sheets: list });
    return undefined;
  } catch (err) {
    if (err instanceof XlsxUnavailableError && !res.headersSent && !streamed) {
      safeOnExport(opts.onExport, { ...info, fallback: true });
      return sendCsvFallback(res, filename, csv.headers, csv.rows);
    }
    console.error('[xlsx] ساخت فایل xlsx ناموفق بود:', err);
    if (!res.headersSent) {
      // هنوز بدنه‌ای نرفته: پاسخ خطای تمیز
      if (typeof res.removeHeader === 'function') { res.removeHeader('Content-Type'); res.removeHeader('Content-Disposition'); }
      return res.status(500).json({ error: 'ساخت فایل xlsx ناموفق بود.', code: 'XLSX_FAILED' });
    }
    // وسط جریان: فایل ناقص نباید سالم به نظر برسد ⇒ اتصال قطع می‌شود
    if (typeof res.destroy === 'function') res.destroy(err);
    return undefined;
  }
}

/** جایگزین sendCsv در routeهای تک‌جدولی: sendSheets با یک شیت (نام شیت: opts.sheetName یا نام فایل). */
function sendTable(req, res, filename, headers, rows, opts = {}) {
  return sendSheets(req, res, filename, [{ name: opts.sheetName || baseName(filename), headers, rows }], { onExport: opts.onExport });
}

module.exports = {
  XLSX_MIME, FALLBACK_NOTICE, XlsxUnavailableError,
  isAvailable, buildWorkbook, workbookToBuffer, writeWorkbookStream, exportAuditFields, sanitizeSheetName, sendTable, sendSheets, requestedFormat,
  _setLoaderForTest,
};
