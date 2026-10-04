// مسیرهای اصلی پنل مدیریتی وب (فاز ۸): لیست/جزئیات/افزودن/ویرایش کارمندان + یک داشبورد خلاصه.
// همه پشت requireAdminAuth هستند. افزودن/ویرایش کارمند فقط برای نقش admin (requireFullAdmin)؛
// مدیر دپارتمان (role=manager) فقط می‌تواند تیم خودش را ببیند (اسکوپ‌شده بر اساس manager_id).

const express = require('express');
const router = express.Router();

const { requireAdminAuth, requireFullAdmin } = require('../../middleware/adminAuth');
const usersRepository = require('../../repositories/usersRepository');
const attendanceRepository = require('../../repositories/attendanceRepository');
const auditRepository = require('../../repositories/auditRepository');
const leaveRepository = require('../../repositories/leaveRepository');
const holidaysRepository = require('../../repositories/holidaysRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const workHours = require('../../utils/workHours');
const { todayDateString } = require('../../utils/serverTime');
const { notifyUser } = require('../../bot/notifier');
const { sendCsv } = require('../../utils/csv');

router.use('/admin', requireAdminAuth);

function scopedUserIds(adminUser) {
  // ادمین کل همه را می‌بیند؛ مدیر دپارتمان فقط اعضای تیم خودش را
  if (adminUser.role === 'admin') return null; // null یعنی بدون فیلتر
  return usersRepository.listUsers({ managerId: adminUser.id }).map((u) => u.id);
}

router.get('/admin/me', (req, res) => {
  const u = req.adminUser;
  res.json({ id: u.id, fullName: u.full_name, role: u.role, department: u.department });
});

// ---------- داشبورد خلاصه ----------

router.get('/admin/dashboard', (req, res) => {
  const adminUser = req.adminUser;
  const allowedIds = scopedUserIds(adminUser);
  const allUsers =
    allowedIds === null
      ? usersRepository.listUsers({ onlyActive: true })
      : usersRepository.listUsers({ onlyActive: true }).filter((u) => allowedIds.includes(u.id));

  let presentCount = 0;
  let onBreakCount = 0;
  let incompleteCount = 0;

  allUsers.forEach((u) => {
    const record = attendanceRepository.findTodayRecord(u.id);
    if (!record) return;
    if (record.status === 'incomplete') incompleteCount += 1;
    if (record.check_in_time && !record.check_out_time) presentCount += 1;
  });

  res.json({
    totalEmployees: allUsers.length,
    presentToday: presentCount,
    incompleteToday: incompleteCount,
    date: todayDateString(),
  });
});

// ---------- لیست کارمندان ----------

router.get('/admin/users', (req, res) => {
  const allowedIds = scopedUserIds(req.adminUser);
  let users = usersRepository.listUsers({});
  if (allowedIds !== null) users = users.filter((u) => allowedIds.includes(u.id));

  const today = todayDateString();
  const withToday = users.map((u) => {
    const record = attendanceRepository.findTodayRecord(u.id);
    let todayStatus = 'not_checked_in';
    if (record) {
      todayStatus = record.check_out_time ? 'checked_out' : 'checked_in';
      if (record.status === 'incomplete') todayStatus = 'incomplete';
      if (record.status === 'holiday') todayStatus = 'holiday';
      if (record.status === 'leave') todayStatus = 'leave';
    } else if (holidaysRepository.isHoliday(today)) {
      todayStatus = 'holiday';
    } else if (leaveRepository.hasApprovedLeaveOnDate(u.id, today, 'leave')) {
      todayStatus = 'leave';
    }
    return {
      id: u.id,
      fullName: u.full_name,
      personnelCode: u.personnel_code,
      department: u.department,
      role: u.role,
      isActive: !!u.is_active,
      telegramUserId: u.telegram_user_id,
      managerId: u.manager_id,
      createdAt: u.created_at,
      todayStatus,
    };
  });

  res.json(withToday);
});

// ---------- افزودن کارمند (فقط ادمین کل) ----------

router.post('/admin/users', requireFullAdmin, (req, res) => {
  const { telegramUserId, fullName, personnelCode, department, role, managerId } = req.body || {};
  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'fullName الزامی است.' });
  }
  if (telegramUserId && usersRepository.findByTelegramId(String(telegramUserId))) {
    return res.status(409).json({ error: 'این آیدی تلگرام قبلاً ثبت شده است.' });
  }

  const user = usersRepository.createUser({
    telegramUserId: telegramUserId ? String(telegramUserId) : null,
    fullName: fullName.trim(),
    personnelCode,
    department,
    role: ['employee', 'manager', 'admin'].includes(role) ? role : 'employee',
    managerId: managerId || null,
  });

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'employee_added',
    details: { source: 'admin_panel', newUserId: user.id },
  });

  res.status(201).json(user);
});

