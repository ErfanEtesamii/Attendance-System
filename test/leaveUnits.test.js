// S4-8a: واحد و مدت مرخصی — migration ۰۱۵ (ستون‌ها و CHECKها، حفظ داده)، منطق خالص (اعتبارسنجی/مدت/تداخل) و سرویس با تقویم/شیفت/تعطیلات
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate, MIGRATIONS_DIR } = require('../src/db/migrator');
const { validateUnitInput, computeDuration, overlapDates } = require('../src/utils/leaveUnits');

// هفته‌ی مرجع: شنبه ۲۰۲۶-۰۹-۱۲ … جمعه ۰۹-۱۸ (جمعه آخر هفته، پنجشنبه نیم‌روز تا ۱۲:۳۰ در تنظیمات پیش‌فرض)
const D = { sat: '2026-09-12', sun: '2026-09-13', mon: '2026-09-14', tue: '2026-09-15', wed: '2026-09-16', thu: '2026-09-17', fri: '2026-09-18', sat2: '2026-09-19' };

// تقویم ساختگی برای تست‌های خالص: ۰۸:۰۰–۱۶:۳۰ (۵۱۰ دقیقه)، پنجشنبه تا ۱۲:۳۰ (۲۷۰)، جمعه آخر هفته، سه‌شنبه (۰۹-۱۵) تعطیلی کامل
function fakeDay(date) {
  if (date === D.fri) return { isWorkingDay: false, kind: 'weekend', expectedStart: null, expectedEnd: null };
  if (date === D.tue) return { isWorkingDay: false, kind: 'holiday', expectedStart: null, expectedEnd: null };
  if (date === D.thu) return { isWorkingDay: true, kind: 'half', expectedStart: '08:00', expectedEnd: '12:30' };
  return { isWorkingDay: true, kind: 'working', expectedStart: '08:00', expectedEnd: '16:30' };
}
const V = (o) => ({ unit: 'day', halfDayPart: null, startTime: null, endTime: null, ...o });

describe('منطق خالص: validateUnitInput', () => {
  test('پیش‌فرض day؛ ترکیب‌های معتبر و نامعتبر', () => {
    const ok = (i) => validateUnitInput(i);
    const codes = (i) => ok(i).errors.map((e) => e.code);
    assert.deepEqual(ok({ startDate: D.mon, endDate: D.wed }).value, V({ startDate: D.mon, endDate: D.wed }));
    assert.equal(ok({ unit: 'half_day', halfDayPart: 'morning', startDate: D.mon, endDate: D.mon }).ok, true);
    assert.equal(ok({ unit: 'hour', startTime: '10:00', endTime: '12:30', startDate: D.mon, endDate: D.mon }).ok, true);

    assert.deepEqual(codes({ unit: 'week', startDate: D.mon, endDate: D.mon }), ['INVALID_UNIT']);
    assert.deepEqual(codes({ startDate: '2026-02-31', endDate: D.mon }), ['INVALID_DATE']);
    assert.deepEqual(codes({ startDate: D.wed, endDate: D.mon }), ['INVALID_RANGE']);
    assert.deepEqual(codes({ startDate: D.mon, endDate: '2027-12-01' }), ['RANGE_TOO_LONG']);
    assert.deepEqual(codes({ unit: 'half_day', halfDayPart: 'morning', startDate: D.mon, endDate: D.tue }), ['SINGLE_DAY_REQUIRED']);
    assert.deepEqual(codes({ unit: 'half_day', startDate: D.mon, endDate: D.mon }), ['INVALID_HALF_DAY_PART']);
    assert.deepEqual(codes({ unit: 'half_day', halfDayPart: 'noon', startDate: D.mon, endDate: D.mon }), ['INVALID_HALF_DAY_PART']);
    assert.deepEqual(codes({ unit: 'hour', startTime: '9:00', endTime: '12:00', startDate: D.mon, endDate: D.mon }), ['INVALID_TIME']);
    assert.deepEqual(codes({ unit: 'hour', startTime: '12:00', endTime: '12:00', startDate: D.mon, endDate: D.mon }), ['INVALID_TIME_RANGE']);
    assert.deepEqual(codes({ unit: 'hour', startDate: D.mon, endDate: D.mon }), ['INVALID_TIME']);
    assert.deepEqual(codes({ unit: 'day', halfDayPart: 'morning', startDate: D.mon, endDate: D.mon }), ['UNIT_FIELDS_MISMATCH']);
    assert.deepEqual(codes({ unit: 'hour', halfDayPart: 'morning', startTime: '10:00', endTime: '11:00', startDate: D.mon, endDate: D.mon }), ['UNIT_FIELDS_MISMATCH']);
  });
});

