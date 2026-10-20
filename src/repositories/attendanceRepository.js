const { getDb } = require('../db/connection');
const { nowIso, todayDateString } = require('../utils/serverTime');
const shiftsRepository = require('./shiftsRepository');
const settingsRepository = require('./settingsRepository');
const { isOvernightShift, shiftRecordDate } = require('../utils/shiftDay');

// تاریخ رکورد «الان» برای این کاربر (S3-6c). شیفت شب ⇒ روزِ «شروع شیفت» به وقت شرکت (ورود ۲۲:۰۰ و خروج ۰۶:۰۰ روز بعد هر دو در یک رکورد؛
// تا «پایان شیفت + outsideShiftMarginMinutes» هنوز روز قبل است). بقیه (بدون شیفت/شیفت عادی) ⇒ دقیقاً مثل قبل todayDateString().
function currentRecordDate(userId, now = new Date()) {
  const shift = shiftsRepository.findByUserId(userId);
  if (!isOvernightShift(shift)) return todayDateString();
  const s = settingsRepository.getAll();
  return shiftRecordDate(now, shift, { timezone: s.timezone, marginMinutes: s.outsideShiftMarginMinutes });
}

// «رکورد امروز» = رکورد روز جاریِ کاربر طبق currentRecordDate (برای کاربر شیفت شب: رکورد شیفتِ در جریان)
function findTodayRecord(userId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM attendance_records WHERE user_id = ? AND record_date = ?')
    .get(userId, currentRecordDate(userId));
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
}

function listByUserAndRange(userId, fromDate, toDate) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM attendance_records
       WHERE user_id = ? AND record_date BETWEEN ? AND ?
       ORDER BY record_date DESC`
    )
    .all(userId, fromDate, toDate);
}

// ثبت ورود: در صورت نبود رکورد امروز برای این کاربر، یکی می‌سازد.
// توجه: IP و timestamp همیشه در همین لایه (سمت سرور) تولید می‌شوند.
// device (اختیاری، S2-3): { deviceId, userAgent } که قبلاً با utils/deviceInfo اعتبارسنجی شده؛
// فقط ذخیره می‌شود و روی منطق ثبت اثری ندارد. بات و فراخوانی بدون device ⇒ NULL.
function recordCheckIn(userId, ip, device = {}, { viaPendingMission = false } = {}) {
  const db = getDb();
  const recordDate = currentRecordDate(userId);
  const existing = db
    .prepare('SELECT * FROM attendance_records WHERE user_id = ? AND record_date = ?')
    .get(userId, recordDate);
  if (existing) return existing; // منطق «فقط یک بار در روز» در فاز API/بات نهایی می‌شود

  const result = db
    .prepare(
      `INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_in_device, check_in_ua, status, via_pending_mission)
       VALUES (?, ?, ?, ?, ?, ?, 'normal', ?)`
    )
    .run(userId, recordDate, nowIso(), ip, device?.deviceId ?? null, device?.userAgent ?? null, viaPendingMission ? 1 : 0);
  return findById(result.lastInsertRowid);
}

function recordCheckOut(attendanceRecordId, ip, device = {}, { viaPendingMission = false } = {}) {
  const db = getDb();
  db.prepare(
    `UPDATE attendance_records
     SET via_pending_mission = CASE WHEN ? = 1 THEN 1 ELSE via_pending_mission END, check_out_time = ?, check_out_ip = ?, check_out_device = ?, check_out_ua = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(viaPendingMission ? 1 : 0, nowIso(), ip, device?.deviceId ?? null, device?.userAgent ?? null, attendanceRecordId);
  return findById(attendanceRecordId);
}

// فاز ۱۸: نوبت دوم روی همان رکورد روزانه نگه‌داری می‌شود تا قرارداد مصرف‌کننده‌های قدیمی نشکند.
function listSegments(attendanceRecordId) {
  const record = findById(attendanceRecordId);
  if (!record || !record.check_in_time) return [];
  const rows = getDb().prepare('SELECT * FROM attendance_segments WHERE attendance_record_id = ? ORDER BY seq').all(attendanceRecordId);
  return rows.length ? rows : [{ seq: 1, check_in_time: record.check_in_time, check_in_ip: record.check_in_ip, check_out_time: record.check_out_time, check_out_ip: record.check_out_ip }];
}

