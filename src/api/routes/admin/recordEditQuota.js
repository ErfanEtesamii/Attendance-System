// نگهبان سقف ماهانه‌ی اصلاح رکورد سرپرست (مرحله ۲). بعد از requirePermission و قبل از handler.
// اگر هدف پیدا نشود/در اسکوپ نباشد، نگهبان کاری نمی‌کند تا handler خطای ۴۰۴/۴۰۳ خودش را بدهد.
const quota = require('../../../services/recordEditQuotaService');
const attendanceRepository = require('../../../repositories/attendanceRepository');
const breakRepository = require('../../../repositories/breakRepository');
const remoteRepo = require('../../../repositories/remoteWorkRepository');
const usersRepository = require('../../../repositories/usersRepository');
const { canAccessUser } = require('./common');

function guard(resolve) {
  return function recordEditQuotaGuard(req, res, next) {
    let target = null;
    try { target = resolve(req); } catch (_) { target = null; }
    if (!target || (target.targetUserId !== null && target.targetUserId !== undefined && !canAccessUser(req.adminUser, target.targetUserId))) return next();
    const r = quota.assertCanEdit(req.adminUser, { ...target, ip: req.ip });
    if (r.ok) return next();
    return res.status(r.status).json({ error: r.error, code: r.code, limit: r.limit, used: r.used });
  };
}

const idParam = (req) => parseInt(req.params.id, 10);
const forRecord = guard((req) => {
  const rec = attendanceRepository.findById(idParam(req));
  return rec ? { recordId: rec.id, targetUserId: rec.user_id } : null;
});
const forBreak = guard((req) => {
  const br = breakRepository.findById(idParam(req));
  const rec = br ? attendanceRepository.findById(br.attendance_record_id) : null;
  return rec ? { recordId: rec.id, targetUserId: rec.user_id } : null;
});
const forNewRecord = guard((req) => {
  const u = usersRepository.findById(parseInt((req.body || {}).userId, 10));
  return u ? { recordId: null, targetUserId: u.id } : null;
});
const forRemoteSession = guard((req) => {
  const row = remoteRepo.findSessionFull(idParam(req));
  return row ? { sessionId: row.id, targetUserId: row.user_id } : null;
});

module.exports = { guard, forRecord, forBreak, forNewRecord, forRemoteSession };
