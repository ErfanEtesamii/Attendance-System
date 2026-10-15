// D1 (فاز ۱۲): شمارش تأخیر ماهانه (ماه شمسی) و چرخه‌ی «اجازه‌ی ورود» — سرویس lateLimitService + repository + migration ۰۳۱.
// «بیش از ۳ بار»: تأخیر اول تا سوم آزاد؛ وقتی سه تأخیرِ قطعی‌شده ثبت شده، ورودِ دیرِ بعدی (چهارم) اجازه می‌خواهد.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/lateLimitService');
const repo = require('../src/repositories/checkinPermissionRepository');
const settings = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const userDaySvc = require('../src/services/userScheduleService');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const holidays = require('../src/repositories/holidaysRepository');
const migration = require('../src/db/migrations/031_checkin_permissions');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TZ = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TZ);
const NOW = at('2026-12-10', '10:00'); // پنجشنبه، ۱۹ آذر ۱۴۰۵ (ماه ۹)
const AZAR = { jy: 1405, jm: 9 }; // ۲۰۲۶-۱۱-۲۲ تا ۲۰۲۶-۱۲-۲۱
const ABAN = { jy: 1405, jm: 8 }; // ... تا ۲۰۲۶-۱۱-۲۱
// روزهای کاریِ آذر قبل از «امروز»: سه‌شنبه‌ها/…؛ همه کاری‌اند (آخر هفته‌ی پیش‌فرض: جمعه)
const WORK = ['2026-12-01', '2026-12-02', '2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08'];