describe('منطق خالص: computeDuration', () => {
  test('روزی: تعطیلی و آخر هفته‌ی وسط بازه شمرده نمی‌شود؛ نیم‌روزِ تقویم کوتاه‌تر است', () => {
    // یکشنبه تا شنبه‌ی بعد: یکشنبه ۵۱۰ + دوشنبه ۵۱۰ + (سه‌شنبه تعطیل) + چهارشنبه ۵۱۰ + پنجشنبه ۲۷۰ + (جمعه) + شنبه ۵۱۰
    const r = computeDuration(V({ startDate: D.sun, endDate: D.sat2 }), fakeDay);
    assert.equal(r.ok, true);
    assert.equal(r.minutes, 510 * 4 + 270);
    assert.deepEqual(r.days.filter((d) => !d.counted).map((d) => [d.date, d.reason]), [[D.tue, 'holiday'], [D.fri, 'weekend']]);
    assert.equal(r.days.length, 7);
    // فقط روز غیرکاری ⇒ خطا
    assert.equal(computeDuration(V({ startDate: D.fri, endDate: D.fri }), fakeDay).code, 'NO_WORKING_TIME');
    assert.equal(computeDuration(V({ startDate: D.tue, endDate: D.tue }), fakeDay).code, 'NO_WORKING_TIME');
    assert.equal(computeDuration(V({ startDate: D.tue, endDate: D.wed }), fakeDay).minutes, 510, 'تعطیلی اول بازه شمرده نمی‌شود');
  });

  test('نیم‌روز: مجموع صبح و عصر دقیقاً یک روز؛ روز غیرکاری ⇒ خطا', () => {
    const half = (date, part) => computeDuration(V({ unit: 'half_day', halfDayPart: part, startDate: date, endDate: date }), fakeDay);
    assert.deepEqual([half(D.mon, 'morning').minutes, half(D.mon, 'afternoon').minutes], [255, 255]);
    assert.deepEqual([half(D.thu, 'morning').minutes, half(D.thu, 'afternoon').minutes], [135, 135]);
    const odd = (part) => computeDuration(V({ unit: 'half_day', halfDayPart: part, startDate: D.mon, endDate: D.mon }), () => ({ isWorkingDay: true, kind: 'working', expectedStart: '09:00', expectedEnd: '17:35' }));
    assert.equal(odd('morning').minutes + odd('afternoon').minutes, 515);
    assert.equal(odd('morning').minutes, 257);
    assert.equal(half(D.fri, 'morning').code, 'NOT_WORKING_DAY');
    assert.equal(half(D.tue, 'afternoon').code, 'NOT_WORKING_DAY');
  });

  test('ساعتی: داخل ساعت کاری همان روز؛ بیرون/روز غیرکاری/شیفت شب ⇒ خطا', () => {
    const hour = (date, s, e, getDay = fakeDay) => computeDuration(V({ unit: 'hour', startTime: s, endTime: e, startDate: date, endDate: date }), getDay);
    assert.equal(hour(D.mon, '10:00', '12:30').minutes, 150);
    assert.equal(hour(D.mon, '08:00', '16:30').minutes, 510);
    assert.equal(hour(D.mon, '07:30', '09:00').code, 'OUTSIDE_WORK_HOURS');
    assert.equal(hour(D.mon, '16:00', '17:00').code, 'OUTSIDE_WORK_HOURS');
    assert.equal(hour(D.thu, '12:00', '13:00').code, 'OUTSIDE_WORK_HOURS'); // پایان نیم‌روز ۱۲:۳۰
    assert.equal(hour(D.thu, '10:00', '12:30').minutes, 150);
    assert.equal(hour(D.fri, '10:00', '11:00').code, 'NOT_WORKING_DAY');
    const night = () => ({ isWorkingDay: true, kind: 'working', expectedStart: '22:00', expectedEnd: '06:00' });
    assert.equal(hour(D.mon, '23:00', '23:30', night).code, 'OVERNIGHT_HOURLY_UNSUPPORTED');
    // روز کامل شیفت شب = ۱۴۴۰ − ۱۳۲۰ + ۳۶۰ = ۴۸۰
    assert.equal(computeDuration(V({ startDate: D.mon, endDate: D.mon }), night).minutes, 480);
  });
});

