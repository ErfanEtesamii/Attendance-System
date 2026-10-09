// تولید خروجی CSV بدون وابستگی خارجی (فاز ۶).
//
// چرا CSV و نه .xlsx واقعی: کتابخانه‌ای مثل exceljs روی این sandbox قابل نصب نیست (بدون
// دسترسی اینترنت). CSV با BOM یو‌تی‌اف-۸ در اکسل (از جمله متن فارسی/راست‌به‌چپ) درست باز
// می‌شود و برای «خروجی اکسل» سند فاز ۶ کافی‌ست. روی سرور واقعی شرکت (که اینترنت دارد)
// می‌توان بعداً با `npm install exceljs` این تابع را با خروجی .xlsx واقعی (چند شیت، فرمت
// سلول، فریز کردن هدر) جایگزین کرد؛ امضای endpoint نیازی به تغییر ندارد چون Content-Type
// و پسوند فایل مصرف‌کننده (خود اکسل) را مشخص می‌کند.
// S5-1a: هسته‌ی xlsx در utils/xlsx.js آمد (exceljs اختیاری)؛ CSV همچنان پیش‌فرض و fallback است و routeها از sendTable آن فایل استفاده می‌کنند.

const { neutralizeCell } = require('./exportSafety');

// S5-1c: هر سلول رشته‌ای که شبیه فرمول باشد (= + - @ ...) با «'» خنثی می‌شود (exportSafety)
function escapeCsvCell(value) {
  value = neutralizeCell(value);
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @param {string[]} headers - عنوان ستون‌ها
 * @param {Array<Array<string|number|null>>} rows - ردیف‌های داده، به همان ترتیب headers
 * @returns {string} متن کامل CSV با BOM یو‌تی‌اف-۸
 */
function toCsv(headers, rows) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  // BOM (\uFEFF) لازم است وگرنه اکسل متن فارسی UTF-8 را به‌صورت خراب/ناخوانا نمایش می‌دهد
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * پاسخ CSV را با هدرهای مناسب برای دانلود می‌فرستد.
 * @param {import('express').Response} res
 * @param {string} filename - بدون کاراکتر خاص (فقط حروف/عدد/خط‌تیره/نقطه)
 */
function sendCsv(res, filename, headers, rows) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  // S5-1c: حجم بالا ⇒ نوشتن تکه‌تکه (بدون ساخت یک رشته‌ی عظیم)؛ خروجی بایت‌به‌بایت با حالت عادی یکسان است
  const threshold = parseInt(process.env.CSV_STREAM_ROWS, 10) > 0 ? parseInt(process.env.CSV_STREAM_ROWS, 10) : 5000;
  if (rows.length > threshold && typeof res.write === 'function' && typeof res.end === 'function') {
    const BATCH = 1000;
    res.write(`\uFEFF${headers.map(escapeCsvCell).join(',')}`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((row) => `\r\n${row.map(escapeCsvCell).join(',')}`).join('');
      res.write(chunk);
    }
    return res.end();
  }
  return res.send(toCsv(headers, rows));
}

module.exports = { toCsv, sendCsv };
