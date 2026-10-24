// R3 (فاز ۱۴): دسترسی به remote_work_sessions / remote_work_breaks — فقط SQL؛ قواعد و audit در remoteWorkService.
// این جدول‌ها «داده‌ی رسمی» نیستند: تا تأیید سرپرست (R5) هیچ‌چیز از اینجا وارد attendance_records / break_records نمی‌شود.
const { getDb } = require('../db/connection');

// ستون‌هایی که به کارمند نشان داده می‌شوند (بدون ip_address / reviewed_by)
const SESSION_COLS = 'id, user_id, work_date, start_at, end_at, status, source, auto_closed, reviewed_at, review_note, approved_start_at, approved_end_at';

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

// تاریخچه‌ی خود کارمند (R4): نشست‌های روز کاریِ بازه‌ی [from, to]، جدیدترین اول
function listForUserRange(userId, from, to) {
  return getDb()
    .prepare(`SELECT ${SESSION_COLS} FROM remote_work_sessions WHERE user_id = ? AND work_date >= ? AND work_date <= ? ORDER BY work_date DESC, start_at DESC, id DESC`)
    .all(userId, from, to);
}

function insertSession({ userId, workDate, startAt, ip, source = 'miniapp' }) {
  const r = getDb()
    .prepare('INSERT INTO remote_work_sessions (user_id, work_date, start_at, ip_address, source) VALUES (?, ?, ?, ?, ?)')
    .run(userId, workDate, startAt, ip || null, source);
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

// ---------- R5-۳: صف بررسی (فقط‌خواندنی) ----------
// ستون‌های صف (بدون ip_address). هم‌پوشانی با حضور حضوری: رکورد رسمیِ «حضوری» (via_remote = 0 و دارای ورود) در همان روز کاری؛
// رکوردهای ساخته‌شده از دورکاری (via_remote = 1) و ردیف‌های بدون ورود (مرخصی/تعطیل) هم‌پوشانی حساب نمی‌شوند.
// UNIQUE(user_id, record_date) روی attendance_records تضمین می‌کند JOIN ردیف تکراری نمی‌سازد.
const QUEUE_COLS = 's.id, s.user_id, s.work_date, s.start_at, s.end_at, s.status, s.source, s.auto_closed, s.reviewed_by, s.reviewed_at, s.review_note, s.approved_start_at, s.approved_end_at, s.attendance_record_id';

/**
 * @param {{userIds?: number[]|null, status?: string|null, from?: string|null, to?: string|null, userId?: number|null, limit?: number, offset?: number}} f
 *   userIds = null یعنی همه؛ آرایه‌ی خالی ⇒ نتیجه‌ی خالی. from/to بازه‌ی work_date (شامل دو سر).
 * @returns {{rows: object[], total: number}} به ترتیب قدیمی‌ترین روز اول (صف رسیدگی)
 */
function listQueue({ userIds = null, status = null, from = null, to = null, userId = null, limit = 50, offset = 0 } = {}) {
  if (Array.isArray(userIds) && userIds.length === 0) return { rows: [], total: 0 };
  const where = [];
  const params = [];
  if (Array.isArray(userIds)) {
    where.push(`s.user_id IN (${userIds.map(() => '?').join(', ')})`);
    params.push(...userIds);
  }
  if (userId !== null && userId !== undefined) { where.push('s.user_id = ?'); params.push(userId); }
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (from) { where.push('s.work_date >= ?'); params.push(from); }
  if (to) { where.push('s.work_date <= ?'); params.push(to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM remote_work_sessions s ${whereSql}`).get(...params).n;
  const rows = db.prepare(
    `SELECT ${QUEUE_COLS}, a.id AS onsite_record_id, a.check_in_time AS onsite_check_in, a.check_out_time AS onsite_check_out
     FROM remote_work_sessions s
     LEFT JOIN attendance_records a ON a.user_id = s.user_id AND a.record_date = s.work_date AND a.via_remote = 0 AND a.check_in_time IS NOT NULL
     ${whereSql}
     ORDER BY s.work_date, s.start_at, s.id
     LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  return { rows, total };
}

// استراحت‌های چند نشست در یک پرس‌وجو؛ ⇒ Map(sessionId → [break...])
function listBreaksForSessions(sessionIds) {
  const map = new Map();
  if (!sessionIds.length) return map;
  const rows = getDb()
    .prepare(`SELECT id, session_id, start_at, end_at FROM remote_work_breaks WHERE session_id IN (${sessionIds.map(() => '?').join(', ')}) ORDER BY start_at, id`)
    .all(...sessionIds);
  for (const r of rows) {
    if (!map.has(r.session_id)) map.set(r.session_id, []);
    map.get(r.session_id).push(r);
  }
  return map;
}

// ---------- R5-۴: تأیید (نوشتن؛ فقط SQL — قواعد، تراکنش و audit در remoteWorkAdminService) ----------
// ستون‌های کامل یک نشست برای تصمیم (شامل ip_address که فقط به سرپرست/ادمین می‌رسد و در رکورد رسمی به‌عنوان IP ورود/خروج می‌نشیند)
const FULL_COLS = 'id, user_id, work_date, start_at, end_at, status, source, ip_address, auto_closed, reviewed_by, reviewed_at, review_note, approved_start_at, approved_end_at, attendance_record_id';

function findSessionFull(id) {
  return getDb().prepare(`SELECT ${FULL_COLS} FROM remote_work_sessions WHERE id = ?`).get(id) || null;
}

// نشست‌های تأییدشده‌ی یک کارمند در یک روز کاری (مبنای ساخت دوباره‌ی رکورد رسمیِ همان روز)
function listApprovedForDay(userId, workDate) {
  return getDb()
    .prepare(`SELECT ${FULL_COLS} FROM remote_work_sessions WHERE user_id = ? AND work_date = ? AND status = 'approved' ORDER BY COALESCE(approved_start_at, start_at), id`)
    .all(userId, workDate);
}

// R7: نشست‌های تأییدشده‌ی چند کارمند در بازه‌ی work_date (فقط approved؛ pending/rejected هرگز وارد گزارش نمی‌شوند)
function listApprovedInRange(userIds, from, to) {
  if (!Array.isArray(userIds) || !userIds.length) return [];
  const ph = userIds.map(() => '?').join(',');
  return getDb()
    .prepare(`SELECT ${FULL_COLS} FROM remote_work_sessions WHERE status = 'approved' AND end_at IS NOT NULL AND user_id IN (${ph}) AND work_date >= ? AND work_date <= ? ORDER BY work_date, id`)
    .all(...userIds, from, to);
}

function findOfficialRecord(userId, date) {
  return getDb().prepare('SELECT * FROM attendance_records WHERE user_id = ? AND record_date = ?').get(userId, date) || null;
}

function insertRemoteRecord({ userId, date, checkIn, checkOut, ip }) {
  const r = getDb()
    .prepare(`INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_out_time, check_out_ip, status, via_remote)
              VALUES (?, ?, ?, ?, ?, ?, 'normal', 1)`)
    .run(userId, date, checkIn, ip || null, checkOut, ip || null);
  return r.lastInsertRowid;
}

function updateRemoteRecord(id, { checkIn, checkOut }) {
  getDb()
    .prepare("UPDATE attendance_records SET check_in_time = ?, check_out_time = ?, updated_at = datetime('now') WHERE id = ? AND via_remote = 1")
    .run(checkIn, checkOut, id);
}

// رکوردِ جانگهدار (مرخصی/تعطیل، بدون ورود، via_remote = 0) وقتی کارمند همان روز دورکاری تأییدشده دارد، «تصاحب» می‌شود: ساعت‌ها پر و via_remote = 1؛ status (leave/holiday) حفظ می‌شود
function adoptPlaceholder(id, { checkIn, checkOut, ip }) {
  getDb()
    .prepare("UPDATE attendance_records SET check_in_time = ?, check_in_ip = ?, check_out_time = ?, check_out_ip = ?, via_remote = 1, updated_at = datetime('now') WHERE id = ? AND via_remote = 0 AND check_in_time IS NULL")
    .run(checkIn, ip || null, checkOut, ip || null, id);
}

// استراحت‌های «دورکاری» یک رکورد (via_remote = 1) پاک و دوباره ساخته می‌شوند؛ استراحت‌های حضوری (via_remote = 0) هرگز دست نمی‌خورند
function replaceRemoteBreaks(recordId, breaks) {
  const db = getDb();
  db.prepare('DELETE FROM break_records WHERE attendance_record_id = ? AND via_remote = 1').run(recordId);
  const ins = db.prepare("INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time, via_remote) VALUES (?, 'short_break', ?, ?, 1)");
  for (const b of breaks) ins.run(recordId, b.start, b.end);
}

/**
 * pending ⇒ approved با شرط WHERE status = 'pending' (تأیید هم‌زمان/تکراری فقط یک‌بار موفق می‌شود). ⇒ تعداد ردیف تغییریافته (۰ یا ۱)
 */
function markApproved(id, { reviewedBy, reviewedAt, reviewNote, approvedStartAt, approvedEndAt, attendanceRecordId }) {
  return getDb()
    .prepare(`UPDATE remote_work_sessions
              SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ?, approved_start_at = ?, approved_end_at = ?, attendance_record_id = ?
              WHERE id = ? AND status = 'pending'`)
    .run(reviewedBy, reviewedAt, reviewNote, approvedStartAt, approvedEndAt, attendanceRecordId, id).changes;
}

// R5-۵/۶: رد (فقط pending) و ادغام در رکورد حضوری
function markRejected(id, { reviewedBy, reviewedAt, reviewNote }) {
  return getDb()
    .prepare("UPDATE remote_work_sessions SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ? AND status = 'pending'")
    .run(reviewedBy, reviewedAt, reviewNote, id).changes;
}

// ساعت ورود/خروج هر رکورد رسمی (حضوری هم) — فقط برای «ادغام» (R5-۶) که تصمیم صریح سرپرست است
function updateRecordTimes(id, { checkIn, checkOut }) {
  getDb().prepare("UPDATE attendance_records SET check_in_time = ?, check_out_time = ?, updated_at = datetime('now') WHERE id = ?").run(checkIn, checkOut, id);
}

// افزودن استراحت‌های دورکاری (via_remote = 1) بدون پاک کردن چیزی
function insertRemoteBreaks(recordId, breaks) {
  const ins = getDb().prepare("INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time, via_remote) VALUES (?, 'short_break', ?, ?, 1)");
  for (const b of breaks) ins.run(recordId, b.start, b.end);
}

// R6: خلاصه‌ی صف منتظر بررسی (نشست‌های «بسته‌شده»ی pending؛ نشست باز هنوز قابل بررسی نیست) به‌ازای هر کارمند — برای شمارنده‌ی پنل/بات و یادآوری هفتگی
// userIds = null یعنی همه؛ آرایه‌ی خالی ⇒ خالی. excludeUserId: خودِ بررسی‌کننده (دورکاری خودش را نمی‌تواند تأیید کند)
function pendingClosedByUser({ userIds = null, excludeUserId = null } = {}) {
  if (Array.isArray(userIds) && userIds.length === 0) return [];
  const where = ["s.status = 'pending'", 's.end_at IS NOT NULL'];
  const params = [];
  if (Array.isArray(userIds)) { where.push(`s.user_id IN (${userIds.map(() => '?').join(', ')})`); params.push(...userIds); }
  if (excludeUserId !== null && excludeUserId !== undefined) { where.push('s.user_id <> ?'); params.push(excludeUserId); }
  return getDb()
    .prepare(`SELECT s.user_id AS user_id, COUNT(*) AS n, MIN(s.work_date) AS oldest FROM remote_work_sessions s WHERE ${where.join(' AND ')} GROUP BY s.user_id ORDER BY MIN(s.work_date), s.user_id`)
    .all(...params);
}

module.exports = {
  listQueue, listBreaksForSessions,
  findSessionFull, listApprovedForDay, listApprovedInRange, findOfficialRecord, insertRemoteRecord, updateRemoteRecord, adoptPlaceholder, replaceRemoteBreaks, markApproved, markRejected, updateRecordTimes, insertRemoteBreaks, pendingClosedByUser,
  findOpenSession, findSessionById, listForUserDate, listForUserRange, insertSession, closeSession, listStaleOpenSessions,
  listBreaks, findOpenBreak, insertBreak, closeBreak,
};