describe('منطق خالص: overlapDates', () => {
  test('روز/نیم‌روز/ساعتی روی روز کاری؛ روز غیرکاری نادیده', () => {
    const day = (a, b) => V({ startDate: a, endDate: b });
    const half = (d, part) => V({ unit: 'half_day', halfDayPart: part, startDate: d, endDate: d });
    const hr = (d, s, e) => V({ unit: 'hour', startTime: s, endTime: e, startDate: d, endDate: d });
    assert.deepEqual(overlapDates(day(D.sun, D.mon), day(D.mon, D.wed), fakeDay), [D.mon]);
    assert.deepEqual(overlapDates(day(D.sun, D.sun), day(D.mon, D.wed), fakeDay), []);
    assert.deepEqual(overlapDates(day(D.mon, D.mon), half(D.mon, 'morning'), fakeDay), [D.mon]);
    assert.deepEqual(overlapDates(half(D.mon, 'morning'), half(D.mon, 'afternoon'), fakeDay), []);
    assert.deepEqual(overlapDates(half(D.mon, 'morning'), half(D.mon, 'morning'), fakeDay), [D.mon]);
    assert.deepEqual(overlapDates(hr(D.mon, '08:00', '10:00'), half(D.mon, 'morning'), fakeDay), [D.mon]);
    assert.deepEqual(overlapDates(hr(D.mon, '13:00', '14:00'), half(D.mon, 'morning'), fakeDay), []);
    assert.deepEqual(overlapDates(hr(D.mon, '10:00', '11:00'), hr(D.mon, '11:00', '12:00'), fakeDay), []); // مرز مشترک تداخل نیست
    assert.deepEqual(overlapDates(hr(D.mon, '10:00', '11:30'), hr(D.mon, '11:00', '12:00'), fakeDay), [D.mon]);
    // دو درخواست فقط روی جمعه/تعطیلی هم‌پوشان‌اند ⇒ زمان کاری مشترکی نیست
    assert.deepEqual(overlapDates(day(D.thu, D.fri), day(D.fri, D.sat2), fakeDay), []);
    assert.deepEqual(overlapDates(day(D.mon, D.wed), day(D.tue, D.tue), fakeDay), []);
  });
});

