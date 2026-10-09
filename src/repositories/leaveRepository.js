const { getDb } = require('../db/connection');
const leaveTypesRepository = require('./leaveTypesRepository');

// S4-7b: هر درخواست به یک «نوع» (leave_types) وصل است. کانال‌های فعلی هنوز فقط 'leave' | 'mission' می‌فرستند؛ نگاشت:
// leave → annual (مرخصی استحقاقی)، mission → mission (مأموریت). ستون قدیمی leave_type همیشه برابر kind نوع انتخاب‌شده نگه داشته می‌شود
// (تا S4-7c که کدهای مصرف‌کننده به kind منتقل می‌شوند).
const LEGACY_TYPE_CODE = { leave: 'annual', mission: 'mission' };

// نوع را از leaveTypeId (اولویت) یا از مقدار قدیمی leaveType پیدا می‌کند؛ نامعتبر/ناموجود ⇒ Error (چیزی نوشته نمی‌شود)
function resolveLeaveType({ leaveType, leaveTypeId } = {}) {
  if (leaveTypeId !== undefined && leaveTypeId !== null) {
    const byId = leaveTypesRepository.findById(leaveTypeId);
    if (!byId) throw new Error(`نوع مرخصی با شناسه‌ی ${leaveTypeId} وجود ندارد.`);
    return byId;
  }
  const legacy = leaveType || 'leave';
  if (!Object.prototype.hasOwnProperty.call(LEGACY_TYPE_CODE, legacy)) throw new Error(`مقدار leaveType نامعتبر است: ${legacy}`);
  const code = LEGACY_TYPE_CODE[legacy];
  const byCode = leaveTypesRepository.findByCode(code);
  if (!byCode) throw new Error(`نوع «${code}» در leave_types نیست؛ آن را از پنل (انواع مرخصی) بسازید.`);
  return byCode;
}

