// S4-14a: API تقویم تیم — اسکوپ نقش، صحت وضعیت هر روز، اعتبارسنجی ورودی، احراز هویت.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('API تقویم تیم (S4-14a)', () => {
  let server; let base; let cookies; let users;
  let today; let jalaliOf;
  const D = {}; // تاریخ سناریوها (نسبت به امروز)

  before(async () => {
    resetDb();
    const { makeUser, makeApprovedMission, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const shiftsRepository = require('../src/repositories/shiftsRepository');
    const usersRepository = require('../src/repositories/usersRepository');
    const holidaysRepository = require('../src/repositories/holidaysRepository');
    const leaveRepository = require('../src/repositories/leaveRepository');
    const attendanceRepository = require('../src/repositories/attendanceRepository');
    const { todayDateString } = require('../src/utils/serverTime');
    const jalali = require('../src/utils/jalali');
    jalaliOf = (dateStr) => {
      const [jy, jm] = jalali.isoDateToJalaliString(dateStr).split('/').map(Number);
      return { jy, jm };
    };
    today = todayDateString();

    const manager = makeUser({ role: 'manager', name: 'سرپرست' });
    users = {
      admin: makeUser({ role: 'admin' }),
      hr: makeUser({ role: 'hr' }),
      manager,
      employee: makeUser({ role: 'employee', managerId: manager.id, name: 'کارمند تیم', department: 'فنی' }),
      other: makeUser({ role: 'employee', name: 'کارمند بیرون تیم', department: 'مالی' }),
    };
    cookies = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, sessionCookie(u.id)]));

    const baseShift = {
      startTime: '08:00', endTime: '17:00', graceLateMinutes: 0, graceEarlyMinutes: 0,
      overnight: false, maxLunchMinutes: 60, fixedLunchDeductMinutes: 0,
    };
    // شیفت هفت‌روزه: «روز کاری» کارمند تیم به آخر هفته‌ی واقعی وابسته نیست
    const allDays = shiftsRepository.createShift({ ...baseShift, name: 'شیفت تست تقویم ۷روزه', workDays: [0, 1, 2, 3, 4, 5, 6] });
    usersRepository.setUserShift(users.employee.id, allDays.id);

    D.present = shiftDate(today, -2);
    D.late = shiftDate(today, -6);
    D.incomplete = shiftDate(today, -1);
    D.holiday = shiftDate(today, -3);
    D.weekend = shiftDate(today, -4);
    D.leave = shiftDate(today, -5);
    D.absent = shiftDate(today, -7);
    D.hourLeave = shiftDate(today, -9);
    D.manualLeave = shiftDate(today, -10);
    D.mission = shiftDate(today, -11);
    D.future = shiftDate(today, 3);

    // کاربر «بیرون تیم»: شیفتی که روز هفته‌ی D.weekend در workDays آن نیست ⇒ weekend
    const weekdayOfWeekend = new Date(`${D.weekend}T00:00:00Z`).getUTCDay();
    const noThatDay = shiftsRepository.createShift({
      ...baseShift, name: 'شیفت تست تقویم بدون یک روز', workDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== weekdayOfWeekend),
    });
    usersRepository.setUserShift(users.other.id, noThatDay.id);

    const uid = users.employee.id;
    // ورود ۰۳:۰۰Z پیش از شروع شیفت (به وقت UTC تا تهران) ⇒ present؛ ۱۳:۰۰Z پس از شروع ⇒ late
    attendanceRepository.createManual({ userId: uid, recordDate: D.present, checkInTime: `${D.present}T03:00:00.000Z`, checkOutTime: `${D.present}T12:00:00.000Z`, status: 'normal' });
    attendanceRepository.createManual({ userId: uid, recordDate: D.late, checkInTime: `${D.late}T13:00:00.000Z`, checkOutTime: `${D.late}T14:30:00.000Z`, status: 'late' });
    attendanceRepository.createManual({ userId: uid, recordDate: D.incomplete, checkInTime: `${D.incomplete}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' });
    attendanceRepository.createManual({ userId: uid, recordDate: D.manualLeave, checkInTime: null, checkOutTime: null, status: 'leave' });
    holidaysRepository.addHoliday(D.holiday, 'تعطیل تست', { kind: 'full', scope: 'all' });

    const lr = leaveRepository.createLeaveRequest({ userId: uid, startDate: D.leave, endDate: D.leave, leaveType: 'leave', reason: 'تست' });
    leaveRepository.setStatus(lr.id, 'approved', null);
    const hr = leaveRepository.createLeaveRequest({
      userId: uid, startDate: D.hourLeave, endDate: D.hourLeave, leaveType: 'leave', reason: 'تست', unit: 'hour', startTime: '10:00', endTime: '12:00', durationMinutes: 120,
    });
    leaveRepository.setStatus(hr.id, 'approved', null);
    makeApprovedMission(uid, D.mission);

    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, url) {
    const headers = {};
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { headers });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدون بدنه */ }
    return { status: res.status, json };
  }
  const urlFor = (year, month, extra = '') => `/api/admin/calendar?year=${year}&month=${month}${extra}`;
  const currentMonthUrl = (extra) => { const { jy, jm } = jalaliOf(today); return urlFor(jy, jm, extra); };
  const findCell = (json, userId, dateStr) => {
    const u = json.users.find((x) => x.user.id === userId);
    return u && u.days.find((d) => d.date === dateStr);
  };
  async function cellOf(userId, dateStr) {
    const { jy, jm } = jalaliOf(dateStr);
    const r = await hit('admin', urlFor(jy, jm));
    assert.equal(r.status, 200);
    const cell = findCell(r.json, userId, dateStr);
    assert.ok(cell, `سلول ${dateStr} پیدا نشد`);
    return cell;
  }

  test('اسکوپ نقش: admin/hr همه، سرپرست فقط زیرمجموعه، کارمند ممنوع؛ فیلتر دپارتمان', async () => {
    const ids = (r) => r.json.users.map((u) => u.user.id).sort((a, b) => a - b);
    const all = [users.admin, users.hr, users.manager, users.employee, users.other].map((u) => u.id).sort((a, b) => a - b);
    assert.deepEqual(ids(await hit('admin', currentMonthUrl())), all);
    assert.deepEqual(ids(await hit('hr', currentMonthUrl())), all);
    assert.deepEqual(ids(await hit('manager', currentMonthUrl())), [users.employee.id]);
    assert.equal((await hit('employee', currentMonthUrl())).status, 403);
    assert.deepEqual(ids(await hit('admin', currentMonthUrl('&department=فنی'))), [users.employee.id]);
  });

  test('هر ماه شمسی همه‌ی روزهایش را برمی‌گرداند (ترتیب صعودی، بدون تکرار)', async () => {
    const { jy, jm } = jalaliOf(today);
    const r = await hit('admin', urlFor(jy, jm));
    const days = r.json.users[0].days.map((d) => d.date);
    assert.equal(days.length, require('jalaali-js').jalaaliMonthLength(jy, jm));
    assert.deepEqual([...days].sort(), days);
    assert.equal(new Set(days).size, days.length);
    assert.equal(days[0], r.json.from);
    assert.equal(days[days.length - 1], r.json.to);
  });

  test('وضعیت‌ها: present، late، incomplete، holiday، leave، mission، absent، future', async () => {
    const e = users.employee.id;
    let c = await cellOf(e, D.present); assert.equal(c.status, 'present'); assert.equal(c.hasRecord, true); assert.equal(c.lateMinutes, 0);
    c = await cellOf(e, D.late); assert.equal(c.status, 'late'); assert.ok(c.lateMinutes > 0);
    c = await cellOf(e, D.incomplete); assert.equal(c.status, 'incomplete'); assert.equal(c.hasRecord, true);
    c = await cellOf(e, D.holiday); assert.equal(c.status, 'holiday'); assert.equal(c.isHoliday, true); assert.ok(c.holidayTitle); assert.equal(c.hasRecord, false);
    c = await cellOf(e, D.leave); assert.equal(c.status, 'leave'); assert.equal(c.leave.kind, 'leave'); assert.equal(c.leave.unit, 'day');
    c = await cellOf(e, D.mission); assert.equal(c.status, 'mission'); assert.equal(c.leave.kind, 'mission');
    c = await cellOf(e, D.absent); assert.equal(c.status, 'absent'); assert.equal(c.hasRecord, false);
    c = await cellOf(e, D.future); assert.equal(c.status, 'future'); assert.equal(c.hasRecord, false);
  });

  test('روز غیرکاری شیفت ⇒ weekend', async () => {
    const c = await cellOf(users.other.id, D.weekend);
    assert.equal(c.status, 'weekend');
    assert.equal(c.isWorkingDay, false);
  });

  test('مرخصی ساعتی کل روز را «مرخصی» نمی‌کند ولی در leave گزارش می‌شود', async () => {
    const c = await cellOf(users.employee.id, D.hourLeave);
    assert.equal(c.status, 'absent');
    assert.equal(c.leave.unit, 'hour');
    assert.equal(c.leave.startTime, '10:00');
    assert.equal(c.leave.endTime, '12:00');
  });

  test('رکورد دستی بدون ورود با status=leave ⇒ leave (نه absent)', async () => {
    const c = await cellOf(users.employee.id, D.manualLeave);
    assert.equal(c.status, 'leave');
    assert.equal(c.hasRecord, true);
  });

  test('اعتبارسنجی ورودی: سال/ماه نامعتبر، کاربر نامعتبر/خارج از اسکوپ/ناموجود', async () => {
    assert.equal((await hit('admin', '/api/admin/calendar?year=abc&month=1')).status, 400);
    assert.equal((await hit('admin', '/api/admin/calendar?year=1403&month=13')).status, 400);
    assert.equal((await hit('admin', '/api/admin/calendar?year=1403&month=0')).status, 400);
    assert.equal((await hit('admin', currentMonthUrl('&userId=abc'))).status, 400);
    assert.equal((await hit('manager', currentMonthUrl(`&userId=${users.other.id}`))).status, 403);
    assert.equal((await hit('admin', currentMonthUrl('&userId=999999'))).status, 404);
    assert.equal((await hit('manager', currentMonthUrl(`&userId=${users.employee.id}`))).status, 200);
  });

  test('آستانه‌ی هشدار هم‌زمانی (S4-14b): maxConcurrent پیش‌فرض ۰؛ مقدار تنظیم در پاسخ می‌آید، حتی وقتی فهرست کاربران خالی است', async () => {
    const settingsRepo = require('../src/repositories/settingsRepository');
    assert.equal((await hit('admin', currentMonthUrl())).json.maxConcurrent, 0);
    settingsRepo.setValue('teamCalendarMaxConcurrent', 2);
    try {
      assert.equal((await hit('admin', currentMonthUrl())).json.maxConcurrent, 2);
      assert.equal((await hit('manager', currentMonthUrl())).json.maxConcurrent, 2);
      const empty = await hit('admin', currentMonthUrl('&department=دپارتمان-ناموجود'));
      assert.equal(empty.status, 200);
      assert.deepEqual(empty.json.users, []);
      assert.equal(empty.json.maxConcurrent, 2);
    } finally {
      settingsRepo.resetValue('teamCalendarMaxConcurrent');
    }
    assert.equal((await hit('admin', currentMonthUrl())).json.maxConcurrent, 0);
  });

  test('بدون ورود ⇒ ۴۰۱', async () => {
    assert.equal((await hit('nobody', currentMonthUrl())).status, 401);
  });
});
