const { getDb } = require('../db/connection');

function listUsers({ onlyActive = false, managerId = null } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  if (onlyActive) conditions.push('is_active = 1');
  if (managerId != null) {
    conditions.push('manager_id = ?');
    params.push(managerId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM users ${where} ORDER BY full_name`).all(...params);
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function findByTelegramId(telegramUserId) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE telegram_user_id = ?').get(telegramUserId);
}

function createUser({ telegramUserId, fullName, personnelCode, department, role, managerId }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(telegramUserId || null, fullName, personnelCode || null, department || null, role || 'employee', managerId || null);
  return findById(result.lastInsertRowid);
}

function updateUser(id, fields) {
  const db = getDb();
  const allowed = ['telegram_user_id', 'full_name', 'personnel_code', 'department', 'role', 'manager_id', 'is_active'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findById(id);

  // بخش ۲-الف: تغییر وضعیت فعال، نقش یا آیدی تلگرام = باطل‌شدن خودکار همه‌ی نشست‌های پنل این کاربر
  // (در خود repository انجام می‌شود تا هر مسیری — پنل، بات، اسکریپت — را پوشش دهد).
  const before = findById(id);
  let bump = false;
  if (before) {
    if ('is_active' in fields && Number(fields.is_active) !== Number(before.is_active)) bump = true;
    if ('role' in fields && fields.role !== before.role) bump = true;
    if ('telegram_user_id' in fields) {
      const next = fields.telegram_user_id == null || fields.telegram_user_id === '' ? null : String(fields.telegram_user_id);
      const prev = before.telegram_user_id == null ? null : String(before.telegram_user_id);
      if (next !== prev) bump = true;
    }
  }

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  const bumpSql = bump ? ', session_version = session_version + 1' : '';
  db.prepare(`UPDATE users SET ${setClause}${bumpSql}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return findById(id);
}

// باطل‌کردن همه‌ی نشست‌های پنل یک کاربر (دکمه‌ی «خروج از همه‌ی نشست‌ها»). نسخه‌ی جدید را برمی‌گرداند یا null اگر کاربر نبود.
function revokeSessions(id) {
  const db = getDb();
  const info = db.prepare("UPDATE users SET session_version = session_version + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  if (info.changes === 0) return null;
  return findById(id).session_version;
}

// انتساب شیفت (S3-6a): shiftId = عدد یا null (بدون شیفت). وجود شیفت را route چک می‌کند؛ FK هم جلوی شیفت ناموجود را می‌گیرد.
// نسخه‌ی نشست (session_version) عمداً تغییر نمی‌کند: انتساب شیفت دسترسی کاربر را عوض نمی‌کند. کاربر نبود ⇒ null.
function setUserShift(id, shiftId) {
  const db = getDb();
  const info = db.prepare("UPDATE users SET shift_id = ?, updated_at = datetime('now') WHERE id = ?").run(shiftId, id);
  return info.changes === 0 ? null : findById(id);
}

function deactivateUser(id) {
  return updateUser(id, { is_active: 0 });
}


// تعداد سوابق وابسته به کاربر (برای هشدار قبل از حذف)
function getHistoryCounts(id) {
  const db = getDb();
  const n = (sql) => db.prepare(sql).get(id).n;
  return {
    attendance: n('SELECT COUNT(*) n FROM attendance_records WHERE user_id = ?'),
    leave: n('SELECT COUNT(*) n FROM leave_requests WHERE user_id = ?'),
    disputes: n('SELECT COUNT(*) n FROM record_disputes WHERE user_id = ?'),
    subordinates: n('SELECT COUNT(*) n FROM users WHERE manager_id = ?'),
  };
}

// حذف دائمی کاربر همراه با سوابقش (تردد، استراحت، مرخصی، اعتراض). در یک تراکنش انجام می‌شود.
// - زیرمجموعه‌های او بدون سرپرست می‌شوند (manager_id = NULL)
// - درخواست‌های مرخصی دیگران که او تأییدشان کرده باقی می‌ماند (approver_id = NULL)
// - رکوردهای audit_log (و audit_log_archive، S2-6a) حذف نمی‌شوند؛ فقط ارتباطشان با کاربر قطع می‌شود (user_id = NULL)
function deleteUserPermanently(id) {
  const db = getDb();
  const tx = db.transaction((userId) => {
    db.prepare('UPDATE users SET manager_id = NULL WHERE manager_id = ?').run(userId);
    db.prepare('UPDATE leave_requests SET approver_id = NULL WHERE approver_id = ?').run(userId);
    db.prepare(
      `DELETE FROM record_disputes WHERE user_id = ?
         OR attendance_record_id IN (SELECT id FROM attendance_records WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare(
      'DELETE FROM break_records WHERE attendance_record_id IN (SELECT id FROM attendance_records WHERE user_id = ?)'
    ).run(userId);
    db.prepare('DELETE FROM attendance_records WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM leave_requests WHERE user_id = ?').run(userId);
    db.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('UPDATE audit_log_archive SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx(id);
}

module.exports = {
  listUsers,
  findById,
  findByTelegramId,
  createUser,
  updateUser,
  deactivateUser,
  revokeSessions,
  setUserShift,
  getHistoryCounts,
  deleteUserPermanently,
};
