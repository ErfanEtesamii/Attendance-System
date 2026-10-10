// ارسال خودکار گزارش ماهانه به‌صورت فایل xlsx در تلگرام (S5-5a). ایمیل عمداً نیست.
//
// Job «monthlyReport» (هر روز اجرا می‌شود و فقط روز اول ماه شمسی کار می‌کند) بعد از پیام متنی، این تابع را هم صدا می‌زند.
// همه‌چیز از تنظیمات پنل (گروه «ارسال خودکار گزارش») می‌آید و پیش‌فرض «خاموش» است:
//   reportXlsxEnabled        روشن/خاموش
//   reportXlsxRecipientRoles نقش‌های گیرنده (با ویرگول؛ از admin,hr,manager). admin/hr کل شرکت، manager فقط تیم خودش (مثل پیام متنی)
//   reportXlsxRequireClosed  فقط اگر ماه قبل «بسته» شده باشد ارسال شود؛ خاموش ⇒ ماه بسته‌نشده هم با ارقام زنده (برچسب «زنده» در شیت «مشخصات گزارش»)
// ارقام ماه بسته‌شده از snapshot می‌آید (همان منطق گزارش API)؛ بدون exceljs ⇒ فایل CSV (شیت اصلی) با توضیح در کپشن.
// اسکوپ: هر گیرنده فقط داده‌ی کاربران خودش را می‌گیرد. خطای ارسال به یک گیرنده بقیه را متوقف نمی‌کند و در پایان Job «خطا» می‌شود.

const usersRepository = require('../../repositories/usersRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const monthClosuresRepository = require('../../repositories/monthClosuresRepository');
const auditRepository = require('../../repositories/auditRepository');
const { computeMonthlyReport } = require('../../services/monthlyReportService');
const { reportFromSnapshot } = require('../../services/monthCloseService');
const { buildMonthlySheets, MAIN_COLUMNS } = require('../../services/monthlyExportService');
const { jalaliMonthRange } = require('../../utils/jalali');
const xlsx = require('../../utils/xlsx');
const { toCsv } = require('../../utils/csv');

const ALLOWED_ROLES = ['admin', 'hr', 'manager'];

// «admin, hr» ⇒ ['admin','hr']؛ نقش ناشناخته/تکراری نادیده گرفته می‌شود
function parseRoles(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const r = part.trim().toLowerCase();
    if (ALLOWED_ROLES.includes(r) && !out.includes(r)) out.push(r);
  }
  return out;
}

// کاربرانی که این گیرنده باید ببیند: admin/hr همه‌ی فعال‌ها، manager فقط زیرمجموعه‌ی مستقیم خودش
function scopeFor(recipient, activeUsers) {
  if (recipient.role === 'manager') return activeUsers.filter((u) => u.manager_id === recipient.id);
  return activeUsers;
}

function buildPayload({ year, month, closure, users }) {
  const ids = users.map((u) => u.id);
  const closureInfo = closure ? { status: closure.status, closedAt: closure.closed_at, closeCount: closure.close_count } : null;
  if (closure && closure.status === 'closed' && closure.snapshot) {
    return { ...reportFromSnapshot(closure, { allowedIds: ids, includeDays: true }), closure: closureInfo };
  }
  return { ...computeMonthlyReport({ users, year, month, includeDays: true }), source: 'live', closure: closureInfo };
}

// فایل را می‌سازد: xlsx (شش شیت)، یا بدون exceljs CSV شیت اصلی
async function buildFile(payload) {
  const mm = String(payload.month).padStart(2, '0');
  const base = `monthly-report_${payload.year}-${mm}`;
  if (xlsx.isAvailable()) {
    const wb = xlsx.buildWorkbook({ sheets: buildMonthlySheets(payload) });
    return { buffer: await xlsx.workbookToBuffer(wb), filename: `${base}.xlsx`, contentType: xlsx.XLSX_MIME, fallback: false };
  }
  const headers = MAIN_COLUMNS.map((c) => c[0]);
  const total = payload.users.length ? [{ user: { fullName: 'جمع', personnelCode: '', department: '' }, ...payload.totals }] : [];
  const rows = [...payload.users, ...total].map((u) => MAIN_COLUMNS.map((c) => c[2](u)));
  return { buffer: Buffer.from(toCsv(headers, rows), 'utf8'), filename: `${base}.csv`, contentType: 'text/csv', fallback: true };
}

