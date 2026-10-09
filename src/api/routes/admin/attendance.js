// رکوردهای تردد و استراحت‌ها: جستجو، خروجی، جزئیات، ایجاد/اصلاح/حذف.
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const { getDb } = require('../../../db/connection');
const { requirePermission } = require('../../../middleware/permissions');
const usersRepository = require('../../../repositories/usersRepository');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const breakRepository = require('../../../repositories/breakRepository');
const disputeRepository = require('../../../repositories/disputeRepository');
const auditRepository = require('../../../repositories/auditRepository');
const { notifyUser } = require('../../../bot/notifier');
const { sendTable, exportAuditFields } = require('../../../utils/xlsx'); // S5-1a: پیش‌فرض CSV؛ ?format=xlsx ⇒ xlsx (بدون exceljs ⇒ CSV + اعلام fallback)
const { isoDateToJalaliString } = require('../../../utils/jalali');
const { DATE_RE, STATUSES, scopedUserIds, visibleUsers, canAccessUser, parseRange, isoOrNull, enrichRecord, requireReason, audit, auditChange } = require('./common');
const { attendanceRecordView, breakView } = require('../../../utils/auditViews');

// ---------- اصلاح دستی رکورد تردد (فقط ادمین کل) ----------

router.patch('/admin/attendance-records/:id', requirePermission('records.edit'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const record = attendanceRepository.findById(id);
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  const allowedIds = scopedUserIds(req.adminUser);
  if (allowedIds !== null && !allowedIds.includes(record.user_id)) {
    return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  }

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

  auditChange(req, {
    action: 'attendance_record_manually_fixed',
    entityType: 'attendance_record',
    entityId: id,
    before: attendanceRecordView(record),
    after: attendanceRecordView(updated),
    reason: reason.trim(),
    meta: { recordId: id, targetUserId: record.user_id, fields: Object.keys(fields) },
  });

  const employee = usersRepository.findById(record.user_id);
  if (employee?.telegram_user_id) {
    notifyUser(
      employee.telegram_user_id,
      `رکورد تردد شما در تاریخ ${record.record_date} توسط ${req.adminUser.role === 'admin' ? 'ادمین' : 'سرپرست'} اصلاح شد.\nدلیل: ${reason.trim()}`
    );
  }

  res.json(updated);
});

// ---------- جستجو و مرور همه‌ی رکوردهای تردد ----------

function filteredAttendance(req) {
  const { from, to } = parseRange(req.query, 7);
  const { userId, department, status, q } = req.query;
  let users = visibleUsers(req.adminUser);
  if (userId) users = users.filter((u) => String(u.id) === String(userId));
  if (department) users = users.filter((u) => (u.department || '') === department);
  if (q) {
    const needle = q.toString().trim().toLowerCase();
    users = users.filter(
      (u) =>
        (u.full_name || '').toLowerCase().includes(needle) ||
        (u.personnel_code || '').toLowerCase().includes(needle)
    );
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const records = attendanceRepository.search({
    from,
    to,
    userIds: users.map((u) => u.id),
    status: STATUSES.includes(status) ? status : null,
    limit,
  });
  const userMap = new Map(users.map((u) => [u.id, u]));
  return { from, to, records, userMap };
}

router.get('/admin/attendance', requirePermission('attendance.read'), (req, res) => {
  const { from, to, records, userMap } = filteredAttendance(req);
  res.json({ from, to, count: records.length, records: records.map((r) => enrichRecord(r, userMap)) });
});

router.get('/admin/attendance/export', requirePermission('attendance.read'), (req, res) => {
  const { from, to, records, userMap } = filteredAttendance(req);
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('fa-IR') : '');
  const rows = records.map((r) => {
    const e = enrichRecord(r, userMap);
    return [
      e.user?.fullName || '', e.user?.personnelCode || '', e.user?.department || '',
      r.record_date, isoDateToJalaliString(r.record_date), fmt(r.check_in_time), r.check_in_ip || '', fmt(r.check_out_time),
      r.check_out_ip || '', e.breakMinutes, e.summary.effectiveMinutes ?? '', e.summary.lateMinutes,
      e.summary.earlyLeaveMinutes, e.summary.overtimeMinutes, r.status,
    ];
  });
  // S5-1c: audit درست قبل از ارسال بدنه و با قالب واقعاً تحویل‌شده (csv/xlsx/fallback/streamed)
  return sendTable(
    req,
    res,
    `attendance-records_${from}_${to}.csv`,
    ['نام', 'کد پرسنلی', 'دپارتمان', 'تاریخ', 'تاریخ شمسی', 'ورود', 'IP ورود', 'خروج', 'IP خروج',
      'دقیقه استراحت', 'دقیقه مفید', 'دقیقه تأخیر', 'دقیقه خروج زودهنگام', 'دقیقه اضافه‌کاری', 'وضعیت'],
    rows,
    { onExport: (info) => audit(req, 'attendance_exported', { from, to, count: rows.length, ...exportAuditFields(info) }) }
  );
});

