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

function createLeaveRequest({ userId, startDate, endDate, leaveType, leaveTypeId, reason }) {
  const db = getDb();
  const type = resolveLeaveType({ leaveType, leaveTypeId });
  const result = db
    .prepare(
      `INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id, reason)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, startDate, endDate, type.kind, type.id, reason || null);
  return findById(result.lastInsertRowid);
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
}

function listPending() {
  const db = getDb();
  return db.prepare("SELECT * FROM leave_requests WHERE status = 'pending' ORDER BY created_at").all();
}

// برای پنل مدیریتی وب (فاز ۸): تاریخچه کامل یا فیلترشده بر اساس وضعیت
function listAll({ status } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM leave_requests WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM leave_requests ORDER BY created_at DESC').all();
}

function listByUser(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM leave_requests WHERE user_id = ? ORDER BY created_at DESC').all(userId);
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

// آیا برای این کاربر در این تاریخ یک درخواست تأییدشده از نوع مشخص وجود دارد؟
// نسخه عمومی؛ هم برای مأموریت (استثنای فاز ۲) و هم برای مرخصی (رفع گپ «غایب» فاز ۵) استفاده می‌شود.
function hasApprovedLeaveOnDate(userId, dateStr, leaveType) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM leave_requests
       WHERE user_id = ? AND leave_type = ? AND status = 'approved'
         AND ? BETWEEN start_date AND end_date`
    )
    .get(userId, leaveType, dateStr);
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
      if (existing && fields.leave_type === existing.leave_type) return;
      const type = resolveLeaveType({ leaveType: fields.leave_type });
      sets.push('leave_type = ?', 'leave_type_id = ?');
      values.push(type.kind, type.id);
      return;
    }
    sets.push(`${k} = ?`);
    values.push(fields[k]);
  });
  if (!sets.length) return findById(id);
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
  remove,
  updateManual,
  createLeaveRequest,
  findById,
  listPending,
  listAll,
  listByUser,
  setStatus,
  hasApprovedMissionOnDate,
  hasApprovedLeaveOnDate,
};
