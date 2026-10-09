// S5-2a/S5-2b: گزارش ماهانه‌ی شمسی — سرویس (محاسبه با computeDay، تطبیق با محاسبه‌ی دستی) و route (اسکوپ نقش).
// سناریو یک ماه کامل را می‌سازد: شهریور ۱۴۰۵ = ۲۰۲۶-۰۸-۲۳ (یکشنبه) تا ۲۰۲۶-۰۹-۲۲؛ ۳۱ روز، جمعه آخر هفته (۴ روز)،
// پنجشنبه نیم‌روز (۴ روز؛ ۲۷۰ دقیقه)، یک تعطیلی کامل (۰۹-۰۸)؛ پس روز کاری مورد انتظار = ۳۱ − ۴ − ۱ = ۲۶ و ساعت کاری کامل ۵۱۰ دقیقه.
// «الان» = ۲۰۲۶-۰۹-۱۰ ساعت ۲۰:۰۰ تهران (پنجشنبه): روزهای تا ۰۹-۰۹ گذشته‌اند، ۰۹-۱۰ «امروز» و بعدش آینده.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const { computeMonthlyReport } = require('../src/services/monthlyReportService');
const dayService = require('../src/engine/dayService');
const settingsRepo = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const leaveRepo = require('../src/repositories/leaveRepository');
const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
const holidaysRepo = require('../src/repositories/holidaysRepository');
const overtimeApprovalRepo = require('../src/repositories/overtimeApprovalRepository');
const leaveBalanceService = require('../src/services/leaveBalanceService');
const { zonedTimeToUtc } = require('../src/utils/time');
const usersRepo = require('../src/repositories/usersRepository');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const NOW = at('2026-09-10', '20:00');
const Y = 1405;
const M = 6;

function rec(userId, date, inn, out, status = 'normal') {
  return attendanceRepo.createManual({ userId, recordDate: date, checkInTime: inn ? at(date, inn) : null, checkOutTime: out ? at(date, out) : null, status });
}
function approvedLeave(userId, date, { type = 'annual', unit = 'day', startTime, endTime, minutes }) {
  const t = leaveTypesRepo.findByCode(type);
  const r = leaveRepo.createLeaveRequest({ userId, startDate: date, endDate: date, leaveTypeId: t.id, unit, startTime, endTime, durationMinutes: minutes });
  return leaveRepo.setStatus(r.id, 'approved', null);
}
const setCreatedAt = (userId, createdAt) => getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, userId);
// ردیف تازه از DB (created_at بعد از ساخت عوض شده؛ شیء برگشتیِ makeUser کهنه است)
const fresh = (u) => usersRepo.findById(u.id);

