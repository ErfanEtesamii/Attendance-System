// تولید خروجی CSV بدون وابستگی خارجی (فاز ۶).
//
// چرا CSV و نه .xlsx واقعی: کتابخانه‌ای مثل exceljs روی این sandbox قابل نصب نیست (بدون
// دسترسی اینترنت). CSV با BOM یو‌تی‌اف-۸ در اکسل (از جمله متن فارسی/راست‌به‌چپ) درست باز
// می‌شود و برای «خروجی اکسل» سند فاز ۶ کافی‌ست. روی سرور واقعی شرکت (که اینترنت دارد)
// می‌توان بعداً با `npm install exceljs` این تابع را با خروجی .xlsx واقعی (چند شیت، فرمت
// سلول، فریز کردن هدر) جایگزین کرد؛ امضای endpoint نیازی به تغییر ندارد چون Content-Type
// و پسوند فایل مصرف‌کننده (خود اکسل) را مشخص می‌کند.

function escapeCsvCell(value) {
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
  const csv = toCsv(headers, rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.send(csv);
}

module.exports = { toCsv, sendCsv };
