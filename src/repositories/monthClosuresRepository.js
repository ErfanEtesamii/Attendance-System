// بستن ماه (S5-3a). SQL فقط اینجاست. این مرحله فقط خواندن؛ نوشتن (بستن/بازکردن) در S5-3b/S5-3c می‌آید.

const { getDb } = require('../db/connection');

function parseRow(row) {
  if (!row) return null;
  const parse = (s) => {
    try { return s == null ? null : JSON.parse(s); } catch (_) { return null; }
  };
  return { ...row, snapshot: parse(row.snapshot_json), checklist: parse(row.checklist_json) };
}

// ردیف بسته‌شدنِ یک ماه شمسی (یا null اگر هرگز بسته نشده)
function findByMonth(year, month) {
  return parseRow(getDb().prepare('SELECT * FROM month_closures WHERE jalali_year = ? AND jalali_month = ?').get(year, month));
}

// خلاصه‌ی وضعیت ماه‌های یک سال (بدون snapshot سنگین)
function listByYear(year) {
  return getDb()
    .prepare(
      `SELECT id, jalali_year, jalali_month, status, period_from, period_to, close_note, close_count,
              closed_by, closed_at, reopened_by, reopened_at, reopen_reason
         FROM month_closures WHERE jalali_year = ? ORDER BY jalali_month`
    )
    .all(year);
}

// S5-3b: ثبت بسته‌شدن ماه (UPSERT در یک تراکنش با بررسی وضعیت).
//   ردیف نبود ⇒ INSERT | ردیف reopened ⇒ UPDATE (snapshot جدید، close_count+1، closed_by/at تازه) | ردیف closed ⇒ خطای ALREADY_CLOSED.
// فراخواننده (سرویس) چک‌لیست را قبلاً سنجیده؛ اینجا فقط «بسته‌شدنِ دوباره» در رقابت دو درخواست جلوگیری می‌شود.
function saveClosure({ year, month, periodFrom, periodTo, snapshot, checklist, note = null, closedBy = null }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT id, status FROM month_closures WHERE jalali_year = ? AND jalali_month = ?').get(year, month);
    const snapshotJson = JSON.stringify(snapshot);
    const checklistJson = JSON.stringify(checklist);
    if (!existing) {
      db.prepare(
        `INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to, snapshot_json, checklist_json, close_note, close_count, closed_by)
         VALUES (?, ?, 'closed', ?, ?, ?, ?, ?, 1, ?)`
      ).run(year, month, periodFrom, periodTo, snapshotJson, checklistJson, note, closedBy);
    } else if (existing.status === 'reopened') {
      db.prepare(
        `UPDATE month_closures
            SET status = 'closed', period_from = ?, period_to = ?, snapshot_json = ?, checklist_json = ?, close_note = ?,
                close_count = close_count + 1, closed_by = ?, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`
      ).run(periodFrom, periodTo, snapshotJson, checklistJson, note, closedBy, existing.id);
    } else {
      const err = new Error('این ماه از قبل بسته شده است.');
      err.code = 'ALREADY_CLOSED';
      throw err;
    }
    return findByMonth(year, month);
  });
  return tx();
}

// ماه(های) «بسته» که با بازه‌ی میلادی [from, to] هم‌پوشانی دارند (قفل ویرایش، S5-3c). status=closed فقط؛ reopened قفل نیست.
function findClosedOverlapping(from, to) {
  return getDb()
    .prepare(
      `SELECT id, jalali_year, jalali_month, period_from, period_to, close_count
         FROM month_closures WHERE status = 'closed' AND period_from <= ? AND period_to >= ? ORDER BY period_from`
    )
    .all(to, from);
}

// بازکردن ماه بسته (فقط وقتی closed است). snapshot و ردیف اصلاح‌ها می‌مانند. ⇒ ردیف به‌روز یا null (بسته نبود)
function reopen(year, month, { reopenedBy = null, reason }) {
  const res = getDb()
    .prepare(
      `UPDATE month_closures
          SET status = 'reopened', reopened_by = ?, reopened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), reopen_reason = ?
        WHERE jalali_year = ? AND jalali_month = ? AND status = 'closed'`
    )
    .run(reopenedBy, reason, year, month);
  return res.changes === 1 ? findByMonth(year, month) : null;
}

function addAdjustment({ closureId, closeCount, action, entityType, entityId = null, userId = null, effectiveDate = null, reason, details = null, adjustedBy = null }) {
  const db = getDb();
  const r = db
    .prepare(
      `INSERT INTO month_closure_adjustments (closure_id, close_count, action, entity_type, entity_id, user_id, effective_date, reason, details, adjusted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(closureId, closeCount, action, entityType, entityId, userId, effectiveDate, reason, details == null ? null : JSON.stringify(details), adjustedBy);
  return db.prepare('SELECT * FROM month_closure_adjustments WHERE id = ?').get(r.lastInsertRowid);
}

// اصلاح‌های نسخه‌ی جاری بستنِ یک ماه (جدیدترین اول)
function listAdjustments(closureId, closeCount, { limit = 200 } = {}) {
  return getDb()
    .prepare('SELECT * FROM month_closure_adjustments WHERE closure_id = ? AND close_count = ? ORDER BY id DESC LIMIT ?')
    .all(closureId, closeCount, limit)
    .map((r) => {
      let details = null;
      try { details = r.details == null ? null : JSON.parse(r.details); } catch (_) { details = null; }
      return { ...r, details };
    });
}

module.exports = { findByMonth, listByYear, saveClosure, findClosedOverlapping, reopen, addAdjustment, listAdjustments };
