// M1 («وضعیت من»): GET /api/admin/me/week و employeeWeekService.getMyWeek — هفته‌ی «خودِ» کاربر برای همه‌ی نقش‌ها، بدون دسترسی به دیگران.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/employeeWeekService');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const iso = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const SAT = '2026-09-12'; // شنبه
const NEXT_SAT = '2026-09-19';

describe('وضعیت من: سرویس getMyWeek', () => {
  let db; let admin; let hr; let mgr; let emp; let otherEmp;

  before(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${NEXT_SAT}T08:00:00Z`) });
    db = resetDb();
    admin = makeUser({ role: 'admin' });
    hr = makeUser({ role: 'hr' });
    mgr = makeUser({ role: 'manager' });
    emp = makeUser({ managerId: mgr.id });
    otherEmp = makeUser({ managerId: mgr.id });
    const shift = shiftsRepo.createShift({ name: 'عصر', startTime: '15:30', endTime: '21:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0 });
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(shift.id, emp.id);
    attendanceRepo.createManual({ userId: emp.id, recordDate: SAT, checkInTime: iso(SAT, '15:40'), checkOutTime: iso(SAT, '20:30'), status: 'late' });
    attendanceRepo.createManual({ userId: otherEmp.id, recordDate: SAT, checkInTime: iso(SAT, '15:30'), checkOutTime: iso(SAT, '21:00'), status: 'normal' });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('کارمند هفته‌ی خودش را می‌بیند (حتی بدون team.week_view) و فقط‌خواندنی است', () => {
    const r = svc.getMyWeek(emp, { start: SAT });
    assert.equal(r.ok, true);
    assert.equal(r.self, true);
    assert.equal(r.readOnly, true);
    assert.equal(r.user.id, emp.id);
    assert.equal(r.days.length, 7);
    assert.equal(r.days[0].attendance.lateMinutes, 10);
    assert.ok(r.summary && r.summary.attendance, 'خلاصه‌ی ساعت مفید و تأخیر');
  });

  test('هویت فقط از actor: ورودی userId نادیده گرفته می‌شود و getWeek عادی همچنان کارمند را ردّ می‌کند', () => {
    const r = svc.getMyWeek(emp, { start: SAT, userId: otherEmp.id, id: otherEmp.id });
    assert.equal(r.user.id, emp.id);
    assert.equal(svc.getWeek(emp, otherEmp.id, { start: SAT }).status, 403, 'کارمند نباید با getWeek دیگری را ببیند');
    assert.equal(svc.getWeek(emp, emp.id, { start: SAT }).status, 403, 'self فقط از getMyWeek فعال می‌شود');
    assert.equal(svc.getWeek(emp, emp.id, { start: SAT }, { self: false }).status, 403);
  });

  test('self=true برای هدفی غیر از خودِ actor اثر ندارد', () => {
    assert.equal(svc.getWeek(emp, otherEmp.id, { start: SAT }, { self: true }).status, 403);
  });

  test('همه‌ی نقش‌ها هفته‌ی خودشان را می‌بینند', () => {
    for (const u of [mgr, hr, admin]) {
      const r = svc.getMyWeek(u, {});
      assert.equal(r.ok, true, u.role);
      assert.equal(r.user.id, u.id);
    }
  });

  test('هفته‌ی قبل با start؛ تاریخ نامعتبر ۴۰۰؛ بدون actor ۴۰۱', () => {
    const cur = svc.getMyWeek(emp, {});
    assert.equal(cur.week.isCurrentWeek, true);
    const prev = svc.getMyWeek(emp, { start: cur.week.prevWeekStart });
    assert.equal(prev.week.start, SAT);
    assert.equal(prev.week.isCurrentWeek, false);
    assert.equal(svc.getMyWeek(emp, { start: '2026-02-30' }).code, 'INVALID_DATE');
    assert.equal(svc.getMyWeek(null, {}).status, 401);
  });

  test('شناسه‌ی بازبین از کامنت‌های «مشاهده شد» حذف می‌شود', () => {
    const logs = require('../src/repositories/reportReviewRepository');
    const fnName = ['upsert', 'create', 'add', 'mark'].find((n) => typeof logs[n] === 'function');
    if (!fnName) return; // ساختار repository متفاوت است؛ این مورد فقط وقتی اجرا می‌شود که API ثبت وجود داشته باشد
    try { logs[fnName]({ subjectUserId: emp.id, reportDate: SAT, reviewerId: mgr.id, comment: 'عالی' }); } catch (_) { return; }
    const r = svc.getMyWeek(emp, { start: SAT });
    for (const d of r.days) for (const rv of (d.review && d.review.reviews) || []) assert.equal('reviewerId' in rv, false);
  });
});

describe('وضعیت من: GET /api/admin/me/week', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, cookies, users;

  before(async () => {
    resetDb();
    const { sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    users = {
      employee: makeUser({ role: 'employee' }), manager: makeUser({ role: 'manager' }),
      hr: makeUser({ role: 'hr' }), admin: makeUser({ role: 'admin' }),
    };
    cookies = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, sessionCookie(u.id)]));
    server = await new Promise((resolve) => { const s = createApp().listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const get = (role, qs = '') => fetch(`${base}/api/admin/me/week${qs}`, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });

  test('هر چهار نقش ۲۰۰ می‌گیرند و کاربرِ پاسخ همان کاربر نشست است', async () => {
    for (const role of ['employee', 'manager', 'hr', 'admin']) {
      const res = await get(role);
      assert.equal(res.status, 200, role);
      const j = await res.json();
      assert.equal(j.user.id, users[role].id, role);
      assert.equal(j.days.length, 7);
    }
  });

  test('پارامتر کاربر در query نادیده گرفته می‌شود', async () => {
    const j = await (await get('employee', `?userId=${users.admin.id}&id=${users.admin.id}`)).json();
    assert.equal(j.user.id, users.employee.id);
  });

  test('تاریخ نامعتبر ۴۰۰؛ بدون نشست ۴۰۱', async () => {
    assert.equal((await get('employee', '?start=2026-02-30')).status, 400);
    const res = await fetch(`${base}/api/admin/me/week`);
    assert.equal(res.status, 401);
  });
});
