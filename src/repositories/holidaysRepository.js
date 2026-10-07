const { getDb } = require('../db/connection');

function listHolidays() {
  const db = getDb();
  return db.prepare('SELECT * FROM holidays ORDER BY holiday_date').all();
}

// «تعطیلی کامل برای همه» (kind=full و scope=all) — معنای قبلیِ isHoliday که مصرف‌کننده‌های فعلی (Jobها، گزارش‌ها) به آن تکیه دارند.
// تعطیلی نیم‌روز/دپارتمانی عمداً اینجا نمی‌آید؛ آن‌ها با getCalendarDay (S3-7c) وصل می‌شوند.
function isHoliday(dateStr) {
  const db = getDb();
  return Boolean(db.prepare("SELECT 1 FROM holidays WHERE holiday_date = ? AND scope = 'all' AND kind = 'full'").get(dateStr));
}

// همه‌ی ردیف‌های یک تاریخ (همه‌ی نوع‌ها و دامنه‌ها؛ معمولاً ۰ تا ۲ ردیف) برای getCalendarDay
function listByDate(dateStr) {
  const db = getDb();
  return db.prepare('SELECT * FROM holidays WHERE holiday_date = ? ORDER BY id').all(dateStr);
}

// opts (اختیاری): { kind: 'full'|'half'، halfEndTime، scope: 'all'|'department'، department }؛ ندادن = تعطیلی کامل برای همه (رفتار قبلی).
// ورودی نامعتبر را CHECK جدول با خطا رد می‌کند (اعتبارسنجی کاربرپسند در S3-9b). ردیف تکراری (تاریخ+دامنه+دپارتمان) درج نمی‌شود و ردیف موجود برمی‌گردد.
function addHoliday(dateStr, title, opts = {}) {
  const db = getDb();
  const kind = opts.kind || 'full';
  const scope = opts.scope || 'all';
  const department = scope === 'department' ? opts.department || '' : '';
  const halfEndTime = kind === 'half' ? opts.halfEndTime || null : null;
  const find = db.prepare('SELECT * FROM holidays WHERE holiday_date = ? AND scope = ? AND department = ?');
  const existing = find.get(dateStr, scope, department);
  if (existing) return existing;
  // INSERT ساده (نه OR IGNORE): OR IGNORE نقض CHECK را هم بی‌صدا می‌بلعد
  db.prepare('INSERT INTO holidays (holiday_date, title, kind, half_end_time, scope, department) VALUES (?, ?, ?, ?, ?, ?)').run(dateStr, title, kind, halfEndTime, scope, department);
  return find.get(dateStr, scope, department);
}

function getHoliday(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM holidays WHERE id = ?').get(id) || null;
}

// S3-9b: ویرایش یک تعطیلی (مقدارهای «از قبل معتبر»؛ اعتبارسنجی در route). ردیف دیگری با همان (تاریخ، دامنه، دپارتمان) ⇒ { conflict: true } بدون تغییر.
// ردیف نبود ⇒ null. خروجی موفق: ردیف جدید.
function updateHoliday(id, fields) {
  const db = getDb();
  const current = db.prepare('SELECT * FROM holidays WHERE id = ?').get(id);
  if (!current) return null;
  const kind = fields.kind || 'full';
  const scope = fields.scope || 'all';
  const department = scope === 'department' ? fields.department || '' : '';
  const halfEndTime = kind === 'half' ? fields.halfEndTime || null : null;
  const dup = db.prepare('SELECT id FROM holidays WHERE holiday_date = ? AND scope = ? AND department = ? AND id <> ?').get(fields.date, scope, department, id);
  if (dup) return { conflict: true };
  db.prepare('UPDATE holidays SET holiday_date = ?, title = ?, kind = ?, half_end_time = ?, scope = ?, department = ? WHERE id = ?')
    .run(fields.date, fields.title, kind, halfEndTime, scope, department, id);
  return db.prepare('SELECT * FROM holidays WHERE id = ?').get(id);
}

function removeHoliday(id) {
  const db = getDb();
  db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
}

module.exports = { listHolidays, isHoliday, listByDate, getHoliday, addHoliday, updateHoliday, removeHoliday };