// ---------- جزئیات یک رکورد (استراحت‌ها، IPها، تاریخچه‌ی تغییرات) ----------

router.get('/admin/attendance-records/:id', requirePermission('attendance.read'), (req, res) => {
  const record = attendanceRepository.findById(parseInt(req.params.id, 10));
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  if (!canAccessUser(req.adminUser, record.user_id)) {
    return res.status(403).json({ error: 'به این رکورد دسترسی ندارید.' });
  }
  let history = [];
  if (req.adminUser.role === 'admin') {
    history = auditRepository
      .search({ q: `"recordId":${record.id}`, limit: 50 })
      .map((r) => ({ ...r, userFullName: r.user_id ? usersRepository.findById(r.user_id)?.full_name : null }));
  }
  const disputes = disputeRepository
    .listByUser(record.user_id)
    .filter((d) => d.attendance_record_id === record.id);
  res.json({ ...enrichRecord(record), history, disputes });
});

router.post('/admin/attendance-records', requirePermission('records.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const { userId, date, checkInTime, checkOutTime, status } = req.body || {};
  const user = usersRepository.findById(parseInt(userId, 10));
  if (!user) return res.status(404).json({ error: 'کارمند یافت نشد.' });
  if (!canAccessUser(req.adminUser, user.id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  if (!DATE_RE.test(date || '')) return res.status(400).json({ error: 'تاریخ نامعتبر است (YYYY-MM-DD).' });
  const ci = isoOrNull(checkInTime);
  const co = isoOrNull(checkOutTime);
  if (ci === 'INVALID' || co === 'INVALID') return res.status(400).json({ error: 'ساعت نامعتبر است.' });
  if (ci && co && new Date(co) < new Date(ci)) {
    return res.status(400).json({ error: 'ساعت خروج نمی‌تواند قبل از ورود باشد.' });
  }
  const st = STATUSES.includes(status) ? status : 'normal';
  const existing = getDb()
    .prepare('SELECT id FROM attendance_records WHERE user_id = ? AND record_date = ?')
    .get(user.id, date);
  if (existing) {
    return res.status(409).json({ error: 'برای این کارمند در این تاریخ از قبل رکورد وجود دارد.', recordId: existing.id });
  }
  const created = attendanceRepository.createManual({
    userId: user.id, recordDate: date, checkInTime: ci, checkOutTime: co, status: st,
  });
  auditChange(req, {
    action: 'attendance_record_manually_created',
    entityType: 'attendance_record',
    entityId: created.id,
    before: null,
    after: attendanceRecordView(created),
    reason,
    meta: { recordId: created.id, targetUserId: user.id },
  });
  res.status(201).json(enrichRecord(created));
});

router.delete('/admin/attendance-records/:id', requirePermission('records.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const record = attendanceRepository.findById(parseInt(req.params.id, 10));
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  if (!canAccessUser(req.adminUser, record.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  attendanceRepository.removeWithBreaks(record.id);
  auditChange(req, {
    action: 'attendance_record_deleted',
    entityType: 'attendance_record',
    entityId: record.id,
    before: attendanceRecordView(record),
    after: null,
    reason,
    meta: { recordId: record.id, targetUserId: record.user_id },
  });
  res.json({ ok: true });
});

// ---------- استراحت‌ها ----------

router.post('/admin/attendance-records/:id/breaks', requirePermission('records.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const record = attendanceRepository.findById(parseInt(req.params.id, 10));
  if (!record) return res.status(404).json({ error: 'رکورد یافت نشد.' });
  if (!canAccessUser(req.adminUser, record.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  const { breakType, startTime, endTime } = req.body || {};
  const st = isoOrNull(startTime);
  const en = isoOrNull(endTime);
  if (!st || st === 'INVALID' || en === 'INVALID') return res.status(400).json({ error: 'زمان استراحت نامعتبر است.' });
  if (en && new Date(en) < new Date(st)) return res.status(400).json({ error: 'پایان استراحت قبل از شروع است.' });
  const created = breakRepository.createManual({
    attendanceRecordId: record.id,
    breakType: breakType === 'short_break' ? 'short_break' : 'lunch',
    startTime: st,
    endTime: en,
  });
  auditChange(req, {
    action: 'break_record_manually_created',
    entityType: 'break_record',
    entityId: created.id,
    before: null,
    after: breakView(created),
    reason,
    meta: { recordId: record.id, breakId: created.id, targetUserId: record.user_id },
  });
  res.status(201).json(created);
});

router.patch('/admin/break-records/:id', requirePermission('records.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const br = breakRepository.findById(parseInt(req.params.id, 10));
  if (!br) return res.status(404).json({ error: 'استراحت یافت نشد.' });
  const ownerRec = attendanceRepository.findById(br.attendance_record_id);
  if (!ownerRec || !canAccessUser(req.adminUser, ownerRec.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  const { breakType, startTime, endTime } = req.body || {};
  const fields = {};
  if (breakType !== undefined) fields.break_type = breakType === 'short_break' ? 'short_break' : 'lunch';
  const st = isoOrNull(startTime);
  const en = isoOrNull(endTime);
  if (st === 'INVALID' || en === 'INVALID') return res.status(400).json({ error: 'زمان نامعتبر است.' });
  if (st) fields.start_time = st;
  if (en !== undefined) fields.end_time = en;
  const startFinal = fields.start_time || br.start_time;
  const endFinal = fields.end_time !== undefined ? fields.end_time : br.end_time;
  if (endFinal && new Date(endFinal) < new Date(startFinal)) {
    return res.status(400).json({ error: 'پایان استراحت قبل از شروع است.' });
  }
  const updated = breakRepository.updateManual(br.id, fields);
  const record = attendanceRepository.findById(br.attendance_record_id);
  auditChange(req, {
    action: 'break_record_manually_edited',
    entityType: 'break_record',
    entityId: br.id,
    before: breakView(br),
    after: breakView(updated),
    reason,
    meta: { recordId: br.attendance_record_id, breakId: br.id, targetUserId: record?.user_id, fields: Object.keys(fields) },
  });
  res.json(updated);
});

router.delete('/admin/break-records/:id', requirePermission('records.edit'), (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const br = breakRepository.findById(parseInt(req.params.id, 10));
  if (!br) return res.status(404).json({ error: 'استراحت یافت نشد.' });
  const ownerRec = attendanceRepository.findById(br.attendance_record_id);
  if (!ownerRec || !canAccessUser(req.adminUser, ownerRec.user_id)) return res.status(403).json({ error: 'به این کارمند دسترسی ندارید.' });
  breakRepository.remove(br.id);
  const record = attendanceRepository.findById(br.attendance_record_id);
  auditChange(req, {
    action: 'break_record_deleted',
    entityType: 'break_record',
    entityId: br.id,
    before: breakView(br),
    after: null,
    reason,
    meta: { recordId: br.attendance_record_id, breakId: br.id, targetUserId: record?.user_id },
  });
  res.json({ ok: true });
});

module.exports = router;
