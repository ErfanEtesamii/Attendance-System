// ارسال خودکار زیپ اکسل‌های جداگانه‌ی همه‌ی کارمندان در تلگرام (روز اول ماه شمسی، برای ماه قبل).
// تنظیمات پنل (گروه «ارسال خودکار گزارش»): employeeZipEnabled (پیش‌فرض خاموش) و employeeZipRecipientIds (شناسه‌ی کاربران گیرنده، با ویرگول).
// خطای ارسال به یک گیرنده بقیه را متوقف نمی‌کند و در پایان خطا پرتاب می‌شود تا در job_runs «ناموفق» ثبت شود.
const usersRepository = require('../../repositories/usersRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const { jalaliMonthRange } = require('../../utils/jalali');
const { buildEmployeesZip } = require('../../services/employeeMonthlyExcelService');

function parseIds(raw) {
  const out = [];
  for (const p of String(raw || '').split(',')) { const n = Number(p.trim()); if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n); }
  return out;
}

async function sendEmployeeZipReports(bot, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  if (!settings.employeeZipEnabled) return { skipped: 'disabled', sent: 0, failed: 0 };
  const ids = parseIds(settings.employeeZipRecipientIds);
  const recipients = ids.map((id) => usersRepository.findById(id)).filter((u) => u && u.is_active && u.telegram_user_id);
  if (!recipients.length) return { skipped: 'no_recipients', sent: 0, failed: 0 };
  const range = jalaliMonthRange({ previous: true, date: now });
  const file = await buildEmployeesZip({ year: range.jy, month: range.jm });
  if (!file.count) return { skipped: 'no_records', sent: 0, failed: 0 };
  const caption = `📦 اکسل ماهانه‌ی کارمندان — ${range.label}\nتعداد کارمند: ${file.count}`;
  let sent = 0; const errors = [];
  for (const r of recipients) {
    try { await bot.sendDocument(r.telegram_user_id, file.buffer, { caption }, { filename: file.filename, contentType: 'application/zip' }); sent += 1; } catch (err) { errors.push(`${r.full_name}: ${err.message}`); }
  }
  if (errors.length) throw new Error(`ارسال زیپ کارمندان برای ${errors.length} گیرنده ناموفق بود (${sent} موفق): ${errors.join(' | ')}`);
  return { sent, failed: 0 };
}

module.exports = { sendEmployeeZipReports, parseIds };