// S4-8a: ستون‌های واحد/مدت اختیاری‌اند (بدون آن‌ها: unit='day' و duration_minutes=NULL = رفتار قبلی). اعتبارسنجی و محاسبه‌ی مدت
// در leaveDurationService است؛ اینجا فقط ذخیره می‌شود و CHECKهای جدول (migration ۰۱۵) ناهم‌خوانی را رد می‌کنند.
function createLeaveRequest({ userId, startDate, endDate, leaveType, leaveTypeId, reason, unit, halfDayPart, startTime, endTime, durationMinutes, substituteUserId, attachment }) {
  const db = getDb();
  const type = resolveLeaveType({ leaveType, leaveTypeId });
  const result = db
    .prepare(
      `INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id, reason, unit, half_day_part, start_time, end_time, duration_minutes, substitute_user_id, attachment_id, attachment_mime, attachment_size, attachment_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId, startDate, endDate, type.kind, type.id, reason || null,
      unit || 'day', halfDayPart || null, startTime || null, endTime || null,
      durationMinutes === undefined ? null : durationMinutes,
      substituteUserId === undefined ? null : substituteUserId,
      attachment ? attachment.id : null, attachment ? attachment.mime : null, attachment ? attachment.size : null, attachment ? attachment.name || null : null
    );
  return findById(result.lastInsertRowid);
}

// درخواست‌های «زنده» (pending/approved؛ ردشده‌ها حساب نمی‌شوند) یک کاربر که با بازه‌ی [startDate, endDate] هم‌پوشانی تاریخی دارند (S4-8a).
function listActiveInRange(userId, startDate, endDate, { excludeId } = {}) {
  const db = getDb();
  return db
    .prepare(
      `${SELECT_WITH_KIND} WHERE lr.user_id = ? AND lr.status IN ('pending','approved')
         AND lr.start_date <= ? AND lr.end_date >= ? AND (? IS NULL OR lr.id <> ?)
       ORDER BY lr.start_date, lr.id`
    )
    .all(userId, endDate, startDate, excludeId === undefined ? null : excludeId, excludeId === undefined ? null : excludeId);
}

// درخواست‌های «تأییدشده»ی یک کاربر که تاریخ date داخل بازه‌شان است (S4-8b-2؛ ورودی پنجره‌های مرخصی موتور). هر دو kind (leave و mission).
// فقط approved: pending/rejected هرگز expected را کم نمی‌کند. ردیف‌ها با `kind` و ستون‌های unit/half_day_part/start_time/end_time.
function listApprovedOnDate(userId, dateStr) {
  return getDb()
    .prepare(
      `${SELECT_WITH_KIND} WHERE lr.user_id = ? AND lr.status = 'approved' AND ? BETWEEN lr.start_date AND lr.end_date ORDER BY lr.id`
    )
    .all(userId, dateStr);
}

// درخواست‌هایی که duration_minutes ندارند (قدیمی‌ها)، قدیمی‌ترین اول (برای backfillMissingDurations)
function listMissingDuration({ limit = 500 } = {}) {
  return getDb().prepare(`${SELECT_WITH_KIND} WHERE lr.duration_minutes IS NULL ORDER BY lr.id LIMIT ?`).all(limit);
}

function setDuration(id, minutes) {
  getDb().prepare('UPDATE leave_requests SET duration_minutes = ? WHERE id = ?').run(minutes, id);
}

// S4-7c: هر ردیف خروجی علاوه بر ستون‌های leave_requests فیلد `kind` ('leave'|'mission') را از leave_types می‌گیرد؛
// مصرف‌کننده‌ها باید به `kind` تکیه کنند، نه به ستون قدیمی leave_type (که فقط برای سازگاری می‌ماند).
const SELECT_WITH_KIND = `SELECT lr.*, lt.kind AS kind FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id`;

function findById(id) {
  const db = getDb();
  return db.prepare(`${SELECT_WITH_KIND} WHERE lr.id = ?`).get(id);
}

function listPending() {
  const db = getDb();
  return db.prepare(`${SELECT_WITH_KIND} WHERE lr.status = 'pending' ORDER BY lr.created_at`).all();
}

// برای پنل مدیریتی وب (فاز ۸): تاریخچه کامل یا فیلترشده بر اساس وضعیت
function listAll({ status } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare(`${SELECT_WITH_KIND} WHERE lr.status = ? ORDER BY lr.created_at DESC`)
      .all(status);
  }
  return db.prepare(`${SELECT_WITH_KIND} ORDER BY lr.created_at DESC`).all();
}

// S4-13a: صف تأیید با فیلتر و صفحه‌بندی (همه‌ی فیلترها در SQL).
//   status: pending|approved|rejected|all | kind: leave|mission | leaveTypeId | userIds: آرایه‌ی اسکوپ (خالی ⇒ نتیجه‌ی خالی؛ null ⇒ بدون محدودیت)
//   from/to: درخواست‌هایی که بازه‌شان با [from, to] هم‌پوشانی دارد (هرکدام اختیاری) | limit: null ⇒ بدون سقف
// ترتیب: «در انتظار» قدیمی‌ترین اول (FIFO صف)، بقیه جدیدترین اول. ⇒ { rows, total } (total = پیش از صفحه‌بندی)
function listQueue({ status, kind, leaveTypeId, userIds, from, to, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { where.push('lr.status = ?'); params.push(status); }
  if (kind) { where.push('lt.kind = ?'); params.push(kind); }
  if (leaveTypeId !== undefined && leaveTypeId !== null) { where.push('lr.leave_type_id = ?'); params.push(leaveTypeId); }
  if (Array.isArray(userIds)) {
    if (!userIds.length) return { rows: [], total: 0 };
    where.push(`lr.user_id IN (${userIds.map(() => '?').join(',')})`);
    params.push(...userIds);
  }
  if (from) { where.push('lr.end_date >= ?'); params.push(from); }
  if (to) { where.push('lr.start_date <= ?'); params.push(to); }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) AS n FROM leave_requests lr JOIN leave_types lt ON lt.id = lr.leave_type_id${clause}`).get(...params).n;
  const order = status === 'pending' ? 'lr.created_at ASC, lr.id ASC' : 'lr.created_at DESC, lr.id DESC';
  const paging = limit === null ? '' : ' LIMIT ? OFFSET ?';
  const rows = db
    .prepare(`${SELECT_WITH_KIND}${clause} ORDER BY ${order}${paging}`)
    .all(...params, ...(limit === null ? [] : [limit, offset]));
  return { rows, total };
}

