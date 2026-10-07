// S3-5b: سقف ماهانه‌ی اضافه‌کاری قابل‌پرداخت (تابع جدا در dayService؛ computeDay دست‌نخورده).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { computeDay } = require('../src/engine/computeDay');
const dayService = require('../src/engine/dayService');
const registry = require('../src/utils/settingsRegistry');
const settingsRepo = require('../src/repositories/settingsRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const { capMonthlyOvertime, computeMonthOvertime } = dayService;
const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
// پایان کار پیش‌فرض ۱۶:۳۰ ⇒ خروج با «raw» دقیقه اضافه‌کاری
const outAt = (raw) => { const t = 16 * 60 + 30 + raw; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

describe('سقف ماهانه‌ی اضافه‌کاری (S3-5b)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('capMonthlyOvertime: جدول مرز سقف (برابر، یک دقیقه بیشتر، روز عبورکننده، بعد از سقف، بدون سقف)', () => {
    // [ورودی، سقف، خروجی مورد انتظار]
    const table = [
      [[60, 40], 100, [60, 40]], // مجموع دقیقاً برابر سقف ⇒ بدون برش
      [[60, 41], 100, [60, 40]], // یک دقیقه بیشتر ⇒ فقط همان یک دقیقه بریده می‌شود
      [[60, 39], 100, [60, 39]], // یک دقیقه کمتر ⇒ بدون برش
      [[60, 40, 10], 100, [60, 40, 0]], // بعد از رسیدن به سقف ⇒ ۰
      [[150], 100, [100]], // یک روز به‌تنهایی بیش از سقف
      [[30, 90, 20], 100, [30, 70, 0]], // روز وسط عبور می‌کند ⇒ فقط باقی‌مانده
      [[0, 100, 0, 5], 100, [0, 100, 0, 0]], // روزهای صفر دست نمی‌خورند
      [[60, 70], 0, [60, 70]], // سقف ۰ = بدون سقف
      [[60, 70], 1000, [60, 70]], // سقف بالاتر از مجموع
      [[], 100, []],
    ];
    for (const [input, cap, expected] of table) {
      const copy = input.slice();
      assert.deepEqual(capMonthlyOvertime(input, cap), expected, `${JSON.stringify(input)} با سقف ${cap}`);
      assert.deepEqual(input, copy, 'ورودی تغییر نمی‌کند');
    }
    assert.notEqual(capMonthlyOvertime([5], 0), undefined);
    // ورودی نامعتبر
    [-1, NaN, Infinity, '100', null, undefined].forEach((cap) => assert.throws(() => capMonthlyOvertime([10], cap), RangeError, `cap ${String(cap)}`));
    [[-5], [NaN], ['10'], [null]].forEach((arr) => assert.throws(() => capMonthlyOvertime(arr, 100), RangeError));
    assert.throws(() => capMonthlyOvertime('60,40', 100), TypeError);
  });

  test('رجیستری: تنظیم overtimeMonthlyCapMinutes (پیش‌فرض ۰، گروه اضافه‌کاری، اعتبارسنجی)', () => {
    assert.deepEqual(registry.selfCheck(), []);
    assert.equal(registry.defaultOf('overtimeMonthlyCapMinutes'), 0);
    assert.equal(registry.getDef('overtimeMonthlyCapMinutes').group, 'overtime');
    assert.equal(registry.getDef('overtimeMonthlyCapMinutes').dbKey, 'overtime_monthly_cap_minutes');
    assert.deepEqual(registry.validate('overtimeMonthlyCapMinutes', 600), { ok: true, value: 600 });
    [-1, 12001, 1.5, 'abc', ''].forEach((v) => assert.equal(registry.validate('overtimeMonthlyCapMinutes', v).ok, false, JSON.stringify(v)));
  });

  test('computeMonthOvertime با رکوردهای واقعی: ترتیب تاریخ، برش، مجموع‌ها و سقف از تنظیمات یا opts', () => {
    const user = makeUser();
    const insert = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)');
    // خام: ۴۰، ۵۰، ۳۰ دقیقه در سه روز؛ آخرین ردیف را عمداً زودتر درج می‌کنیم تا ترتیب تاریخ (نه درج) تعیین‌کننده باشد
    const mk = (date, raw) => {
      const id = insert.run(user.id, date, at(date, '08:00'), at(date, outAt(raw)), 'normal').lastInsertRowid;
      return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
    };
    const d3 = mk('2026-09-14', 30);
    const d1 = mk('2026-09-12', 40);
    const d2 = mk('2026-09-13', 50);
    const input = [d3, d1, d2]; // نامرتب
    const reset = () => db.exec("DELETE FROM settings WHERE key LIKE 'overtime\\_%' ESCAPE '\\'");
    try {
      // مصرف‌کننده‌ی واقعی تنظیمات: روشن + ضریب ۱٫۵ ⇒ روزانه ۶۰، ۷۵، ۴۵ (مجموع ۱۸۰)
      settingsRepo.update({ overtimeEnabled: true, overtimeFactor: 1.5 });

      // پیش‌فرض DB (سقف ۰) ⇒ بدون برش
      let m = computeMonthOvertime(input);
      assert.equal(m.cap, 0);
      assert.deepEqual(m.days.map((d) => [d.recordDate, d.overtimePayableDaily, d.overtimePayable]), [['2026-09-12', 60, 60], ['2026-09-13', 75, 75], ['2026-09-14', 45, 45]]);
      assert.deepEqual([m.totalOvertime, m.totalPayableDaily, m.totalPayable, m.clippedMinutes], [120, 180, 180, 0]);

      // سقف از تنظیمات DB: ۱۰۰ ⇒ روز اول ۶۰، روز دوم فقط ۴۰ (نه ۷۵)، روز سوم ۰؛ خام همچنان گزارش می‌شود
      settingsRepo.update({ overtimeMonthlyCapMinutes: 100 });
      m = computeMonthOvertime(input);
      assert.equal(m.cap, 100);
      assert.deepEqual(m.days.map((d) => [d.recordId, d.overtime, d.overtimePayableDaily, d.overtimePayable]), [[d1.id, 40, 60, 60], [d2.id, 50, 75, 40], [d3.id, 30, 45, 0]]);
      assert.deepEqual([m.totalPayableDaily, m.totalPayable, m.clippedMinutes], [180, 100, 80]);
      assert.deepEqual(input.map((r) => r.id), [d3.id, d1.id, d2.id], 'ورودی مرتب نمی‌شود');

      // مرز: سقف دقیقاً برابر مجموع ⇒ بدون برش؛ یک دقیقه کمتر ⇒ فقط یک دقیقه برش
      assert.equal(computeMonthOvertime(input, { capMinutes: 180 }).clippedMinutes, 0);
      assert.equal(computeMonthOvertime(input, { capMinutes: 179 }).clippedMinutes, 1);
      // opts.capMinutes بر تنظیم DB غالب است؛ ۰ = بدون سقف
      assert.equal(computeMonthOvertime(input, { capMinutes: 0 }).totalPayable, 180);

      // اضافه‌کاری خاموش ⇒ همه ۰ (سقف بی‌اثر)؛ ماه خالی ⇒ مجموع ۰
      settingsRepo.update({ overtimeEnabled: false });
      assert.equal(computeMonthOvertime(input).totalPayable, 0);
      assert.deepEqual(computeMonthOvertime([]).days, []);
    } finally { reset(); }

    // computeDay خالص و دست‌نخورده است: سقف ماهانه را نمی‌شناسد
    const base = { workDayStart: '08:00', workDayEnd: '16:30', overtimeEnabled: true, overtimeFactor: 1.5, overtimeMonthlyCapMinutes: 1 };
    assert.equal(computeDay({ record: d2, breaks: [], settings: base, timezone: TEHRAN, now: at('2026-09-13', '12:00') }).overtimePayable, 75);
  });

  test('رکوردهای چند کاربر در یک ماه ⇒ RangeError (سقف برای هر کاربر جدا)', () => {
    const a = makeUser();
    const b = makeUser();
    const insert = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)');
    const row = (u, date) => db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(insert.run(u.id, date, at(date, '08:00'), at(date, outAt(10)), 'normal').lastInsertRowid);
    assert.throws(() => computeMonthOvertime([row(a, '2026-08-01'), row(b, '2026-08-02')], { capMinutes: 10 }), RangeError);
  });
});
