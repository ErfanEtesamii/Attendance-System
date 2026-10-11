// S5-7b: قواعد «الگو» روی داده‌ی تردد یک کاربر — توابع خالص (بدون DB، بدون زمان سیستم، بدون HTTP).
//
// خروجی هر قاعده فهرستی از «نشانه»هاست، نه حکم: { rule, title, reason, evidence }.
//   • reason: دلیل فارسیِ قابل‌خواندن با همان عددهایی که باعث هشدار شده (برای نمایش مستقیم در UI).
//   • evidence: داده‌ی ساختاریافته (تاریخ‌ها، شمارش‌ها، درصدها) برای نمایش جزئیات و تست.
// آستانه‌ها از تنظیمات می‌آیند؛ مقدار ۰ برای آستانه‌ی اصلیِ هر قاعده = قاعده خاموش (هیچ نشانه‌ای نمی‌دهد).
//
// ورودی روزها (days) خروجی includeDays گزارش ماهانه است: { date: 'YYYY-MM-DD', status, late (دقیقه) }.
//   وضعیت‌ها: present | late | incomplete | absent | leave | mission | manual_leave | manual_holiday | holiday | weekend | pending | future | not_started
// تعریف‌های مشترک:
//   «حضوری» = status ∈ {present, late, incomplete}؛ «تأخیر» = حضوری با late > 0.
//   «روز کاریِ سپری‌شده» = هر وضعیتی جز {weekend, holiday, manual_holiday, pending, future, not_started}.
//   مرخصی/مأموریت در رشته‌ی «تأخیر پشت‌سرهم» خنثی است (نه زنجیره را می‌شکند نه ادامه می‌دهد)؛ غیبت و روز بدون تأخیر زنجیره را می‌شکنند.

const ATTENDED = new Set(['present', 'late', 'incomplete']);
const NEUTRAL_FOR_STREAK = new Set(['weekend', 'holiday', 'manual_holiday', 'leave', 'mission', 'manual_leave']);
const NOT_ELAPSED = new Set(['weekend', 'holiday', 'manual_holiday', 'pending', 'future', 'not_started']);
const OFF_DAY = new Set(['weekend', 'holiday']); // مبنای «چسبیده به آخر هفته/تعطیلی»

const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // ۰ = یکشنبه (مثل getUTCDay)

const isLate = (d) => ATTENDED.has(d.status) && Number(d.late) > 0;
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const percent = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0); // یک رقم اعشار
const sortByDate = (days) => days.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/**
 * الف) تأخیر پشت‌سرهم: دست‌کم minDays روزِ حضوریِ متوالی با تأخیر.
 * @returns {object[]} صفر یا یک نشانه (همه‌ی رشته‌های هم‌طول یا بلندتر از آستانه در evidence.streaks)
 */
function consecutiveLate(days, { minDays } = {}) {
  if (!(minDays > 0)) return [];
  const streaks = [];
  let cur = null;
  const close = () => { if (cur && cur.length >= minDays) streaks.push(cur); cur = null; };
  for (const d of sortByDate(days)) {
    if (NEUTRAL_FOR_STREAK.has(d.status)) continue;
    if (isLate(d)) {
      if (!cur) cur = { from: d.date, to: d.date, length: 0, dates: [] };
      cur.to = d.date; cur.length += 1; cur.dates.push(d.date);
    } else {
      close(); // حضور بدون تأخیر، غیبت، ناقص‌بدون‌تأخیر، امروز/آینده‌ی نامعلوم: زنجیره می‌شکند
    }
  }
  close();
  if (!streaks.length) return [];
  const longest = streaks.reduce((a, b) => (b.length > a.length ? b : a));
  return [{
    rule: 'consecutive_late',
    title: 'تأخیر پشت‌سرهم',
    reason: `${longest.length} روز حضوریِ پشت‌سرهم با تأخیر (از ${longest.from} تا ${longest.to}؛ آستانه ${minDays} روز). مرخصی/تعطیلی بین روزها زنجیره را نمی‌شکند.`,
    evidence: { minDays, longest: longest.length, streaks },
  }];
}

/**
 * ب) تأخیر مکرر در یک روز مشخص هفته: در آن روز هفته حداقل minCount بار تأخیر، با سهم ≥ minSharePercent از روزهای حضوریِ همان روز هفته،
 * و (اگر marginPercent > 0) سهم آن روز دست‌کم marginPercent واحد بیشتر از سهم تأخیر در بقیه‌ی روزهای هفته باشد
 * (کسی که هر روز دیر می‌آید «الگوی روز هفته» ندارد؛ برایش قاعده‌ی تأخیر پشت‌سرهم/نرخ کلی معنی‌دارتر است).
 */
