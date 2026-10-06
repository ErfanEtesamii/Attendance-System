// S3-3a: مهلت تأخیر (late_grace_minutes) و مبنای محاسبه (late_counts_from). رفتار پیش‌فرض (مهلت ۰) باید دقیقاً مثل قبل بماند.
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
const lateOf = (checkIn, extra = {}) => computeDay({
  record: { check_in_time: checkIn, check_out_time: at('16:30'), status: 'normal' }, breaks: [], settings: { ...base, ...extra }, timezone: TEHRAN,
}).late;

describe('مهلت تأخیر (S3-3a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('جدول: به‌موقع، داخل مهلت، دقیقاً مرز، بعد از مرز — هر دو حالت؛ مهلت ۰ = رفتار قبلی', () => {
    // [ساعت ورود, shift_start, after_grace] با مهلت ۱۰ دقیقه
    const rows = [
      ['07:50', 0, 0], ['08:00', 0, 0], ['08:05', 0, 0],
      ['08:10', 0, 0], // دقیقاً مرز مهلت ⇒ هنوز تأخیر نیست
      ['08:10:59', 0, 0], // دقت دقیقه (ثانیه‌ها نادیده؛ مثل قبل)
      ['08:11', 11, 1], ['08:30', 30, 20], ['11:00', 180, 170],
    ];
    for (const [hhmm, fromStart, afterGrace] of rows) {
      const ci = hhmm.length > 5 ? new Date(Date.parse(at(hhmm.slice(0, 5))) + Number(hhmm.slice(6)) * 1000).toISOString() : at(hhmm);
      assert.equal(lateOf(ci, { lateGraceMinutes: 10, lateCountsFrom: 'shift_start' }), fromStart, `shift_start ${hhmm}`);
      assert.equal(lateOf(ci, { lateGraceMinutes: 10, lateCountsFrom: 'after_grace' }), afterGrace, `after_grace ${hhmm}`);
    }
    // مهلت ۰ (پیش‌فرض): هر دو حالت و حالت بدون کلید، همه مثل منطق قبلی (ورود − شروع اگر بعد از شروع)
    for (const extra of [{}, { lateGraceMinutes: 0 }, { lateGraceMinutes: 0, lateCountsFrom: 'shift_start' }, { lateGraceMinutes: 0, lateCountsFrom: 'after_grace' }]) {
      assert.deepEqual(['07:59', '08:00', '08:01', '08:30'].map((h) => lateOf(at(h), extra)), [0, 0, 1, 30], JSON.stringify(extra));
    }
    // مهلت فقط late را عوض می‌کند، نه بقیه‌ی خروجی‌ها
    const rec = { check_in_time: at('08:20'), check_out_time: at('17:00'), status: 'normal' };
    const a = computeDay({ record: rec, breaks: [], settings: base, timezone: TEHRAN });
    const b = computeDay({ record: rec, breaks: [], settings: { ...base, lateGraceMinutes: 30 }, timezone: TEHRAN });
    assert.equal(a.late, 20);
    assert.equal(b.late, 0);
    assert.deepEqual({ ...b, late: 20 }, a);
  });

  test('ورودی نامعتبر ⇒ RangeError؛ نبودن کلیدها ⇒ پیش‌فرض', () => {
    const run = (extra) => lateOf(at('08:30'), extra);
    assert.equal(run({}), run({ lateGraceMinutes: 0, lateCountsFrom: 'shift_start' }));
    [-1, NaN, Infinity, '10', null, true].forEach((v) => assert.throws(() => run({ lateGraceMinutes: v }), RangeError, `grace ${v}`));
    ['start', '', null, 5].forEach((v) => assert.throws(() => run({ lateCountsFrom: v }), RangeError, `from ${v}`));
  });

  test('رجیستری + DB: اعتبارسنجی و پیش‌فرض‌ها، اثر روی dayService/summarizeRange، و جدا بودن از مهلت یادآور ورود', () => {
    assert.deepEqual(registry.selfCheck(), []);
    assert.equal(registry.defaultOf('lateGraceMinutes'), 0);
    assert.equal(registry.defaultOf('lateCountsFrom'), 'shift_start');
    assert.deepEqual(registry.validate('lateGraceMinutes', '10'), { ok: true, value: 10 });
    [-1, 241, 1.5, 'abc'].forEach((v) => assert.equal(registry.validate('lateGraceMinutes', v).ok, false, `grace ${v}`));
    assert.deepEqual(registry.validate('lateCountsFrom', 'after_grace'), { ok: true, value: 'after_grace' });
    ['start', '', 'SHIFT_START', null].forEach((v) => assert.equal(registry.validate('lateCountsFrom', v).ok, false, `from ${v}`));
    assert.equal(registry.getDef('lateGraceMinutes').group, 'workHours');

    const user = makeUser();
    const ins = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)');
    const recs = ['08:05', '08:10', '08:25', '09:00'].map((h, i) => {
      const date = `2026-09-0${i + 1}`;
      return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(ins.run(user.id, date, at(h, date), at('16:30', date), 'normal').lastInsertRowid);
    });
    const lates = () => recs.map((r) => dayService.summarizeRecord(r).lateMinutes);
    const reset = () => db.exec("DELETE FROM settings WHERE key IN ('late_grace_minutes', 'late_counts_from', 'late_checkin_grace_minutes')");

    assert.deepEqual(lates(), [5, 10, 25, 60], 'پیش‌فرض DB: بدون مهلت');
    try {
      settingsRepo.update({ lateGraceMinutes: 10 });
      assert.deepEqual(lates(), [0, 0, 25, 60], 'shift_start با مهلت ۱۰');
      assert.deepEqual(dayService.summarizeRange(recs).lateCount, 2);
      settingsRepo.update({ lateCountsFrom: 'after_grace' });
      assert.deepEqual(lates(), [0, 0, 15, 50], 'after_grace با مهلت ۱۰');
      reset();
      settingsRepo.update({ lateCheckinGraceMinutes: 30 }); // مهلت «یادآور ورود» نباید روی محاسبه اثر بگذارد
      assert.deepEqual(lates(), [5, 10, 25, 60]);
    } finally { reset(); }
    assert.deepEqual(lates(), [5, 10, 25, 60]);
  });
});
