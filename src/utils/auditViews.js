// S4-1b: «نمای قابل‌ثبت» موجودیت‌ها برای auditRepository.logChange (before/after).
// فقط ستون‌های بیزینسی که تغییرشان معنا دارد؛ زمان‌های سیستمی (created_at/updated_at) و ستون‌های حساس عمداً نیستند.
// خروجی null برای ورودی null ⇒ logChange آن را «ایجاد/حذف» حساب می‌کند.

function pick(row, fields) {
  if (row === null || row === undefined) return null;
  const out = {};
  fields.forEach((f) => { out[f] = row[f] === undefined ? null : row[f]; });
  return out;
}

const userView = (u) => pick(u, ['full_name', 'personnel_code', 'department', 'role', 'manager_id', 'is_active', 'telegram_user_id']);
const attendanceRecordView = (r) => pick(r, ['record_date', 'check_in_time', 'check_out_time', 'status']);
const breakView = (b) => pick(b, ['break_type', 'start_time', 'end_time']);
const leaveRequestView = (l) => pick(l, ['leave_type', 'start_date', 'end_date', 'status', 'reason', 'unit', 'half_day_part', 'start_time', 'end_time', 'duration_minutes']);
const disputeView = (d) => pick(d, ['status']);
// S4-7a: نوع مرخصی/مأموریت (ورودی = شیء camelCase خروجی leaveTypesRepository؛ code برای شناسایی در diff می‌آید)
const leaveTypeView = (t) => pick(t, ['code', 'title', 'kind', 'isPaid', 'requiresAttachment', 'countsAgainstBalance', 'allowedUnits', 'maxConsecutiveDays', 'isActive']);

module.exports = { pick, userView, attendanceRecordView, breakView, leaveRequestView, disputeView, leaveTypeView };
