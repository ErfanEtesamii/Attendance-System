// S5-3c: قفل ویرایش ماه بسته + اصلاح‌ها (adjustment) + بازکردن ماه. ماه آزمایشی شهریور ۱۴۰۵ (۲۰۲۶-۰۸-۲۳ تا ۲۰۲۶-۰۹-۲۲).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const { evaluate } = require('./../src/api/routes/admin/monthLock');
const monthClosuresRepo = require('../src/repositories/monthClosuresRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const leaveRepo = require('../src/repositories/leaveRepository');
const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const Y = 1405;
const M = 6;

describe('قفل ماه — منطق خالص و repository (S5-3c)', () => {
  let admin; let mgr;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    mgr = makeUser({ role: 'manager' });
  });
  after(cleanup);

  test('migration ۰۲۱ و repository: closed قفل است، reopened/باز نه؛ اصلاح‌ها به نسخه‌ی جاری وابسته‌اند', () => {
    const db = getDb();
    assert.ok(db.prepare('PRAGMA table_info(month_closure_adjustments)').all().length > 5);
    assert.deepEqual(monthClosuresRepo.findClosedOverlapping('2026-09-01', '2026-09-01'), []);
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (?, ?, 'closed', '2026-08-23', '2026-09-22')").run(Y, M);
    const c = monthClosuresRepo.findByMonth(Y, M);
    assert.equal(monthClosuresRepo.findClosedOverlapping('2026-09-22', '2026-09-22').length, 1, 'مرز آخر');
    assert.equal(monthClosuresRepo.findClosedOverlapping('2026-09-23', '2026-09-23').length, 0);
    assert.equal(monthClosuresRepo.findClosedOverlapping('2026-08-10', '2026-08-23').length, 1, 'بازه‌ای که از ماه قبل شروع می‌شود');
    monthClosuresRepo.addAdjustment({ closureId: c.id, closeCount: 1, action: 'x', entityType: 'attendance_record', entityId: 5, userId: 7, effectiveDate: '2026-09-01', reason: 'r', details: { a: 1 }, adjustedBy: admin.id });
    monthClosuresRepo.addAdjustment({ closureId: c.id, closeCount: 2, action: 'y', entityType: 'attendance_record', reason: 'r2' });
    assert.deepEqual(monthClosuresRepo.listAdjustments(c.id, 1).map((a) => a.action), ['x']);
    assert.deepEqual(monthClosuresRepo.listAdjustments(c.id, 1)[0].details, { a: 1 });
    monthClosuresRepo.reopen(Y, M, { reopenedBy: admin.id, reason: 'اشتباه' });
    assert.equal(monthClosuresRepo.findClosedOverlapping('2026-09-01', '2026-09-01').length, 0);
    assert.equal(monthClosuresRepo.reopen(Y, M, { reason: 'دوباره' }), null, 'بازِ بازشده null');
    db.prepare("UPDATE month_closures SET status = 'closed'").run();
  });

  test('evaluate: غیرادمین ۴۰۳، ادمین بدون دلیل ۴۰۰، ادمین با دلیل مجاز، دسته‌جمعی ۴۰۹، تاریخ خارج از ماه آزاد', () => {
    const base = { from: '2026-09-01' };
    assert.deepEqual(evaluate({ actor: admin, from: '2026-09-23', reason: '' }), { locked: false });
    assert.equal(evaluate({ actor: mgr, ...base, reason: 'x' }).status, 403);
    assert.equal(evaluate({ actor: mgr, ...base, reason: 'x' }).code, 'MONTH_CLOSED');
    assert.equal(evaluate({ actor: admin, ...base, reason: '  ' }).code, 'MONTH_CLOSED_REASON_REQUIRED');
    const ok = evaluate({ actor: admin, ...base, reason: ' دلیل ' });
    assert.equal(ok.ok, true);
    assert.equal(ok.reason, 'دلیل');
    assert.equal(evaluate({ actor: admin, ...base, reason: 'x', bulk: true }).status, 409);
  });
});

let hasExpress = true;
try { require.resolve('express'); } catch (_) { hasExpress = false; }

