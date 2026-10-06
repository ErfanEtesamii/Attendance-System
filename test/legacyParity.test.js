// S3-2d: تطبیق موتور جدید (dayService ⇒ computeDay) با منطق قدیمی workHours (منجمد در test/fixtures/legacyWorkHours.js).
// رکوردهای ساختگی متنوع (دست‌ساز + تصادفیِ بذردار ⇒ قابل تکرار) × چند تنظیم ساعت کاری، از مسیر واقعی DB.
// جدول تفاوت (diffs) باید خالی باشد. منطق قدیمی با ساعت سیستم کار می‌کند ⇒ TZ پروسه = Asia/Tehran (timezone پیش‌فرض موتور).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dayService = require('../src/engine/dayService');
const legacy = require('./fixtures/legacyWorkHours');
const settingsRepo = require('../src/repositories/settingsRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const FIXED = at('2026-10-06', '12:00');
const CONFIGS = [
  {},
  { workDayStart: '09:00', workDayEnd: '17:30' },
  { workDayStart: '7:30', workDayEnd: '15:00' },
  { workDayStart: '00:00', workDayEnd: '23:59' },
  { workDayStart: '08:00', workDayEnd: '08:00' },
  { workDayStart: '17:00', workDayEnd: '08:00' }, // شروع بعد از پایان (تنظیم عجیب ولی معتبر)
];

// PRNG بذردار (mulberry32) تا مجموعه‌ی رکوردها در هر اجرا یکی باشد
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('تطبیق موتور جدید با workHours قدیمی (S3-2d)', () => {
  let db; let originalTz; const RealDate = Date;
  const recordIds = [];

  const freezeDate = () => {
    global.Date = class extends RealDate {
      constructor(...args) { if (args.length === 0) super(FIXED); else super(...args); }
      static now() { return new RealDate(FIXED).getTime(); }
    };
  };

  before(() => {
    originalTz = process.env.TZ;
    process.env.TZ = TEHRAN;
    db = resetDb();
    const user = makeUser();
    const insRec = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)');
    const insBrk = db.prepare('INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (?, ?, ?, ?)');
    let n = 0;
    const add = (ci, out, status, brk = []) => {
      n += 1;
      const date = new RealDate(Date.UTC(2025, 0, 1) + n * 86400000).toISOString().slice(0, 10); // تاریخ یکتا (UNIQUE کاربر+تاریخ)
      const id = Number(insRec.run(user.id, date, ci, out, status).lastInsertRowid);
      brk.forEach(([s, e]) => insBrk.run(id, 'lunch', s, e));
      recordIds.push(id);
    };

    // --- دست‌ساز: مرزها و حالت‌های خاص ---
    const D = '2026-09-10';
    add(at(D, '08:00'), at(D, '16:30'), 'normal', [[at(D, '12:00'), at(D, '12:30')]]); // دقیقاً روی شروع/پایان
    add(at(D, '08:01'), at(D, '16:29'), 'late');
    add(at(D, '07:59'), at(D, '16:31'), 'normal');
    add(at(D, '08:00'), at(D, '08:00'), 'normal'); // ورود = خروج
    add(at(D, '09:00'), at(D, '08:00'), 'normal'); // خروج پیش از ورود
    add(at(D, '08:00'), at('2026-09-11', '01:00'), 'normal'); // خروج بعد از نیمه‌شب
    add(at(D, '23:59'), at('2026-09-11', '00:00'), 'late');
    add(at(D, '00:00'), at(D, '23:59'), 'normal');
    add(null, null, 'holiday');
    add(null, null, 'leave');
    add(at('2026-10-06', '08:10'), null, 'incomplete', [[at('2026-10-06', '10:00'), at('2026-10-06', '10:15')], [at('2026-10-06', '11:50'), null]]); // باز + استراحت باز
    add(at('2026-10-06', '13:00'), null, 'incomplete'); // ورود بعد از «الان»
    add('2026-09-12T04:30:00.500Z', '2026-09-12T13:00:00.250Z', 'normal', [['2026-09-12T08:00:00.700Z', '2026-09-12T08:30:00.100Z']]); // میلی‌ثانیه
    add(at(D, '08:00'), at(D, '09:00'), 'normal', [[at(D, '08:10'), at(D, '10:00')]]); // استراحت بلندتر از کار ⇒ effective صفر
    add(at(D, '08:00'), at(D, '16:00'), 'normal', [[at(D, '12:30'), at(D, '12:00')]]); // پایان استراحت پیش از شروعش (منفی)
    add(at(D, '08:00'), at(D, '16:00'), 'normal', [[at(D, '12:00'), at(D, '12:00')]]); // استراحت صفر
    add(at(D, '08:00'), at(D, '16:00'), 'normal', [[at(D, '07:00'), at(D, '07:30')], [at(D, '17:00'), at(D, '17:30')]]); // استراحت خارج از بازه
    add(at(D, '08:00'), at(D, '16:00'), 'normal', [[at(D, '10:00'), at(D, '10:40')], [at(D, '10:20'), at(D, '11:00')]]); // استراحت‌های هم‌پوشان
    // دقیقه‌ی ۳۰ ثانیه‌ای: گرد کردن نیم‌دقیقه
    add('2026-09-13T05:00:00.000Z', '2026-09-13T13:00:30.000Z', 'normal', [['2026-09-13T08:00:00.000Z', '2026-09-13T08:00:30.000Z']]);
    add('2026-09-14T05:00:00.000Z', '2026-09-14T13:00:29.999Z', 'normal', [['2026-09-14T08:00:00.000Z', '2026-09-14T08:00:29.999Z']]);

    // --- تصادفی بذردار (۳۰۰ رکورد) ---
    const r = rng(20261006);
    const pick = (a, b) => a + Math.floor(r() * (b - a + 1));
    for (let i = 0; i < 300; i += 1) {
      const day = `2026-0${pick(1, 9)}-${String(pick(1, 28)).padStart(2, '0')}`;
      const inMs = Date.parse(at(day, '00:00')) + pick(0, 86399) * 1000 + pick(0, 999);
      const kind = r();
      if (kind < 0.05) { add(null, null, r() < 0.5 ? 'holiday' : 'leave'); continue; }
      let outMs = null;
      if (kind >= 0.2) {
        if (kind < 0.25) outMs = inMs - pick(0, 4 * 3600) * 1000; // خروج پیش از ورود
        else outMs = inMs + pick(0, 16 * 3600) * 1000 + pick(0, 999); // تا ۱۶ ساعت ⇒ گاهی بعد از نیمه‌شب
      }
      const brk = [];
      for (let b = pick(0, 3); b > 0; b -= 1) {
        const s = inMs + pick(-1800, 12 * 3600) * 1000;
        const open = r() < 0.1;
        const e = s + pick(-300, 5400) * 1000 + pick(0, 999); // گاهی پایان پیش از شروع
        brk.push([new RealDate(s).toISOString(), open ? null : new RealDate(e).toISOString()]);
      }
      add(new RealDate(inMs).toISOString(), outMs === null ? null : new RealDate(outMs).toISOString(),
        outMs === null ? 'incomplete' : (r() < 0.3 ? 'late' : 'normal'), brk);
    }
  });

  after(() => {
    global.Date = RealDate;
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
    cleanup();
  });

  const load = () => recordIds.map((id) => db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id));
  const setConfig = (cfg) => {
    db.exec("DELETE FROM settings WHERE key IN ('work_day_start', 'work_day_end')");
    settingsRepo.update(cfg);
  };

  test('summarizeRecord: برای همه‌ی رکوردها × همه‌ی تنظیمات، موتور جدید = قدیمی (جدول تفاوت خالی)', () => {
    const records = load();
    assert.ok(records.length >= 300);
    let compared = 0; let withValues = 0;
    for (const cfg of CONFIGS) {
      setConfig(cfg);
      const diffs = [];
      freezeDate(); // رکوردهای باز: هر دو موتور با همان «الان»
      try {
        for (const record of records) {
          const oldOut = legacy.summarizeRecord(record);
          const newOut = dayService.summarizeRecord(record); // بدون now ⇒ مسیر پیش‌فرض واقعی
          try { assert.deepEqual(newOut, oldOut); } catch (_) { diffs.push({ id: record.id, old: oldOut, new: newOut }); }
          compared += 1;
          if (oldOut.effectiveMinutes) withValues += 1;
        }
      } finally { global.Date = RealDate; }
      assert.deepEqual(diffs.slice(0, 5), [], `جدول تفاوت باید خالی باشد (تنظیم ${JSON.stringify(cfg)}؛ ${diffs.length} تفاوت)`);
    }
    assert.equal(compared, records.length * CONFIGS.length);
    assert.ok(withValues > compared / 2, 'مجموعه‌ی داده باید معنادار باشد (بیشتر رکوردها ساعت مفید دارند)');
  });

  test('summarizeRange: کل مجموعه و گروه‌های ۱۰تایی × همه‌ی تنظیمات، موتور جدید = قدیمی', () => {
    const records = load();
    for (const cfg of CONFIGS) {
      setConfig(cfg);
      freezeDate();
      try {
        const diffs = [];
        const groups = [records, []];
        for (let i = 0; i < records.length; i += 10) groups.push(records.slice(i, i + 10));
        groups.forEach((g, gi) => {
          const oldOut = legacy.summarizeRange(g);
          const newOut = dayService.summarizeRange(g);
          try { assert.deepEqual(newOut, oldOut); } catch (_) { diffs.push({ group: gi, old: oldOut, new: newOut }); }
        });
        assert.deepEqual(diffs.slice(0, 5), [], `تنظیم ${JSON.stringify(cfg)}`);
      } finally { global.Date = RealDate; }
    }
  });

  test('wrapper workHours (مسیر require قدیمی) هم همان خروجی قدیمی را می‌دهد؛ now تزریقی با Date ثابت‌شده یکسان است', () => {
    const workHours = require('../src/utils/workHours');
    const records = load();
    setConfig({});
    const diffs = [];
    freezeDate();
    try {
      for (const record of records) {
        const oldOut = legacy.summarizeRecord(record);
        const viaWrapper = workHours.summarizeRecord(record);
        const viaNow = dayService.summarizeRecord(record, { now: FIXED });
        try { assert.deepEqual(viaWrapper, oldOut); assert.deepEqual(viaNow, oldOut); } catch (_) { diffs.push({ id: record.id, old: oldOut, wrapper: viaWrapper, now: viaNow }); }
      }
      assert.deepEqual(workHours.summarizeRange(records), legacy.summarizeRange(records));
    } finally { global.Date = RealDate; }
    assert.deepEqual(diffs.slice(0, 5), []);
  });
});