describe('اجازه‌ی ورود و سقف تأخیر ماهانه (D1)', () => {
  let db; let admin; let mgr; let other; let hr; let emp; let loner;
  let seq = 0;
  const mk = (o = {}) => makeUser(o);
  const checkIn = (u, date, inH, outH = '16:30') => attendanceRepo.createManual({ userId: u.id, recordDate: date, checkInTime: at(date, inH).toISOString(), checkOutTime: outH ? at(date, outH).toISOString() : null, status: 'normal' });

  before(() => {
    db = resetDb();
    admin = mk({ role: 'admin' });
    mgr = mk({ role: 'manager' });
    other = mk({ role: 'manager' });
    hr = mk({ role: 'hr' });
    settings.setValue('lateMonthlyLimit', 3);
    settings.setValue('lateLimitGateMode', 'enforce');
  });
  after(cleanup);
  beforeEach(() => {
    emp = mk({ managerId: mgr.id });
    loner = mk({}); // بدون سرپرست
    seq += 1;
  });

  const lates = (u, dates, hhmm = '08:20') => dates.forEach((d) => checkIn(u, d, hhmm));

  test('۳ تأخیر قطعی ⇒ دقیقاً به سقف رسیده (ورود چهارم گیت می‌خورد)؛ ۲ تأخیر ⇒ آزاد', () => {
    lates(emp, WORK.slice(0, 2));
    let g = svc.getGateState(emp, NOW);
    assert.deepEqual([g.enabled, g.lateCount, g.limit, g.overLimit, g.blocked], [true, 2, 3, false, false]);
    lates(emp, WORK.slice(2, 3));
    g = svc.getGateState(emp, NOW);
    assert.deepEqual([g.lateCount, g.overLimit, g.blocked, g.permission], [3, true, true, null]);
    assert.deepEqual([g.month.jy, g.month.jm], [1405, 9]);
  });

  test('شمارش: ورود به‌موقع و داخل مهلت شمرده نمی‌شود؛ تأخیر «امروز» هم شمرده نمی‌شود', () => {
    checkIn(emp, WORK[0], '08:00'); checkIn(emp, WORK[1], '07:40'); checkIn(emp, WORK[2], '08:20');
    attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-12-10', checkInTime: at('2026-12-10', '09:30').toISOString(), checkOutTime: null, status: 'late' });
    const r = svc.countLateInMonth(emp.id, AZAR, { now: NOW });
    assert.deepEqual([r.count, r.days.map((d) => d.date)], [1, [WORK[2]]]);
    assert.equal(r.days[0].lateMinutes, 20);
    settings.setValue('lateGraceMinutes', 25);
    assert.equal(svc.countLateInMonth(emp.id, AZAR, { now: NOW }).count, 0, 'داخل مهلت تأخیر ⇒ late=۰');
    settings.resetValue('lateGraceMinutes');
  });

  test('مرخصی/تعطیل/آف روز شمرده نمی‌شود؛ شیفت مؤثر و override روز (B2) در تعریف «تأخیر» اثر دارند', () => {
    const u = mk({ managerId: mgr.id });
    attendanceRepo.createManual({ userId: u.id, recordDate: WORK[0], checkInTime: at(WORK[0], '09:00').toISOString(), checkOutTime: at(WORK[0], '16:00').toISOString(), status: 'leave' });
    holidays.addHoliday('2026-12-03', 'تعطیلی تست', { kind: 'full' }); // خارج از WORK تا روی تست‌های بعدی اثر نگذارد
    checkIn(u, '2026-12-03', '09:00'); // کار در روز تعطیل
    userDaySvc.setDay(admin, u.id, WORK[2], { kind: 'off' });
    checkIn(u, WORK[2], '09:00'); // روز آفِ برنامه‌ی ویژه
    assert.equal(svc.countLateInMonth(u.id, AZAR, { now: NOW }).count, 0);
    // شیفتِ عصر ۱۵:۳۰: ورود ۰۸:۲۰ دیر نیست؛ ۱۵:۴۰ دیر است
    const ev = shiftsRepo.createShift({ name: `ع${seq}`, startTime: '15:30', endTime: '21:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    shiftsRepo.assignShift({ userId: u.id, shiftId: ev.id, effectiveFrom: '2026-01-01' });
    checkIn(u, WORK[3], '08:20', '21:00'); checkIn(u, WORK[4], '15:40', '21:00');
    assert.deepEqual(svc.countLateInMonth(u.id, AZAR, { now: NOW }).days.map((d) => d.date), [WORK[4]]);
    // override work روزِ WORK[5] با شروع ۱۰:۰۰: ورود ۱۰:۰۵ ⇒ دیر (۵ دقیقه)
    userDaySvc.setDay(admin, u.id, WORK[5], { kind: 'work', startTime: '10:00', endTime: '14:00' });
    checkIn(u, WORK[5], '10:05', '14:00');
    assert.deepEqual(svc.countLateInMonth(u.id, AZAR, { now: NOW }).days.map((d) => d.date).sort(), [WORK[4], WORK[5]]);
  });

  test('مرز ماه شمسی: ۲۱ آبان ⇒ آبان، ۱ آذر ⇒ آذر؛ ماه گذشته کامل شمرده می‌شود', () => {
    const u = mk({ managerId: mgr.id });
    checkIn(u, '2026-11-21', '08:30'); // ۳۰ آبان (آخر ماه ۸) — شنبه ۱ آذر = ۲۰۲۶-۱۱-۲۲
    checkIn(u, '2026-11-22', '08:30'); // ۱ آذر
    assert.deepEqual(svc.countLateInMonth(u.id, AZAR, { now: NOW }).days.map((d) => d.date), ['2026-11-22']);
    assert.deepEqual(svc.countLateInMonth(u.id, ABAN, { now: NOW }).days.map((d) => d.date), ['2026-11-21']);
    assert.throws(() => svc.countLateInMonth(u.id, { jy: 1405, jm: 13 }, { now: NOW }), RangeError);
  });

  test('خاموش: limit=۰ یا mode=off ⇒ enabled=false و blocked=false (حتی با تأخیر زیاد)؛ soft همچنان وضعیت را حساب می‌کند', () => {
    lates(emp, WORK.slice(0, 4));
    settings.setValue('lateMonthlyLimit', 0);
    assert.deepEqual([svc.getGateState(emp, NOW).enabled, svc.getGateState(emp, NOW).blocked, svc.getGateState(emp, NOW).lateCount], [false, false, 0]);
    settings.setValue('lateMonthlyLimit', 3);
    settings.setValue('lateLimitGateMode', 'off');
    assert.equal(svc.getGateState(emp, NOW).blocked, false);
    settings.setValue('lateLimitGateMode', 'soft');
    const s = svc.getGateState(emp, NOW);
    assert.deepEqual([s.enabled, s.mode, s.overLimit, s.blocked], [true, 'soft', true, true]);
    settings.setValue('lateLimitGateMode', 'enforce');
  });

  test('requestPermission: فقط بالای سقف؛ علت الزامی/≤۲۰۰؛ یکتایی درخواست فعال', () => {
    lates(emp, WORK.slice(0, 2));
    assert.equal(svc.requestPermission(emp, 'علت', NOW).code, 'PERMISSION_NOT_REQUIRED');
    lates(emp, WORK.slice(2, 3));
    assert.equal(svc.requestPermission(emp, '   ', NOW).code, 'REASON_REQUIRED');
    assert.equal(svc.requestPermission(emp, 'x'.repeat(201), NOW).code, 'REASON_TOO_LONG');
    const r = svc.requestPermission(emp, 'ترافیک سنگین', NOW);
    assert.deepEqual([r.ok, r.permission.status, r.permission.date, r.permission.reason], [true, 'pending', '2026-12-10', 'ترافیک سنگین']);
    const dup = svc.requestPermission(emp, 'دوباره', NOW);
    assert.deepEqual([dup.ok, dup.status, dup.code, dup.permission.id], [false, 409, 'PERMISSION_ALREADY_ACTIVE', r.permission.id]);
    assert.equal(svc.getGateState(emp, NOW).permission.status, 'pending');
    assert.equal(svc.getGateState(emp, NOW).blocked, true, 'pending هنوز ورود را باز نمی‌کند');
    assert.throws(() => repo.insert({ userId: emp.id, date: '2026-12-10', reason: 'x', requestedAt: NOW.toISOString() }), /UNIQUE|constraint/i);
  });

  test('decide: فقط سرپرست مستقیم یا ادمین؛ کارمندِ بدون سرپرست فقط ادمین؛ hr/employee هرگز؛ تصمیم مجدد رد می‌شود', () => {
    lates(emp, WORK.slice(0, 3)); lates(loner, WORK.slice(0, 3));
    const pe = svc.requestPermission(emp, 'الف', NOW).permission;
    const pl = svc.requestPermission(loner, 'ب', NOW).permission;
    for (const [actor, id, code] of [[other, pe.id, 'FORBIDDEN'], [hr, pe.id, 'FORBIDDEN'], [emp, pe.id, 'FORBIDDEN'], [mgr, pl.id, 'FORBIDDEN']]) {
      const r = svc.decide(actor, id, true, null, NOW);
      assert.deepEqual([r.ok, r.status, r.code], [false, 403, code]);
    }
    assert.equal(svc.decide(admin, 99999, true, null, NOW).status, 404);
    assert.equal(svc.decide(mgr, pe.id, true, 'x'.repeat(201), NOW).code, 'NOTE_TOO_LONG');
    const ok = svc.decide(mgr, pe.id, true, 'باشه', NOW);
    assert.deepEqual([ok.ok, ok.permission.status, ok.permission.decidedBy, ok.permission.decisionNote], [true, 'approved', mgr.id, 'باشه']);
    assert.equal(ok.permission.expiresAt, new Date(NOW.getTime() + 60 * 60000).toISOString(), 'TTL پیش‌فرض ۶۰ دقیقه از لحظه‌ی تأیید');
    assert.equal(svc.decide(mgr, pe.id, false, null, NOW).code, 'PERMISSION_NOT_PENDING');
    assert.equal(svc.decide(admin, pe.id, true, null, NOW).code, 'PERMISSION_NOT_PENDING');
    assert.equal(svc.decide(admin, pl.id, true, null, NOW).ok, true);
    assert.equal(svc.getGateState(emp, NOW).permission.decisionNote, 'باشه');
  });

  test('تأیید ⇒ blocked=false؛ مصرف با ورود ⇒ used و دوباره مسدود؛ مصرف دوم null', () => {
    lates(emp, WORK.slice(0, 3));
    const p = svc.requestPermission(emp, 'علت', NOW).permission;
    assert.equal(svc.consumeOnCheckIn(emp, NOW), null, 'pending مصرف‌شدنی نیست');
    svc.decide(mgr, p.id, true, null, NOW);
    const g = svc.getGateState(emp, at('2026-12-10', '10:30'));
    assert.deepEqual([g.blocked, g.permission.status], [false, 'approved']);
    const used = svc.consumeOnCheckIn(emp, at('2026-12-10', '10:31'));
    assert.deepEqual([used.status, used.id], ['used', p.id]);
    assert.equal(db.prepare('SELECT used_at FROM checkin_permissions WHERE id = ?').get(p.id).used_at, at('2026-12-10', '10:31').toISOString());
    assert.equal(svc.consumeOnCheckIn(emp, at('2026-12-10', '10:32')), null);
    const after = svc.getGateState(emp, at('2026-12-10', '10:33'));
    assert.deepEqual([after.blocked, after.permission.status], [true, 'used']);
  });

  test('اجازه‌ی منقضی (بعد از TTL) و ردشده ⇒ مسدود؛ بعد از رد/انقضا می‌شود دوباره درخواست داد؛ pending روز قبل منقضی می‌شود', () => {
    lates(emp, WORK.slice(0, 3));
    const p = svc.requestPermission(emp, 'علت', NOW).permission;
    svc.decide(mgr, p.id, true, null, NOW);
    const late = at('2026-12-10', '11:01'); // ۶۱ دقیقه بعد
    const g = svc.getGateState(emp, late);
    assert.deepEqual([g.blocked, g.permission.status], [true, 'expired']);
    assert.equal(svc.consumeOnCheckIn(emp, late), null, 'اجازه‌ی منقضی مصرف نمی‌شود');
    const again = svc.requestPermission(emp, 'درخواست دوباره', late);
    assert.equal(again.ok, true, 'بعد از انقضا درخواست تازه مجاز است');
    svc.decide(mgr, again.permission.id, false, 'نه', late);
    assert.deepEqual([svc.getGateState(emp, late).blocked, svc.getGateState(emp, late).permission.status], [true, 'rejected']);
    assert.equal(svc.requestPermission(emp, 'سوم', late).ok, true, 'بعد از رد هم می‌شود دوباره درخواست داد');
    // pending مانده از دیروز
    const old = repo.insert({ userId: emp.id, date: '2026-12-09', reason: 'قدیمی', requestedAt: at('2026-12-09', '09:00').toISOString() });
    svc.getGateState(emp, late);
    assert.equal(repo.findById(old.id).status, 'expired');
    assert.equal(svc.decide(mgr, old.id, true, null, late).code, 'PERMISSION_NOT_PENDING');
  });

  test('TTL از تنظیمات (تأیید با TTL=۱۰ دقیقه)', () => {
    settings.setValue('lateLimitPermissionTtlMinutes', 10);
    lates(emp, WORK.slice(0, 3));
    const p = svc.requestPermission(emp, 'علت', NOW).permission;
    const d = svc.decide(mgr, p.id, true, null, NOW);
    assert.equal(d.permission.expiresAt, new Date(NOW.getTime() + 10 * 60000).toISOString());
    assert.equal(svc.getGateState(emp, at('2026-12-10', '10:09')).blocked, false);
    assert.equal(svc.getGateState(emp, at('2026-12-10', '10:11')).blocked, true);
    settings.setValue('lateLimitPermissionTtlMinutes', 60);
  });

  test('ثبت‌نشدنِ تأخیر در سایر کارمندان: شمارش مستقل و کارمند زیر سقف دست‌نخورده', () => {
    lates(emp, WORK.slice(0, 3));
    const calm = mk({ managerId: mgr.id });
    checkIn(calm, WORK[0], '08:00');
    assert.deepEqual([svc.getGateState(calm, NOW).lateCount, svc.getGateState(calm, NOW).blocked], [0, false]);
    assert.equal(svc.getGateState(emp, NOW).blocked, true);
  });

  test('listForQueue: فیلتر وضعیت/اسکوپ، شمار تأخیر ماه و اطلاعات کارمند', () => {
    lates(emp, WORK.slice(0, 3)); lates(loner, WORK.slice(0, 3));
    svc.requestPermission(emp, 'الف', NOW); svc.requestPermission(loner, 'ب', NOW);
    const all = svc.listForQueue({ now: NOW });
    assert.ok(all.length >= 2);
    const mine = svc.listForQueue({ status: 'pending', userIds: [emp.id], now: NOW });
    assert.equal(mine.length, 1);
    assert.deepEqual([mine[0].user.id, mine[0].lateCount, mine[0].limit, mine[0].status], [emp.id, 3, 3, 'pending']);
    assert.deepEqual(svc.listForQueue({ userIds: [], now: NOW }), []);
  });

  test('migration ۰۳۱ idempotent و CHECK وضعیت/تاریخ', () => {
    migration.up(db);
    migration.up(db);
    assert.throws(() => db.prepare("INSERT INTO checkin_permissions (user_id, permission_date, status, reason, requested_at) VALUES (?, '2026-12-10', 'zzz', 'x', 'x')").run(admin.id));
    assert.throws(() => db.prepare("INSERT INTO checkin_permissions (user_id, permission_date, status, reason, requested_at) VALUES (?, '2026-12-1', 'pending', 'x', 'x')").run(admin.id));
  });
});