function listByUser(userId) {
  const db = getDb();
  return db.prepare(`${SELECT_WITH_KIND} WHERE lr.user_id = ? ORDER BY lr.created_at DESC`).all(userId);
}

function setStatus(id, status, approverId) {
  const db = getDb();
  db.prepare(
    `UPDATE leave_requests
     SET status = ?, approver_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, approverId, id);
  return findById(id);
}

// آیا برای این کاربر در این تاریخ یک درخواست تأییدشده از «kind» مشخص ('leave' | 'mission') وجود دارد؟
// S4-7c: بر پایه‌ی leave_types.kind (از طریق leave_type_id)؛ هر نوع دلخواه (استعلاجی، بدون حقوق، …) با kind خودش شمرده می‌شود.
// kind نامعتبر ⇒ Error (به‌جای «هیچ‌وقت true نمی‌شود» بی‌صدا).
const KINDS = ['leave', 'mission'];
function hasApprovedLeaveOnDate(userId, dateStr, kind) {
  if (!KINDS.includes(kind)) throw new Error(`kind نامعتبر است: ${kind}`);
  const db = getDb();
  const row = db
    .prepare(
      `SELECT 1 FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.user_id = ? AND lt.kind = ? AND lr.status = 'approved'
         AND ? BETWEEN lr.start_date AND lr.end_date
       LIMIT 1`
    )
    .get(userId, kind, dateStr);
  return Boolean(row);
}

// آیا برای این کاربر در این تاریخ یک «مأموریت تأییدشده» وجود دارد؟
// در فاز ۷ این تابع برای معاف کردن کاربر از چک IP فاز ۲ استفاده می‌شود.
function hasApprovedMissionOnDate(userId, dateStr) {
  return hasApprovedLeaveOnDate(userId, dateStr, 'mission');
}

function remove(id) {
  getDb().prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
}

// ویرایش/تغییر تصمیم توسط ادمین کل (پنل وب)
function updateManual(id, fields, approverId) {
  const db = getDb();
  const allowed = ['start_date', 'end_date', 'leave_type', 'status', 'reason'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
  if (!keys.length) return findById(id);
  const existing = findById(id);
  const sets = [];
  const values = [];
  keys.forEach((k) => {
    if (k === 'leave_type') {
      // همان kind قبلی دوباره فرستاده شد ⇒ نوع دقیق (مثلاً استعلاجی) نباید به annual برگردد
      if (existing && fields.leave_type === existing.kind) return;
      const type = resolveLeaveType({ leaveType: fields.leave_type });
      sets.push('leave_type = ?', 'leave_type_id = ?');
      values.push(type.kind, type.id);
      return;
    }
    sets.push(`${k} = ?`);
    values.push(fields[k]);
  });
  if (!sets.length) return findById(id);
  // S4-8a: تغییر تاریخ، مدتِ محاسبه‌شده را کهنه می‌کند ⇒ NULL (با backfill دوباره پر می‌شود). نیم‌روز/ساعتی فقط یک روز است.
  if (fields.start_date !== undefined || fields.end_date !== undefined) {
    const nextStart = fields.start_date !== undefined ? fields.start_date : existing && existing.start_date;
    const nextEnd = fields.end_date !== undefined ? fields.end_date : existing && existing.end_date;
    if (existing && existing.unit !== 'day' && nextStart !== nextEnd) {
      throw new Error('درخواست نیم‌روز/ساعتی فقط یک روز است؛ تاریخ شروع و پایان باید یکی بماند.');
    }
    sets.push('duration_minutes = NULL');
  }
  if (fields.status) {
    sets.push('approver_id = ?');
    values.push(approverId || null);
  }
  db.prepare(`UPDATE leave_requests SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
    ...values,
    id
  );
  return findById(id);
}

module.exports = {
  resolveLeaveType,
  listActiveInRange,
  listApprovedOnDate,
  listMissingDuration,
  setDuration,
  remove,
  updateManual,
  createLeaveRequest,
  findById,
  listPending,
  listAll,
  listQueue,
  listByUser,
  setStatus,
  hasApprovedMissionOnDate,
  hasApprovedLeaveOnDate,
};