// ---------- فاز ۶: خروجی CSV کارمندان (باید قبل از /admin/users/:id ثبت شود، وگرنه
// اکسپرس "export" را به‌عنوان مقدار :id تفسیر می‌کند) ----------

router.get('/admin/users/export', (req, res) => {
  const allowedIds = scopedUserIds(req.adminUser);
  let users = usersRepository.listUsers({});
  if (allowedIds !== null) users = users.filter((u) => allowedIds.includes(u.id));

  const rows = users.map((u) => [
    u.full_name,
    u.personnel_code || '',
    u.department || '',
    u.role,
    u.telegram_user_id || '',
    u.is_active ? 'فعال' : 'غیرفعال',
  ]);

  sendCsv(
    res,
    'employees.csv',
    ['نام کارمند', 'کد پرسنلی', 'دپارتمان', 'نقش', 'آیدی تلگرام', 'وضعیت'],
    rows
  );
});

// ---------- پروفایل یک کارمند ----------

router.get('/admin/users/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = usersRepository.findById(id);
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });

  const allowedIds = scopedUserIds(req.adminUser);
  if (allowedIds !== null && !allowedIds.includes(user.id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }

  const to = todayDateString();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  const from = fromDate.toISOString().slice(0, 10);
  const records = attendanceRepository.listByUserAndRange(user.id, from, to);
  const enrichedRecords = records.map((r) => ({ ...r, summary: workHours.summarizeRecord(r) }));
  const rangeSummary = workHours.summarizeRange(records);

  res.json({
    id: user.id,
    telegramUserId: user.telegram_user_id,
    fullName: user.full_name,
    personnelCode: user.personnel_code,
    department: user.department,
    role: user.role,
    managerId: user.manager_id,
    isActive: !!user.is_active,
    createdAt: user.created_at,
    last30Days: { from, to, ...rangeSummary },
    recentRecords: enrichedRecords,
  });
});

// ---------- ویرایش پروفایل کارمند (فقط ادمین کل) ----------

router.patch('/admin/users/:id', requireFullAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = usersRepository.findById(id);
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });

  const { fullName, personnelCode, department, role, managerId, isActive, telegramUserId } =
    req.body || {};
  // جلوگیری از قفل شدن پنل: ادمین نباید خودش را غیرفعال یا تنزل نقش کند
  if (id === req.adminUser.id) {
    if (isActive !== undefined && !isActive) {
      return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را غیرفعال کنید.' });
    }
    if (role !== undefined && role !== 'admin') {
      return res.status(400).json({ error: 'نمی‌توانید نقش خودتان را تغییر دهید.' });
    }
  }
  if (telegramUserId) {
    const other = usersRepository.findByTelegramId(String(telegramUserId));
    if (other && other.id !== id) {
      return res.status(409).json({ error: 'این آیدی تلگرام برای کارمند دیگری ثبت شده است.' });
    }
  }
  if (managerId && Number(managerId) === id) {
    return res.status(400).json({ error: 'کارمند نمی‌تواند مدیر خودش باشد.' });
  }

  const fields = {};
  if (fullName !== undefined) fields.full_name = fullName;
  if (personnelCode !== undefined) fields.personnel_code = personnelCode;
  if (department !== undefined) fields.department = department;
  if (role !== undefined && ['employee', 'manager', 'admin'].includes(role)) fields.role = role;
  if (managerId !== undefined) fields.manager_id = managerId || null;
  if (isActive !== undefined) fields.is_active = isActive ? 1 : 0;
  if (telegramUserId !== undefined) fields.telegram_user_id = telegramUserId || null;

  let updated;
  try {
    updated = usersRepository.updateUser(id, fields);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'کد پرسنلی یا آیدی تلگرام تکراری است.' });
    }
    throw err;
  }

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'employee_profile_edited',
    details: { source: 'admin_panel', targetUserId: id, fields: Object.keys(fields) },
  });

  res.json(updated);
});

