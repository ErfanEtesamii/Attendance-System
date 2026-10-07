// S3-3b: مهلت زودتر رفتن (early_grace_minutes). رفتار پیش‌فرض (مهلت ۰) باید دقیقاً مثل قبل بماند.
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
const at = (hhmm, date = '2026-09-10') => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const base = { workDayStart: '08:00', workDayEnd: '16:30' };
const dayOf = (checkOut, extra = {}) => computeDay({
  record: { check_in_time: at('08:00'), check_out_time: checkOut, status: 'normal' }, breaks: [], settings: { ...base, ...extra }, timezone: TEHRAN,
});

describe('مهلت زودتر رفتن (S3-3b)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('جدول: بعد از پایان، روی پایان، داخل مهلت، دقیقاً مرز، زودتر از مرز؛ مهلت ۰ = رفتار قبلی', () => {
    // [ساعت خروج, earlyLeave, overtime] با مهلت ۱۰ دقیقه (پایان ۱۶:۳۰ ⇒ مرز ۱۶:۲۰)
    const rows = [
      ['17:00', 0, 30], ['16:30', 0, 0], ['16:29', 0, 0], ['16:25', 0, 0],
      ['16:20', 0, 0], // دقیقاً مرز مهلت ⇒ هنوز زودتر رفتن نیست
      ['16:19', 11, 0], // بعد از مرز ⇒ کل دقیقه‌های مانده تا پایان (نه فقط مازاد بر مهلت)
      ['16:00', 30, 0], ['12:00', 270, 0],
    ];
    for (const [hhmm, early, overtime] of rows) {
      const d = dayOf(at(hhmm), { earlyGraceMinutes: 10 });
      assert.deepEqual([d.earlyLeave, d.overtime], [early, overtime], `خروج ${hhmm}`);
    }
    // مهلت ۰ (پیش‌فرض) و نبودن کلید: مثل منطق قبلی
    for (const extra of [{}, { earlyGraceMinutes: 0 }]) {
      assert.deepEqual(['16:29', '16:30', '16:31', '15:00'].map((h) => { const d = dayOf(at(h), extra); return [d.earlyLeave, d.overtime]; }),
        [[1, 0], [0, 0], [0, 1], [90, 0]], JSON.stringify(extra));
    }
    // مهلت فقط earlyLeave را عوض می‌کند؛ بقیه‌ی خروجی‌ها (از جمله late و رکورد باز) دست‌نخورده
    const a = dayOf(at('16:25'));
    const b = dayOf(at('16:25'), { earlyGraceMinutes: 30 });
    assert.equal(a.earlyLeave, 5);
    assert.equal(b.earlyLeave, 0);
    assert.deepEqual({ ...b, earlyLeave: 5 }, a);
    const open = computeDay({ record: { check_in_time: at('08:00'), check_out_time: null, status: 'incomplete' }, breaks: [], settings: { ...base, earlyGraceMinutes: 30 }, now: at('12:00'), timezone: TEHRAN });
    assert.deepEqual([open.earlyLeave, open.overtime, open.isOpen], [0, 0, true]);
    // مهلت دیرکرد و زودتر رفتن مستقل‌اند
    assert.equal(computeDay({ record: { check_in_time: at('08:20'), check_out_time: at('16:20') }, breaks: [], settings: { ...base, lateGraceMinutes: 30 }, timezone: TEHRAN }).earlyLeave, 10);
  });

  test('ورودی نامعتبر ⇒ RangeError؛ نبودن کلید ⇒ پیش‌فرض ۰', () => {
    const run = (extra) => dayOf(at('16:00'), extra).earlyLeave;
    assert.equal(run({}), 30);
    assert.equal(run({}), run({ earlyGraceMinutes: 0 }));
    [-1, NaN, Infinity, '10', null, true].forEach((v) => assert.throws(() => run({ earlyGraceMinutes: v }), RangeError, `grace ${v}`));
    assert.throws(() => run({ lateGraceMinutes: -1 }), /lateGraceMinutes/, 'اعتبارسنجی مهلت تأخیر (S3-3a) دست‌نخورده');
  });

  test('رجیستری + DB: اعتبارسنجی و پیش‌فرض، اثر روی dayService/summarizeRange، و جدا بودن از یادآور خروج و مهلت تأخیر', () => {
    assert.deepEqual(registry.selfCheck(), []);
    assert.equal(registry.defaultOf('earlyGraceMinutes'), 0);
    assert.deepEqual(registry.validate('earlyGraceMinutes', '10'), { ok: true, value: 10 });
    [-1, 241, 1.5, 'abc', ''].forEach((v) => assert.equal(registry.validate('earlyGraceMinutes', v).ok, false, `grace ${JSON.stringify(v)}`));
    assert.equal(registry.getDef('earlyGraceMinutes').dbKey, 'early_grace_minutes');
    assert.equal(registry.getDef('earlyGraceMinutes').group, 'workHours');

    const user = makeUser();
    const ins = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)');
    const recs = ['16:25', '16:20', '16:10', '15:00'].map((h, i) => {
      const date = `2026-09-1${i + 2}`; // شنبه تا سه‌شنبه (تقویم پیش‌فرض: پنجشنبه/جمعه متفاوت است، S3-7c)
      return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(ins.run(user.id, date, at('08:00', date), at(h, date), 'normal').lastInsertRowid);
    });
    const earlies = () => recs.map((r) => dayService.summarizeRecord(r).earlyLeaveMinutes);
    const reset = () => db.exec("DELETE FROM settings WHERE key IN ('early_grace_minutes', 'late_grace_minutes', 'checkout_reminder_minutes_before')");

    assert.deepEqual(earlies(), [5, 10, 20, 90], 'پیش‌فرض DB: بدون مهلت');
    assert.equal(dayService.summarizeRange(recs).earlyLeaveCount, 4);
    try {
      settingsRepo.update({ earlyGraceMinutes: 10 });
      assert.deepEqual(earlies(), [0, 0, 20, 90]);
      assert.equal(dayService.summarizeRange(recs).earlyLeaveCount, 2);
      reset();
      settingsRepo.update({ checkoutReminderMinutesBefore: 60, lateGraceMinutes: 60 }); // یادآور خروج و مهلت تأخیر اثری ندارند
      assert.deepEqual(earlies(), [5, 10, 20, 90]);
    } finally { reset(); }
    assert.deepEqual(earlies(), [5, 10, 20, 90]);
  });
});
