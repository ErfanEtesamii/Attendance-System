// S5-3b: بستن ماه — snapshot، خواندن گزارش از snapshot، اسکوپ، route (POST close / GET جزئیات).
// ماه آزمایشی شهریور ۱۴۰۵ (۲۰۲۶-۰۸-۲۳ تا ۲۰۲۶-۰۹-۲۲)؛ «الان» ۲۰۲۶-۱۰-۰۵.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const { closeMonth, reportFromSnapshot, MonthCloseError } = require('../src/services/monthCloseService');
const { computeMonthlyReport } = require('../src/services/monthlyReportService');
const settingsRepo = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const monthClosuresRepo = require('../src/repositories/monthClosuresRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const NOW = at('2026-10-05', '10:00');
const Y = 1405;
const M = 6;
const rec = (userId, date, inn, out) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });

describe('بستن ماه — سرویس (S5-3b)', () => {
  let admin; let emp; let emp2; let gone;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    emp = makeUser({ name: 'الف', department: 'فنی' });
    emp2 = makeUser({ name: 'ب', department: 'مالی' });
    gone = makeUser({ name: 'ج', department: 'فنی', active: false });
    for (const u of [admin, emp, emp2, gone]) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    rec(emp.id, '2026-08-24', '08:00', '16:30');
    rec(emp2.id, '2026-08-24', '08:30', '16:30');
  });
  after(cleanup);

  test('بستن: snapshot کامل ذخیره می‌شود؛ بستن دوباره ⇒ ALREADY_CLOSED', () => {
    const { closure, checklist } = closeMonth({ year: Y, month: M, closedBy: admin.id, note: '  بستن آزمایشی  ', now: NOW });
    assert.equal(closure.status, 'closed');
    assert.equal(closure.close_count, 1);
    assert.equal(closure.closed_by, admin.id);
    assert.equal(closure.close_note, 'بستن آزمایشی');
    assert.equal(closure.period_from, '2026-08-23');
    assert.equal(checklist.canClose, true);
    assert.equal(closure.snapshot.version, 1);
    assert.equal(closure.snapshot.report.users.length, 4, 'همه‌ی کاربران حتی غیرفعال');
    assert.ok(closure.snapshot.report.users.every((u) => Array.isArray(u.days) && u.days.length === 31));
    assert.equal(closure.snapshot.settings.workDayStart, '08:00');
    assert.throws(() => closeMonth({ year: Y, month: M, closedBy: admin.id, now: NOW }), (e) => e instanceof MonthCloseError && e.code === 'ALREADY_CLOSED');
  });

  test('تغییر تنظیمات و رکوردها بعد از بستن ارقام snapshot را عوض نمی‌کند، ولی محاسبه‌ی زنده عوض می‌شود', () => {
    const row = monthClosuresRepo.findByMonth(Y, M);
    const before = reportFromSnapshot(row, { includeDays: true });
    settingsRepo.update({ workDayEnd: '15:00', lateGraceMinutes: 120, overtimeEnabled: true });
    rec(emp.id, '2026-08-25', '08:00', '20:00');
    const after = reportFromSnapshot(monthClosuresRepo.findByMonth(Y, M), { includeDays: true });
    assert.deepEqual(after, before);
    assert.equal(before.source, 'snapshot');
    const live = computeMonthlyReport({ users: usersRepo.listUsers({}), year: Y, month: M, now: NOW });
    assert.notEqual(live.totals.time.expectedMinutes, before.totals.time.expectedMinutes);
    assert.notEqual(live.totals.attendance.presentDays, before.totals.attendance.presentDays);
  });

  test('انتخاب از snapshot: فعال‌ها پیش‌فرض، includeInactive، دپارتمان، اسکوپ، userId؛ totals بازمحاسبه می‌شود', () => {
    const row = monthClosuresRepo.findByMonth(Y, M);
    const ids = (r) => r.users.map((u) => u.user.id).sort((a, b) => a - b);
    assert.deepEqual(ids(reportFromSnapshot(row)), [admin.id, emp.id, emp2.id].sort((a, b) => a - b));
    assert.equal(reportFromSnapshot(row, { includeInactive: true }).users.length, 4);
    assert.deepEqual(ids(reportFromSnapshot(row, { department: 'فنی' })), [emp.id]);
    assert.deepEqual(ids(reportFromSnapshot(row, { allowedIds: [emp2.id] })), [emp2.id]);
    assert.deepEqual(ids(reportFromSnapshot(row, { userId: gone.id })), [gone.id], 'userId بدون فیلتر فعال');
    const only = reportFromSnapshot(row, { allowedIds: [emp.id] });
    assert.equal(only.totals.userCount, 1);
    assert.equal(only.totals.attendance.presentDays, 1);
    assert.equal(only.users[0].days, undefined);
  });

  test('مانع چک‌لیست ⇒ CHECKLIST_BLOCKED و چیزی ذخیره نمی‌شود', () => {
    getDb().prepare('DELETE FROM month_closures').run();
    rec(emp2.id, '2026-08-26', '08:00', null); // ناقص
    assert.throws(() => closeMonth({ year: Y, month: M, closedBy: admin.id, now: NOW }), (e) => e.code === 'CHECKLIST_BLOCKED' && e.checklist.blockingCount === 1);
    assert.equal(monthClosuresRepo.findByMonth(Y, M), null);
  });

  test('ماه reopened دوباره بسته می‌شود: snapshot تازه و close_count=2', () => {
    getDb().prepare("DELETE FROM attendance_records WHERE check_out_time IS NULL").run();
    closeMonth({ year: Y, month: M, closedBy: admin.id, now: NOW });
    getDb().prepare("UPDATE month_closures SET status = 'reopened'").run();
    const { closure } = closeMonth({ year: Y, month: M, closedBy: admin.id, now: NOW });
    assert.equal(closure.close_count, 2);
    assert.equal(closure.status, 'closed');
  });
});

