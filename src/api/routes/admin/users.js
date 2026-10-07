// کارمندان: لیست، افزودن، خروجی CSV، پروفایل، ویرایش، حذف، پرونده‌ی کامل و پیام به کارمند.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { requirePermission, ROLES } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const leaveRepository = require('../../../repositories/leaveRepository');
const holidaysRepository = require('../../../repositories/holidaysRepository');
const disputeRepository = require('../../../repositories/disputeRepository');
const auditRepository = require('../../../repositories/auditRepository');
const dayService = require('../../../engine/dayService');
const settingsRepository = require('../../../repositories/settingsRepository');
const { getCalendarDay } = require('../../../engine/calendarService');
const { todayDateString } = require('../../../utils/serverTime');
const { sendMessage } = require('../../../bot/notifier');
const { sendCsv } = require('../../../utils/csv');
const { buildClearCookie } = require('../../../utils/sessionCookie');
const { scopedUserIds, canAccessUser, parseRange, userBrief, enrichRecord, audit, auditChange, aggregateRecords, requireReason } = require('./common');
const { userView } = require('../../../utils/auditViews');

// ---------- لیست کارمندان ----------

router.get('/admin/users', requirePermission('users.read'), (req, res) => {
  const allowedIds = scopedUserIds(req.adminUser);
  let users = usersRepository.listUsers({});
  if (allowedIds !== null) users = users.filter((u) => allowedIds.includes(u.id));

  const today = todayDateString();
  // S3-7c: «تعطیل» بودن امروز برای هر کاربر از getCalendarDay (تعطیلی کامل؛ شامل دامنه‌ی دپارتمان). یک‌بار خواندن تنظیمات/ردیف‌های امروز
  const calSettings = settingsRepository.getAll();
  const calHolidays = holidaysRepository.listByDate(today);
  const withToday = users.map((u) => {
    const record = attendanceRepository.findTodayRecord(u.id);
    let todayStatus = 'not_checked_in';
    if (record) {
      todayStatus = record.check_out_time ? 'checked_out' : 'checked_in';
      if (record.status === 'incomplete') todayStatus = 'incomplete';
      if (record.status === 'holiday') todayStatus = 'holiday';
      if (record.status === 'leave') todayStatus = 'leave';
    } else if (getCalendarDay(u, today, { settings: calSettings, holidays: calHolidays }).kind === 'holiday') {
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

router.post('/admin/users', requirePermission('users.write'), (req, res) => {
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
    role: ROLES.includes(role) ? role : 'employee',
    managerId: managerId || null,
  });

  auditChange(req, {
    action: 'employee_added',
    entityType: 'user',
    entityId: user.id,
    before: null,
    after: userView(user),
    meta: { newUserId: user.id, targetUserId: user.id },
  });

  res.status(201).json(user);
});

// ---------- فاز ۶: خروجی CSV کارمندان (باید قبل از /admin/users/:id ثبت شود، وگرنه
// اکسپرس "export" را به‌عنوان مقدار :id تفسیر می‌کند) ----------

router.get('/admin/users/export', requirePermission('users.read'), (req, res) => {
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

router.get('/admin/users/:id', requirePermission('users.read'), (req, res) => {
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
  const enrichedRecords = records.map((r) => ({ ...r, summary: dayService.summarizeRecord(r) }));
  const rangeSummary = dayService.summarizeRange(records);

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

router.patch('/admin/users/:id', requirePermission('users.write'), (req, res) => {
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
  if (role !== undefined && ROLES.includes(role)) fields.role = role;
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

  auditChange(req, {
    action: 'employee_profile_edited',
    entityType: 'user',
    entityId: id,
    before: userView(user),
    after: userView(updated),
    meta: { targetUserId: id, fields: Object.keys(fields) },
  });

  res.json(updated);
});

// ---------- باطل‌کردن همه‌ی نشست‌های پنل یک کاربر (فقط ادمین کل، با دلیل اجباری) ----------
// کاربر در درخواست بعدی‌اش ۴۰۱ می‌گیرد و باید دوباره وارد شود. اگر ادمین نشست‌های خودش را باطل کند، خودش هم خارج می‌شود.
router.post('/admin/users/:id/revoke-sessions', requirePermission('users.write'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const user = usersRepository.findById(id);
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  const reason = requireReason(req, res);
  if (!reason) return;

  const version = usersRepository.revokeSessions(id);
  auditChange(req, {
    action: 'user_sessions_revoked',
    entityType: 'user',
    entityId: id,
    before: { session_version: user.session_version },
    after: { session_version: version },
    reason,
    meta: { targetUserId: id },
  });
  const selfLoggedOut = id === req.adminUser.id;
  if (selfLoggedOut) res.setHeader('Set-Cookie', buildClearCookie(req));
  res.json({ ok: true, selfLoggedOut });
});

// ---------- حذف کارمند (فقط ادمین کل) ----------
// بدون ?force=1: اگر کارمند سابقه‌ی تردد/مرخصی/اعتراض داشته باشد، ۴۰۹ با شمارش سوابق برمی‌گردد
// تا پنل هشدار بدهد. با ?force=1: حذف دائمی همراه با سوابق.

router.delete('/admin/users/:id', requirePermission('users.write'), (req, res) => {
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

  auditChange(req, {
    action: 'employee_deleted',
    entityType: 'user',
    entityId: id,
    before: userView(user),
    after: null,
    meta: { targetUserId: id, removed: counts },
  });

  res.json({ ok: true, removed: counts });
});

// ---------- پرونده‌ی کامل یک کارمند ----------

router.get('/admin/users/:id/details', requirePermission('users.details.read'), (req, res) => {
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }
  const { from, to } = parseRange(req.query, 30);
  const records = attendanceRepository.listByUserAndRange(user.id, from, to);
  const manager = user.manager_id ? usersRepository.findById(user.manager_id) : null;
  const team = usersRepository.listUsers({ managerId: user.id }).map(userBrief);
  const today = todayDateString();
  const todayRecord = attendanceRepository.findTodayRecord(user.id);

  let audits = [];
  if (req.adminUser.role === 'admin') {
    const own = auditRepository.search({ userId: user.id, limit: 100 });
    const about = auditRepository.search({ q: `"targetUserId":${user.id}`, limit: 100 });
    const seen = new Set();
    audits = [...own, ...about]
      .filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
      .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      .slice(0, 100)
      .map((r) => ({ ...r, userFullName: r.user_id ? usersRepository.findById(r.user_id)?.full_name : null }));
  }

  res.json({
    user: {
      ...userBrief(user),
      managerId: user.manager_id,
      managerName: manager ? manager.full_name : null,
      shiftId: user.shift_id == null ? null : user.shift_id,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    },
    range: { from, to },
    todayState: todayRecord ? enrichRecord(todayRecord) : null,
    stats: aggregateRecords(records),
    records: records.map((r) => enrichRecord(r)),
    leaves: leaveRepository.listByUser(user.id),
    disputes: disputeRepository.listByUser(user.id),
    team,
    audit: audits,
    onLeaveToday: leaveRepository.hasApprovedLeaveOnDate(user.id, today, 'leave'),
  });
});

router.post('/admin/users/:id/message', requirePermission('users.message'), (req, res) => {
  const user = usersRepository.findById(parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }
  const text = ((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'متن پیام خالی است.' });
  if (!user.telegram_user_id) return res.status(400).json({ error: 'این کارمند آیدی تلگرام ثبت‌شده ندارد.' });
  sendMessage(user.telegram_user_id, `📩 پیام از ${req.adminUser.full_name}:\n\n${text}`).then((ok) => {
    audit(req, 'admin_message_sent', { targetUserId: user.id, delivered: ok });
    if (!ok) return res.status(502).json({ error: 'ارسال پیام ناموفق بود (بات تنظیم نشده یا کاربر بات را مسدود کرده).' });
    res.json({ ok: true });
  });
});

module.exports = router;