describe('قفل ماه — routeها (S5-3c)', { skip: hasExpress ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let cookies; let emp; let rec; let rec2; let auditRepo;
  before(async () => {
    resetDb();
    const { sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    auditRepo = require('../src/repositories/auditRepository');
    const admin = makeUser({ role: 'admin' });
    const mgr = makeUser({ role: 'manager' });
    emp = makeUser({ role: 'employee', managerId: mgr.id });
    for (const u of [admin, mgr, emp]) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    rec = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-08-24', checkInTime: at('2026-08-24', '08:00'), checkOutTime: at('2026-08-24', '16:30'), status: 'normal' });
    rec2 = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-10-06', checkInTime: at('2026-10-06', '08:00'), checkOutTime: at('2026-10-06', '16:30'), status: 'normal' });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(mgr.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const call = async (role, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (_) { /* خالی */ }
    return { status: res.status, json };
  };

  test('پیش از بستن: سرپرست رکورد را ویرایش می‌کند (قفل نیست)', async () => {
    const r = await call('manager', 'PATCH', `/api/admin/attendance-records/${rec.id}`, { status: 'late', reason: 'تست' });
    assert.equal(r.status, 200);
  });

  test('پس از بستن: سرپرست ۴۰۳؛ ادمین بدون دلیل ۴۰۰؛ ادمین با دلیل ۲۰۰ + adjustment + audit؛ رکورد ماه دیگر آزاد', async () => {
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/close`, {})).status, 201);
    const m = await call('manager', 'PATCH', `/api/admin/attendance-records/${rec.id}`, { status: 'normal', reason: 'تست' });
    assert.equal(m.status, 403);
    assert.equal(m.json.code, 'MONTH_CLOSED');
    assert.equal((await call('manager', 'DELETE', `/api/admin/attendance-records/${rec.id}?reason=x`)).status, 403);
    assert.equal((await call('manager', 'POST', `/api/admin/attendance-records/${rec.id}/breaks`, { startTime: at('2026-08-24', '12:00'), reason: 'x' })).status, 403);
    // ادمین: دلیل اجباری در خود route (۴۰۰ عمومی)؛ با دلیل مجاز
    const ok = await call('admin', 'PATCH', `/api/admin/attendance-records/${rec.id}`, { checkOutTime: at('2026-08-24', '17:00'), reason: 'اصلاح ساعت خروج' });
    assert.equal(ok.status, 200);
    const adj = await call('admin', 'GET', `/api/admin/month-closures/${Y}/${M}/adjustments`);
    assert.equal(adj.json.items.length, 1);
    assert.equal(adj.json.items[0].reason, 'اصلاح ساعت خروج');
    assert.equal(adj.json.items[0].user_id, emp.id);
    assert.equal(auditRepo.search({ action: 'closed_month_adjustment' }).length, 1);
    // ماه بعد آزاد
    assert.equal((await call('manager', 'PATCH', `/api/admin/attendance-records/${rec2.id}`, { status: 'late', reason: 'تست' })).status, 200);
    // snapshot دست‌نخورده، زنده متفاوت
    const snap = await call('admin', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}&userId=${emp.id}`);
    const live = await call('admin', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}&userId=${emp.id}&source=live`);
    assert.equal(snap.json.source, 'snapshot');
    assert.equal(snap.json.adjustments.length, 1);
    assert.equal(live.json.users[0].time.effectiveMinutes - snap.json.users[0].time.effectiveMinutes, 30);
    const mgrView = await call('manager', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}`);
    assert.equal(mgrView.json.adjustments.length, 1);
  });

  test('مرخصی هم‌پوشان با ماه بسته: ثبت سرپرست ۴۰۳؛ ادمین با دلیل مجاز؛ تصمیم دسته‌جمعی روی آن ناموفق', async () => {
    const t = leaveTypesRepo.findByCode('annual');
    const body = { userId: emp.id, startDate: '2026-09-05', endDate: '2026-09-05', leaveTypeId: t.id, status: 'pending', reason: 'تست' };
    assert.equal((await call('manager', 'POST', '/api/admin/leave-requests', body)).status, 403);
    const created = await call('admin', 'POST', '/api/admin/leave-requests', body);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const lr = created.json;
    const bulk = await call('admin', 'POST', '/api/admin/leave-queue/bulk', { action: 'approve', ids: [lr.id] });
    assert.equal(bulk.json.results[0].ok, false);
    assert.equal(bulk.json.results[0].code, 'MONTH_CLOSED');
    assert.equal((await call('admin', 'POST', `/api/admin/leave-requests/${lr.id}/approve`, {})).json.code, 'MONTH_CLOSED_REASON_REQUIRED');
    assert.equal((await call('admin', 'POST', `/api/admin/leave-requests/${lr.id}/approve`, { note: 'تأیید پس از بستن' })).status, 200);
    assert.equal((await call('admin', 'DELETE', `/api/admin/leave-requests/${lr.id}`)).json.code, 'MONTH_CLOSED_REASON_REQUIRED');
    assert.equal((await call('admin', 'DELETE', `/api/admin/leave-requests/${lr.id}?adjustmentReason=اشتباه`)).status, 200);
    const adj = await call('admin', 'GET', `/api/admin/month-closures/${Y}/${M}/adjustments`);
    assert.ok(adj.json.items.some((a) => a.action === 'leave_request_deleted_by_admin'));
  });

  test('بازکردن: فقط admin با دلیل؛ پس از آن گزارش زنده و قفل برداشته؛ بستن دوباره اصلاح‌های قبلی را از لیست نسخه‌ی جدید حذف می‌کند', async () => {
    assert.equal((await call('manager', 'POST', `/api/admin/month-closures/${Y}/${M}/reopen`, { reason: 'x' })).status, 403);
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/reopen`, {})).status, 400);
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/5/reopen`, { reason: 'x' })).json.code, 'NOT_CLOSED');
    const re = await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/reopen`, { reason: 'خطا در داده' });
    assert.equal(re.status, 200);
    assert.equal(re.json.status, 'reopened');
    assert.equal((await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/reopen`, { reason: 'دوباره' })).json.code, 'NOT_CLOSED');
    assert.equal((await call('manager', 'PATCH', `/api/admin/attendance-records/${rec.id}`, { status: 'late', reason: 'تست' })).status, 200, 'قفل برداشته شد');
    assert.equal((await call('admin', 'GET', `/api/admin/reports/monthly?year=${Y}&month=${M}`)).json.source, 'live');
    assert.equal(auditRepo.search({ action: 'month_reopened' }).length, 1);
    const again = await call('admin', 'POST', `/api/admin/month-closures/${Y}/${M}/close`, {});
    assert.equal(again.status, 201);
    assert.equal(again.json.closeCount, 2);
    assert.equal((await call('admin', 'GET', `/api/admin/month-closures/${Y}/${M}/adjustments`)).json.items.length, 0);
  });
});