describe('گزارش ماهانه — سرویس (S5-2a)', () => {
  let admin; let emp; let newcomer; let annual;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    emp = makeUser({ name: 'الف' });
    newcomer = makeUser({ name: 'ب' });
    setCreatedAt(admin.id, '2020-01-01 00:00:00');
    setCreatedAt(emp.id, '2020-01-01 00:00:00');
    setCreatedAt(newcomer.id, '2026-09-01 08:00:00'); // UTC ⇒ ۲۰۲۶-۰۹-۰۱ به وقت شرکت
    annual = leaveTypesRepo.findByCode('annual');

    settingsRepo.update({ overtimeEnabled: true, overtimeMonthlyCapMinutes: 100 });
    holidaysRepo.addHoliday('2026-09-08', 'تعطیلی آزمایشی');
    leaveBalanceService.setEntitlement({ userId: emp.id, leaveTypeId: annual.id, jalaliYear: Y, entitledMinutes: 10000, actor: admin.id, reason: 'تست' });

    rec(emp.id, '2026-08-23', '08:00', '16:30'); // کامل
    rec(emp.id, '2026-08-24', '08:20', '16:30'); // ۲۰ دقیقه تأخیر
    rec(emp.id, '2026-08-25', '08:00', '16:00'); // ۳۰ دقیقه زودتر رفتن
    rec(emp.id, '2026-08-26', '08:00', '18:30'); // ۱۲۰ دقیقه اضافه‌کاری
    rec(emp.id, '2026-08-27', '08:00', '13:30'); // پنجشنبه نیم‌روز (پایان ۱۲:۳۰) ⇒ ۶۰ دقیقه اضافه‌کاری
    approvedLeave(emp.id, '2026-08-29', { minutes: 510 }); // شنبه: مرخصی تمام‌روز
    approvedLeave(emp.id, '2026-08-30', { type: 'mission', minutes: 510 }); // یکشنبه: مأموریت تمام‌روز
    approvedLeave(emp.id, '2026-08-31', { unit: 'hour', startTime: '10:00', endTime: '12:00', minutes: 120 }); // ساعتی
    rec(emp.id, '2026-08-31', '08:00', '16:30');
    // ۰۹-۰۱: غیبت
    rec(emp.id, '2026-09-02', '08:00', null, 'incomplete'); // ورود بدون خروج
    // ۰۹-۰۳ (پنجشنبه): غیبت
    rec(emp.id, '2026-09-05', null, null, 'leave'); // ثبت دستی مرخصی
    rec(emp.id, '2026-09-06', null, null, 'holiday'); // ثبت دستی تعطیل
    // ۰۹-۰۷ و ۰۹-۰۹: غیبت؛ ۰۹-۰۸ تعطیل رسمی؛ ۰۹-۱۰ امروز
  });
  after(cleanup);

  const get = (user, extra = {}) => computeMonthlyReport({ users: [fresh(user)], year: Y, month: M, now: NOW, ...extra }).users[0];

  test('تقویم و شمارش روزها مطابق محاسبه‌ی دستی', () => {
    const rep = computeMonthlyReport({ users: [fresh(emp)], year: Y, month: M, now: NOW });
    assert.deepEqual([rep.from, rep.to, rep.daysInMonth, rep.today], ['2026-08-23', '2026-09-22', 31, '2026-09-10']);
    const r = rep.users[0];
    assert.deepEqual(r.calendar, { daysInMonth: 31, expectedWorkDays: 26, holidayDays: 1, weekendDays: 4, halfDays: 4 });
    assert.deepEqual(r.attendance, {
      presentDays: 7, absentDays: 4, lateDays: 1, earlyLeaveDays: 1, incompleteDays: 1, pendingDays: 1, futureDays: 10,
      manualHolidayDays: 1, notStartedDays: 0, workedOnNonWorkingDays: 0, invalidDays: 0,
    });
    // اجزای انحصاری روز کاری جمعاً برابر روزهای کاری مورد انتظارند (حضور + غیبت + امروز + آینده + مرخصی + مأموریت + تعطیل دستی)
    const a = r.attendance; const l = r.leave;
    assert.equal(a.presentDays + a.absentDays + a.pendingDays + a.futureDays + a.manualHolidayDays + l.leaveDays + l.missionDays, r.calendar.expectedWorkDays);
  });

  test('زمان‌ها: مورد انتظار، مفید (بدون روز ناقص)، تأخیر، زودتر رفتن و کسری', () => {
    const t = get(emp).time;
    // مورد انتظار: ۲۲ روز کامل ×۵۱۰ + ۴ نیم‌روز ×۲۷۰ − مرخصی ۵۱۰ − مأموریت ۵۱۰ − ساعتی ۱۲۰
    assert.equal(t.expectedMinutes, 22 * 510 + 4 * 270 - 510 - 510 - 120);
    // مفید: ۵۱۰ + ۴۹۰ + ۴۸۰ + ۶۳۰ + ۳۳۰ + ۵۱۰ ؛ روز ناقص ۰۹-۰۲ (ورود بدون خروج) در جمع نیست
    assert.equal(t.effectiveMinutes, 2950);
    assert.equal(t.lateMinutes, 20);
    assert.equal(t.earlyLeaveMinutes, 30);
    // کسری: ۲۰ + ۳۰ + غیبت‌ها (۵۱۰ ۰۹-۰۱، ۲۷۰ ۰۹-۰۳ پنجشنبه، ۵۱۰ ۰۹-۰۷، ۵۱۰ ۰۹-۰۹)
    assert.equal(t.shortfallMinutes, 20 + 30 + 510 + 270 + 510 + 510);
  });

  test('مرخصی و مأموریت به تفکیک نوع؛ روز کامل در مقابل ساعتی؛ ثبت دستی بدون نوع', () => {
    const l = get(emp).leave;
    assert.deepEqual([l.leaveDays, l.leaveMinutes, l.missionDays, l.missionMinutes], [2, 630, 1, 510]);
    const by = Object.fromEntries(l.byType.map((x) => [x.leaveTypeId === null ? 'manual' : leaveTypesRepo.findById(x.leaveTypeId).code, x]));
    assert.deepEqual([by.annual.days, by.annual.minutes, by.annual.kind], [1, 630, 'leave']); // یک روز تمام + ۱۲۰ دقیقه ساعتی
    assert.deepEqual([by.mission.days, by.mission.minutes, by.mission.kind], [1, 510, 'mission']);
    assert.deepEqual([by.manual.days, by.manual.minutes], [1, 0]);
  });

  test('اضافه‌کاری: خام، قابل‌پرداخت روزانه، سقف ماهانه (روز عبورکننده و بعدی)', () => {
    const o = get(emp).overtime;
    assert.deepEqual(o, {
      rawMinutes: 180, payableDailyMinutes: 180, pendingMinutes: 0, rejectedMinutes: 0, eligibleMinutes: 180, payableMinutes: 100, clippedMinutes: 80,
    });
    const days = get(emp, { includeDays: true }).days;
    const d = Object.fromEntries(days.map((x) => [x.date, x]));
    assert.equal(d['2026-08-26'].overtimePayableFinal, 100); // روز عبورکننده فقط باقی‌مانده‌ی سقف را می‌گیرد
    assert.equal(d['2026-08-27'].overtimePayableFinal, 0); // روز بعد از سقف
  });

  test('تطبیق با dayService.computeMonthOvertime (بدون تأیید و با تأیید لازم)', () => {
    const records = attendanceRepo.listByUserAndRange(emp.id, '2026-08-23', '2026-09-22');
    const compare = () => {
      const ref = dayService.computeMonthOvertime(records, { now: NOW });
      const o = get(emp).overtime;
      assert.deepEqual(
        [o.rawMinutes, o.payableDailyMinutes, o.pendingMinutes, o.rejectedMinutes, o.eligibleMinutes, o.payableMinutes, o.clippedMinutes],
        [ref.totalOvertime, ref.totalPayableDaily, ref.pendingMinutes, ref.rejectedMinutes, ref.totalEligible, ref.totalPayable, ref.clippedMinutes],
      );
      return o;
    };
    compare();
    settingsRepo.update({ overtimeRequiresApproval: true });
    const r26 = records.find((r) => r.record_date === '2026-08-26');
    overtimeApprovalRepo.upsertDecision({ attendanceRecordId: r26.id, userId: emp.id, status: 'approved', decidedBy: admin.id });
    let o = compare(); // ۰۸-۲۶ تأییدشده (۱۲۰ ⇒ سقف ۱۰۰)، ۰۸-۲۷ معلق (۶۰)
    assert.deepEqual([o.pendingMinutes, o.eligibleMinutes, o.payableMinutes, o.clippedMinutes], [60, 120, 100, 20]);
    const r27 = records.find((r) => r.record_date === '2026-08-27');
    overtimeApprovalRepo.upsertDecision({ attendanceRecordId: r27.id, userId: emp.id, status: 'rejected', reason: 'تست', decidedBy: admin.id });
    o = compare();
    assert.deepEqual([o.pendingMinutes, o.rejectedMinutes, o.payableMinutes], [0, 60, 100]);
    settingsRepo.update({ overtimeRequiresApproval: false });
  });

  test('مانده‌ی مرخصی سالانه از ledger؛ نوع بدون کسر در balances نیست', () => {
    const b = get(emp).balances;
    const a = b.find((x) => x.leaveTypeId === annual.id);
    assert.deepEqual([a.entitled, a.used, a.remaining], [10000, 630, 9370]);
    assert.equal(b.some((x) => x.leaveTypeId === leaveTypesRepo.findByCode('mission').id), false);
    assert.deepEqual(get(emp, { includeBalances: false }).balances, []);
  });

  test('کارمند تازه‌واردِ وسط ماه: روزهای پیش از ثبت غیبت/کسری نیستند', () => {
    const r = get(newcomer);
    assert.equal(r.attendance.notStartedDays, 9); // ۰۸-۲۳ تا ۰۸-۳۱
    // از ۰۹-۰۱: روز کاری = ۲۲ − ۳ جمعه − ۱ تعطیلی = ۱۸ ⇒ ۷ غیبت + ۱ امروز + ۱۰ آینده
    assert.deepEqual([r.calendar.expectedWorkDays, r.attendance.absentDays, r.attendance.pendingDays, r.attendance.futureDays], [18, 7, 1, 10]);
    assert.equal(r.time.shortfallMinutes, 510 * 6 + 270); // ۰۹-۰۱،۰۲،۰۵،۰۶،۰۷،۰۹ کامل + ۰۹-۰۳ پنجشنبه
    // روز پیش از ثبت «با رکورد» حساب می‌شود
    rec(newcomer.id, '2026-08-24', '08:00', '16:30');
    const r2 = get(newcomer);
    assert.deepEqual([r2.attendance.notStartedDays, r2.attendance.presentDays], [8, 1]);
  });

  test('ریز روزانه (days=1): ۳۱ روز به ترتیب با وضعیت‌های درست', () => {
    const days = get(emp, { includeDays: true }).days;
    assert.equal(days.length, 31);
    const st = Object.fromEntries(days.map((d) => [d.date, d.status]));
    assert.deepEqual(
      [st['2026-08-23'], st['2026-08-24'], st['2026-08-28'], st['2026-08-29'], st['2026-08-30'], st['2026-08-31'], st['2026-09-01'], st['2026-09-02'],
        st['2026-09-05'], st['2026-09-06'], st['2026-09-08'], st['2026-09-09'], st['2026-09-10'], st['2026-09-12']],
      ['present', 'late', 'weekend', 'leave', 'mission', 'present', 'absent', 'incomplete', 'manual_leave', 'manual_holiday', 'holiday', 'absent', 'pending', 'future'],
    );
    assert.equal(get(emp).days, undefined, 'بدون includeDays ریز روزانه نیست');
    assert.equal(days.find((d) => d.date === '2026-08-31').leaveMinutes, 120);
  });

  test('totals جمع کاربران است؛ لیست خالی و ورودی نامعتبر', () => {
    const rep = computeMonthlyReport({ users: [fresh(emp), fresh(newcomer)], year: Y, month: M, now: NOW });
    assert.equal(rep.totals.userCount, 2);
    assert.equal(rep.totals.attendance.presentDays, rep.users[0].attendance.presentDays + rep.users[1].attendance.presentDays);
    assert.equal(rep.totals.time.shortfallMinutes, rep.users[0].time.shortfallMinutes + rep.users[1].time.shortfallMinutes);
    assert.equal(rep.totals.overtime.payableMinutes, 100);
    assert.deepEqual(rep.overtimePolicy, { enabled: true, requiresApproval: false, monthlyCapMinutes: 100 });

    const empty = computeMonthlyReport({ users: [], year: Y, month: M, now: NOW });
    assert.deepEqual([empty.users.length, empty.totals.userCount, empty.totals.time.expectedMinutes], [0, 0, 0]);
    for (const [y, m] of [[Y, 0], [Y, 13], [Y, 1.5], [NaN, 1], [1405.5, 1]]) {
      assert.throws(() => computeMonthlyReport({ users: [fresh(emp)], year: y, month: m, now: NOW }), RangeError, `${y}/${m}`);
    }
  });

  test('ماه اسفند کبیسه/غیرکبیسه: تعداد روزها از تقویم شمسی', () => {
    assert.equal(computeMonthlyReport({ users: [], year: 1403, month: 12, now: NOW }).daysInMonth, 30); // ۱۴۰۳ کبیسه
    assert.equal(computeMonthlyReport({ users: [], year: 1405, month: 12, now: NOW }).daysInMonth, 29);
  });

  test('ماه آینده: همه‌ی روزهای کاری future؛ غیبت و کسری صفر', () => {
    const r = computeMonthlyReport({ users: [fresh(emp)], year: 1405, month: 8, now: NOW }).users[0];
    assert.equal(r.attendance.absentDays, 0);
    assert.equal(r.attendance.futureDays, r.calendar.expectedWorkDays);
    assert.equal(r.time.shortfallMinutes, 0);
  });
});