describe('migration ۰۱۵ — ستون‌های واحد/مدت (S4-8a)', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-unit-migration-'));
  let counter = 0;
  function migrationsUpTo(n) {
    counter += 1;
    const dir = path.join(work, `m${counter}`);
    fs.mkdirSync(dir);
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
      const m = /^(\d{3,})_/.exec(f);
      if (m && parseInt(m[1], 10) <= n) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    }
    return dir;
  }
  function makeDbBefore015() {
    counter += 1;
    const db = new Database(path.join(work, `db${counter}.db`));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db, { dir: migrationsUpTo(14) });
    db.exec(`
      INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id) VALUES
        ('3001','مدیر','U1','فنی','admin',NULL), ('3002','کارمند','U2','فنی','employee',1);
      INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id, status, approver_id, reason, rejected_reason, created_at, updated_at) VALUES
        (2,'2026-09-25','2026-09-26','leave',1,'approved',1,'مرخصی',NULL,'2026-09-01 10:00:00','2026-09-02 11:00:00'),
        (2,'2026-10-02','2026-10-02','mission',2,'pending',NULL,NULL,NULL,'2026-09-03 08:00:00','2026-09-03 08:00:00'),
        (2,'2026-10-05','2026-10-06','leave',1,'rejected',1,'رد شده','نامناسب','2026-09-04 09:30:00','2026-09-05 09:30:00'),
        (2,'2026-10-20','2026-10-20','leave',1,'pending',NULL,'موقت',NULL,'2026-09-07 07:00:00','2026-09-07 07:00:00');
      DELETE FROM leave_requests WHERE id = 4;
    `);
    return db;
  }
  after(() => { try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { /* ویندوز: فایل هنوز باز است؛ پوشه‌ی temp را سیستم‌عامل بعداً پاک می‌کند */ } });

  test('داده‌ی قدیمی بدون تغییر می‌ماند، unit=day و بقیه NULL؛ ایندکس‌ها، شمارنده و بک‌آپ حفظ؛ اجرای دوباره بی‌اثر', () => {
    const db = makeDbBefore015();
    const before = db.prepare('SELECT * FROM leave_requests ORDER BY id').all();
    const backupDir = path.join(work, 'backups');
    const res = migrate(db, { dir: migrationsUpTo(15), backupDir });
    assert.deepEqual(res.applied, ['015_leave_request_units']);
    const after = db.prepare('SELECT * FROM leave_requests ORDER BY id').all();
    assert.equal(after.length, 3);
    after.forEach((row, i) => {
      const { unit, half_day_part: hp, start_time: st, end_time: et, duration_minutes: dm, ...old } = row;
      assert.deepEqual(old, before[i], `ردیف ${before[i].id} بدون تغییر`);
      assert.deepEqual([unit, hp, st, et, dm], ['day', null, null, null, null]);
    });
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='leave_requests'").all().map((r) => r.name);
    assert.ok(indexes.includes('idx_leave_user_status') && indexes.includes('idx_leave_type_id'), indexes.join());
    assert.equal(db.pragma('foreign_key_check').length, 0);
    const next = db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (2,'2026-11-01','2026-11-01','leave',1)").run();
    assert.equal(Number(next.lastInsertRowid), 5, 'شمارنده‌ی AUTOINCREMENT عقب نرفته');
    assert.equal(migrate(db, { dir: migrationsUpTo(15), backupDir }).applied.length, 0);
    const bak = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db'));
    assert.ok(bak.length >= 1, 'بک‌آپ pre-migration');
  });

  test('CHECKها: ترکیب ناهم‌خوان واحد/بخش/ساعت و نیم‌روز/ساعتیِ چندروزه رد می‌شود', () => {
    const db = makeDbBefore015();
    migrate(db, { dir: migrationsUpTo(15), backupDir: path.join(work, 'backups2') });
    const ins = (cols, vals) => db.prepare(`INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id, ${cols}) VALUES (2,'2026-11-02','2026-11-02','leave',1, ${vals.map(() => '?').join(',')})`).run(...vals);
    assert.doesNotThrow(() => ins('unit, half_day_part', ['half_day', 'morning']));
    assert.doesNotThrow(() => ins('unit, start_time, end_time, duration_minutes', ['hour', '10:00', '12:30', 150]));
    assert.throws(() => ins('unit', ['week']), /CHECK/);
    assert.throws(() => ins('unit', ['half_day']), /CHECK/, 'نیم‌روز بدون بخش');
    assert.throws(() => ins('unit, half_day_part', ['day', 'morning']), /CHECK/, 'بخش برای روزی');
    assert.throws(() => ins('unit, half_day_part', ['half_day', 'noon']), /CHECK/);
    assert.throws(() => ins('unit', ['hour']), /CHECK/, 'ساعتی بدون ساعت');
    assert.throws(() => ins('unit, start_time, end_time', ['hour', '12:00', '10:00']), /CHECK/, 'پایان قبل شروع');
    assert.throws(() => ins('unit, start_time, end_time', ['hour', '9:00', '10:00']), /CHECK/, 'قالب HH:MM');
    assert.throws(() => ins('unit, start_time, end_time', ['day', '10:00', '11:00']), /CHECK/, 'ساعت برای روزی');
    assert.throws(() => ins('duration_minutes', [-5]), /CHECK/);
    assert.throws(
      () => db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id, unit, half_day_part) VALUES (2,'2026-11-02','2026-11-03','leave',1,'half_day','morning')").run(),
      /CHECK/, 'نیم‌روز دو روزه'
    );
  });
});

