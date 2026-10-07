// انواع مرخصی/مأموریت (S4-7a). SQL فقط اینجا. خروجی «شیء نرمال‌شده‌ی camelCase» است؛
// allowed_units ذخیره‌شده‌ی خراب (JSON نامعتبر) ⇒ آرایه‌ی خالی، نه exception (مثل work_days در shiftsRepository).
// leave_requests.leave_type_id (migration ۰۱۴، S4-7b) به این جدول وصل است و countRequests/isReferenced آن را می‌شمارند.

const { getDb } = require('../db/connection');

const UNIT_ORDER = ['day', 'half_day', 'hour'];

function parseUnits(text) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? UNIT_ORDER.filter((u) => v.includes(u)) : [];
  } catch (_) {
    return [];
  }
}

function toLeaveType(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    kind: row.kind,
    isPaid: !!row.is_paid,
    requiresAttachment: !!row.requires_attachment,
    countsAgainstBalance: !!row.counts_against_balance,
    allowedUnits: parseUnits(row.allowed_units),
    maxConsecutiveDays: row.max_consecutive_days === null ? null : row.max_consecutive_days,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listLeaveTypes({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = 1' : '';
  return getDb().prepare(`SELECT * FROM leave_types ${where} ORDER BY id`).all().map(toLeaveType);
}

function findById(id) {
  return toLeaveType(getDb().prepare('SELECT * FROM leave_types WHERE id = ?').get(id));
}

function findByCode(code) {
  return toLeaveType(getDb().prepare('SELECT * FROM leave_types WHERE code = ?').get(code));
}

function createLeaveType(v) {
  const info = getDb()
    .prepare(
      `INSERT INTO leave_types (code, title, kind, is_paid, requires_attachment, counts_against_balance, allowed_units, max_consecutive_days, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      v.code,
      v.title,
      v.kind,
      v.isPaid ? 1 : 0,
      v.requiresAttachment ? 1 : 0,
      v.countsAgainstBalance ? 1 : 0,
      JSON.stringify(v.allowedUnits),
      v.maxConsecutiveDays === undefined ? null : v.maxConsecutiveDays,
      v.isActive ? 1 : 0
    );
  return findById(info.lastInsertRowid);
}

const COLUMN_OF = {
  title: 'title',
  kind: 'kind',
  isPaid: 'is_paid',
  requiresAttachment: 'requires_attachment',
  countsAgainstBalance: 'counts_against_balance',
  allowedUnits: 'allowed_units',
  maxConsecutiveDays: 'max_consecutive_days',
  isActive: 'is_active',
};

// patch: زیرمجموعه‌ای از فیلدهای camelCase (code عمداً قابل تغییر نیست)
function updateLeaveType(id, patch) {
  const keys = Object.keys(patch).filter((k) => COLUMN_OF[k]);
  if (!keys.length) return findById(id);
  const sets = keys.map((k) => `${COLUMN_OF[k]} = ?`);
  const values = keys.map((k) => {
    const v = patch[k];
    if (k === 'allowedUnits') return JSON.stringify(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
  getDb().prepare(`UPDATE leave_types SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return findById(id);
}

// تعداد درخواست‌های این نوع؛ اگر ستون leave_type_id هنوز نیست (migration ۰۱۴ اعمال نشده) ⇒ ۰.
function countRequests(id) {
  const db = getDb();
  const hasColumn = db.pragma('table_info(leave_requests)').some((c) => c.name === 'leave_type_id');
  if (!hasColumn) return 0;
  return db.prepare('SELECT COUNT(*) AS n FROM leave_requests WHERE leave_type_id = ?').get(id).n;
}

function isReferenced(id) {
  return countRequests(id) > 0;
}

// حذف فقط وقتی هیچ درخواستی به آن اشاره نمی‌کند؛ نتیجه: true = حذف شد
function deleteIfUnused(id) {
  if (isReferenced(id)) return false;
  return getDb().prepare('DELETE FROM leave_types WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  UNIT_ORDER,
  listLeaveTypes,
  findById,
  findByCode,
  createLeaveType,
  updateLeaveType,
  countRequests,
  isReferenced,
  deleteIfUnused,
};
