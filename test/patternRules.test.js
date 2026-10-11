// S5-7b: قواعد الگو (توابع خالص، بدون DB): مثبت، منفی، مرز و خاموش بودن با آستانه‌ی ۰.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/utils/patternRules');

// ساخت روز: d('2026-08-23', 'late', 10)
const d = (date, status, late = 0) => ({ date, status, late });

describe('تأخیر پشت‌سرهم (S5-7b)', () => {
  const days = [d('2026-08-22', 'present'), d('2026-08-23', 'late', 5), d('2026-08-24', 'late', 9), d('2026-08-25', 'late', 1), d('2026-08-26', 'present')];

  test('۳ روز متوالی ⇒ نشانه با دلیل و بازه', () => {
    const r = R.consecutiveLate(days, { minDays: 3 });
    assert.equal(r.length, 1);
    assert.equal(r[0].rule, 'consecutive_late');
    assert.equal(r[0].evidence.longest, 3);
    assert.deepEqual(r[0].evidence.streaks[0].dates, ['2026-08-23', '2026-08-24', '2026-08-25']);
    assert.match(r[0].reason, /3 روز/);
  });
  test('مرز: آستانه ۴ ⇒ هیچ؛ آستانه ۳ ⇒ هست', () => {
    assert.equal(R.consecutiveLate(days, { minDays: 4 }).length, 0);
    assert.equal(R.consecutiveLate(days, { minDays: 3 }).length, 1);
  });
  test('غیبت و روز بدون تأخیر زنجیره را می‌شکنند', () => {
    const broken = [d('2026-08-23', 'late', 5), d('2026-08-24', 'late', 5), d('2026-08-25', 'absent'), d('2026-08-26', 'late', 5)];
    assert.equal(R.consecutiveLate(broken, { minDays: 3 }).length, 0);
    const ok = [d('2026-08-23', 'late', 5), d('2026-08-24', 'present'), d('2026-08-25', 'late', 5)];
    assert.equal(R.consecutiveLate(ok, { minDays: 2 }).length, 0);
  });
  test('آخر هفته، تعطیلی و مرخصی خنثی‌اند (زنجیره ادامه می‌یابد)', () => {
    const bridged = [d('2026-08-20', 'late', 5), d('2026-08-21', 'weekend'), d('2026-08-22', 'holiday'), d('2026-08-23', 'leave'), d('2026-08-24', 'late', 5), d('2026-08-25', 'late', 5)];
    const r = R.consecutiveLate(bridged, { minDays: 3 });
    assert.equal(r.length, 1);
    assert.equal(r[0].evidence.longest, 3);
  });
  test('ورودی نامرتب مرتب می‌شود و آستانه ۰ ⇒ خاموش', () => {
    assert.equal(R.consecutiveLate(days.slice().reverse(), { minDays: 3 }).length, 1);
    assert.deepEqual(R.consecutiveLate(days, { minDays: 0 }), []);
    assert.deepEqual(R.consecutiveLate([], { minDays: 3 }), []);
  });
  test('چند رشته‌ی بلند ⇒ یک نشانه، همه در evidence.streaks', () => {
    const two = [d('2026-08-01', 'late', 1), d('2026-08-02', 'late', 1), d('2026-08-03', 'present'), d('2026-08-04', 'late', 1), d('2026-08-05', 'late', 1), d('2026-08-06', 'late', 1)];
    const r = R.consecutiveLate(two, { minDays: 2 });
    assert.equal(r.length, 1);
    assert.equal(r[0].evidence.streaks.length, 2);
    assert.equal(r[0].evidence.longest, 3);
  });
});

describe('تأخیر مکرر یک روز هفته (S5-7b)', () => {
  // ۲۰۲۶-۰۸-۲۳ یکشنبه است؛ ۴ یکشنبه‌ی ماه همه دیر، بقیه‌ی روزها به‌موقع
  const sundays = ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23'];
  const mondays = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'];
  const base = [...sundays.map((x) => d(x, 'late', 7)), ...mondays.map((x) => d(x, 'present'))];

  test('یکشنبه‌ها ⇒ نشانه با نام روز و سهم', () => {
    const r = R.weekdayLate(base, { minCount: 3, minSharePercent: 75, marginPercent: 25 });
    assert.equal(r.length, 1);
    assert.equal(r[0].evidence.weekday, 0);
    assert.equal(r[0].evidence.weekdayName, 'یکشنبه');
    assert.equal(r[0].evidence.lateCount, 4);
    assert.equal(r[0].evidence.sharePercent, 100);
    assert.equal(r[0].evidence.otherDaysSharePercent, 0);
    assert.match(r[0].title, /یکشنبه/);
  });
  test('مرز تعداد و سهم', () => {
    assert.equal(R.weekdayLate(base, { minCount: 5, minSharePercent: 75 }).length, 0);
    const partial = [d(sundays[0], 'late', 7), d(sundays[1], 'late', 7), d(sundays[2], 'late', 7), d(sundays[3], 'present')];
    assert.equal(R.weekdayLate(partial, { minCount: 3, minSharePercent: 75, marginPercent: 0 }).length, 1); // ۷۵٪ دقیقاً روی مرز
    assert.equal(R.weekdayLate(partial, { minCount: 3, minSharePercent: 76, marginPercent: 0 }).length, 0);
  });
  test('کسی که هر روز دیر می‌آید الگوی «روز هفته» ندارد (شرط حاشیه)', () => {
    const always = [...sundays, ...mondays].map((x) => d(x, 'late', 7));
    assert.equal(R.weekdayLate(always, { minCount: 3, minSharePercent: 75, marginPercent: 25 }).length, 0);
    assert.ok(R.weekdayLate(always, { minCount: 3, minSharePercent: 75, marginPercent: 0 }).length >= 1);
  });
  test('غیبت/تعطیلی در حضوری‌ها نمی‌آید و آستانه ۰ ⇒ خاموش', () => {
    const noAtt = sundays.map((x) => d(x, 'absent'));
    assert.deepEqual(R.weekdayLate(noAtt, { minCount: 1, minSharePercent: 1 }), []);
    assert.deepEqual(R.weekdayLate(base, { minCount: 0 }), []);
  });
});