describe('leaveDurationService با تقویم/شیفت/تعطیلات واقعی (S4-8a)', () => {
  let db, svc, repo, typesRepo, holidays, usersRepo, shiftsRepo, settings, user, other, allUnits;
  before(() => {
    db = resetDb();
    svc = require('../src/services/leaveDurationService');
    repo = require('../src/repositories/leaveRepository');
    typesRepo = require('../src/repositories/leaveTypesRepository');
    holidays = require('../src/repositories/holidaysRepository');
    usersRepo = require('../src/repositories/usersRepository');
    shiftsRepo = require('../src/repositories/shiftsRepository');
    settings = require('../src/repositories/settingsRepository');
    const f = require('./helpers/factories');
    user = f.makeUser();
    other = f.makeUser();
    settings.setValue('workDayStart', '08:00');
    settings.setValue('workDayEnd', '16:30');
    allUnits = typesRepo.createLeaveType({ code: 'flex', title: 'انعطاف‌پذیر', kind: 'leave', isPaid: true, requiresAttachment: false, countsAgainstBalance: true, allowedUnits: ['day', 'half_day', 'hour'], maxConsecutiveDays: null, isActive: true });
  });
  after(cleanup);

  const prep = (o) => svc.prepare({ userId: user.id, leaveTypeId: allUnits.id, ...o });
  const save = (o, status = 'pending') => {
    const p = prep(o);
    assert.equal(p.ok, true, JSON.stringify(p.errors));
    const r = repo.createLeaveRequest({ userId: user.id, leaveTypeId: allUnits.id, startDate: p.value.startDate, endDate: p.value.endDate, unit: p.value.unit, halfDayPart: p.value.halfDayPart, startTime: p.value.startTime, endTime: p.value.endTime, durationMinutes: p.durationMinutes });
    return status === 'pending' ? r : repo.setStatus(r.id, status, null);
  };

  test('مدت روزی با تقویم: آخر هفته و تعطیلی وسط بازه شمرده نمی‌شود، پنجشنبه نیم‌روز است', () => {
    assert.equal(prep({ startDate: D.mon, endDate: D.tue }).durationMinutes, 1020);
    // چهارشنبه تا شنبه‌ی بعد: ۵۱۰ + ۲۷۰ (پنجشنبه) + جمعه ۰ + شنبه ۵۱۰
    const r = prep({ startDate: D.wed, endDate: D.sat2 });
    assert.equal(r.ok, true);
    assert.equal(r.durationMinutes, 1290);
    assert.deepEqual(r.days.filter((d) => !d.counted).map((d) => [d.date, d.reason]), [[D.fri, 'weekend']]);
    holidays.addHoliday(D.tue, 'تعطیلی تست');
    assert.equal(prep({ startDate: D.mon, endDate: D.wed }).durationMinutes, 1020, 'تعطیلی کامل وسط بازه شمرده نمی‌شود');
    assert.equal(prep({ startDate: D.tue, endDate: D.tue }).errors[0].code, 'NO_WORKING_TIME');
    holidays.removeHoliday(holidays.listByDate(D.tue)[0].id);
    assert.equal(prep({ startDate: D.mon, endDate: D.wed }).durationMinutes, 1530);
  });

  test('نیم‌روز و ساعتی با ساعت کاری کاربر؛ شیفت اختصاصی و شیفت شب', () => {
    assert.equal(prep({ unit: 'half_day', halfDayPart: 'morning', startDate: D.mon, endDate: D.mon }).durationMinutes, 255);
    assert.equal(prep({ unit: 'half_day', halfDayPart: 'afternoon', startDate: D.thu, endDate: D.thu }).durationMinutes, 135);
    assert.equal(prep({ unit: 'hour', startTime: '10:00', endTime: '12:30', startDate: D.mon, endDate: D.mon }).durationMinutes, 150);
    assert.equal(prep({ unit: 'hour', startTime: '07:00', endTime: '09:00', startDate: D.mon, endDate: D.mon }).errors[0].code, 'OUTSIDE_WORK_HOURS');
    assert.equal(prep({ unit: 'hour', startTime: '10:00', endTime: '11:00', startDate: D.fri, endDate: D.fri }).errors[0].code, 'NOT_WORKING_DAY');

    // شیفت ۱۴:۰۰–۲۲:۰۰ شنبه تا چهارشنبه (۴۸۰): ساعتی ۱۰:۰۰ دیگر خارج از ساعت این کاربر است، ۱۵:۰۰ داخل
    const evening = shiftsRepo.createShift({ name: 'عصر', startTime: '14:00', endTime: '22:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    usersRepo.setUserShift(user.id, evening.id);
    assert.equal(prep({ startDate: D.mon, endDate: D.mon }).durationMinutes, 480);
    assert.equal(prep({ unit: 'hour', startTime: '10:00', endTime: '11:00', startDate: D.mon, endDate: D.mon }).errors[0].code, 'OUTSIDE_WORK_HOURS');
    assert.equal(prep({ unit: 'hour', startTime: '15:00', endTime: '16:00', startDate: D.mon, endDate: D.mon }).durationMinutes, 60);
    assert.equal(prep({ startDate: D.thu, endDate: D.thu }).errors[0].code, 'NO_WORKING_TIME', 'پنجشنبه برای این شیفت روز کاری نیست');

    const night = shiftsRepo.createShift({ name: 'شب', startTime: '22:00', endTime: '06:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: true, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    usersRepo.setUserShift(user.id, night.id);
    assert.equal(prep({ startDate: D.mon, endDate: D.mon }).durationMinutes, 480);
    assert.equal(prep({ unit: 'half_day', halfDayPart: 'afternoon', startDate: D.mon, endDate: D.mon }).durationMinutes, 240);
    assert.equal(prep({ unit: 'hour', startTime: '23:00', endTime: '23:30', startDate: D.mon, endDate: D.mon }).errors[0].code, 'OVERNIGHT_HOURLY_UNSUPPORTED');
    usersRepo.setUserShift(user.id, null);
  });

  test('نوع/واحد مجاز، ورودی نامعتبر و کاربر ناموجود؛ هیچ‌چیز نوشته نمی‌شود', () => {
    const count = () => db.prepare('SELECT COUNT(*) n FROM leave_requests').get().n;
    const n = count();
    // annual فقط day را می‌پذیرد (پیش‌فرض S4-7a)
    const annual = svc.prepare({ userId: user.id, leaveType: 'leave', unit: 'half_day', halfDayPart: 'morning', startDate: D.mon, endDate: D.mon });
    assert.equal(annual.errors[0].code, 'UNIT_NOT_ALLOWED');
    assert.equal(svc.prepare({ userId: user.id, leaveType: 'leave', startDate: D.mon, endDate: D.mon }).ok, true);
    assert.equal(svc.prepare({ userId: user.id, leaveTypeId: 99999, startDate: D.mon, endDate: D.mon }).errors[0].code, 'INVALID_TYPE');
    assert.equal(svc.prepare({ userId: 99999, startDate: D.mon, endDate: D.mon }).errors[0].code, 'USER_NOT_FOUND');
    assert.equal(prep({ unit: 'hour', startDate: D.mon, endDate: D.mon }).errors[0].code, 'INVALID_TIME');
    assert.equal(count(), n);
  });

  test('تداخل: pending/approved حساب می‌شود، ردشده و کاربر دیگر نه؛ صبح/عصر و ساعت‌های جدا تداخل ندارند؛ excludeRequestId', () => {
    const base = save({ startDate: D.sun, endDate: D.mon }); // pending: یکشنبه و دوشنبه
    const conflict = (o) => prep(o).conflicts;
    assert.equal(conflict({ startDate: D.mon, endDate: D.wed })[0].requestId, base.id);
    assert.deepEqual(conflict({ startDate: D.mon, endDate: D.wed })[0].dates, [D.mon]);
    assert.equal(prep({ startDate: D.mon, endDate: D.wed }).errors[0].code, 'OVERLAP');
    assert.equal(conflict({ unit: 'half_day', halfDayPart: 'morning', startDate: D.sun, endDate: D.sun }).length, 1);
    assert.equal(conflict({ unit: 'hour', startTime: '10:00', endTime: '11:00', startDate: D.mon, endDate: D.mon }).length, 1);
    assert.equal(prep({ startDate: D.wed, endDate: D.wed }).ok, true, 'روز بعد از بازه تداخل ندارد');
    assert.equal(svc.prepare({ userId: other.id, leaveTypeId: allUnits.id, startDate: D.mon, endDate: D.mon }).ok, true, 'کاربر دیگر');
    assert.equal(prep({ startDate: D.mon, endDate: D.wed, excludeRequestId: base.id }).ok, true, 'ویرایش خودِ درخواست');
    repo.setStatus(base.id, 'approved', null);
    assert.equal(prep({ startDate: D.mon, endDate: D.mon }).errors[0].code, 'OVERLAP', 'تأییدشده هم حساب می‌شود');
    repo.setStatus(base.id, 'rejected', null);
    assert.equal(prep({ startDate: D.mon, endDate: D.mon }).ok, true, 'ردشده تداخل نمی‌سازد');

    // صبح و عصرِ همان روز، و ساعتی در دو طرف نیم‌روز
    const morning = save({ unit: 'half_day', halfDayPart: 'morning', startDate: D.wed, endDate: D.wed });
    assert.equal(prep({ unit: 'half_day', halfDayPart: 'afternoon', startDate: D.wed, endDate: D.wed }).ok, true);
    assert.equal(prep({ unit: 'half_day', halfDayPart: 'morning', startDate: D.wed, endDate: D.wed }).errors[0].code, 'OVERLAP');
    assert.equal(prep({ unit: 'hour', startTime: '13:00', endTime: '15:00', startDate: D.wed, endDate: D.wed }).ok, true);
    assert.equal(prep({ unit: 'hour', startTime: '11:00', endTime: '13:00', startDate: D.wed, endDate: D.wed }).errors[0].code, 'OVERLAP');
    assert.equal(prep({ startDate: D.wed, endDate: D.wed }).errors[0].code, 'OVERLAP', 'روز کامل روی نیم‌روز');
    assert.ok(morning.id);
  });

  test('ذخیره‌ی ستون‌ها در repository، backfill مدت درخواست‌های قدیمی و بازنشانی مدت با تغییر تاریخ', () => {
    const saved = save({ unit: 'hour', startTime: '09:00', endTime: '10:30', startDate: D.sat, endDate: D.sat });
    assert.deepEqual([saved.unit, saved.start_time, saved.end_time, saved.half_day_part, saved.duration_minutes], ['hour', '09:00', '10:30', null, 90]);
    // ورودی ناهم‌خوان را CHECK جدول رد می‌کند (repository خودش اعتبارسنجی نمی‌کند)
    assert.throws(() => repo.createLeaveRequest({ userId: user.id, startDate: D.sat, endDate: D.sat, unit: 'hour' }), /CHECK/);

    const legacy = repo.createLeaveRequest({ userId: other.id, leaveTypeId: allUnits.id, startDate: D.mon, endDate: D.tue, reason: 'قدیمی' });
    assert.equal(legacy.unit, 'day');
    assert.equal(legacy.duration_minutes, null);
    assert.deepEqual(svc.backfillMissingDurations({ limit: 1000 }), { updated: 1, skipped: 0 });
    assert.equal(repo.findById(legacy.id).duration_minutes, 1020);
    assert.deepEqual(svc.backfillMissingDurations(), { updated: 0, skipped: 0 }, 'idempotent');

    const edited = repo.updateManual(legacy.id, { end_date: D.wed }, 1);
    assert.equal(edited.duration_minutes, null, 'تغییر تاریخ مدت را کهنه می‌کند');
    assert.equal(repo.updateManual(legacy.id, { reason: 'فقط دلیل' }, 1).reason, 'فقط دلیل');
    assert.throws(() => repo.updateManual(saved.id, { end_date: D.sun }, 1), /یک روز/);
    assert.equal(repo.findById(saved.id).end_date, D.sat, 'تغییر ردشده چیزی ننوشت');
  });
});
