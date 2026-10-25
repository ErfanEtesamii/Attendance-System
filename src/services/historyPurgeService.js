// پاک‌سازی محدودِ داده‌های گذشته: فقط تردد و برنامه‌ی هفتگیِ بازه.
// این سرویس عمداً از «ریست کامل سیستم» جداست تا هیچ گروهِ دیگری به‌طور
// اتفاقی وارد دامنه‌ی حذف نشود.

const { getDb } = require('../db/connection');
const auditRepository = require('../repositories/auditRepository');
const maintenanceMode = require('../utils/maintenanceMode');
const { todayDateString } = require('../utils/serverTime');
const backup = require('../bot/scheduler/backup');

class HistoryPurgeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HistoryPurgeError';
    this.code = code;
  }
}

const CONFIRM_WORD = 'حذف تاریخچه';

const ENTRIES = Object.freeze([
  { table: 'break_records', label: 'استراحت‌های رکوردهای تردد', where: 'attendance_record_id IN (SELECT id FROM attendance_records WHERE record_date BETWEEN ? AND ?)' },
  { table: 'dispute_messages', label: 'پیام‌های اعتراضِ رکوردهای تردد', where: 'dispute_id IN (SELECT id FROM record_disputes WHERE attendance_record_id IN (SELECT id FROM attendance_records WHERE record_date BETWEEN ? AND ?))' },
  { table: 'record_disputes', label: 'اعتراض‌های مرتبط با تردد', where: 'attendance_record_id IN (SELECT id FROM attendance_records WHERE record_date BETWEEN ? AND ?)' },
  { table: 'overtime_approvals', label: 'تأییدهای اضافه‌کاریِ همان ترددها', where: 'attendance_record_id IN (SELECT id FROM attendance_records WHERE record_date BETWEEN ? AND ?)' },
  { table: 'attendance_records', label: 'رکوردهای رفت‌وآمد', where: 'record_date BETWEEN ? AND ?' },
  { table: 'task_daily_logs', label: 'گزارش‌های روزانه‌ی برنامه‌های هفتگی', where: 'task_id IN (SELECT id FROM plan_tasks WHERE plan_id IN (SELECT id FROM weekly_plans WHERE week_start_date BETWEEN ? AND ?))' },
  { table: 'plan_tasks', label: 'تسک‌های برنامه‌های هفتگی', where: 'plan_id IN (SELECT id FROM weekly_plans WHERE week_start_date BETWEEN ? AND ?)' },
  { table: 'weekly_plans', label: 'برنامه‌های هفتگی', where: 'week_start_date BETWEEN ? AND ?' },
]);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function normalizeRange({ fromDate, toDate } = {}) {
  if (!validDate(fromDate) || !validDate(toDate)) {
    throw new HistoryPurgeError('INVALID_DATE', 'ابتدا و انتهای بازه باید تاریخ معتبر میلادی با قالب YYYY-MM-DD باشند.');
  }
  if (fromDate > toDate) throw new HistoryPurgeError('INVALID_RANGE', 'تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.');
  if (toDate >= todayDateString()) throw new HistoryPurgeError('PAST_ONLY', 'فقط داده‌های پیش از امروز را می‌توان پاک کرد.');
  return { fromDate, toDate };
}

function preview(input = {}, db = getDb()) {
  const { fromDate, toDate } = normalizeRange(input);
  const tables = ENTRIES.map((entry) => ({
    table: entry.table,
    label: entry.label,
    count: db.prepare(`SELECT COUNT(*) AS c FROM ${entry.table} WHERE ${entry.where}`).get(fromDate, toDate).c,
  }));
  return { fromDate, toDate, tables, total: tables.reduce((sum, row) => sum + row.count, 0) };
}

let running = false;

async function execute(input = {}, { actor = null, ip = null } = {}) {
  const { fromDate, toDate } = normalizeRange(input);
  if (running) throw new HistoryPurgeError('BUSY', 'یک پاک‌سازی دیگر در حال اجراست.');
  running = true;
  try {
    let backupInfo;
    try {
      backupInfo = await backup.runPreResetBackup();
    } catch (err) {
      throw new HistoryPurgeError('BACKUP_FAILED', `بک‌آپ پیش از پاک‌سازی ناموفق بود؛ هیچ داده‌ای حذف نشد: ${err.message}`);
    }

    maintenanceMode.enter('history_purge');
    try {
      const db = getDb();
      const deleted = {};
      db.transaction(() => {
        for (const entry of ENTRIES) {
          deleted[entry.table] = db.prepare(`DELETE FROM ${entry.table} WHERE ${entry.where}`).run(fromDate, toDate).changes;
        }
      }).immediate();
      const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);
      auditRepository.logEvent({
        userId: actor,
        action: 'historical_data_purged',
        ipAddress: ip,
        details: { fromDate, toDate, deleted, total, backupFile: backupInfo.file },
      });
      return { fromDate, toDate, deleted, total, backup: backupInfo };
    } finally {
      maintenanceMode.leave();
    }
  } finally {
    running = false;
  }
}

function checkRequest(body, adminUser) {
  if (!adminUser || adminUser.role !== 'admin') {
    return { ok: false, status: 403, code: 'forbidden', error: 'فقط ادمین کل می‌تواند داده‌های گذشته را پاک کند.' };
  }
  let range;
  try { range = normalizeRange(body || {}); } catch (err) {
    if (err instanceof HistoryPurgeError) return { ok: false, status: 400, code: err.code, error: err.message };
    throw err;
  }
  if (String((body || {}).confirmText || '').trim() !== CONFIRM_WORD) {
    return { ok: false, status: 400, code: 'confirm_required', error: 'برای تأیید باید عبارت «حذف تاریخچه» را دقیقاً بنویسید.' };
  }
  return { ok: true, range };
}

module.exports = { HistoryPurgeError, CONFIRM_WORD, ENTRIES, normalizeRange, preview, execute, checkRequest };
