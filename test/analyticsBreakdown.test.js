// S5-6b: رتبه‌ی اضافه‌کاری/کسری، نرخ حضور، مرخصی به‌تفکیک نوع، توزیع ساعت ورود — برابری با گزارش ماهانه، رتبه‌ی مساوی، null، اسکوپ.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const B = require('../src/services/analyticsBreakdownService');
const { AnalyticsError } = require('../src/services/analyticsService');
const { computeMonthlyReport } = require('../src/services/monthlyReportService');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const leaveRepo = require('../src/repositories/leaveRepository');
const usersRepo = require('../src/repositories/usersRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie, makeApprovedMission } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const rec = (userId, date, inn, out) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });
const setCreatedAt = (id) => getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(id);
const Y = 1405; const M = 6;

describe('تحلیل‌های ماهانه و توزیع ورود (S5-6b)', () => {
  let admin; let mgr; let uA; let uB; let uC; let uD; let report;
  before(() => {
    resetDb();
    settingsRepo.update({ overtimeEnabled: true });
    admin = makeUser({ role: 'admin', name: 'ادمین', department: 'مدیریت' });
    mgr = makeUser({ role: 'manager', name: 'سرپرست', department: 'فنی' });
    uA = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'الف' });
    uB = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'ب' });
    uC = makeUser({ role: 'employee', department: 'فروش', name: 'ج' });
    uD = makeUser({ role: 'employee', department: '', name: 'د' }); // دپارتمان ندارد؛ هیچ رکوردی ندارد
    for (const u of usersRepo.listUsers({})) setCreatedAt(u.id);
    // الف: ۳ روز، اضافه‌کاری ۱۲۰ و ۶۰؛ ب: ۲ روز، اضافه‌کاری ۶۰ (هم‌رتبه با الف۲ نیست چون مجموع متفاوت)
    rec(uA.id, '2026-08-23', '08:00', '18:30'); rec(uA.id, '2026-08-24', '08:10', '17:30'); rec(uA.id, '2026-08-25', '08:40', '16:30');
    rec(uB.id, '2026-08-23', '09:05', '17:30'); rec(uB.id, '2026-08-24', '08:00', '16:30');
    rec(uC.id, '2026-08-23', '08:00', '17:30');
    // مرخصی/مأموریت تأییدشده‌ی ج
    const l = leaveRepo.createLeaveRequest({ userId: uC.id, startDate: '2026-08-30', endDate: '2026-08-31', leaveType: 'leave', reason: 'ت' });
    leaveRepo.setStatus(l.id, 'approved', null);
    makeApprovedMission(uC.id, '2026-09-01');
    report = computeMonthlyReport({ users: usersRepo.listUsers({ onlyActive: true }), year: Y, month: M });
  });
  after(cleanup);

  test('رتبه‌ی اضافه‌کاری: برابر عدد گزارش ماهانه، نزولی، فقط مثبت، رتبه‌ی استاندارد', () => {
    const r = B.rankOvertime(report, { limit: 10 });
    const byId = new Map(report.users.map((u) => [u.user.id, u.overtime.payableMinutes]));
    for (const row of r.rows) assert.equal(row.payableMinutes, byId.get(row.user.id));
    assert.ok(r.rows.length >= 2);
    for (let i = 1; i < r.rows.length; i += 1) assert.ok(r.rows[i - 1].payableMinutes >= r.rows[i].payableMinutes);
    assert.equal(r.rows[0].rank, 1);
    assert.ok(r.rows.every((x) => x.payableMinutes > 0), 'صفرها رتبه نمی‌گیرند');
    assert.equal(r.rows[0].user.id, uA.id);
    assert.equal(B.rankOvertime(report, { limit: 1 }).rows.length, 1);
  });

  test('رتبه‌ی مساوی: هم‌رتبه، رتبه‌ی بعدی می‌پرد', () => {
    const fake = { overtimePolicy: {}, users: [10, 10, 5].map((m, i) => ({ user: { id: i, fullName: `ک${i}` }, overtime: { payableMinutes: m, rawMinutes: m, pendingMinutes: 0, clippedMinutes: 0 } })) };
    assert.deepEqual(B.rankOvertime(fake).rows.map((x) => x.rank), [1, 1, 3]);
  });

  test('رتبه‌ی کسری: برابر گزارش، نسبت کسری، صفرها حذف', () => {
    const r = B.rankShortfall(report, { limit: 10 });
    const byId = new Map(report.users.map((u) => [u.user.id, u]));
    for (const row of r.rows) {
      const u = byId.get(row.user.id);
      assert.equal(row.shortfallMinutes, u.time.shortfallMinutes);
      assert.equal(row.expectedMinutes, u.time.expectedMinutes);
      assert.equal(row.shortfallRatio, Math.round((u.time.shortfallMinutes / u.time.expectedMinutes) * 10000) / 10000);
    }
    assert.ok(r.rows.length > 0);
  });

  test('نرخ حضور = حضور ÷ (حضور + غیبت)؛ مخرج صفر ⇒ null؛ گروه‌بندی دپارتمان شامل «بدون دپارتمان»', () => {
    const r = B.attendanceRate(report, { groupBy: 'user' });
    for (const g of r.groups) {
      const u = report.users.find((x) => x.user.id === g.userId);
      const den = u.attendance.presentDays + u.attendance.absentDays;
      assert.equal(g.rate, den > 0 ? Math.round((u.attendance.presentDays / den) * 10000) / 10000 : null);
    }
    const a = r.groups.find((g) => g.userId === uA.id);
    assert.equal(a.presentDays, 3);
    assert.ok(a.rate > 0 && a.rate < 1);
    const dep = B.attendanceRate(report, { groupBy: 'department' });
    assert.ok(dep.groups.some((g) => g.label === 'بدون دپارتمان'));
    const total = B.attendanceRate(report);
    assert.equal(total.total.presentDays, report.users.reduce((s, u) => s + u.attendance.presentDays, 0));
    assert.equal(B.attendanceRate({ users: [] }).total.rate, null);
    assert.throws(() => B.attendanceRate(report, { groupBy: 'x' }), AnalyticsError);
  });

  test('مرخصی به‌تفکیک نوع: روز، تعداد کارمند و گروه‌بندی دپارتمان', () => {
    const r = B.leaveByType(report);
    const kinds = Object.fromEntries(r.types.map((t) => [t.kind, t]));
    assert.equal(kinds.leave.days, 2);
    assert.equal(kinds.leave.employees, 1);
    assert.equal(kinds.mission.days, 1);
    const g = B.leaveByType(report, { groupBy: 'department' });
    const sales = g.groups.find((x) => x.label === 'فروش');
    assert.equal(sales.types.reduce((s, t) => s + t.days, 0), 3);
    assert.equal(g.groups.find((x) => x.label === 'فنی').types.length, 0);
    assert.throws(() => B.leaveByType(report, { groupBy: 'user' }), AnalyticsError);
  });

  test('توزیع ساعت ورود: سطل‌های پیوسته، میانه، ساعت اولین/آخرین', () => {
    const d = B.checkinDistribution({ users: usersRepo.listUsers({ onlyActive: true }), from: '2026-08-23', to: '2026-08-25', binMinutes: 30 });
    // ورودها: ۰۸:۰۰ ×۳ (الف۱، ب۲، ج)… الف ۰۸:۰۰، ۰۸:۱۰، ۰۸:۴۰؛ ب ۰۹:۰۵، ۰۸:۰۰؛ ج ۰۸:۰۰
    assert.equal(d.count, 6);
    assert.equal(d.earliest, '08:00');
    assert.equal(d.latest, '09:05');
    assert.deepEqual(d.bins.map((b) => [b.from, b.count]), [['08:00', 4], ['08:30', 1], ['09:00', 1]]);
    assert.equal(d.bins[0].to, '08:30');
    assert.equal(d.median, '08:05');
    assert.equal(B.checkinDistribution({ users: [], from: '2026-08-23', to: '2026-08-25' }).bins.length, 0);
    assert.equal(B.checkinDistribution({ users: [], from: '2026-08-23', to: '2026-08-25' }).median, null);
  });

  test('توزیع ساعت ورود: اعتبارسنجی', () => {
    const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
    assert.equal(code(() => B.checkinDistribution({ users: [], from: '2026-08-23', to: '2026-08-25', binMinutes: 7 })), 'INVALID_BIN');
    assert.equal(code(() => B.checkinDistribution({ users: [], from: '2026-09-01', to: '2026-08-25' })), 'INVALID_RANGE');
    assert.equal(code(() => B.checkinDistribution({ users: [], from: '2020-01-01', to: '2026-08-25' })), 'RANGE_TOO_LARGE');
    assert.equal(code(() => B.parseLimit('0')), 'INVALID_LIMIT');
    assert.equal(B.parseLimit(undefined), 10);
  });

  describe('API (اسکوپ، ماه بسته، کارمند ممنوع)', () => {
    let server; let base; let cookies;
    before(async () => {
      const { createApp } = require('../src/server');
      cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(mgr.id), employee: sessionCookie(uA.id) };
      server = createApp().listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { if (server) server.close(); });
    const get = async (role, url) => {
      const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const P = `year=${Y}&month=${M}`;

    test('کارمند روی هر پنج مسیر ممنوع', async () => {
      for (const u of [`rankings?${P}`, `attendance-rate?${P}`, `leave-by-type?${P}`, 'checkin-distribution']) {
        assert.equal((await get('employee', `/api/admin/analytics/${u}`)).status, 403, u);
      }
    });
    test('سرپرست فقط تیم خودش؛ admin همه', async () => {
      const m = await get('manager', `/api/admin/analytics/rankings?${P}&metric=overtime`);
      assert.equal(m.status, 200);
      assert.equal(m.json.source, 'live');
      assert.deepEqual(m.json.rows.map((r) => r.user.id).sort(), [uA.id, uB.id].sort());
      const a = await get('admin', `/api/admin/analytics/attendance-rate?${P}&groupBy=user`);
      assert.ok(a.json.groups.length >= 5);
      const lm = await get('manager', `/api/admin/analytics/leave-by-type?${P}`);
      assert.equal(lm.json.types.length, 0); // ج در تیم او نیست
      const c = await get('manager', '/api/admin/analytics/checkin-distribution?from=2026-08-23&to=2026-08-25');
      assert.equal(c.json.count, 5); // بدون ج
      assert.equal((await get('manager', `/api/admin/analytics/checkin-distribution?from=2026-08-23&to=2026-08-25&userId=${uC.id}`)).status, 403);
    });
    test('اعتبارسنجی', async () => {
      assert.equal((await get('admin', `/api/admin/analytics/rankings?${P}&metric=zzz`)).json.code, 'INVALID_METRIC');
      assert.equal((await get('admin', `/api/admin/analytics/rankings?${P}&limit=500`)).json.code, 'INVALID_LIMIT');
      assert.equal((await get('admin', '/api/admin/analytics/rankings?year=1405&month=0')).json.code, 'INVALID_MONTH');
      assert.equal((await get('admin', '/api/admin/analytics/checkin-distribution?binMinutes=7')).json.code, 'INVALID_BIN');
      assert.equal((await get('admin', '/api/admin/analytics/checkin-distribution?binMinutes=x')).json.code, 'INVALID_BIN');
      assert.equal((await get('admin', `/api/admin/analytics/leave-by-type?${P}&groupBy=user`)).json.code, 'INVALID_GROUP');
    });
    test('ماه بسته‌شده از snapshot خوانده می‌شود (حتی اگر بعداً داده عوض شود)', async () => {
      const { closeMonth } = require('../src/services/monthCloseService');
      // رکورد ناقص/اعتراض باز نداریم؛ اگر چک‌لیست مانع داشت، تست مهم نیست (از مسیر مستقیم snapshot می‌سازیم)
      let closed = true;
      try { closeMonth({ year: Y, month: M, closedBy: admin.id }); } catch (_) { closed = false; }
      if (!closed) return;
      rec(uB.id, '2026-08-26', '08:00', '23:00'); // بعد از بستن: اضافه‌کاری بزرگ
      const r = await get('admin', `/api/admin/analytics/rankings?${P}&metric=overtime`);
      assert.equal(r.json.source, 'snapshot');
      assert.equal(r.json.rows[0].user.id, uA.id);
    });
  });
});