function weekdayLate(days, { minCount, minSharePercent = 75, marginPercent = 25 } = {}) {
  if (!(minCount > 0)) return [];
  const by = new Map(); // weekday ⇒ { attended, late, dates }
  let totalAttended = 0; let totalLate = 0;
  for (const d of days) {
    if (!ATTENDED.has(d.status)) continue;
    const w = weekdayOf(d.date);
    if (!by.has(w)) by.set(w, { attended: 0, late: 0, dates: [] });
    const b = by.get(w);
    b.attended += 1; totalAttended += 1;
    if (isLate(d)) { b.late += 1; totalLate += 1; b.dates.push(d.date); }
  }
  const out = [];
  for (const [w, b] of [...by.entries()].sort((x, y) => x[0] - y[0])) {
    if (b.late < minCount) continue;
    const share = percent(b.late, b.attended);
    if (share < minSharePercent) continue;
    const otherAttended = totalAttended - b.attended;
    const otherShare = percent(totalLate - b.late, otherAttended); // بدون روز دیگر ⇒ ۰
    if (marginPercent > 0 && otherAttended > 0 && share - otherShare < marginPercent) continue;
    out.push({
      rule: 'weekday_late',
      title: `تأخیر مکرر در ${WEEKDAY_NAMES[w]}‌ها`,
      reason: `در ${b.late} از ${b.attended} ${WEEKDAY_NAMES[w]}ِ حضوری تأخیر داشته (${share}٪؛ آستانه: حداقل ${minCount} بار و ${minSharePercent}٪)` +
        (otherAttended > 0 ? ` در حالی که در بقیه‌ی روزهای هفته ${otherShare}٪ بوده است.` : '.'),
      evidence: { weekday: w, weekdayName: WEEKDAY_NAMES[w], lateCount: b.late, attendedCount: b.attended, sharePercent: share, otherDaysSharePercent: otherAttended > 0 ? otherShare : null, dates: b.dates, minCount, minSharePercent, marginPercent },
    });
  }
  return out;
}

/**
 * ج) غیبتِ چسبیده به آخر هفته/تعطیلی: غیبتی که روز قبل یا بعدش (در همان ماه) weekend/holiday است.
 * نشانه وقتی: تعداد چنین غیبت‌ها ≥ minCount و سهمشان از کل غیبت‌ها ≥ minSharePercent.
 * سهم مبنا (baselineSharePercent) = چند درصد روزهای کاریِ سپری‌شده اصلاً چسبیده به تعطیلی‌اند؛ تا بشود دید سهم غیبت‌ها فراتر از «شانس» هست یا نه.
 * روز اول/آخر ماه همسایه‌ی بیرون ماه را نمی‌بیند (فقط همسایه‌ی داخل ماه سنجیده می‌شود).
 */
function weekendAdjacentAbsence(days, { minCount, minSharePercent = 60 } = {}) {
  if (!(minCount > 0)) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const adjacent = (iso) => [addDays(iso, -1), addDays(iso, 1)].some((n) => byDate.has(n) && OFF_DAY.has(byDate.get(n).status));
  let absent = 0; const adjAbsent = []; let elapsed = 0; let elapsedAdjacent = 0;
  for (const d of sortByDate(days)) {
    if (NOT_ELAPSED.has(d.status)) continue;
    elapsed += 1;
    const adj = adjacent(d.date);
    if (adj) elapsedAdjacent += 1;
    if (d.status === 'absent') { absent += 1; if (adj) adjAbsent.push(d.date); }
  }
  if (adjAbsent.length < minCount) return [];
  const share = percent(adjAbsent.length, absent);
  if (share < minSharePercent) return [];
  const baseline = percent(elapsedAdjacent, elapsed);
  return [{
    rule: 'weekend_adjacent_absence',
    title: 'غیبت چسبیده به آخر هفته/تعطیلی',
    reason: `${adjAbsent.length} از ${absent} غیبت ماه (${share}٪) در روزِ قبل یا بعدِ آخر هفته/تعطیلی بوده (آستانه: حداقل ${minCount} مورد و ${minSharePercent}٪)؛ ` +
      `برای مقایسه، ${baseline}٪ از روزهای کاریِ سپری‌شده‌ی این ماه اصلاً چسبیده به تعطیلی‌اند.`,
    evidence: { absentDays: absent, adjacentAbsentDays: adjAbsent.length, sharePercent: share, baselineSharePercent: baseline, dates: adjAbsent, minCount, minSharePercent },
  }];
}