function startReEntry(attendanceRecordId, ip, maxReEntries = null) {
  const db = getDb(); const record = findById(attendanceRecordId);
  if (!record || !record.check_out_time) return null;
  const tx = db.transaction(() => {
    const state = db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(seq), 0) AS seq FROM attendance_segments WHERE attendance_record_id = ?').get(attendanceRecordId);
    const used = state.count ? state.count - 1 : 0;
    if (maxReEntries !== null && used >= maxReEntries) return false;
    if (!state.count) {
      db.prepare(`INSERT INTO attendance_segments
        (attendance_record_id, seq, check_in_time, check_in_ip, check_out_time, check_out_ip)
        VALUES (?, 1, ?, ?, ?, ?)`).run(attendanceRecordId, record.check_in_time, record.check_in_ip, record.check_out_time, record.check_out_ip);
    }
    const seq = state.count ? state.seq + 1 : 2;
    db.prepare('INSERT INTO attendance_segments (attendance_record_id, seq, check_in_time, check_in_ip) VALUES (?, ?, ?, ?)').run(attendanceRecordId, seq, nowIso(), ip);
    db.prepare('UPDATE attendance_records SET check_out_time = NULL, check_out_ip = NULL, check_out_device = NULL, check_out_ua = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(attendanceRecordId);
    return true;
  });
  return tx() ? findById(attendanceRecordId) : null;
}

