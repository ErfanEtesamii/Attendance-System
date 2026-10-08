// S4-8b-1: اثر مرخصی تأییدشده در موتور خالص — approvedLeaves در computeDay (expected کم می‌شود؛ تأخیر/زودتر رفتنِ داخل پنجره حساب نمی‌شود)
// و سازنده‌ی پنجره‌ها leaveWindowsOnDate. فقط منطق خالص: هیچ DB/dayService در این بخش درگیر نیست (اتصال در S4-8b-2).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeDay } = require('../src/engine/computeDay');
const { leaveWindowsOnDate } = require('../src/utils/leaveUnits');
const { zonedTimeToUtc } = require('../src/utils/time');

const TEHRAN = 'Asia/Tehran';
const MON = '2026-09-14';
const at = (hhmm, date = MON) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const settings = { workDayStart: '08:00', workDayEnd: '16:30' }; // ۵۱۰ دقیقه
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const W = (a, b) => ({ start: min(a), end: min(b) });

// تقویم ساختگی مثل leaveUnits.test: ۰۸:۰۰–۱۶:۳۰؛ پنجشنبه (۰۹-۱۷) نیم‌روز تا ۱۲:۳۰؛ جمعه آخر هفته؛ سه‌شنبه (۰۹-۱۵) تعطیلی
const fakeDay = (date) => {
  if (date === '2026-09-18') return { isWorkingDay: false, kind: 'weekend', expectedStart: null, expectedEnd: null };
  if (date === '2026-09-15') return { isWorkingDay: false, kind: 'holiday', expectedStart: null, expectedEnd: null };
  if (date === '2026-09-17') return { isWorkingDay: true, kind: 'half', expectedStart: '08:00', expectedEnd: '12:30' };
  return { isWorkingDay: true, kind: 'working', expectedStart: '08:00', expectedEnd: '16:30' };
};
const V = (o) => ({ unit: 'day', halfDayPart: null, startTime: null, endTime: null, ...o });

// خروجی کلیدی یک روز: ورود/خروج دلخواه (hh:mm) با پنجره‌های مرخصی
function day(inn, out, approvedLeaves, extra = {}) {
  const date = extra.date || MON;
  const r = computeDay({
    record: { check_in_time: at(inn, date), check_out_time: out ? at(out, date) : null, status: 'normal', record_date: date },
    breaks: [], settings: { ...settings, ...(extra.settings || {}) }, timezone: TEHRAN, now: at('23:00', date), calendar: extra.calendar, approvedLeaves,
  });
  return { expected: r.expected, late: r.late, early: r.earlyLeave, overtime: r.overtime };
}

