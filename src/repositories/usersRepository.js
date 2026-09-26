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

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  db.prepare(`UPDATE users SET ${setClause}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return findById(id);
}

function deactivateUser(id) {
  return updateUser(id, { is_active: 0 });
}

module.exports = {
  listUsers,
  findById,
  findByTelegramId,
  createUser,
  updateUser,
  deactivateUser,
};