// ---------- حذف کارمند (فقط ادمین کل) ----------
// بدون ?force=1: اگر کارمند سابقه‌ی تردد/مرخصی/اعتراض داشته باشد، ۴۰۹ با شمارش سوابق برمی‌گردد
// تا پنل هشدار بدهد. با ?force=1: حذف دائمی همراه با سوابق.

router.delete('/admin/users/:id', requireFullAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = usersRepository.findById(id);
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (id === req.adminUser.id) {
    return res.status(400).json({ error: 'نمی‌توانید حساب خودتان را حذف کنید.' });
  }

  const counts = usersRepository.getHistoryCounts(id);
  const hasHistory = counts.attendance + counts.leave + counts.disputes > 0;
  if (hasHistory && req.query.force !== '1') {
    return res.status(409).json({
      code: 'HAS_HISTORY',
      counts,
      error: 'این کارمند سوابق ثبت‌شده دارد.',
    });
  }

  usersRepository.deleteUserPermanently(id);

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'employee_deleted',
    ipAddress: req.ip,
    details: {
      source: 'admin_panel',
      targetUserId: id,
      fullName: user.full_name,
      personnelCode: user.personnel_code,
      telegramUserId: user.telegram_user_id,
      removed: counts,
    },
  });

  res.json({ ok: true, removed: counts });
});

// ---------- صف تأیید مرخصی/مأموریت ----------

router.get('/admin/leave-requests', (req, res) => {
  const status = req.query.status || 'pending';
  const allowedIds = scopedUserIds(req.adminUser);
  let items = status === 'all' ? leaveRepository.listAll({}) : leaveRepository.listAll({ status });
  if (allowedIds !== null) items = items.filter((r) => allowedIds.includes(r.user_id));

  const enriched = items.map((r) => {
    const employee = usersRepository.findById(r.user_id);
    return {
      id: r.id,
      leaveType: r.leave_type,
      startDate: r.start_date,
      endDate: r.end_date,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      employee: employee ? { id: employee.id, fullName: employee.full_name } : null,
    };
  });
  res.json(enriched);
});

router.post('/admin/leave-requests/:id/:decision(approve|reject)', (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const decision = req.params.decision;
  const request = leaveRepository.findById(requestId);
  if (!request) return res.status(404).json({ error: 'درخواست یافت نشد.' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'این درخواست قبلاً بررسی شده است.' });
  }

  const employee = usersRepository.findById(request.user_id);
  const isManagerOfEmployee = employee && employee.manager_id === req.adminUser.id;
  if (req.adminUser.role !== 'admin' && !isManagerOfEmployee) {
    return res.status(403).json({ error: 'این کارمند زیرمجموعه شما نیست.' });
  }

  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  const updated = leaveRepository.setStatus(requestId, newStatus, req.adminUser.id);

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: newStatus === 'approved' ? 'leave_request_approved' : 'leave_request_rejected',
    details: { source: 'admin_panel', requestId, employeeId: request.user_id },
  });

  if (employee?.telegram_user_id) {
    const typeLabel = request.leave_type === 'mission' ? 'مأموریت' : 'مرخصی';
    const statusLabel = newStatus === 'approved' ? 'تأیید شد ✅' : 'رد شد ❌';
    notifyUser(
      employee.telegram_user_id,
      `درخواست ${typeLabel} شما (${request.start_date} تا ${request.end_date}) ${statusLabel}`
    );
  }

  res.json(updated);
});

// ---------- اصلاح دستی رکورد تردد (فقط ادمین کل) ----------

router.patch('/admin/attendance-records/:id', requireFullAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = attendanceRepository.findById(id);
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });

  const { checkInTime, checkOutTime, status, reason } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'ذکر دلیل اصلاح الزامی است.' });
  }

  if (status !== undefined && !['normal', 'late', 'incomplete', 'leave', 'holiday'].includes(status)) {
    return res.status(400).json({ error: 'وضعیت نامعتبر است.' });
  }
  for (const v of [checkInTime, checkOutTime]) {
    if (v && Number.isNaN(new Date(v).getTime())) {
      return res.status(400).json({ error: 'ساعت نامعتبر است.' });
    }
  }
  const fields = {};
  if (checkInTime !== undefined) fields.check_in_time = checkInTime;
  if (checkOutTime !== undefined) fields.check_out_time = checkOutTime;
  if (status !== undefined) fields.status = status;

  const updated = attendanceRepository.manualUpdate(id, fields);

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'attendance_record_manually_fixed',
    details: { source: 'admin_panel', recordId: id, fields: Object.keys(fields), reason: reason.trim() },
  });

  const employee = usersRepository.findById(record.user_id);
  if (employee?.telegram_user_id) {
    notifyUser(
      employee.telegram_user_id,
      `رکورد تردد شما در تاریخ ${record.record_date} توسط ادمین اصلاح شد.\nدلیل: ${reason.trim()}`
    );
  }

  res.json(updated);
});