let hasExpress = true;
try { require.resolve('express'); } catch (_) { hasExpress = false; }

describe('بستن ماه — route (S5-3b)', { skip: hasExpress ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let cookies; let emp; let other; let auditRepo;
  before(async () => {
    resetDb();
    const { sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    auditRepo = require('../src/repositories/auditRepository');
    const admin = makeUser({ role: 'admin' });
    const hr = makeUser({ role: 'hr' });
    const mgr = makeUser({ role: 'manager' });
    emp = makeUser({ role: 'employee', managerId: mgr.id, name: 'کارمند' });
    other = makeUser({ role: 'employee', name: 'دیگری' });
    for (const u of [admin, hr, mgr, emp, other]) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    rec(emp.id, '2026-08-24', '08:00', '16:30');
    cookies = { admin: sessionCookie(admin.id), hr: sessionCookie(hr.id), manager: sessionCookie(mgr.id), employee: sessionCookie(emp.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const call = async (role, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };

  test('فقط admin می‌بندد؛ ماه تمام‌نشده ۴۰۹؛ بدون دسترسی ۴۰۳', async () => {
    // «الان» واقعی (۲۰۲۶-۱۰ یا بعد) ⇒ ماه تمام‌شده است
    for (const role of ['hr', 'manager', 'employee']) assert.equal((await call(role, 'POST', `/api/admin/month-closures/${Y}/${M}/close`, {})).status, 403, role);
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/13/close`, {})).json.code, 'INVALID_MONTH');
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/close`, { note: 5 })).json.code, 'INVALID_NOTE');
    const future = await call('admin', 'POST', `/api/admin/month-closures/1499/1/close`, {});
    assert.equal(future.status, 409);
    assert.equal(future.json.code, 'CHECKLIST_BLOCKED');
    assert.equal(future.json.checklist.items[0].key, 'month_not_ended');
  });

  test('بستن موفق: ۲۰۱ + audit؛ بستن دوباره ۴۰۹؛ گزارش ماهانه از snapshot با اسکوپ؛ source=live فقط admin/hr', async () => {
    const closed = await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/close`, { note: 'ok' });
    assert.equal(closed.status, 201, JSON.stringify(closed.json));
    assert.equal(closed.json.status, 'closed');
    assert.equal(closed.json.closeNote, 'ok');
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/close`, {})).json.code, 'ALREADY_CLOSED');
    const log = auditRepo.search({ action: 'month_closed' });
    assert.equal(log.length, 1);

    const detail = await call('hr', 'GET', `/api/admin/month-closures/${Y}/${M}`);
    assert.equal(detail.json.status, 'closed');
    assert.ok(detail.json.snapshot.userCount >= 5);
    assert.equal((await call('admin', 'GET', `/api/admin/month-closures/${Y}/7`)).json.status, 'open');

    const adminRep = await call('admin', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}`);
    assert.equal(adminRep.json.source, 'snapshot');
    assert.equal(adminRep.json.closure.status, 'closed');
    assert.equal(adminRep.json.users.length, 5);
    const empRep = await call('employee', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}`);
    assert.deepEqual(empRep.json.users.map((u) => u.user.id), [emp.id]);
    assert.equal(empRep.json.source, 'snapshot');
    const mgrRep = await call('manager', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}`);
    assert.deepEqual(mgrRep.json.users.map((u) => u.user.id), [emp.id]);

    assert.equal((await call('employee', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}&source=live`)).status, 403);
    const live = await call('hr', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}&source=live`);
    assert.equal(live.json.source, 'live');
    // ماه بسته‌نشده زنده است
    assert.equal((await call('admin', 'GET', `/api/admin/reports/monthly?year=${Y}&month=5`)).json.source, 'live');
  });
});