describe('اثر مرخصی در موتور (S4-8b-1)', () => {
  test('بدون مرخصی (undefined/null/[]) دقیقاً مثل قبل؛ ورودی نامعتبر ⇒ خطا؛ ورودی تغییر نمی‌کند', () => {
    const rec = { check_in_time: at('08:20'), check_out_time: at('16:00'), status: 'normal' };
    const args = { record: rec, breaks: [], settings, timezone: TEHRAN };
    const base = computeDay(args);
    assert.deepEqual([base.expected, base.late, base.earlyLeave], [510, 20, 30]);
    for (const none of [undefined, null, []]) assert.deepEqual(computeDay({ ...args, approvedLeaves: none }), base);
    // پنجره‌ی کاملاً بیرون از ساعت کاری بی‌اثر است (نه خطا)
    assert.deepEqual(computeDay({ ...args, approvedLeaves: [W('17:00', '18:00'), W('06:00', '07:00')] }), base);
    for (const bad of [{}, 'x', [null], [{ start: 10 }], [{ start: 600, end: 600 }], [{ start: 700, end: 600 }], [{ start: -5, end: 60 }], [{ start: '1', end: 2 }], [{ start: 1, end: Infinity }]]) {
      assert.throws(() => computeDay({ ...args, approvedLeaves: bad }), bad && (Array.isArray(bad) ? RangeError : TypeError), JSON.stringify(bad));
    }
    const wins = [W('10:00', '11:00')];
    const copy = JSON.stringify(wins);
    computeDay({ ...args, approvedLeaves: wins });
    assert.equal(JSON.stringify(wins), copy);
  });

  test('ساعتی: اول وقت، وسط روز، آخر وقت، هم‌پوشانی و مهلت', () => {
    // ساعتیِ ۱۰:۰۰–۱۲:۰۰ وسط روز: expected = ۵۱۰−۱۲۰؛ ورود ۰۸:۰۰ و خروج ۱۶:۳۰ ⇒ بدون تأخیر/زودتر رفتن
    assert.deepEqual(day('08:00', '16:30', [W('10:00', '12:00')]), { expected: 390, late: 0, early: 0, overtime: 0 });
    // اول وقت ۰۸:۰۰–۱۰:۰۰: ورود ۰۹:۳۰ داخل پنجره ⇒ تأخیر نیست؛ ۱۰:۲۰ ⇒ ۲۰ دقیقه (از شروعِ مؤثر ۱۰:۰۰، نه ۱۴۰)
    assert.equal(day('09:30', '16:30', [W('08:00', '10:00')]).late, 0);
    assert.equal(day('10:00', '16:30', [W('08:00', '10:00')]).late, 0);
    assert.deepEqual(day('10:20', '16:30', [W('08:00', '10:00')]), { expected: 390, late: 20, early: 0, overtime: 0 });
    // پنجره‌ی وسط ۰۹:۰۰–۱۰:۰۰ و ورود ۰۹:۳۰: فقط ۰۸:۰۰–۰۹:۰۰ تأخیر است (نیم‌ساعتِ داخل پنجره نه)
    assert.equal(day('09:30', '16:30', [W('09:00', '10:00')]).late, 60);
    // آخر وقت ۱۵:۳۰–۱۶:۳۰: خروج ۱۵:۳۰ و ۱۵:۴۵ ⇒ زودتر رفتن نیست؛ ۱۵:۰۰ ⇒ ۳۰ دقیقه (نه ۹۰)؛ خروج پس از پایان ⇒ اضافه‌کاری مثل قبل
    assert.equal(day('08:00', '15:30', [W('15:30', '16:30')]).early, 0);
    assert.equal(day('08:00', '15:45', [W('15:30', '16:30')]).early, 0);
    assert.deepEqual(day('08:00', '15:00', [W('15:30', '16:30')]), { expected: 450, late: 0, early: 30, overtime: 0 });
    assert.equal(day('08:00', '17:00', [W('15:30', '16:30')]).overtime, 30);
    // خروج ۱۱:۰۰ با ساعتیِ ۱۰:۰۰–۱۲:۰۰ وسط روز: ۱۱:۰۰ تا ۱۶:۳۰ = ۳۳۰ دقیقه، که ۶۰ دقیقه‌اش (۱۱:۰۰–۱۲:۰۰) داخل مرخصی است ⇒ ۲۷۰
    assert.equal(day('08:00', '11:00', [W('10:00', '12:00')]).early, 330 - 60);
    // پنجره‌های هم‌پوشان/چسبیده یک‌بار شمرده می‌شوند
    assert.equal(day('08:00', '16:30', [W('09:00', '11:00'), W('10:00', '12:00'), W('12:00', '13:00')]).expected, 510 - 240);
    // مهلت از شروعِ مؤثر: مهلت ۱۰ دقیقه و مرخصی تا ۱۰:۰۰ ⇒ ۱۰:۱۰ هنوز تأخیر نیست، ۱۰:۱۱ ⇒ ۱۱ (shift_start) یا ۱ (after_grace)
    const g = (inn, countsFrom) => day(inn, '16:30', [W('08:00', '10:00')], { settings: { lateGraceMinutes: 10, lateCountsFrom: countsFrom } }).late;
    assert.deepEqual([g('10:10', 'shift_start'), g('10:11', 'shift_start'), g('10:11', 'after_grace')], [0, 11, 1]);
  });

  test('نیم‌روز صبح/عصر (با سازنده‌ی پنجره از تقویم): نیمه‌ها دقیقاً یک روز می‌شوند', () => {
    const win = (v, date = MON) => leaveWindowsOnDate([v], date, fakeDay);
    const morning = win(V({ unit: 'half_day', halfDayPart: 'morning', startDate: MON, endDate: MON }));
    const afternoon = win(V({ unit: 'half_day', halfDayPart: 'afternoon', startDate: MON, endDate: MON }));
    assert.deepEqual(morning, [W('08:00', '12:15')]); // floor(۵۱۰/۲) = ۲۵۵
    assert.deepEqual(afternoon, [W('12:15', '16:30')]);
    // صبح: expected = ۲۵۵؛ ورود ۱۲:۱۵ و پیش از آن ⇒ تأخیر نیست؛ ۱۲:۳۰ ⇒ ۱۵ دقیقه؛ خروج ۱۶:۳۰ بدون زودتر رفتن
    assert.deepEqual(day('12:15', '16:30', morning), { expected: 255, late: 0, early: 0, overtime: 0 });
    assert.equal(day('09:00', '16:30', morning).late, 0);
    assert.equal(day('12:30', '16:30', morning).late, 15);
    assert.equal(day('12:15', '16:00', morning).early, 30);
    // عصر: expected = ۲۵۵؛ خروج ۱۲:۱۵ ⇒ زودتر رفتن نیست؛ ۱۲:۰۰ ⇒ ۱۵؛ ۱۴:۰۰ (داخل پنجره) ⇒ نه زودتر رفتن نه اضافه‌کاری؛ ورود ۰۸:۱۰ ⇒ ۱۰ دقیقه تأخیر
    assert.deepEqual(day('08:00', '12:15', afternoon), { expected: 255, late: 0, early: 0, overtime: 0 });
    assert.equal(day('08:00', '12:00', afternoon).early, 15);
    assert.deepEqual(day('08:00', '14:00', afternoon), { expected: 255, late: 0, early: 0, overtime: 0 });
    assert.equal(day('08:10', '12:15', afternoon).late, 10);
    // صبح + عصر هم‌روز = کل روز: expected ۰ و هیچ تأخیر/زودتر رفتنی حتی با ورود دیر/خروج زود
    const both = [...morning, ...afternoon];
    assert.deepEqual(day('13:00', '14:00', both), { expected: 0, late: 0, early: 0, overtime: 0 });
    // پنجشنبه نیم‌روزِ تقویم (۰۸:۰۰–۱۲:۳۰ = ۲۷۰): صبح = ۱۳۵ دقیقه تا ۱۰:۱۵ و موتور با همان پایانِ نیم‌روز می‌سنجد
    const thu = '2026-09-17';
    const thuMorning = win(V({ unit: 'half_day', halfDayPart: 'morning', startDate: thu, endDate: thu }), thu);
    assert.deepEqual(thuMorning, [W('08:00', '10:15')]);
    const thuOpts = { date: thu, calendar: fakeDay(thu) };
    assert.deepEqual(day('10:15', '12:30', thuMorning, thuOpts), { expected: 135, late: 0, early: 0, overtime: 0 });
    assert.equal(day('10:30', '12:30', thuMorning, thuOpts).late, 15);
  });

  test('چندروزه با تعطیلی وسط: فقط روزهای کاریِ بازه پنجره می‌دهند؛ روز غیرکاری و بیرون از بازه دست‌نخورده', () => {
    // دوشنبه ۰۹-۱۴ تا چهارشنبه ۰۹-۱۶ با سه‌شنبه تعطیل
    const v = V({ startDate: MON, endDate: '2026-09-16' });
    const winOf = (date) => leaveWindowsOnDate([v], date, fakeDay);
    assert.deepEqual(winOf(MON), [W('08:00', '16:30')]);
    assert.deepEqual(winOf('2026-09-15'), []); // تعطیلی وسط بازه پنجره ندارد
    assert.deepEqual(winOf('2026-09-16'), [W('08:00', '16:30')]);
    assert.deepEqual(winOf('2026-09-13'), []); // قبل و بعد از بازه
    assert.deepEqual(winOf('2026-09-17'), []);
    // روز کاری داخل بازه: expected ۰ بدون تأخیر/زودتر رفتن، حتی اگر کارمند آمده باشد (اضافه‌کاری مثل قبل: خروج پس از پایان)
    assert.deepEqual(day('09:00', '16:00', winOf(MON)), { expected: 0, late: 0, early: 0, overtime: 0 });
    assert.deepEqual(day('08:00', '17:00', winOf(MON)), { expected: 0, late: 0, early: 0, overtime: 30 });
    // روز تعطیل: expected ۰ و کل کار اضافه‌کاری، با پنجره‌ی ساختگی هم تغییری نمی‌کند (روز غیرکاری ⇒ پنجره بی‌اثر)
    const hol = '2026-09-15';
    const off = (leaves) => day('09:00', '11:00', leaves, { date: hol, calendar: fakeDay(hol) });
    assert.deepEqual(off([W('08:00', '16:30')]), off([]));
    assert.deepEqual(off([]), { expected: 0, late: 0, early: 0, overtime: 120 });
    // روز بعد از بازه: عادی (۵۱۰ و تأخیر معمول)
    const wed2 = '2026-09-19'; // شنبه‌ی بعد
    assert.deepEqual(day('08:30', '16:30', winOf(wed2), { date: wed2, calendar: fakeDay(wed2) }), { expected: 510, late: 30, early: 0, overtime: 0 });
    // بازه‌ی دوشنبه تا جمعه: آخر هفته هم پنجره نمی‌دهد؛ پنجشنبه‌ی نیم‌روز پنجره‌ی کوتاه (۲۷۰)
    const week = V({ startDate: MON, endDate: '2026-09-18' });
    assert.deepEqual(leaveWindowsOnDate([week], '2026-09-17', fakeDay), [W('08:00', '12:30')]);
    assert.deepEqual(leaveWindowsOnDate([week], '2026-09-18', fakeDay), []);
    assert.deepEqual(day('08:00', '12:30', leaveWindowsOnDate([week], '2026-09-17', fakeDay), { date: '2026-09-17', calendar: fakeDay('2026-09-17') }), { expected: 0, late: 0, early: 0, overtime: 0 });
    assert.throws(() => leaveWindowsOnDate([v], 'x', fakeDay), RangeError);
  });
});