// ---------- تعطیلات رسمی ----------

router.get('/admin/holidays', (req, res) => {
  res.json(holidaysRepository.listHolidays());
});

router.post('/admin/holidays', requireFullAdmin, (req, res) => {
  const { date, title } = req.body || {};
  if (!date || !title) return res.status(400).json({ error: 'date و title الزامی هستند.' });
  const holiday = holidaysRepository.addHoliday(date, title);
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'holiday_added',
    details: { source: 'admin_panel', date, title },
  });
  res.status(201).json(holiday);
});

router.delete('/admin/holidays/:id', requireFullAdmin, (req, res) => {
  holidaysRepository.removeHoliday(parseInt(req.params.id, 10));
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'holiday_removed',
    details: { source: 'admin_panel', holidayId: req.params.id },
  });
  res.json({ ok: true });
});

// ---------- تنظیمات سیستم (ساعت کاری، آستانه‌ها) ----------

router.get('/admin/settings', (req, res) => {
  res.json(settingsRepository.getAll());
});

router.patch('/admin/settings', requireFullAdmin, (req, res) => {
  const updated = settingsRepository.update(req.body || {});
  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'settings_updated',
    details: { source: 'admin_panel', fields: Object.keys(req.body || {}) },
  });
  res.json(updated);
});

// ---------- Audit Log (فقط ادمین کل) ----------

router.get('/admin/audit-log', requireFullAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const { userId, action, from, to, q } = req.query;
  const rows = auditRepository.search({ userId, action, from, to, q, limit });

  const enriched = rows.map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    return { ...r, userFullName: u ? u.full_name : null };
  });
  res.json(enriched);
});

// ---------- فاز ۶: خروجی اکسل (CSV) ----------
// نکته: خروجی CSV با BOM است، نه .xlsx باینری واقعی - توضیح کامل در src/utils/csv.js.
// این سه مسیر همان محدوده‌ی داده‌ای (scoping بر اساس نقش) مسیرهای JSON بالا را رعایت می‌کنند.

router.get('/admin/reports/export', (req, res) => {
  const { from, to, userId } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'پارامترهای from و to (به‌فرمت YYYY-MM-DD) الزامی‌اند.' });
  }

  const allowedIds = scopedUserIds(req.adminUser);
  let team = usersRepository.listUsers({});
  if (allowedIds !== null) team = team.filter((u) => allowedIds.includes(u.id));
  if (userId) team = team.filter((u) => String(u.id) === String(userId));

  const rows = team.map((member) => {
    const records = attendanceRepository.listByUserAndRange(member.id, from, to);
    const summary = workHours.summarizeRange(records);
    return [
      member.full_name,
      member.personnel_code || '',
      member.department || '',
      summary.dayCount,
      Math.round(summary.totalEffective),
      summary.lateCount,
      summary.earlyLeaveCount,
      summary.incompleteCount,
    ];
  });

  auditRepository.logEvent({
    userId: req.adminUser.id,
    action: 'report_exported',
    details: { source: 'admin_panel', from, to, userId: userId || null },
  });

  sendCsv(
    res,
    `attendance-report_${from}_${to}.csv`,
    [
      'نام کارمند',
      'کد پرسنلی',
      'دپارتمان',
      'تعداد روز رکورد',
      'مجموع دقیقه مفید',
      'تعداد تأخیر',
      'تعداد خروج زودهنگام',
      'تعداد روز ناقص',
    ],
    rows
  );
});

router.get('/admin/audit-log/export', requireFullAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const rows = (req.query.userId
    ? auditRepository.listByUser(req.query.userId, limit)
    : auditRepository.listRecent(limit)
  ).map((r) => {
    const u = r.user_id ? usersRepository.findById(r.user_id) : null;
    return [r.id, r.occurred_at, u ? u.full_name : '', r.action, r.ip_address || '', r.details || ''];
  });

  sendCsv(res, 'audit-log.csv', ['ردیف', 'زمان', 'کارمند', 'عملیات', 'IP', 'جزئیات'], rows);
});

module.exports = router;