// ---------- route (S5-2b) ----------
// handlerها مستقیم از stack روتر اجرا می‌شوند (بدون سرور HTTP)؛ ماتریس نقش×route واقعی در permissionRoutes.test.js است.
let hasExpress = true;
try { require.resolve('express'); } catch (_) { hasExpress = false; }

describe('گزارش ماهانه — route (S5-2b)', { skip: hasExpress ? false : 'express نصب نیست (npm install)' }, () => {
  let router; let admin; let hr; let mgr; let empA; let empB; let other;
  before(() => {
    resetDb();
    router = require('../src/api/routes/admin/reports');
    admin = makeUser({ role: 'admin' });
    hr = makeUser({ role: 'hr' });
    mgr = makeUser({ role: 'manager' });
    empA = makeUser({ managerId: mgr.id, department: 'فنی' });
    empB = makeUser({ managerId: mgr.id, department: 'مالی' });
    other = makeUser({ managerId: admin.id, department: 'فنی' });
    for (const u of [admin, hr, mgr, empA, empB, other]) setCreatedAt(u.id, '2020-01-01 00:00:00');
    rec(empA.id, '2026-08-23', '08:00', '16:30');
  });
  after(cleanup);

  function call(user, query) {
    const layer = router.stack.find((l) => l.route && l.route.path === '/admin/reports/monthly' && l.route.methods.get);
    assert.ok(layer, 'route ثبت شده است');
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const req = { adminUser: user, query, method: 'GET', ip: '127.0.0.1' };
    const handlers = layer.route.stack.map((s) => s.handle);
    let i = 0;
    const next = () => { const h = handlers[i]; i += 1; if (h) h(req, res, next); };
    next();
    return { status: res.statusCode, body: res.body };
  }
  const names = (r) => r.body.users.map((u) => u.user.id).sort((a, b) => a - b);

  test('اسکوپ نقش: admin/hr همه‌ی فعال‌ها، سرپرست فقط تیم مستقیم (بدون خودش)، کارمند فقط خودش', () => {
    const all = [admin, hr, mgr, empA, empB, other].map((u) => u.id).sort((a, b) => a - b);
    assert.deepEqual(names(call(admin, { year: '1405', month: '6' })), all);
    assert.deepEqual(names(call(hr, { year: '1405', month: '6' })), all);
    assert.deepEqual(names(call(mgr, { year: '1405', month: '6' })), [empA.id, empB.id]);
    assert.deepEqual(names(call(empA, { year: '1405', month: '6' })), [empA.id]);
  });

  test('userId: خودش/تیم مجاز؛ خارج از اسکوپ ۴۰۳؛ ناموجود ۴۰۴؛ نامعتبر ۴۰۰', () => {
    assert.deepEqual(names(call(empA, { year: '1405', month: '6', userId: String(empA.id) })), [empA.id]);
    assert.equal(call(empA, { year: '1405', month: '6', userId: String(empB.id) }).status, 403);
    assert.equal(call(mgr, { year: '1405', month: '6', userId: String(other.id) }).status, 403);
    assert.deepEqual(names(call(mgr, { year: '1405', month: '6', userId: String(empB.id) })), [empB.id]);
    assert.equal(call(admin, { year: '1405', month: '6', userId: '999999' }).status, 404);
    assert.equal(call(admin, { year: '1405', month: '6', userId: 'abc' }).status, 400);
  });

  test('فیلتر دپارتمان درون اسکوپ؛ غیرفعال‌ها فقط با includeInactive', () => {
    assert.deepEqual(names(call(admin, { year: '1405', month: '6', department: 'فنی' })), [empA.id, other.id].sort((a, b) => a - b));
    assert.deepEqual(names(call(mgr, { year: '1405', month: '6', department: 'فنی' })), [empA.id]); // other در تیم سرپرست نیست
    getDb().prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(empB.id);
    assert.equal(names(call(mgr, { year: '1405', month: '6' })).includes(empB.id), false);
    assert.equal(names(call(mgr, { year: '1405', month: '6', includeInactive: '1' })).includes(empB.id), true);
    getDb().prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(empB.id);
  });

  test('اعتبارسنجی سال/ماه ⇒ ۴۰۰ با کد؛ days=1 ریز روزانه می‌دهد؛ ساختار پاسخ', () => {
    for (const q of [{}, { year: '1405' }, { month: '6' }, { year: '1405', month: '0' }, { year: '1405', month: '13' }, { year: '1405', month: 'x' }, { year: '99', month: '6' }, { year: '1405', month: '6.5' }]) {
      const r = call(admin, q);
      assert.equal(r.status, 400, JSON.stringify(q));
      assert.ok(['INVALID_YEAR', 'INVALID_MONTH'].includes(r.body.code));
    }
    const r = call(empA, { year: '1405', month: '6', days: '1' });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.year, r.body.month, r.body.from, r.body.to, r.body.label], [1405, 6, '2026-08-23', '2026-09-22', 'شهریور 1405']);
    assert.equal(r.body.users[0].days.length, 31);
    assert.equal(r.body.users[0].attendance.presentDays, 1);
    assert.equal(call(empA, { year: '1405', month: '6' }).body.users[0].days, undefined);
    assert.ok(Array.isArray(r.body.departmentOptions));
  });

  test('گارد مجوز: نقش بدون reports.read ⇒ ۴۰۳', () => {
    assert.equal(call({ id: 1, role: 'ghost' }, { year: '1405', month: '6' }).status, 403);
    assert.equal(call(undefined, { year: '1405', month: '6' }).status, 403);
  });
});
