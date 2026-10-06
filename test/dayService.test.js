// S3-2c: dayService (خواندن repository + computeDay) و wrapper شدن workHours. تطبیق کامل با منطق قدیمی در S3-2d.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dayService = require('../src/engine/dayService');
const { computeDay } = require('../src/engine/computeDay');
const workHours = require('../src/utils/workHours');
const settingsRepo = require('../src/repositories/settingsRepository');
const breakRepo = require('../src/repositories/breakRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const NOW = at('2026-10-06', '12:00');

describe('dayService (S3-2c)', () => {
  let db;
  let user;
  let seq = 0;
  const addRecord = ({ in: ci, out = null, status = 'normal', brk = [] }) => {
    seq += 1;
    const id = Number(db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, `2026-07-${String(seq).padStart(2, '0')}`, ci, out, status).lastInsertRowid);
    brk.forEach(([s, e]) => db.prepare("INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (?, 'lunch', ?, ?)").run(id, s, e));
    return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  };

  before(() => { db = resetDb(); user = makeUser(); });
  after(cleanup);

  test('computeRecordDay: استراحت‌ها و تنظیمات را از DB می‌خواند و دقیقاً خروجی computeDay خالص را می‌دهد؛ شکل قدیمی با همان ترتیب کلیدها', () => {
    const record = addRecord({ in: at('2026-09-01', '08:45'), out: at('2026-09-01', '17:15'), brk: [[at('2026-09-01', '12:00'), at('2026-09-01', '12:30')]] });
    const day = dayService.computeRecordDay(record, { now: NOW });
    const pure = computeDay({
      record, breaks: breakRepo.listByAttendanceRecord(record.id), settings: settingsRepo.getAll(), now: NOW, timezone: TEHRAN,
    });
    assert.deepEqual(day, pure);
    assert.equal(day.break, 30);
    assert.equal(day.late, 45);
    assert.equal(day.overtime, 45);

    const legacy = dayService.summarizeRecord(record, { now: NOW });
    assert.deepEqual(legacy, { effectiveMinutes: 480, lateMinutes: 45, earlyLeaveMinutes: 0, overtimeMinutes: 45, isOpen: false });
    assert.deepEqual(Object.keys(legacy), ['effectiveMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'overtimeMinutes', 'isOpen'], 'ترتیب کلیدها ⇒ JSON پاسخ‌ها یکسان');
    // بدون رکورد / بدون ورود
    assert.deepEqual(dayService.summarizeRecord(null), { effectiveMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, isOpen: false });
    assert.deepEqual(dayService.summarizeRecord(addRecord({ in: null, status: 'holiday' })), { effectiveMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, isOpen: false });
  });

  test('رکورد باز تا now (استراحت باز حساب نمی‌شود)؛ summarizeRange جمع‌بندی قدیمی؛ تغییر تنظیم ساعت کاری فوراً اثر می‌کند (بدون کش)', () => {
    const open = addRecord({ in: at('2026-10-06', '08:10'), status: 'incomplete', brk: [[at('2026-10-06', '10:00'), at('2026-10-06', '10:15')], [at('2026-10-06', '11:50'), null]] });
    const closed = addRecord({ in: at('2026-09-02', '08:00'), out: at('2026-09-02', '15:00') });
    const s = dayService.summarizeRecord(open, { now: NOW });
    assert.deepEqual(s, { effectiveMinutes: 230 - 15, lateMinutes: 10, earlyLeaveMinutes: 0, overtimeMinutes: 0, isOpen: true });

    const range = dayService.summarizeRange([open, closed], { now: NOW });
    assert.deepEqual(range, { totalEffective: 215 + 420, lateCount: 1, earlyLeaveCount: 1, incompleteCount: 1, dayCount: 2 });

    settingsRepo.update({ workDayStart: '09:00', workDayEnd: '15:00' });
    try {
      assert.equal(dayService.summarizeRecord(open, { now: NOW }).lateMinutes, 0);
      assert.equal(dayService.summarizeRecord(closed, { now: NOW }).earlyLeaveMinutes, 0);
    } finally {
      db.exec("DELETE FROM settings WHERE key IN ('work_day_start', 'work_day_end')");
    }
  });

  test('timezone از تنظیمات می‌آید (نه ساعت سیستم)؛ رکورد با زمان خراب خلاصه‌ی خالی می‌دهد و پرتاب نمی‌کند', () => {
    const record = addRecord({ in: at('2026-09-03', '08:30'), out: at('2026-09-03', '16:30') });
    assert.equal(dayService.summarizeRecord(record).lateMinutes, 30);
    const originalTz = process.env.TZ;
    settingsRepo.update({ timezone: 'UTC' }); // 08:30 تهران = 05:00 UTC ⇒ دیگر دیر نیست
    try {
      process.env.TZ = 'America/Los_Angeles'; // ساعت سیستم هیچ نقشی ندارد
      assert.equal(dayService.summarizeRecord(record).lateMinutes, 0);
      assert.equal(dayService.computeRecordDay(record).late, 0);
    } finally {
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
      db.exec("DELETE FROM settings WHERE key = 'timezone'");
    }
    assert.equal(dayService.summarizeRecord(record).lateMinutes, 30);

    const realError = console.error;
    const logged = [];
    console.error = (...a) => logged.push(a.join(' '));
    try {
      const bad = addRecord({ in: 'not-a-date', out: null, status: 'normal' });
      assert.deepEqual(dayService.summarizeRecord(bad), { effectiveMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, isOpen: false });
      assert.equal(dayService.summarizeRange([bad, record]).dayCount, 2);
    } finally {
      console.error = realError;
    }
    assert.ok(logged.length >= 1, 'داده‌ی خراب باید لاگ شود');
    assert.throws(() => dayService.computeRecordDay(addRecord({ in: 'not-a-date' })), RangeError, 'API کامل همچنان سخت‌گیر است');
  });

  test('workHours wrapper به dayService ارجاع می‌دهد؛ هیچ مصرف‌کننده‌ای در src محاسبه‌ی روز را از workHours نمی‌گیرد (فقط formatMinutes)', () => {
    const record = addRecord({ in: at('2026-09-04', '08:20'), out: at('2026-09-04', '16:00'), brk: [[at('2026-09-04', '12:00'), at('2026-09-04', '12:20')]] });
    assert.deepEqual(workHours.summarizeRecord(record), dayService.summarizeRecord(record));
    assert.deepEqual(workHours.summarizeRange([record]), dayService.summarizeRange([record]));
    assert.equal(workHours.minutesSinceMidnight(new Date(at('2026-09-04', '08:20'))), 8 * 60 + 20, 'ساعت دیواری شرکت');
    assert.equal(workHours.formatMinutes(95), '1 ساعت و 35 دقیقه');
    assert.equal(workHours.timeStringToMinutes('08:30'), 510);

    const srcDir = path.join(__dirname, '..', 'src');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const offenders = [];
    for (const file of walk(srcDir).filter((f) => f.endsWith('.js') && !f.endsWith(path.join('utils', 'workHours.js')))) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
        if (/require\(['"][^'"]*utils\/workHours['"]\)/.test(line) && !/^\s*const \{ formatMinutes \} = require/.test(line)) offenders.push(`${path.relative(srcDir, file)}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});
