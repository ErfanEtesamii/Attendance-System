// B2 (فاز ۱۲): برنامه‌ی کاری روزبه‌روز هر کارمند — سرویس (اعتبارسنجی/اسکوپ/قفل ماه/audit/گروهی) + اولویت در موتور (override ← شیفت ← سراسری).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/userScheduleService');
const repo = require('../src/repositories/userDayScheduleRepository');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const dayService = require('../src/engine/dayService');
const calendarService = require('../src/engine/calendarService');
const monthClosures = require('../src/repositories/monthClosuresRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');
const migration = require('../src/db/migrations/029_user_day_schedules');

const TEHRAN = 'Asia/Tehran';
const iso = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const SAT = '2026-09-12'; // شنبه
const usersRepoRow = (u) => require('../src/repositories/usersRepository').findById(u.id);
const mkShift = (o) => shiftsRepo.createShift({ graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0, ...o });

describe('برنامه‌ی روزبه‌روز کارمند (B2)', () => {
  let db; let admin; let mgr; let other; let hr; let emp; let outsider; let evening; let night;

  before(() => {
    db = resetDb();
    admin = makeUser({ role: 'admin' });
    mgr = makeUser({ role: 'manager' });
    other = makeUser({ role: 'manager' });
    hr = makeUser({ role: 'hr' });
    emp = makeUser({ managerId: mgr.id });
    outsider = makeUser({ managerId: other.id });
    evening = mkShift({ name: 'عصر', startTime: '15:30', endTime: '21:00' });
    night = mkShift({ name: 'شب', startTime: '22:00', endTime: '06:00', overnight: true });
  });
  after(cleanup);

  const row = (u, d) => repo.get(u.id, d);

  test('اعتبارسنجی: kind، فرمت ساعت، پایان بعد از شروع، یادداشت', () => {
    const bad = (input, code) => { const r = svc.setDay(admin, emp.id, '2026-09-20', input); assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(r.status, 400); };
    bad({ kind: 'x' }, 'INVALID_KIND');
    bad({ kind: 'work' }, 'INVALID_TIME');
    bad({ kind: 'work', startTime: '8:00', endTime: '16:00' }, 'INVALID_TIME');
    bad({ kind: 'work', startTime: '08:00', endTime: '25:00' }, 'INVALID_TIME');
    bad({ kind: 'work', startTime: '10:00', endTime: '10:00' }, 'INVALID_TIME');
    bad({ kind: 'work', startTime: '18:00', endTime: '09:00' }, 'INVALID_TIME'); // پایان قبل از شروع بدون شیفت شب
    bad({ kind: 'off', note: 'x'.repeat(201) }, 'NOTE_TOO_LONG');
    assert.equal(svc.setDay(admin, emp.id, '2026-02-30', { kind: 'off' }).code, 'INVALID_DATE');
    assert.equal(svc.setDay(admin, 99999, '2026-09-20', { kind: 'off' }).status, 404);
    assert.equal(repo.listRange(emp.id, '2026-09-01', '2026-09-30').length, 0, 'هیچ ردیفی با ورودی نامعتبر ساخته نشد');
  });

  test('ثبت/ویرایش/حذف + audit با قبل/بعد؛ ثبت تکراری بدون تغییر audit نمی‌سازد', () => {
    const auditCount = (a) => db.prepare('SELECT COUNT(*) n FROM audit_log WHERE action = ?').get(a).n;
    const set = svc.setDay(mgr, emp.id, '2026-09-21', { kind: 'work', startTime: '10:00', endTime: '14:00', note: 'جلسه' });
    assert.deepEqual([set.ok, set.changed, set.schedule.startTime, set.schedule.note], [true, true, '10:00', 'جلسه']);
    assert.equal(auditCount('user_day_schedule_set'), 1);
    assert.equal(svc.setDay(mgr, emp.id, '2026-09-21', { kind: 'work', startTime: '10:00', endTime: '14:00', note: 'جلسه' }).changed, false);
    assert.equal(auditCount('user_day_schedule_set') + auditCount('user_day_schedule_updated'), 1);
    assert.equal(svc.setDay(mgr, emp.id, '2026-09-21', { kind: 'off' }).changed, true);
    assert.equal(auditCount('user_day_schedule_updated'), 1);
    const log = db.prepare("SELECT details FROM audit_log WHERE action = 'user_day_schedule_updated'").get();
    const d = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
    assert.deepEqual([d.targetUserId, d.date, d.changes.schedule.before.kind, d.changes.schedule.after.kind], [emp.id, '2026-09-21', 'work', 'off']);
    assert.deepEqual(svc.clearDay(mgr, emp.id, '2026-09-21'), { ok: true, removed: true });
    assert.equal(svc.clearDay(mgr, emp.id, '2026-09-21').removed, false);
    assert.equal(auditCount('user_day_schedule_removed'), 1);
    assert.equal(row(emp, '2026-09-21'), null);
  });

  test('اسکوپ: سرپرستِ غیرمرتبط ۴۰۳، hr/employee نمی‌نویسند، admin همه؛ خواندن: hr همه، سرپرست تیم خودش، کارمند خودش', () => {
    assert.equal(svc.setDay(other, emp.id, '2026-09-22', { kind: 'off' }).status, 403);
    assert.equal(svc.setDay(hr, emp.id, '2026-09-22', { kind: 'off' }).status, 403);
    assert.equal(svc.setDay(emp, emp.id, '2026-09-22', { kind: 'off' }).status, 403);
    assert.equal(svc.setDay(mgr, outsider.id, '2026-09-22', { kind: 'off' }).status, 403);
    assert.equal(svc.clearDay(other, emp.id, '2026-09-22').status, 403);
    assert.equal(svc.setDay(admin, outsider.id, '2026-09-22', { kind: 'off' }).ok, true);
    assert.equal(svc.list(hr, outsider.id, '2026-09-20', '2026-09-24').ok, true);
    assert.equal(svc.list(mgr, outsider.id, '2026-09-20', '2026-09-24').status, 403);
    assert.equal(svc.list(emp, emp.id, '2026-09-20', '2026-09-24').ok, true);
    assert.equal(svc.list(emp, outsider.id, '2026-09-20', '2026-09-24').status, 403);
    assert.equal(row(emp, '2026-09-22'), null);
  });

  test('ماه بسته‌شده ⇒ ۴۰۹ برای ثبت و حذف؛ روز خارج از ماه بسته آزاد است', () => {
    svc.setDay(admin, emp.id, '2026-04-10', { kind: 'off' }); // قبل از بستن
    monthClosures.saveClosure({ year: 1405, month: 1, periodFrom: '2026-03-21', periodTo: '2026-04-20', snapshot: {}, checklist: {}, closedBy: admin.id });
    const r = svc.setDay(admin, emp.id, '2026-04-15', { kind: 'off' });
    assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'MONTH_CLOSED']);
    assert.equal(svc.clearDay(admin, emp.id, '2026-04-10').code, 'MONTH_CLOSED');
    assert.equal(row(emp, '2026-04-10').kind, 'off', 'ردیف ماه بسته دست نخورد');
    assert.equal(svc.setDay(admin, emp.id, '2026-04-21', { kind: 'off' }).ok, true);
  });

  test('گروهی: چند نفر × بازه با فیلتر روز هفته، سقف‌ها، خطای جزئی', () => {
    const e2 = makeUser({ managerId: mgr.id });
    const r = svc.bulk(mgr, { userIds: [emp.id, e2.id, outsider.id], from: '2026-10-03', to: '2026-10-09', weekdays: [6, 0], kind: 'work', startTime: '09:00', endTime: '13:00' });
    assert.equal(r.ok, true);
    // ۲۰۲۶-۱۰-۰۳ شنبه، ۰۴ یکشنبه ⇒ ۲ روز؛ ۳ کاربر ⇒ ۶ ترکیب، ۲ تا (outsider) رد
    assert.equal(r.results.length, 6);
    assert.equal(r.appliedCount, 4);
    assert.ok(r.results.filter((x) => x.userId === outsider.id).every((x) => !x.ok && x.code === 'FORBIDDEN'));
    assert.equal(row(emp, '2026-10-03').start_time, '09:00');
    assert.equal(row(emp, '2026-10-05'), null, 'دوشنبه خارج از weekdays');
    const bad = (input) => svc.bulk(mgr, { kind: 'off', ...input });
    assert.equal(bad({ userIds: [], from: '2026-10-03', to: '2026-10-04' }).code, 'INVALID_USERS');
    assert.equal(bad({ userIds: [emp.id], from: '2026-10-05', to: '2026-10-04' }).code, 'INVALID_RANGE');
    assert.equal(bad({ userIds: [emp.id], from: '2026-10-01', to: '2026-11-15' }).code, 'RANGE_TOO_LONG');
    assert.equal(bad({ userIds: Array.from({ length: 51 }, (_, i) => i + 1), from: '2026-10-03', to: '2026-10-04' }).code, 'TOO_MANY_USERS');
    assert.equal(bad({ userIds: [emp.id], from: '2026-10-03', to: '2026-10-04', weekdays: [9] }).code, 'INVALID_WEEKDAYS');
    assert.equal(svc.bulk(mgr, { userIds: [emp.id], from: '2026-10-03', to: '2026-10-04', kind: 'zzz' }).code, 'INVALID_KIND');
  });

  test('شیفت شب: پایان قبل از شروع فقط وقتی شیفتِ مؤثر آن روز شب است', () => {
    const u = makeUser({ managerId: mgr.id });
    shiftsRepo.assignShift({ userId: u.id, shiftId: night.id, effectiveFrom: '2026-01-01' });
    const ok = svc.setDay(admin, u.id, '2026-10-20', { kind: 'work', startTime: '20:00', endTime: '04:00' });
    assert.equal(ok.ok, true);
    assert.equal(svc.setDay(admin, emp.id, '2026-10-20', { kind: 'work', startTime: '20:00', endTime: '04:00' }).ok, false);
  });

  test('list: برنامه‌ی ویژه + تقویم مؤثر + منبع (override/shift/global)', () => {
    const u = makeUser({ managerId: mgr.id });
    shiftsRepo.assignShift({ userId: u.id, shiftId: evening.id, effectiveFrom: '2026-01-01' });
    svc.setDay(admin, u.id, '2026-09-13', { kind: 'work', startTime: '10:00', endTime: '14:00' }); // یکشنبه
    svc.setDay(admin, u.id, '2026-09-14', { kind: 'off' });
    const r = svc.list(admin, u.id, '2026-09-12', '2026-09-15');
    const by = Object.fromEntries(r.days.map((d) => [d.date, d]));
    assert.deepEqual([by['2026-09-12'].effective.expectedStart, by['2026-09-12'].effective.source], ['15:30', 'shift']);
    assert.deepEqual([by['2026-09-13'].effective.expectedStart, by['2026-09-13'].effective.expectedEnd, by['2026-09-13'].effective.source], ['10:00', '14:00', 'override']);
    assert.deepEqual([by['2026-09-14'].effective.isWorkingDay, by['2026-09-14'].schedule.kind], [false, 'off']);
    const g = makeUser({ managerId: mgr.id });
    assert.equal(svc.list(admin, g.id, '2026-09-12', '2026-09-12').days[0].effective.source, 'global');
    assert.equal(svc.list(admin, g.id, '2026-09-01', '2026-12-31').code, 'RANGE_TOO_LONG');
  });

  test('موتور: override work بر شیفت غالب است (تأخیر/اضافه‌کاری با ساعت همان روز)، روزهای دیگر دست‌نخورده', () => {
    const u = makeUser({ managerId: mgr.id });
    shiftsRepo.assignShift({ userId: u.id, shiftId: evening.id, effectiveFrom: '2026-01-01' });
    svc.setDay(admin, u.id, '2026-11-01', { kind: 'work', startTime: '10:00', endTime: '14:00' }); // یکشنبه
    const rec = (date, inH, outH) => attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: iso(date, inH), checkOutTime: iso(date, outH), status: 'normal' });
    const special = dayService.computeRecordDay(rec('2026-11-01', '10:20', '14:30'));
    assert.deepEqual([special.expected, special.late, special.earlyLeave, special.overtime], [240, 20, 0, 30]);
    const plain = dayService.computeRecordDay(rec('2026-11-02', '15:40', '21:00')); // دوشنبه: شیفت عصر
    assert.deepEqual([plain.expected, plain.late], [330, 10]);
    const cal = calendarService.getCalendarDay(u, '2026-11-01');
    assert.deepEqual([cal.isWorkingDay, cal.expectedStart, cal.expectedEnd, cal.override], [true, '10:00', '14:00', 'work']);
    assert.equal(calendarService.getCalendarDay(u, '2026-11-02').override, undefined, 'بدون override فیلد اضافه نمی‌شود');
  });

  test('موتور: override work روی آخر هفته/تعطیلی، override off روی روز کاری؛ کاربر بدون شیفت با پارامترهای سراسری', () => {
    const u = makeUser({ managerId: mgr.id }); // بدون شیفت
    require('../src/repositories/holidaysRepository').addHoliday('2026-11-10', 'تعطیلی تست', { kind: 'full' });
    svc.setDay(admin, u.id, '2026-11-10', { kind: 'work', startTime: '09:00', endTime: '12:00' });
    const w = calendarService.getCalendarDay(u, '2026-11-10');
    assert.deepEqual([w.isWorkingDay, w.isHoliday, w.kind], [true, false, 'working']);
    const d = dayService.computeRecordDay(attendanceRepo.createManual({ userId: u.id, recordDate: '2026-11-10', checkInTime: iso('2026-11-10', '09:00'), checkOutTime: iso('2026-11-10', '12:00'), status: 'normal' }));
    assert.deepEqual([d.expected, d.late, d.overtime], [180, 0, 0]);

    svc.setDay(admin, u.id, '2026-11-11', { kind: 'off' }); // چهارشنبه (روز کاری سراسری)
    const o = calendarService.getCalendarDay(u, '2026-11-11');
    assert.deepEqual([o.isWorkingDay, o.expectedStart, o.override], [false, null, 'off']);
    const off = dayService.computeRecordDay(attendanceRepo.createManual({ userId: u.id, recordDate: '2026-11-11', checkInTime: iso('2026-11-11', '09:00'), checkOutTime: iso('2026-11-11', '11:00'), status: 'normal' }));
    assert.equal(off.expected, 0, 'روز آف ⇒ انتظار صفر؛ کار این روز اضافه‌کاری روز غیرکاری است');
    assert.ok(off.overtime > 0);
  });

  test('گزارش ماهانه (دسته‌ای) override را می‌بیند: آف روی روز کاری، کار روی جمعه', () => {
    const { computeMonthlyReport } = require('../src/services/monthlyReportService');
    const u = makeUser({ managerId: mgr.id });
    svc.setDay(admin, u.id, '2026-12-01', { kind: 'off' }); // سه‌شنبه: روز کاریِ سراسری ⇒ آف
    svc.setDay(admin, u.id, '2026-12-04', { kind: 'work', startTime: '09:00', endTime: '12:00' }); // جمعه: آخر هفته ⇒ کار
    const rep = computeMonthlyReport({ users: [usersRepoRow(u)], year: 1405, month: 9, now: '2026-12-31T12:00:00Z', includeDays: true, includeBalances: false });
    const days = Object.fromEntries(rep.users[0].days.map((d) => [d.date, d]));
    assert.deepEqual([days['2026-12-01'].expected, days['2026-12-01'].status], [0, 'weekend']);
    assert.deepEqual([days['2026-12-04'].expected, days['2026-12-04'].status], [180, 'absent']);
    assert.equal(days['2026-12-02'].expected, 510, 'روز بدون override مثل قبل');
  });

  test('migration ۰۲۹ idempotent و CHECK: work بدون ساعت / off با ساعت رد می‌شود', () => {
    migration.up(db);
    migration.up(db);
    assert.throws(() => db.prepare("INSERT INTO user_day_schedules (user_id, schedule_date, kind) VALUES (?, '2026-05-05', 'work')").run(emp.id));
    assert.throws(() => db.prepare("INSERT INTO user_day_schedules (user_id, schedule_date, kind, start_time, end_time) VALUES (?, '2026-05-05', 'off', '09:00', '10:00')").run(emp.id));
    assert.throws(() => db.prepare("INSERT INTO user_day_schedules (user_id, schedule_date, kind) VALUES (?, '2026-05-05x', 'off')").run(emp.id));
  });
});