describe('غیبت چسبیده به آخر هفته (S5-7b)', () => {
  // آخر هفته: ۲۰۲۶-۰۸-۲۱ (جمعه). پنجشنبه ۲۰ و شنبه ۲۲ چسبیده‌اند.
  const month = [
    d('2026-08-19', 'present'), d('2026-08-20', 'absent'), d('2026-08-21', 'weekend'), d('2026-08-22', 'absent'),
    d('2026-08-23', 'present'), d('2026-08-24', 'present'), d('2026-08-25', 'present'), d('2026-08-26', 'present'),
    d('2026-08-27', 'absent'), d('2026-08-28', 'weekend'), d('2026-08-29', 'absent'), d('2026-08-30', 'present'),
  ];
  test('۴ از ۴ غیبت چسبیده ⇒ نشانه با سهم مبنا', () => {
    const r = R.weekendAdjacentAbsence(month, { minCount: 3, minSharePercent: 60 });
    assert.equal(r.length, 1);
    assert.equal(r[0].evidence.absentDays, 4);
    assert.equal(r[0].evidence.adjacentAbsentDays, 4);
    assert.equal(r[0].evidence.sharePercent, 100);
    assert.deepEqual(r[0].evidence.dates, ['2026-08-20', '2026-08-22', '2026-08-27', '2026-08-29']);
    assert.ok(r[0].evidence.baselineSharePercent < 100);
  });
  test('غیبت‌های وسط هفته نشانه نمی‌دهند', () => {
    const mid = [d('2026-08-22', 'present'), d('2026-08-23', 'absent'), d('2026-08-24', 'absent'), d('2026-08-25', 'absent'), d('2026-08-21', 'weekend')];
    assert.deepEqual(R.weekendAdjacentAbsence(mid, { minCount: 2, minSharePercent: 50 }).length, 0);
  });
  test('مرز تعداد؛ غیبتِ همسایه‌ی ناپیدا (لبه‌ی ماه) چسبیده حساب نمی‌شود؛ آستانه ۰ خاموش', () => {
    assert.equal(R.weekendAdjacentAbsence(month, { minCount: 5, minSharePercent: 60 }).length, 0);
    assert.equal(R.weekendAdjacentAbsence([d('2026-08-22', 'absent')], { minCount: 1, minSharePercent: 1 }).length, 0);
    assert.deepEqual(R.weekendAdjacentAbsence(month, { minCount: 0 }), []);
  });
  test('امروز/آینده/مرخصی کامل غیبت نیستند', () => {
    const m = [d('2026-08-21', 'weekend'), d('2026-08-22', 'leave'), d('2026-08-20', 'mission'), d('2026-08-23', 'pending'), d('2026-08-24', 'future')];
    assert.deepEqual(R.weekendAdjacentAbsence(m, { minCount: 1, minSharePercent: 1 }), []);
  });
});

