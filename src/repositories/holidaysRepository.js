const { getDb } = require('../db/connection');

function listHolidays() {
  const db = getDb();
  return db.prepare('SELECT * FROM holidays ORDER BY holiday_date').all();
}

function isHoliday(dateStr) {
  const db = getDb();
  return Boolean(db.prepare('SELECT 1 FROM holidays WHERE holiday_date = ?').get(dateStr));
}

function addHoliday(dateStr, title) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO holidays (holiday_date, title) VALUES (?, ?)').run(dateStr, title);
  return db.prepare('SELECT * FROM holidays WHERE holiday_date = ?').get(dateStr);
}

function removeHoliday(id) {
  const db = getDb();
  db.prepare('DELETE FROM holidays WHERE id = ?').run(id);
}

module.exports = { listHolidays, isHoliday, addHoliday, removeHoliday };
