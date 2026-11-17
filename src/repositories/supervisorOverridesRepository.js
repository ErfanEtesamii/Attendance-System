// فاز D (بخش ۱): دسترسی به جدول supervisor_overrides. فقط خواندن/نوشتن؛ اعتبارسنجی و اولویت در supervisorOverrideService.
const { getDb } = require('../db/connection');

function parse(raw) {
  try { return JSON.parse(raw); } catch (_) { return undefined; }
}

// ⇒ { [key]: value } (مقدار خراب نادیده گرفته می‌شود)
function listByUser(userId) {
  const rows = getDb().prepare('SELECT key, value FROM supervisor_overrides WHERE user_id = ?').all(userId);
  const out = {};
  for (const r of rows) {
    const v = parse(r.value);
    if (v !== undefined) out[r.key] = v;
  }
  return out;
}

// ⇒ مقدار یا undefined
function get(userId, key) {
  const row = getDb().prepare('SELECT value FROM supervisor_overrides WHERE user_id = ? AND key = ?').get(userId, key);
  return row ? parse(row.value) : undefined;
}

// ⇒ Map(userId → value) برای یک کلید (یک کوئری برای همه‌ی سرپرست‌ها؛ مناسب job های شبانه)
function mapForKey(key) {
  const rows = getDb().prepare('SELECT user_id, value FROM supervisor_overrides WHERE key = ?').all(key);
  const out = new Map();
  for (const r of rows) {
    const v = parse(r.value);
    if (v !== undefined) out.set(r.user_id, v);
  }
  return out;
}

function set(userId, key, value) {
  getDb().prepare(
    `INSERT INTO supervisor_overrides (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(userId, key, JSON.stringify(value));
}

// ⇒ true اگر سطری حذف شد
function remove(userId, key) {
  return getDb().prepare('DELETE FROM supervisor_overrides WHERE user_id = ? AND key = ?').run(userId, key).changes > 0;
}

module.exports = { listByUser, get, mapForKey, set, remove };
