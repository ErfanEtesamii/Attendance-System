// S3-5a: اضافه‌کاری روزانه (overtime خام + overtimePayable). پیش‌فرض خاموش؛ ضریب‌ها ۱.
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
const DATE = '2026-09-14'; // دوشنبه: روز کاریِ کامل در تقویم پیش‌فرض (S3-7c)
const at = (hhmm, date = DATE) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const base = { workDayStart: '08:00', workDayEnd: '16:30' };
// پایان کار ۱۶:۳۰ ⇒ خروج با «raw» دقیقه اضافه‌کاری
const outAt = (raw) => { const t = 16 * 60 + 30 + raw; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const rec = (raw, status = 'normal') => ({ check_in_time: at('08:00'), check_out_time: at(outAt(raw)), status });
const run = (record, extra = {}) => computeDay({ record, breaks: [], settings: { ...base, ...extra }, timezone: TEHRAN, now: at('12:00') });
const ON = { overtimeEnabled: true };
const payable = (raw, extra, status) => run(rec(raw, status), { ...ON, ...extra }).overtimePayable;

describe('اضافه‌کاری روزانه (S3-5a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('جدول: خاموش، آستانه، سقف، گرد‌کردن (سه حالت)، ضریب و ترکیب', () => {
    // خاموش (پیش‌فرض): خام همچنان گزارش می‌شود، قابل‌پرداخت ۰
    assert.deepEqual([run(rec(45)).overtime, run(rec(45)).overtimePayable], [45, 0]);
    assert.equal(run(rec(45), { overtimeEnabled: false, overtimeFactor: 2 }).overtimePayable, 0);
    // روشن بدون تنظیم دیگر: همه‌ی خام، ضریب ۱
    assert.equal(payable(0), 0);
    assert.equal(payable(45), 45);
    // آستانه: کمتر ⇒ ۰، روی آستانه و بالاتر ⇒ کامل (نه فقط مازاد)
    assert.deepEqual([29, 30, 31, 45].map((r) => payable(r, { overtimeMinMinutes: 30 })), [0, 30, 31, 45]);
    // سقف روزانه (۰ = بدون سقف)
    assert.deepEqual([59, 60, 90].map((r) => payable(r, { overtimeDailyCapMinutes: 60 })), [59, 60, 60]);
    assert.equal(payable(400, { overtimeDailyCapMinutes: 0 }), 400);
    // گرد‌کردن: [raw، down، nearest، up] با گام ۱۵
    for (const [raw, down, nearest, up] of [[40, 30, 45, 45], [37, 30, 30, 45], [38, 30, 45, 45], [30, 30, 30, 30], [14, 0, 15, 15], [7, 0, 0, 15], [8, 0, 15, 15]]) {
      const r = (mode) => payable(raw, { overtimeRoundStep: 15, overtimeRounding: mode });
      assert.deepEqual([r('down'), r('nearest'), r('up')], [down, nearest, up], `raw ${raw}`);
    }
    // نیم‌گام دقیقاً به بالا (گام ۱۰، raw ۳۵)
    assert.deepEqual(['down', 'nearest', 'up'].map((m) => payable(35, { overtimeRoundStep: 10, overtimeRounding: m })), [30, 40, 40]);
    // گام ۱ = بدون گرد‌کردن در هر حالت
    assert.deepEqual(['down', 'nearest', 'up'].map((m) => payable(37, { overtimeRounding: m })), [37, 37, 37]);
    // ضریب عادی؛ ضریب تعطیل فقط برای status = holiday؛ گرد به عدد صحیح؛ ضریب ۰
    assert.equal(payable(40, { overtimeFactor: 1.5 }), 60);
    assert.equal(payable(40, { overtimeFactor: 1.5, overtimeHolidayFactor: 2 }, 'holiday'), 80);
    assert.equal(payable(40, { overtimeFactor: 1.5, overtimeHolidayFactor: 2 }, 'normal'), 60);
    assert.equal(payable(40, { overtimeFactor: 1.5, overtimeHolidayFactor: 2 }, 'late'), 60);
    assert.equal(payable(10, { overtimeFactor: 1.25 }), 13);
    assert.equal(payable(40, { overtimeFactor: 0 }), 0);
    // ترتیب مراحل: آستانه → سقف → گرد‌کردن → ضریب
    assert.equal(payable(19, { overtimeMinMinutes: 20, overtimeRoundStep: 30, overtimeRounding: 'up' }), 0, 'زیر آستانه حتی با گرد به بالا ۰');
    assert.equal(payable(90, { overtimeDailyCapMinutes: 50, overtimeRoundStep: 15, overtimeRounding: 'down' }), 45, 'سقف پیش از گرد‌کردن');
    assert.equal(payable(80, { overtimeMinMinutes: 20, overtimeDailyCapMinutes: 100, overtimeRoundStep: 30, overtimeRounding: 'nearest', overtimeFactor: 1.5 }), 135);
  });

  test('اعداد دیگر عوض نمی‌شود؛ رکورد باز، خروج پیش از ورود و داده‌ی خراب ⇒ ۰؛ ورودی نامعتبر ⇒ RangeError', () => {
    const cfg = { ...ON, overtimeMinMinutes: 10, overtimeDailyCapMinutes: 30, overtimeFactor: 3, overtimeRoundStep: 15, overtimeRounding: 'up' };
    const a = run(rec(50));
    const b = run(rec(50), cfg);
    assert.equal(b.overtime, 50, 'خام دست‌نخورده');
    assert.deepEqual({ ...b, overtimePayable: 0 }, a);
    // رکورد باز (بدون خروج) ⇒ ۰
    assert.equal(run({ check_in_time: at('08:00'), check_out_time: null, status: 'normal' }, cfg).overtimePayable, 0);
    // بدون رکورد / بدون ورود ⇒ ۰
    assert.equal(run(null, cfg).overtimePayable, 0);
    assert.equal(run({ status: 'holiday', check_in_time: null }, cfg).overtimePayable, 0);
    // خروج پیش از ورود: خام مثل قبل از ساعت دیواری (۳۰) ولی قابل‌پرداخت ۰
    const reversed = run({ check_in_time: at('18:00'), check_out_time: at('17:00'), status: 'normal' }, ON);
    assert.deepEqual([reversed.overtime, reversed.overtimePayable, reversed.flags.includes('checkout_before_checkin')], [30, 0, true]);
    // زمان خراب ⇒ ۰ بدون exception
    assert.equal(run({ check_in_time: 'x', check_out_time: at('17:30'), status: 'normal' }, ON).overtimePayable, 0);
    // ورودی نامعتبر
    const bad = {
      overtimeEnabled: ['true', 1, null], overtimeMinMinutes: [-1, NaN, '5', null], overtimeDailyCapMinutes: [-1, Infinity, '5'],
      overtimeFactor: [-0.1, NaN, '1.5', null], overtimeHolidayFactor: [-1, Infinity, true], overtimeRoundStep: [0, -5, NaN, '15', null], overtimeRounding: ['floor', '', null, 5],
    };
    for (const [key, values] of Object.entries(bad)) values.forEach((v) => assert.throws(() => run(rec(40), { [key]: v }), RangeError, `${key} ${JSON.stringify(v)}`));
    // نبودن کلیدها ⇒ پیش‌فرض
    assert.deepEqual(run(rec(40)), run(rec(40), { overtimeEnabled: false, overtimeMinMinutes: 0, overtimeDailyCapMinutes: 0, overtimeFactor: 1, overtimeHolidayFactor: 1, overtimeRoundStep: 1, overtimeRounding: 'down' }));
  });

  test('رجیستری + DB + dayService: اعتبارسنجی، اعشار، پیش‌فرض‌ها و اثر فوری؛ خلاصه‌ی قدیمی بدون تغییر', () => {
    assert.deepEqual(registry.selfCheck(), []);
    const defaults = { overtimeEnabled: false, overtimeMinMinutes: 0, overtimeDailyCapMinutes: 0, overtimeFactor: 1, overtimeHolidayFactor: 1, overtimeRoundStep: 1, overtimeRounding: 'down' };
    for (const [key, value] of Object.entries(defaults)) {
      assert.equal(registry.defaultOf(key), value, key);
      assert.equal(registry.getDef(key).group, 'overtime', key);
    }
    assert.equal(registry.getDef('overtimeRoundStep').dbKey, 'overtime_round_step');
    assert.deepEqual(registry.validate('overtimeFactor', '1.5'), { ok: true, value: 1.5 });
    assert.deepEqual(registry.validate('overtimeHolidayFactor', 2), { ok: true, value: 2 });
    [-1, 11, 'abc', ''].forEach((v) => assert.equal(registry.validate('overtimeFactor', v).ok, false, `factor ${JSON.stringify(v)}`));
    [0, 61, 1.5, 'abc'].forEach((v) => assert.equal(registry.validate('overtimeRoundStep', v).ok, false, `step ${JSON.stringify(v)}`));
    [-1, 481, 1.5].forEach((v) => assert.equal(registry.validate('overtimeMinMinutes', v).ok, false, `min ${JSON.stringify(v)}`));
    assert.equal(registry.validate('overtimeRounding', 'floor').ok, false);
    assert.equal(registry.validate('overtimeEnabled', 'maybe').ok, false);

    const user = makeUser();
    const id = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, DATE, at('08:00'), at(outAt(40)), 'normal').lastInsertRowid;
    const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
    const reset = () => db.exec("DELETE FROM settings WHERE key LIKE 'overtime\\_%' ESCAPE '\\'");
    try {
      assert.deepEqual(settingsRepo.getAll().overtimeFactor, 1);
      assert.equal(dayService.computeRecordDay(record).overtimePayable, 0, 'پیش‌فرض DB: خاموش');
      settingsRepo.update({ overtimeEnabled: true, overtimeFactor: 1.5, overtimeRoundStep: 15, overtimeRounding: 'nearest' });
      const all = settingsRepo.getAll();
      assert.deepEqual([all.overtimeEnabled, all.overtimeFactor, all.overtimeRoundStep, all.overtimeRounding], [true, 1.5, 15, 'nearest']);
      const day = dayService.computeRecordDay(record);
      assert.deepEqual([day.overtime, day.overtimePayable], [40, 68], '۴۰ ⇒ نزدیک‌ترین ۴۵ × ۱٫۵ = ۶۷٫۵ ⇒ ۶۸');
      const summary = dayService.summarizeRecord(record);
      assert.deepEqual(Object.keys(summary), ['effectiveMinutes', 'lateMinutes', 'earlyLeaveMinutes', 'overtimeMinutes', 'isOpen']);
      assert.equal(summary.overtimeMinutes, 40, 'خلاصه‌ی قدیمی همان خام است');
    } finally { reset(); }
    assert.equal(dayService.computeRecordDay(record).overtimePayable, 0);
  });
});
