// S5-1c: خنثی‌سازی «formula injection» (CSV injection) برای خروجی‌های CSV و xlsx.
//
// تهدید: متنی که کاربر وارد کرده (نام، دپارتمان، دلیل مرخصی، جزئیات audit، ...) اگر با = + - @ (یا tab / CR) شروع شود،
// اکسل/LibreOffice هنگام باز کردن فایل ممکن است آن را فرمول اجرا کند (مثلاً =HYPERLINK یا DDE).
// راه‌حل استاندارد (OWASP): جلوی چنین رشته‌ای یک «'» می‌گذاریم تا همیشه متن باشد.
//
// قواعد:
//   • فقط «رشته» تغییر می‌کند؛ عدد، بولی، Date، null/undefined دست‌نخورده‌اند (عدد منفی واقعی فرمول نیست).
//   • تشخیص روی اولین نویسه‌ی رشته است (و نویسه‌های کنترلی/فاصله‌ی ابتدایی قبل از آن که برخی نرم‌افزارها نادیده می‌گیرند).
//   • idempotent نیست عمداً: دو بار اعمال دو «'» می‌گذارد؛ فراخواننده یک‌بار اعمال می‌کند (در لایه‌ی نوشتن فایل).

const FORMULA_START = /^[\s\u0000-\u001f ​-‏﻿]*[=+\-@]/;
const CONTROL_START = /^[\t\r]/;

function isDangerousString(value) {
  return typeof value === 'string' && value.length > 0 && (FORMULA_START.test(value) || CONTROL_START.test(value));
}

// یک سلول ⇒ همان سلول (امن)
function neutralizeCell(value) {
  return isDangerousString(value) ? `'${value}` : value;
}

const neutralizeRow = (row) => (Array.isArray(row) ? row.map(neutralizeCell) : row);

module.exports = { isDangerousString, neutralizeCell, neutralizeRow };