function closeLastSegment(attendanceRecordId, ip, device = {}, { viaPendingMission = false } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM attendance_segments WHERE attendance_record_id = ? AND check_out_time IS NULL ORDER BY seq DESC LIMIT 1').get(attendanceRecordId);
  if (!row) return recordCheckOut(attendanceRecordId, ip, device, { viaPendingMission });
  db.prepare('UPDATE attendance_segments SET check_out_time = ?, check_out_ip = ? WHERE id = ?').run(nowIso(), ip, row.id);
  const updated = db.prepare('SELECT check_out_time, check_out_ip FROM attendance_segments WHERE id = ?').get(row.id);
  db.prepare(`UPDATE attendance_records SET via_pending_mission = CASE WHEN ? = 1 THEN 1 ELSE via_pending_mission END,
    check_out_time = ?, check_out_ip = ?, check_out_device = ?, check_out_ua = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(viaPendingMission ? 1 : 0, updated.check_out_time, updated.check_out_ip, device?.deviceId ?? null, device?.userAgent ?? null, attendanceRecordId);
  return findById(attendanceRecordId);
}

function removeReEntrySegment(attendanceRecordId, seq) {
  const db = getDb();
  const tx = db.transaction(() => {
    const rows = db.prepare('SELECT * FROM attendance_segments WHERE attendance_record_id = ? ORDER BY seq').all(attendanceRecordId);
    const target = rows.find((row) => row.seq === seq);
    if (!target || seq <= 1) return null;
    db.prepare('DELETE FROM attendance_segments WHERE id = ?').run(target.id);
    const left = rows.filter((row) => row.id !== target.id);
    if (left.length === 1) {
      db.prepare('DELETE FROM attendance_segments WHERE attendance_record_id = ?').run(attendanceRecordId);
      db.prepare(`UPDATE attendance_records SET check_out_time = ?, check_out_ip = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(left[0].check_out_time, left[0].check_out_ip, attendanceRecordId);
    } else {
      left.forEach((row, index) => db.prepare('UPDATE attendance_segments SET seq = ? WHERE id = ?').run(1000 + index, row.id));
      left.forEach((row, index) => db.prepare('UPDATE attendance_segments SET seq = ? WHERE id = ?').run(index + 1, row.id));
      const last = left[left.length - 1];
      db.prepare(`UPDATE attendance_records SET check_out_time = ?, check_out_ip = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(last.check_out_time, last.check_out_ip, attendanceRecordId);
    }
    return target;
  });
  return tx();
}

function updateStatus(attendanceRecordId, status) {
  const db = getDb();
  db.prepare(
    `UPDATE attendance_records SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, attendanceRecordId);
  return findById(attendanceRecordId);
}

// اصلاح دستی یک رکورد توسط ادمین (فاز ۳: دستور /fix_record ، فاز ۸: پنل وب).
// فقط لایه بالاتر (هندلر بات) مسئول محدود کردن این عملیات به نقش ادمین
// و ثبت اجباری «چه‌کسی/چه‌زمانی/چرا» در audit_log است؛ این تابع فقط خود آپدیت را انجام می‌دهد.
function manualUpdate(attendanceRecordId, fields) {
  const db = getDb();
  const allowed = ['check_in_time', 'check_out_time', 'status'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
  if (keys.length === 0) return findById(attendanceRecordId);

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE attendance_records SET ${setClause}, updated_at = datetime('now') WHERE id = ?`
    ).run(...values, attendanceRecordId);
    const segmentCount = db.prepare('SELECT COUNT(*) AS count FROM attendance_segments WHERE attendance_record_id = ?').get(attendanceRecordId).count;
    if (segmentCount && fields.check_in_time !== undefined) {
      db.prepare('UPDATE attendance_segments SET check_in_time = ? WHERE attendance_record_id = ? AND seq = 1').run(fields.check_in_time, attendanceRecordId);
    }
    if (segmentCount && fields.check_out_time !== undefined) {
      db.prepare(`UPDATE attendance_segments SET check_out_time = ?
        WHERE attendance_record_id = ? AND seq = (SELECT MAX(seq) FROM attendance_segments WHERE attendance_record_id = ?)`)
        .run(fields.check_out_time, attendanceRecordId, attendanceRecordId);
    }
  });
  tx();
  return findById(attendanceRecordId);
}

// برای روزهای غیرکاری (تعطیل رسمی/مرخصی تأییدشده): اگر کارمند هنوز هیچ رکوردی برای این تاریخ
// ندارد، یک رکورد placeholder با status مناسب می‌سازد (بدون check_in_time) تا در گزارش‌ها به‌جای
// «غایب» به‌درستی نمایش داده شود. اگر رکوردی از قبل هست (مثلاً با وجود تعطیلی/مرخصی سر کار آمده و
// ورود ثبت کرده)، به لطف UNIQUE(user_id, record_date) دست‌نخورده باقی می‌ماند.
function ensureNonWorkingDayRecord(userId, dateStr, status) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO attendance_records (user_id, record_date, status) VALUES (?, ?, ?)`
    )
    .run(userId, dateStr, status);
  return result.changes > 0;
}

// همه رکوردهای امروز (برای گزارش پایان روز و بررسی «ورود دیرهنگام»/«ناقص»)
function listAllToday() {
  const db = getDb();
  return db.prepare('SELECT * FROM attendance_records WHERE record_date = ?').all(todayDateString());
}

// رکوردهای «ناقص» تاریخ مشخص که خروج ثبت نشده (برای Job بستن خودکار پایان روز)
function listOpenRecordsByDate(dateStr) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM attendance_records WHERE record_date = ? AND check_in_time IS NOT NULL AND check_out_time IS NULL`
    )
    .all(dateStr);
}

// ردیف‌های لازم برای قاعده‌های تشخیص مورد مشکوک (S2-4e): فقط ستون‌های زمان/IP/device، بازه‌ی بسته‌ی تاریخ.
// فقط خواندنی است؛ هیچ اثری روی ثبت تردد ندارد.
function listForFraud(fromDate, toDate) {
  return getDb()
    .prepare(
      `SELECT id, user_id, record_date,
              check_in_time, check_in_ip, check_in_device,
              check_out_time, check_out_ip, check_out_device
       FROM attendance_records
       WHERE record_date BETWEEN ? AND ?
       ORDER BY record_date, id`
    )
    .all(fromDate, toDate);
}

// ساخت دستی رکورد توسط ادمین (پنل وب) - زمان‌ها از ادمین می‌آیند، نه ساعت سرور.
// لایه route مسئول الزام دلیل و ثبت در audit_log است.
function createManual({ userId, recordDate, checkInTime, checkOutTime, status }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, recordDate, checkInTime || null, checkOutTime || null, status || 'normal');
  return findById(result.lastInsertRowid);
}

// حذف کامل یک رکورد و استراحت‌های وابسته‌اش (فقط ادمین کل، با دلیل و audit)
function removeWithBreaks(id) {
  const db = getDb();
  const tx = db.transaction((recordId) => {
    db.prepare('DELETE FROM break_records WHERE attendance_record_id = ?').run(recordId);
    db.prepare('DELETE FROM record_disputes WHERE attendance_record_id = ?').run(recordId);
    db.prepare('DELETE FROM attendance_segments WHERE attendance_record_id = ?').run(recordId);
    db.prepare('DELETE FROM attendance_records WHERE id = ?').run(recordId);
  });
  tx(id);
}

// جستجوی رکوردها با فیلتر (پنل وب). userIds=null یعنی بدون محدودیت کاربر.
function search({ from, to, userIds = null, status = null, limit = 500 }) {
  const db = getDb();
  const where = ['r.record_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (userIds !== null) {
    if (!userIds.length) return [];
    where.push(`r.user_id IN (${userIds.map(() => '?').join(',')})`);
    params.push(...userIds);
  }
  if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  return db
    .prepare(
      `SELECT r.* FROM attendance_records r
       WHERE ${where.join(' AND ')}
       ORDER BY r.record_date DESC, r.id DESC LIMIT ?`
    )
    .all(...params, limit);
}

// S4-14a: رکوردهای چند کاربر در یک بازه (تقویم تیم) — یک کوئری با IN روی ایندکس idx_attendance_user_date، بدون N+1.
function listByUserIdsAndRange(userIds, fromDate, toDate) {
  if (!Array.isArray(userIds) || !userIds.length) return [];
  const db = getDb();
  const placeholders = userIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM attendance_records
       WHERE user_id IN (${placeholders}) AND record_date BETWEEN ? AND ?
       ORDER BY user_id, record_date`
    )
    .all(...userIds, fromDate, toDate);
}

module.exports = {
  currentRecordDate,
  listForFraud,
  createManual,
  removeWithBreaks,
  search,
  findTodayRecord,
  findById,
  listByUserAndRange,
  listByUserIdsAndRange,
  recordCheckIn,
  recordCheckOut,
  listSegments,
  startReEntry,
  closeLastSegment,
  removeReEntrySegment,
  updateStatus,
  manualUpdate,
  listAllToday,
  listOpenRecordsByDate,
  ensureNonWorkingDayRecord,
};
