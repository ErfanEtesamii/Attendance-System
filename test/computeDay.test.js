// S3-2b: موتور خالص computeDay (خروجی‌ها، timezone، اعتبارسنجی ورودی، خالص‌بودن، و تطبیق با workHours.summarizeRecord قدیمی)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const { computeDay } = require('../src/engine/computeDay');
const { zonedTimeToUtc } = require('../src/utils/time');

const TEHRAN = 'Asia/Tehran';
const SETTINGS = { workDayStart: '08:00', workDayEnd: '16:30' };
// ساعت دیواری تهران → ISO UTC
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();

describe('computeDay (S3-2b)', () => {
  after(cleanup);

  test('خروجی‌ها: روز عادی با استراحت، تأخیر، زودتر رفتن، اضافه‌کاری، مرز دقیق، رکورد باز، بدون ورود، timezone', () => {
    const run = (record, breaks = [], extra = {}) => computeDay({ record, breaks, settings: SETTINGS, timezone: TEHRAN, now: at('2026-10-06', '12:00'), ...extra });
    const lunch = [{ start_time: at('2026-10-06', '12:00'), end_time: at('2026-10-06', '12:30') }];

    // روز کامل ۰۸:۰۰–۱۶:۳۰ با ۳۰ دقیقه ناهار
    assert.deepEqual(run({ check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '16:30'), status: 'normal' }, lunch), {
      expected: 510, workedGross: 510, break: 30, breakAuto: 0, breakExcess: 0, effective: 480, late: 0, earlyLeave: 0, overtime: 0, overtimePayable: 0, isOpen: false, flags: [], status: 'normal',
    });
    // تأخیر ۴۵ دقیقه و اضافه‌کاری ۴۵ دقیقه (بدون مهلت؛ مثل منطق قبلی)
    const lateOt = run({ check_in_time: at('2026-10-06', '08:45'), check_out_time: at('2026-10-06', '17:15'), status: 'late' });
    assert.equal(lateOt.late, 45); assert.equal(lateOt.overtime, 45); assert.equal(lateOt.earlyLeave, 0); assert.equal(lateOt.status, 'late');
    // یک دقیقه تأخیر حساب می‌شود، روی ساعت شروع نه
    assert.equal(run({ check_in_time: at('2026-10-06', '08:01'), check_out_time: at('2026-10-06', '16:30') }).late, 1);
    assert.equal(run({ check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '16:30') }).late, 0);
    // زودتر رفتن
    const early = run({ check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '15:00') });
    assert.equal(early.earlyLeave, 90); assert.equal(early.overtime, 0);
    // رکورد باز تا now؛ استراحت باز حساب نمی‌شود
    const open = run({ check_in_time: at('2026-10-06', '08:10'), check_out_time: null, status: 'incomplete' },
      [...lunch.map((b) => ({ ...b, start_time: at('2026-10-06', '10:00'), end_time: at('2026-10-06', '10:15') })), { start_time: at('2026-10-06', '11:50'), end_time: null }]);
    assert.deepEqual([open.isOpen, open.workedGross, open.break, open.effective, open.late, open.earlyLeave, open.overtime], [true, 230, 15, 215, 10, 0, 0]);
    // بدون ورود / بدون رکورد
    assert.deepEqual(run({ status: 'holiday', check_in_time: null }), { expected: 510, workedGross: null, break: 0, breakAuto: 0, breakExcess: 0, effective: null, late: 0, earlyLeave: 0, overtime: 0, overtimePayable: 0, isOpen: false, flags: [], status: 'holiday' });
    assert.equal(run(null).status, null);
    assert.equal(run(null).effective, null);
    // خروج پیش از ورود ⇒ ساعت مفید ۰ (نه منفی)
    const neg = run({ check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '07:00') });
    assert.equal(neg.workedGross, 0); assert.equal(neg.effective, 0);
    // استراحت بیش از حضور ⇒ effective صفر
    assert.equal(run({ check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '08:10') }, lunch).effective, 0);
    // گرد کردن استراحت‌ها: جمع ms سپس گرد (۲۰ث + ۲۵ث + ۲۰ث = ۶۵ث ⇒ ۱ دقیقه)
    const t0 = Date.parse(at('2026-10-06', '10:00'));
    const secs = [20, 25, 20].map((s, i) => ({ start_time: new Date(t0 + i * 600000).toISOString(), end_time: new Date(t0 + i * 600000 + s * 1000).toISOString() }));
    assert.equal(run({ check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '16:30') }, secs).break, 1);

    // timezone صریح: همان لحظه‌ها با UTC ⇒ ورود ۰۴:۳۰ تأخیر ندارد و خروج ۱۳:۰۰ «زودتر» است
    const inOut = { check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '16:30') };
    const utc = run(inOut, [], { timezone: 'UTC' });
    assert.deepEqual([utc.late, utc.earlyLeave, utc.overtime], [0, 210, 0]);
    assert.equal(run(inOut, [], { timezone: undefined }).late, 0, 'پیش‌فرض Asia/Tehran');
    assert.equal(run(inOut, [], { timezone: ' asia/tehran ' }).earlyLeave, 0, 'نام با حروف دلخواه نرمال می‌شود');
    // ساعت‌های تک‌رقمی در settings (مثل DB قدیمی) همان‌طور که workHours قدیمی می‌خواند
    assert.equal(computeDay({ record: { check_in_time: at('2026-10-06', '08:30') }, settings: { workDayStart: '8:00', workDayEnd: '16:30' }, timezone: TEHRAN, now: at('2026-10-06', '09:00') }).late, 30);
  });

  test('اعتبارسنجی ورودی، تغییر‌ندادن ورودی‌ها و خالص‌بودن (بدون بارگذاری repository/DB)', () => {
    const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
    const record = deepFreeze({ id: 1, check_in_time: at('2026-10-06', '08:00'), check_out_time: at('2026-10-06', '16:30'), status: 'normal' });
    const breaks = deepFreeze([{ start_time: at('2026-10-06', '12:00'), end_time: at('2026-10-06', '12:30') }]);
    const settings = deepFreeze({ workDayStart: '08:00', workDayEnd: '16:30' });
    const a = computeDay({ record, breaks, settings, timezone: TEHRAN });
    const b = computeDay({ record, breaks, settings, timezone: TEHRAN });
    assert.deepEqual(a, b, 'یک ورودی ⇒ یک خروجی');
    assert.notEqual(a.flags, b.flags, 'هر فراخوانی آرایه‌ی flags تازه می‌دهد');

    const base = { record: { check_in_time: at('2026-10-06', '08:00') }, settings: SETTINGS, timezone: TEHRAN, now: at('2026-10-06', '12:00') };
    assert.throws(() => computeDay(), TypeError);
    assert.throws(() => computeDay({ ...base, settings: undefined }), TypeError);
    for (const bad of [{ workDayStart: '25:00', workDayEnd: '16:30' }, { workDayStart: '08:00' }, { workDayStart: '08:00', workDayEnd: 'x' }]) {
      assert.throws(() => computeDay({ ...base, settings: bad }), RangeError, JSON.stringify(bad));
    }
    assert.throws(() => computeDay({ ...base, timezone: 'Mars/Base' }), RangeError);
    // زمان خراب رکورد/استراحت = داده‌ی خراب ⇒ پرچم invalid_time نه exception (S3-4b)
    assert.deepEqual(computeDay({ ...base, record: { check_in_time: 'garbage' } }).flags, ['invalid_time']);
    assert.deepEqual(computeDay({ ...base, record: { check_in_time: at('2026-10-06', '08:00'), check_out_time: 'garbage' } }).flags, ['invalid_time']);
    assert.throws(() => computeDay({ ...base, now: 'garbage' }), RangeError);
    assert.deepEqual(computeDay({ ...base, breaks: [{ start_time: 'x', end_time: at('2026-10-06', '12:00') }] }).flags, ['invalid_time']);

    // خالص: با require فقط این ماژول، هیچ repository/db/config بارگذاری نمی‌شود
    const root = path.join(__dirname, '..');
    const r = spawnSync(process.execPath, ['-e', "require('./src/engine/computeDay'); console.log(String(Object.keys(require.cache).filter((k) => /[\\\\/](repositories|db|config\\.js)/.test(k)).length));"], { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), '0');
  });

  test('تطبیق با workHours.summarizeRecord قدیمی روی رکوردهای متنوع و دو تنظیم ساعت کاری (TZ سیستم = Asia/Tehran)', () => {
    const db = resetDb();
    const { makeUser } = require('./helpers/factories');
    const settingsRepo = require('../src/repositories/settingsRepository');
    const breakRepo = require('../src/repositories/breakRepository');
    const workHours = require('./fixtures/legacyWorkHours'); // منطق قدیمی منجمد‌شده (workHours فعلی wrapper موتور جدید است)

    const originalTz = process.env.TZ;
    const RealDate = Date;
    const FIXED = at('2026-10-06', '12:00');
    try {
      process.env.TZ = TEHRAN; // workHours قدیمی با ساعت سیستم کار می‌کند؛ برای مقایسه باید با timezone موتور یکی باشد
      const user = makeUser();
      const insRec = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)');
      const insBrk = db.prepare("INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (?, 'lunch', ?, ?)");
      const d = (n) => `2026-09-${String(n).padStart(2, '0')}`;
      const t0 = Date.parse(at(d(9), '10:00'));
      const iso = (ms) => new RealDate(ms).toISOString();
      const cases = [
        { in: at(d(1), '08:00'), out: at(d(1), '16:30'), brk: [[at(d(1), '12:00'), at(d(1), '12:30')]], status: 'normal' },
        { in: at(d(2), '08:45'), out: at(d(2), '17:15'), status: 'late' },
        { in: at(d(3), '08:00'), out: at(d(3), '15:00'), status: 'normal' },
        { in: at(d(4), '08:00'), out: at(d(4), '16:30'), status: 'normal' }, // مرز دقیق
        { in: at('2026-10-06', '08:10'), out: null, brk: [[at('2026-10-06', '10:00'), at('2026-10-06', '10:15')], [at('2026-10-06', '11:50'), null]], status: 'incomplete' }, // باز + استراحت باز
        { in: null, out: null, status: 'holiday' },
        { in: at(d(7), '08:00'), out: at(d(7), '07:00'), status: 'normal' }, // خروج پیش از ورود
        { in: at(d(8), '08:00'), out: at(d(9), '01:00'), status: 'normal' }, // خروج بعد از نیمه‌شب (رفتار موروثی)
        { in: at(d(9), '08:00'), out: at(d(9), '16:30'), brk: [20, 25, 20].map((s, i) => [iso(t0 + i * 600000), iso(t0 + i * 600000 + s * 1000)]), status: 'normal' },
        { in: at(d(10), '23:59'), out: at(d(11), '00:00'), status: 'late' },
        { in: at(d(11), '00:00'), out: at(d(11), '08:00'), status: 'normal' },
        { in: '2026-09-12T04:30:00.500Z', out: '2026-09-12T13:00:00.250Z', brk: [['2026-09-12T08:00:00.700Z', '2026-09-12T08:30:00.100Z']], status: 'normal' },
        { in: at(d(13), '09:00'), out: at(d(13), '18:00'), status: 'late' },
        { in: at(d(14), '07:30'), out: at(d(14), '16:29'), status: 'normal' },
        { in: at(d(15), '08:00'), out: at(d(15), '08:00'), status: 'normal' }, // ورود = خروج
      ];
      const ids = cases.map((c, i) => {
        // record_date در منطق قدیمی/جدید نقشی ندارد؛ فقط باید برای هر رکورد یکتا باشد (UNIQUE کاربر+تاریخ)
        const id = insRec.run(user.id, `2026-08-${String(i + 1).padStart(2, '0')}`, c.in, c.out, c.status).lastInsertRowid;
        (c.brk || []).forEach(([s, e]) => insBrk.run(id, s, e));
        return Number(id);
      });

      let compared = 0;
      for (const cfg of [{}, { workDayStart: '09:00', workDayEnd: '17:30' }, { workDayStart: '7:30', workDayEnd: '15:00' }]) {
        db.exec("DELETE FROM settings WHERE key IN ('work_day_start', 'work_day_end')");
        settingsRepo.update(cfg);
        const settings = settingsRepo.getAll();
        const diffs = [];
        for (const id of ids) {
          const record = db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
          // Date را برای هر دو موتور ثابت می‌کنیم تا رکوردهای باز قابل مقایسه باشند
          global.Date = class extends RealDate {
            constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
            static now() { return new RealDate(FIXED).getTime(); }
          };
          let oldOut; let newOut;
          try {
            oldOut = workHours.summarizeRecord(record);
            const day = computeDay({ record, breaks: breakRepo.listByAttendanceRecord(id), settings, now: FIXED, timezone: TEHRAN });
            newOut = { effectiveMinutes: day.effective, lateMinutes: day.late, earlyLeaveMinutes: day.earlyLeave, overtimeMinutes: day.overtime, isOpen: day.isOpen };
          } finally { global.Date = RealDate; }
          try { assert.deepEqual(newOut, oldOut); } catch (_) { diffs.push({ id, old: oldOut, new: newOut }); }
          compared += 1;
        }
        assert.deepEqual(diffs, [], `جدول تفاوت باید خالی باشد (تنظیم ${JSON.stringify(cfg)})`);
      }
      assert.equal(compared, cases.length * 3);
    } finally {
      global.Date = RealDate;
      if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    }
  });
});
