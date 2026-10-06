// S3-4a: محاسبه‌ی استراحت‌ها در computeDay (چند استراحت، سقف ناهار، کسر ثابت ناهار). پیش‌فرض‌ها (۰) = رفتار قبلی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { computeDay } = require('../src/engine/computeDay');
const dayService = require('../src/engine/dayService');
const registry = require('../src/utils/settingsRegistry');
const settingsRepo = require('../src/repositories/settingsRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const DATE = '2026-09-10';
const at = (hhmm, date = DATE) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const base = { workDayStart: '08:00', workDayEnd: '16:30' };
const br = (from, to, type) => ({ ...(type ? { break_type: type } : {}), start_time: at(from), end_time: to ? at(to) : null });
const closed = { check_in_time: at('08:00'), check_out_time: at('16:30'), status: 'normal' }; // ۵۱۰ دقیقه
const open = { check_in_time: at('08:00'), check_out_time: null, status: 'incomplete' };
const run = (breaks, extra = {}, record = closed) => computeDay({ record, breaks, settings: { ...base, ...extra }, timezone: TEHRAN, now: at('12:00') });
const pick = (d) => [d.break, d.breakAuto, d.breakExcess, d.effective];

describe('استراحت‌ها (S3-4a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('جدول: چند استراحت، سقف ناهار و کسر ثابت — [break, breakAuto, breakExcess, effective]', () => {
    const lunch45 = [br('12:00', '12:45', 'lunch')];
    const rows = [
      // [شرح، استراحت‌ها، تنظیمات، انتظار]
      ['بدون استراحت و بدون تنظیم = رفتار قبلی', [], {}, [0, 0, 0, 510]],
      ['چند استراحت: جمع همه (ناهار + کوتاه‌ها)', [br('10:00', '10:10', 'short_break'), br('12:00', '12:40', 'lunch'), br('15:00', '15:05', 'short_break')], {}, [55, 0, 0, 455]],
      ['ردیف بدون break_type = ناهار', [br('12:00', '12:30')], { maxLunchMinutes: 20 }, [30, 0, 10, 480]],
      ['سقف ۶۰ و ناهار ۴۵ ⇒ مازاد ۰', lunch45, { maxLunchMinutes: 60 }, [45, 0, 0, 465]],
      ['دقیقاً روی سقف ⇒ مازاد ۰', lunch45, { maxLunchMinutes: 45 }, [45, 0, 0, 465]],
      ['یک دقیقه بالای سقف ⇒ مازاد ۱ (هنوز کامل کسر می‌شود)', lunch45, { maxLunchMinutes: 44 }, [45, 0, 1, 465]],
      ['سقف ۰ = بدون سقف', lunch45, { maxLunchMinutes: 0 }, [45, 0, 0, 465]],
      ['سقف فقط روی ناهار؛ استراحت کوتاه شمرده نمی‌شود', [br('10:00', '10:50', 'short_break'), br('12:00', '12:30', 'lunch')], { maxLunchMinutes: 30 }, [80, 0, 0, 430]],
      ['چند ناهار: جمعشان با سقف سنجیده می‌شود', [br('12:00', '12:30', 'lunch'), br('14:00', '14:30', 'lunch')], { maxLunchMinutes: 45 }, [60, 0, 15, 450]],
      ['ناهار باز در سقف حساب نمی‌شود', [br('12:00', null, 'lunch')], { maxLunchMinutes: 5 }, [0, 0, 0, 510]],
      ['کسر ثابت: روز بسته بدون ناهار', [], { fixedLunchDeductMinutes: 60 }, [60, 60, 0, 450]],
      ['کسر ثابت: ناهار ثبت‌شده ⇒ کسر ثابت نه', lunch45, { fixedLunchDeductMinutes: 60 }, [45, 0, 0, 465]],
      ['کسر ثابت: فقط استراحت کوتاه ثبت‌شده ⇒ کسر ثابت هست', [br('10:00', '10:10', 'short_break')], { fixedLunchDeductMinutes: 60 }, [70, 60, 0, 440]],
      ['کسر ثابت: ناهار باز هم «ثبت‌شده» است', [br('12:00', null, 'lunch')], { fixedLunchDeductMinutes: 60 }, [0, 0, 0, 510]],
      ['کسر ثابت خاموش (۰) = رفتار قبلی', [], { fixedLunchDeductMinutes: 0 }, [0, 0, 0, 510]],
      ['کسر ثابت + سقف با هم (ناهاری ثبت نشده ⇒ مازادی نیست)', [], { fixedLunchDeductMinutes: 30, maxLunchMinutes: 20 }, [30, 30, 0, 480]],
    ];
    for (const [name, breaks, extra, expected] of rows) assert.deepEqual(pick(run(breaks, extra)), expected, name);
  });

  test('کسر ثابت: رکورد باز، روز کوتاه‌تر از کسر، بدون ورود و ورودی نامعتبر', () => {
    // رکورد باز (هنوز خروج نزده) ⇒ کسر ثابت اعمال نمی‌شود
    assert.deepEqual(pick(run([], { fixedLunchDeductMinutes: 60 }, open)), [0, 0, 0, 240]);
    // روز ۳۰ دقیقه‌ای با کسر ۶۰ ⇒ حداکثر به اندازه‌ی مدت کار کسر می‌شود (ساعت مفید ۰، نه منفی)
    const short = { check_in_time: at('08:00'), check_out_time: at('08:30'), status: 'normal' };
    assert.deepEqual(pick(run([], { fixedLunchDeductMinutes: 60 }, short)), [30, 30, 0, 0]);
    // بدون ورود: هیچ کسری نیست؛ مجموع استراحت‌ها مثل قبل
    assert.deepEqual(pick(run([], { fixedLunchDeductMinutes: 60 }, { status: 'holiday', check_in_time: null })), [0, 0, 0, null]);
    assert.deepEqual(pick(run([], { fixedLunchDeductMinutes: 60 }, null)), [0, 0, 0, null]);
    // ورودی نامعتبر ⇒ RangeError؛ نبودن کلیدها ⇒ پیش‌فرض (خاموش)
    for (const key of ['maxLunchMinutes', 'fixedLunchDeductMinutes']) {
      [-1, NaN, Infinity, '30', null, true].forEach((v) => assert.throws(() => run([], { [key]: v }), RangeError, `${key} ${v}`));
    }
    assert.deepEqual(run([], {}), run([], { maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 }));
    // ورودی‌ها تغییر نمی‌کنند
    const breaks = [br('12:00', '12:30', 'lunch')];
    const snapshot = JSON.stringify(breaks);
    run(breaks, { maxLunchMinutes: 10, fixedLunchDeductMinutes: 60 });
    assert.equal(JSON.stringify(breaks), snapshot);
  });

  test('رجیستری + DB: اعتبارسنجی، پیش‌فرض‌ها و اثر روی dayService (شکل خلاصه‌ی قدیمی بدون تغییر)', () => {
    assert.deepEqual(registry.selfCheck(), []);
    for (const key of ['maxLunchMinutes', 'fixedLunchDeductMinutes']) {
      assert.equal(registry.defaultOf(key), 0);
      assert.equal(registry.getDef(key).group, 'workHours');
      assert.deepEqual(registry.validate(key, '45'), { ok: true, value: 45 });
      [-1, 481, 1.5, 'abc', ''].forEach((v) => assert.equal(registry.validate(key, v).ok, false, `${key} ${JSON.stringify(v)}`));
    }
    assert.equal(registry.getDef('maxLunchMinutes').dbKey, 'max_lunch_minutes');
    assert.equal(registry.getDef('fixedLunchDeductMinutes').dbKey, 'fixed_lunch_deduct_minutes');

    const user = makeUser();
    const id = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, DATE, closed.check_in_time, closed.check_out_time, 'normal').lastInsertRowid;
    const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
    const reset = () => db.exec("DELETE FROM settings WHERE key IN ('max_lunch_minutes', 'fixed_lunch_deduct_minutes')");
    try {
      assert.equal(dayService.summarizeRecord(record).effectiveMinutes, 510, 'پیش‌فرض DB: بدون کسر');
      settingsRepo.update({ fixedLunchDeductMinutes: 60 });
      assert.equal(dayService.summarizeRecord(record).effectiveMinutes, 450);
      assert.deepEqual(Object.keys(dayService.summarizeRecord(record)), ['effectiveMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'overtimeMinutes', 'isOpen']);
      assert.deepEqual(pick(dayService.computeRecordDay(record)), [60, 60, 0, 450]);
      db.prepare('INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (?, ?, ?, ?)').run(id, 'lunch', at('12:00'), at('12:45'));
      settingsRepo.update({ maxLunchMinutes: 30 });
      assert.deepEqual(pick(dayService.computeRecordDay(record)), [45, 0, 15, 465], 'ناهار ثبت شد ⇒ کسر ثابت کنار می‌رود و مازاد گزارش می‌شود');
    } finally { reset(); db.prepare('DELETE FROM break_records WHERE attendance_record_id = ?').run(id); }
    assert.equal(dayService.summarizeRecord(record).effectiveMinutes, 510);
  });
});
