// ریست برنامه (B1): رجیستری گروه‌های پاک‌سازی + شمارش (پیش‌نمایش) + حذف. SQL فقط اینجاست.
//
// هر ورودی رجیستری = یک جدول. ترتیب آرایه = ترتیب حذف: «فرزندان قبل از والدین» (کلید خارجی).
// افزودن جدول جدید (مثلاً جدول‌های فاز D) = یک ورودی تازه در ENTRIES (فرزند را قبل از والدش بگذار)؛ هیچ جای دیگری تغییر نمی‌کند.
//
// beforeDate (اختیاری، YYYY-MM-DD میلادی): فقط ردیف‌های «قبل از آن تاریخ» حذف می‌شوند.
//   where:    شرط SQL با یک `?` برای تاریخ برش (پاک‌سازی تاریخ‌دار)
//   undated:  true ⇒ همیشه کل جدول (مثل شمارنده‌های موقت rate limit) حتی با beforeDate
//
// ⚠️ هرگز: users, work_shifts, holidays, leave_types, settings, audit_log (و آرشیو)، schema_migrations،
//   leave_balances (مقدار اولیه‌ی استحقاق)، monitor_state. این فهرست با تست قفل شده است.

const { getDb } = require('../db/connection');

const GROUPS = Object.freeze({
  operational: { label: 'داده‌ی عملیاتی (تردد، استراحت، مرخصی/ماموریت، اعتراض، اعلان‌ها و ...)', defaultSelected: true },
  balances: { label: 'تعدیل‌های مانده‌ی مرخصی (برگشت به مقدار اولیه‌ی استحقاق)', defaultSelected: false },
  jobs: { label: 'تاریخچه‌ی اجرای Jobها و هشدارهای پایش', defaultSelected: false },
});

const DAY = "substr(%s, 1, 10) < ?";
const day = (col) => DAY.replace('%s', col);
const viaRecord = (col = 'attendance_record_id') => `${col} IN (SELECT id FROM attendance_records WHERE record_date < ?)`;

// ترتیب مهم است (فرزند ⇒ والد).
const ENTRIES = Object.freeze([
  // ---- گروه الف: operational ----
  { table: 'break_records', group: 'operational', label: 'استراحت‌ها', where: viaRecord() },
  { table: 'record_disputes', group: 'operational', label: 'اعتراض‌ها', where: viaRecord() },
  { table: 'overtime_approvals', group: 'operational', label: 'تأیید اضافه‌کاری', where: viaRecord() },
  { table: 'suspicious_events', group: 'operational', label: 'موارد مشکوک', where: 'event_date < ?' },
  { table: 'attendance_records', group: 'operational', label: 'رکوردهای تردد (شامل نشانه‌ی دستگاه‌ها)', where: 'record_date < ?' },
  { table: 'leave_approvals', group: 'operational', label: 'مراحل تأیید مرخصی/ماموریت', where: 'leave_request_id IN (SELECT id FROM leave_requests WHERE end_date < ?)' },
  { table: 'leave_requests', group: 'operational', label: 'مرخصی/ماموریت‌ها (و پیوست‌ها)', where: 'end_date < ?' },
  { table: 'notifications', group: 'operational', label: 'اعلان‌ها', where: day('created_at') },
  // D1: برنامه‌ی هفتگی/گزارش روزانه (فرزند ⇒ والد؛ برش تاریخی بر پایه‌ی هفته‌ی برنامه)
  { table: 'report_reviews', group: 'operational', label: 'مشاهده‌ی گزارش‌ها توسط سرپرست', where: 'report_date < ?' },
  { table: 'task_daily_logs', group: 'operational', label: 'پاسخ‌های روزانه‌ی تسک‌ها', where: 'task_id IN (SELECT id FROM plan_tasks WHERE plan_id IN (SELECT id FROM weekly_plans WHERE week_start_date < ?))' },
  { table: 'plan_tasks', group: 'operational', label: 'تسک‌های برنامه‌ی هفتگی', where: 'plan_id IN (SELECT id FROM weekly_plans WHERE week_start_date < ?)' },
  { table: 'plan_gate_exemptions', group: 'operational', label: 'معافیت‌های گیت برنامه‌ی هفتگی', where: 'week_start_date < ?' },
  { table: 'weekly_plans', group: 'operational', label: 'برنامه‌های هفتگی', where: 'week_start_date < ?' },
  { table: 'month_closure_adjustments', group: 'operational', label: 'تعدیل‌های ماه بسته', where: 'closure_id IN (SELECT id FROM month_closures WHERE period_to < ?)' },
  { table: 'month_closures', group: 'operational', label: 'ماه‌های بسته‌شده', where: 'period_to < ?' },
  { table: 'rate_limit_hits', group: 'operational', label: 'شمارنده‌های rate limit', undated: true },
  // ---- گروه ب: اختیاری ----
  { table: 'leave_balance_adjustments', group: 'balances', label: 'تعدیل‌های مانده‌ی مرخصی', where: day('created_at') },
  { table: 'job_runs', group: 'jobs', label: 'تاریخچه‌ی اجرای Jobها', where: day('started_at') },
  { table: 'monitor_alerts', group: 'jobs', label: 'هشدارهای پایش', where: day('updated_at') },
]);