/**
 * د) افزایش ناگهانی تأخیر نسبت به میانگین ماه‌های قبل.
 * @param {{presentDays:number, lateCount:number}} current ماه مورد بررسی (ممکن است ناقص باشد؛ مقایسه با «نرخ» است نه تعداد)
 * @param {Array<{label?:string, presentDays:number, lateCount:number}>} baselineMonths ماه‌های قبل (هر ترتیبی)
 * شرط‌ها: ماه‌های مبنای معتبر (presentDays ≥ minPresentDays) حداقل minBaselineMonths؛ ماه جاری presentDays ≥ minPresentDays؛
 * نرخ جاری ≥ factor × نرخ مبنا (مبنای صفر ⇒ فقط شرط افزایش مطلق)؛ و تأخیر اضافه نسبت به انتظار (نرخ مبنا × حضور جاری) ≥ minExtraLate.
 */
function suddenIncrease(current, baselineMonths, { factor, minExtraLate = 3, minPresentDays = 5, minBaselineMonths = 2 } = {}) {
  if (!(factor > 0) || !current) return [];
  if (!(current.presentDays >= minPresentDays)) return [];
  const valid = (baselineMonths || []).filter((m) => m && m.presentDays >= minPresentDays);
  if (valid.length < minBaselineMonths) return [];
  const basePresent = valid.reduce((s, m) => s + m.presentDays, 0);
  const baseLate = valid.reduce((s, m) => s + m.lateCount, 0);
  const baseRate = basePresent > 0 ? baseLate / basePresent : 0;
  const curRate = current.lateCount / current.presentDays;
  const expectedLate = baseRate * current.presentDays;
  const extra = current.lateCount - expectedLate;
  if (extra < minExtraLate) return [];
  if (baseRate > 0 && curRate < factor * baseRate) return [];
  const r1 = (x) => Math.round(x * 10) / 10;
  const basePct = r1(baseRate * 100); const curPct = r1(curRate * 100);
  return [{
    rule: 'sudden_increase',
    title: 'افزایش ناگهانی تأخیر',
    reason: `${current.lateCount} روز تأخیر از ${current.presentDays} روز حضور (${curPct}٪) در برابر میانگین ${basePct}٪ در ${valid.length} ماه قبل؛ ` +
      `حدود ${r1(extra)} روز بیشتر از انتظار (آستانه: ${factor} برابر و حداقل ${minExtraLate} روز اضافه).`,
    evidence: { currentLateCount: current.lateCount, currentPresentDays: current.presentDays, currentRatePercent: curPct, baselineRatePercent: basePct, baselineMonths: valid.length, expectedLateCount: r1(expectedLate), extraLateCount: r1(extra), factor, minExtraLate },
  }];
}

/**
 * ه) ساعت‌های دقیقاً یکسان: ورود (و جداگانه خروج) به دقیقه‌ی یکسان در ≥ minDays روز و ≥ minSharePercent از رکوردهای آن ستون.
 * ثانیه نادیده است (دقت دقیقه). ورودی times: { date, inMinute|null, outMinute|null } (دقیقه‌ی گذشته از نیمه‌شب به وقت شرکت).
 * توجه: رکورد ثبت‌شده‌ی دستی هم ساعت گرد/یکسان دارد؛ این نشانه فقط می‌گوید «الگو یکسان است» نه «چرا».
 */
function identicalTimes(times, { minDays, minSharePercent = 80 } = {}) {
  if (!(minDays > 0)) return [];
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const out = [];
  for (const [field, label] of [['inMinute', 'ورود'], ['outMinute', 'خروج']]) {
    const vals = times.filter((t) => Number.isFinite(t[field]));
    if (vals.length < minDays) continue;
    const groups = new Map();
    for (const t of vals) { if (!groups.has(t[field])) groups.set(t[field], []); groups.get(t[field]).push(t.date); }
    const [minute, dates] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0])[0];
    const share = percent(dates.length, vals.length);
    if (dates.length < minDays || share < minSharePercent) continue;
    out.push({
      rule: 'identical_times',
      title: `ساعت ${label} دقیقاً یکسان`,
      reason: `ساعت ${label} در ${dates.length} از ${vals.length} روزِ دارای ${label} دقیقاً ${hhmm(minute)} بوده (${share}٪؛ آستانه: حداقل ${minDays} روز و ${minSharePercent}٪). ` +
        'ورودی دستی/اصلاحی هم چنین الگویی می‌سازد؛ فقط نشانه‌ای برای بررسی است.',
      evidence: { field: field === 'inMinute' ? 'check_in' : 'check_out', time: hhmm(minute), days: dates.length, recordedDays: vals.length, sharePercent: share, dates: dates.slice().sort(), minDays, minSharePercent },
    });
  }
  return out;
}

const RULE_IDS = ['consecutive_late', 'weekday_late', 'weekend_adjacent_absence', 'sudden_increase', 'identical_times'];

module.exports = { consecutiveLate, weekdayLate, weekendAdjacentAbsence, suddenIncrease, identicalTimes, RULE_IDS, WEEKDAY_NAMES };