describe('افزایش ناگهانی تأخیر (S5-7b)', () => {
  const base = [{ presentDays: 20, lateCount: 2 }, { presentDays: 22, lateCount: 2 }, { presentDays: 21, lateCount: 2 }]; // ≈۹٪
  test('۹ تأخیر از ۲۰ روز در برابر میانگین ۹٪ ⇒ نشانه', () => {
    const r = R.suddenIncrease({ presentDays: 20, lateCount: 9 }, base, { factor: 2, minExtraLate: 3, minPresentDays: 5, minBaselineMonths: 2 });
    assert.equal(r.length, 1);
    assert.equal(r[0].rule, 'sudden_increase');
    assert.equal(r[0].evidence.baselineMonths, 3);
    assert.ok(r[0].evidence.extraLateCount >= 3);
    assert.match(r[0].reason, /9 روز تأخیر از 20 روز/);
  });
  test('افزایش کم یا ضریب کمتر از آستانه ⇒ هیچ', () => {
    assert.equal(R.suddenIncrease({ presentDays: 20, lateCount: 3 }, base, { factor: 2, minExtraLate: 3 }).length, 0); // اضافه کم
    assert.equal(R.suddenIncrease({ presentDays: 20, lateCount: 3 }, base, { factor: 2, minExtraLate: 1 }).length, 0); // ۱۵٪ < ۲×۹٫۵٪ (اضافه ≈ ۱٫۱ روز؛ ضریب رد می‌کند)
    assert.equal(R.suddenIncrease({ presentDays: 20, lateCount: 4 }, base, { factor: 2, minExtraLate: 1 }).length, 1); // ۲۰٪ ≥ ۲×۹٫۵٪ ⇒ نشانه
  });
  test('مبنای صفر: فقط شرط افزایش مطلق', () => {
    const zero = [{ presentDays: 20, lateCount: 0 }, { presentDays: 20, lateCount: 0 }];
    assert.equal(R.suddenIncrease({ presentDays: 20, lateCount: 3 }, zero, { factor: 2, minExtraLate: 3 }).length, 1);
    assert.equal(R.suddenIncrease({ presentDays: 20, lateCount: 2 }, zero, { factor: 2, minExtraLate: 3 }).length, 0);
  });
  test('ماه مبنای کم‌حضور شمرده نمی‌شود؛ مبنای ناکافی یا حضور جاری کم ⇒ هیچ؛ factor صفر ⇒ خاموش', () => {
    const thin = [{ presentDays: 2, lateCount: 0 }, { presentDays: 3, lateCount: 0 }, { presentDays: 20, lateCount: 1 }];
    assert.equal(R.suddenIncrease({ presentDays: 20, lateCount: 9 }, thin, { factor: 2, minExtraLate: 3, minPresentDays: 5, minBaselineMonths: 2 }).length, 0);
    assert.equal(R.suddenIncrease({ presentDays: 3, lateCount: 3 }, base, { factor: 2, minExtraLate: 1, minPresentDays: 5 }).length, 0);
    assert.deepEqual(R.suddenIncrease({ presentDays: 20, lateCount: 9 }, base, { factor: 0 }), []);
    assert.deepEqual(R.suddenIncrease(null, base, { factor: 2 }), []);
  });
});

describe('ساعت‌های دقیقاً یکسان (S5-7b)', () => {
  const t = (date, i, o) => ({ date, inMinute: i, outMinute: o });
  const same = [t('2026-08-01', 480, 990), t('2026-08-02', 480, 991), t('2026-08-03', 480, 990), t('2026-08-04', 480, 990), t('2026-08-05', 480, 992), t('2026-08-06', 480, 990)];

  test('ورود ۰۸:۰۰ در ۶ از ۶ روز ⇒ نشانه‌ی ورود؛ خروج ۱۶:۳۰ در ۴ از ۶ (۶۶٫۷٪) ⇒ زیر سهم', () => {
    const r = R.identicalTimes(same, { minDays: 5, minSharePercent: 80 });
    assert.equal(r.length, 1);
    assert.equal(r[0].evidence.field, 'check_in');
    assert.equal(r[0].evidence.time, '08:00');
    assert.equal(r[0].evidence.days, 6);
    assert.equal(r[0].evidence.sharePercent, 100);
  });
  test('هر دو ستون یکسان ⇒ دو نشانه', () => {
    const both = same.map((x, i) => t(x.date, 480, 990));
    const r = R.identicalTimes(both, { minDays: 5, minSharePercent: 80 });
    assert.deepEqual(r.map((x) => x.evidence.field).sort(), ['check_in', 'check_out']);
  });
  test('ساعت‌های متنوع (حتی یک دقیقه فاصله) ⇒ هیچ', () => {
    const varied = [480, 481, 479, 485, 478, 490].map((m, i) => t(`2026-08-0${i + 1}`, m, 990 + i));
    assert.deepEqual(R.identicalTimes(varied, { minDays: 3, minSharePercent: 50 }), []);
  });
  test('مرز: دقیقاً minDays روز و سهم؛ کمتر از minDays رکورد ⇒ هیچ؛ null نادیده؛ آستانه ۰ خاموش', () => {
    const five = same.slice(0, 5).map((x) => t(x.date, 480, null));
    assert.equal(R.identicalTimes(five, { minDays: 5, minSharePercent: 100 }).length, 1);
    assert.equal(R.identicalTimes(five.slice(0, 4), { minDays: 5, minSharePercent: 50 }).length, 0);
    assert.deepEqual(R.identicalTimes(same, { minDays: 0 }), []);
    assert.deepEqual(R.identicalTimes([t('2026-08-01', NaN, null)], { minDays: 1 }), []);
  });
});

test('شناسه‌ی قاعده‌ها یکتا و کامل', () => {
  assert.equal(new Set(R.RULE_IDS).size, 5);
  const produced = new Set([
    ...R.consecutiveLate([d('2026-08-01', 'late', 1)], { minDays: 1 }),
    ...R.suddenIncrease({ presentDays: 10, lateCount: 10 }, [{ presentDays: 10, lateCount: 0 }, { presentDays: 10, lateCount: 0 }], { factor: 2 }),
  ].map((x) => x.rule));
  for (const id of produced) assert.ok(R.RULE_IDS.includes(id));
});
