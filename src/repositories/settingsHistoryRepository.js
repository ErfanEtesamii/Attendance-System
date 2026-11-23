// تاریخچه‌ی تاریخ‌دار تنظیمات محاسباتی (migration 058). مقدارها به‌صورت رشته‌ی serialize‌شده‌ی settings ذخیره می‌شوند.
const { getDb } = require('../db/connection');
const registry = require('../utils/settingsRegistry');
const { BASE_FROM } = require('../utils/settingsHistory');

function hasTable() {
  try { return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings_history'").get(); } catch (_) { return false; }
}

// { کلید: [{ from, value (deserialize‌شده) }] } برای settingsAt
function mapAll() {
  if (!hasTable()) return {};
  const out = {};
  for (const r of getDb().prepare('SELECT key, effective_from, value FROM settings_history ORDER BY key, effective_from').all()) {
    if (!registry.getDef(r.key)) continue;
    if (!out[r.key]) out[r.key] = [];
    out[r.key].push({ from: r.effective_from, value: registry.deserialize(r.key, r.value) });
  }
  return out;
}

function listForKey(key) {
  return getDb().prepare('SELECT effective_from AS "from", value FROM settings_history WHERE key = ? ORDER BY effective_from').all(key);
}

// ثبت «از تاریخ from مقدار تازه newSerialized است»: ردیف پایه (مقدار قبلی از ابتدا) اگر نبود ساخته می‌شود و ردیف‌های بعد از from حذف می‌شوند
// (تا مقدار فعلیِ جدول settings همان مقدار آخر تاریخچه بماند). oldSerialized = مقدار فعلی قبل از تغییر.
function recordChange(key, from, oldSerialized, newSerialized) {
  const db = getDb();
  const tx = db.transaction(() => {
    if (!listForKey(key).length) db.prepare('INSERT INTO settings_history (key, effective_from, value) VALUES (?, ?, ?)').run(key, BASE_FROM, oldSerialized);
    db.prepare('DELETE FROM settings_history WHERE key = ? AND effective_from > ?').run(key, from);
    db.prepare(`INSERT INTO settings_history (key, effective_from, value) VALUES (?, ?, ?)
      ON CONFLICT(key, effective_from) DO UPDATE SET value = excluded.value`).run(key, from, newSerialized);
  });
  tx();
}

module.exports = { mapAll, listForKey, recordChange };