// جدول‌هایی که هرگز نباید توسط ریست لمس شوند (فقط برای قفل‌کردن با تست و نمایش در UI)
const PROTECTED_TABLES = Object.freeze([
  'users', 'work_shifts', 'holidays', 'leave_types', 'settings', 'audit_log', 'audit_log_archive',
  'schema_migrations', 'leave_balances', 'monitor_state',
]);

function entriesFor(groups) {
  const set = new Set(groups);
  return ENTRIES.filter((e) => set.has(e.group));
}

function useCut(entry, beforeDate) {
  return !!beforeDate && !entry.undated && !!entry.where;
}

function countRows(entry, beforeDate, db = getDb()) {
  if (useCut(entry, beforeDate)) {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${entry.table} WHERE ${entry.where}`).get(beforeDate).c;
  }
  return db.prepare(`SELECT COUNT(*) AS c FROM ${entry.table}`).get().c;
}

function deleteRows(entry, beforeDate, db = getDb()) {
  if (useCut(entry, beforeDate)) {
    return db.prepare(`DELETE FROM ${entry.table} WHERE ${entry.where}`).run(beforeDate).changes;
  }
  return db.prepare(`DELETE FROM ${entry.table}`).run().changes;
}

// شناسه‌ی پیوست‌های درخواست‌هایی که حذف می‌شوند (برای پاک‌کردن فایل‌ها بعد از commit)
function listAttachmentIds(beforeDate, db = getDb()) {
  const rows = beforeDate
    ? db.prepare('SELECT attachment_id AS id FROM leave_requests WHERE attachment_id IS NOT NULL AND end_date < ?').all(beforeDate)
    : db.prepare('SELECT attachment_id AS id FROM leave_requests WHERE attachment_id IS NOT NULL').all();
  return rows.map((r) => r.id);
}

// شمارنده‌ی AUTOINCREMENT فقط برای جدول‌های «کاملاً خالی» ریست می‌شود (ردیف باقی‌مانده با id تکراری برخورد می‌کرد).
function resetSequencesForEmptyTables(tables, db = getDb()) {
  const reset = [];
  for (const table of tables) {
    const empty = db.prepare(`SELECT 1 AS x FROM ${table} LIMIT 1`).get() === undefined;
    if (!empty) continue;
    db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
    reset.push(table);
  }
  return reset;
}

module.exports = {
  GROUPS, ENTRIES, PROTECTED_TABLES, entriesFor, countRows, deleteRows, listAttachmentIds, resetSequencesForEmptyTables,
};
