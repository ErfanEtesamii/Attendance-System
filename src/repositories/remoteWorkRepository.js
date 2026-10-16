// R3 (فاز ۱۴): دسترسی به remote_work_sessions / remote_work_breaks — فقط SQL؛ قواعد و audit در remoteWorkService.
// این جدول‌ها «داده‌ی رسمی» نیستند: تا تأیید سرپرست (R5) هیچ‌چیز از اینجا وارد attendance_records / break_records نمی‌شود.
const { getDb } = require('../db/connection');

// ستون‌هایی که به کارمند نشان داده می‌شوند (بدون ip_address / reviewed_by)
const SESSION_COLS = 'id, user_id, work_date, start_at, end_at, status, auto_closed, reviewed_at, review_note, approved_start_at, approved_end_at';

function findOpenSession(userId) {
  return getDb().prepare(`SELECT ${SESSION_COLS} FROM remote_work_sessions WHERE user_id = ? AND end_at IS NULL`).get(userId) || null;
}

function findSessionById(id) {
  return getDb().prepare(`SELECT ${SESSION_COLS} FROM remote_work_sessions WHERE id = ?`).get(id) || null;
}

// نشست‌های یک روز کاری + نشستِ بازِ کاربر (حتی اگر از روز قبل مانده باشد)، به ترتیب شروع
function listForUserDate(userId, workDate) {
  return getDb()
    .prepare(`SELECT ${SESSION_COLS} FROM remote_work_sessions WHERE user_id = ? AND (work_date = ? OR end_at IS NULL) ORDER BY start_at, id`)
    .all(userId, workDate);
}

function insertSession({ userId, workDate, startAt, ip }) {
  const r = getDb()
    .prepare('INSERT INTO remote_work_sessions (user_id, work_date, start_at, ip_address) VALUES (?, ?, ?, ?)')
    .run(userId, workDate, startAt, ip || null);
  return findSessionById(r.lastInsertRowid);
}

function closeSession(id, endAt, { autoClosed = false } = {}) {
  getDb().prepare('UPDATE remote_work_sessions SET end_at = ?, auto_closed = ? WHERE id = ? AND end_at IS NULL').run(endAt, autoClosed ? 1 : 0, id);
  return findSessionById(id);
}

// نشست‌های باز که شروعشان از cutoff (ISO/UTC) قدیمی‌تر یا برابر است
function listStaleOpenSessions(cutoffIso) {
  return getDb().prepare(`SELECT ${SESSION_COLS} FROM remote_work_sessions WHERE end_at IS NULL AND start_at <= ? ORDER BY id`).all(cutoffIso);
}

function listBreaks(sessionId) {
  return getDb().prepare('SELECT id, session_id, start_at, end_at FROM remote_work_breaks WHERE session_id = ? ORDER BY start_at, id').all(sessionId);
}

function findOpenBreak(sessionId) {
  return getDb().prepare('SELECT id, session_id, start_at, end_at FROM remote_work_breaks WHERE session_id = ? AND end_at IS NULL').get(sessionId) || null;
}

function insertBreak(sessionId, startAt) {
  const r = getDb().prepare('INSERT INTO remote_work_breaks (session_id, start_at) VALUES (?, ?)').run(sessionId, startAt);
  return getDb().prepare('SELECT id, session_id, start_at, end_at FROM remote_work_breaks WHERE id = ?').get(r.lastInsertRowid);
}

function closeBreak(id, endAt) {
  getDb().prepare('UPDATE remote_work_breaks SET end_at = ? WHERE id = ? AND end_at IS NULL').run(endAt, id);
  return getDb().prepare('SELECT id, session_id, start_at, end_at FROM remote_work_breaks WHERE id = ?').get(id);
}

module.exports = {
  findOpenSession, findSessionById, listForUserDate, insertSession, closeSession, listStaleOpenSessions,
  listBreaks, findOpenBreak, insertBreak, closeBreak,
};