/**
 * @param {{sendDocument: Function}} bot
 * @param {{now?: Date}} [opts]
 * @returns {Promise<{skipped?: string, sent: number, failed: number}>}
 * @throws اگر ارسال به حداقل یک گیرنده شکست بخورد (پس از تلاش برای همه)
 */
async function sendMonthlyXlsxReports(bot, { now = new Date() } = {}) {
  const settings = settingsRepository.getAll();
  if (!settings.reportXlsxEnabled) return { skipped: 'disabled', sent: 0, failed: 0 };

  const range = jalaliMonthRange({ previous: true, date: now });
  const year = range.jy;
  const month = range.jm;
  const closure = monthClosuresRepository.findByMonth(year, month);
  const isClosed = !!(closure && closure.status === 'closed' && closure.snapshot);
  if (settings.reportXlsxRequireClosed && !isClosed) {
    console.log(`[report-xlsx] ماه ${range.label} هنوز بسته نشده؛ طبق تنظیمات ارسال نشد.`);
    return { skipped: 'not_closed', sent: 0, failed: 0 };
  }

  const roles = parseRoles(settings.reportXlsxRecipientRoles);
  if (!roles.length) return { skipped: 'no_roles', sent: 0, failed: 0 };

  const activeUsers = usersRepository.listUsers({ onlyActive: true });
  const recipients = activeUsers.filter((u) => roles.includes(u.role) && u.telegram_user_id);
  const cache = new Map(); // کلید: شناسه‌های اسکوپ ⇒ فایل (admin/hr همه یک فایل می‌گیرند)
  let sent = 0;
  const errors = [];

  for (const recipient of recipients) {
    const scope = scopeFor(recipient, activeUsers);
    if (!scope.length) continue;
    try {
      const key = scope.map((u) => u.id).sort((a, b) => a - b).join(',');
      if (!cache.has(key)) cache.set(key, await buildFile(buildPayload({ year, month, closure, users: scope })));
      const file = cache.get(key);
      const caption = [
        `📊 گزارش ماهانه — ${range.label}`,
        isClosed ? 'ارقام: snapshot ماه بسته‌شده' : 'ارقام: محاسبه‌ی زنده (ماه هنوز بسته نشده؛ ممکن است تغییر کند)',
        file.fallback ? 'توجه: exceljs روی سرور نصب نیست؛ فقط فایل CSV شیت اصلی ارسال شد.' : '',
      ].filter(Boolean).join('\n');
      await bot.sendDocument(recipient.telegram_user_id, file.buffer, { caption }, { filename: file.filename, contentType: file.contentType });
      sent += 1;
      try {
        auditRepository.logEvent({ userId: recipient.id, action: 'report_exported', details: { source: 'scheduler', kind: 'monthly', year, month, dataSource: isClosed ? 'snapshot' : 'live', count: scope.length, format: file.fallback ? 'csv' : 'xlsx', channel: 'telegram' } });
      } catch (err) {
        console.error('[report-xlsx] ثبت audit ناموفق:', err.message);
      }
    } catch (err) {
      errors.push(`${recipient.full_name}: ${err.message}`);
      console.error('[report-xlsx] ارسال به گیرنده ناموفق:', err.message);
    }
  }
  if (errors.length) throw new Error(`ارسال xlsx ماهانه برای ${errors.length} گیرنده ناموفق بود (${sent} موفق): ${errors.slice(0, 3).join(' | ')}`);
  return { sent, failed: 0 };
}

module.exports = { sendMonthlyXlsxReports, parseRoles, scopeFor };
