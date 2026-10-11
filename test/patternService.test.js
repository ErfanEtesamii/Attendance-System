// S5-7b: هشدار الگوها — سرویس روی داده‌ی واقعی DB (پنج قاعده، سناریوی مثبت و منفی، تنظیمات) و API (اسکوپ و ممنوعیت کارمند).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { detectPatterns } = require('../src/services/patternService');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');

const NOW = '2026-10-01T09:00:00Z'; // بعد از پایان ماه ۱۴۰۵/۶ ⇒ همه‌ی روزها «گذشته»
const Y = 1405; const M = 6; // ۲۰۲۶-۰۸-۲۳ .. ۲۰۲۶-۰۹-۲۲ (۲۳ اوت یکشنبه است)
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const setCreatedAt = (id) => getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(id);

function datesBetween(from, to) {
  const out = []; const d = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const isFriday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 5;
const isThursday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() === 4;

// برای همه‌ی روزهای کاری بازه (همه‌ی روزها جز جمعه) رکورد می‌سازد؛ ورود/خروج کمی متنوع تا «ساعت یکسان» به‌طور اتفاقی فعال نشود.
// lateDates: ورود ۰۸:۲۰+ ؛ absent: بدون رکورد؛ fixedIn: ساعت ورود ثابت (برای قاعده‌ی ساعت یکسان)
function fill(user, from, to, { lateDates = [], absent = [], fixedIn = null, seed = 0 } = {}) {
  datesBetween(from, to).filter((x) => !isFriday(x)).forEach((date, i) => {
    if (absent.includes(date)) return;
    const late = lateDates.includes(date);
    const inM = fixedIn !== null ? fixedIn : (late ? 8 * 60 + 20 + (i % 5) : 7 * 60 + 45 + ((i * 7 + seed) % 14));
    const outM = isThursday(date) ? 12 * 60 + 30 + ((i + seed) % 9) : 16 * 60 + 30 + ((i * 3 + seed) % 11);
    attendanceRepo.createManual({ userId: user.id, recordDate: date, checkInTime: at(date, hhmm(inM)), checkOutTime: at(date, hhmm(outM)), status: 'normal' });
  });
}

describe('هشدار الگوها: سرویس (S5-7b)', () => {
  let admin; let hr; let mgr; let uConsec; let uWeekday; let uWeekend; let uSudden; let uIdentical; let uClean; let outsider; let report;
  const rulesOf = (name) => (report.users.find((u) => u.user.fullName === name) || { findings: [] }).findings.map((f) => f.rule).sort();
  const findingOf = (name, rule) => report.users.find((u) => u.user.fullName === name).findings.find((f) => f.rule === rule);

  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین', department: 'مدیریت' });
    hr = makeUser({ role: 'hr', name: 'منابع', department: 'مدیریت' });
    mgr = makeUser({ role: 'manager', name: 'سرپرست', department: 'فنی' });
    uConsec = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'پشت‌سرهم' });
    uWeekday = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'دوشنبه‌ها' });
    uWeekend = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'آخرهفته' });
    uSudden = makeUser({ role: 'employee', department: 'فروش', name: 'ناگهانی' });
    uIdentical = makeUser({ role: 'employee', department: 'فروش', name: 'یکسان' });
    uClean = makeUser({ role: 'employee', managerId: mgr.id, department: 'فنی', name: 'سالم' });
    outsider = makeUser({ role: 'employee', department: 'فروش', name: 'بیرونی' });
    for (const u of usersRepo.listUsers({})) setCreatedAt(u.id);

    // ۱) سه روز متوالی تأخیر: یکشنبه/دوشنبه/سه‌شنبه‌ی هفته‌ی اول
    fill(uConsec, '2026-08-23', '2026-09-22', { lateDates: ['2026-08-23', '2026-08-24', '2026-08-25'], seed: 1 });
    // ۲) هر دوشنبه دیر (۵ دوشنبه‌ی ماه)؛ بین‌شان روز به‌موقع ⇒ پشت‌سرهم نیست
    fill(uWeekday, '2026-08-23', '2026-09-22', { lateDates: ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'], seed: 2 });
    // ۳) چهار غیبت: دو پنجشنبه (قبل از جمعه) و دو شنبه (بعد از جمعه)
    fill(uWeekend, '2026-08-23', '2026-09-22', { absent: ['2026-08-27', '2026-08-29', '2026-09-03', '2026-09-05'], seed: 3 });
    // ۴) افزایش ناگهانی: سه ماه قبل هرکدام یک تأخیر؛ ماه جاری ۸ تأخیر (یک‌روز در میان)
    const prev = [['2026-05-22', '2026-06-21'], ['2026-06-22', '2026-07-22'], ['2026-07-23', '2026-08-22']];
    for (const [f, t] of prev) {
      const wd = datesBetween(f, t).filter((x) => !isFriday(x));
      fill(uSudden, f, t, { lateDates: [wd[3]], seed: 4 });
    }
    const curWork = datesBetween('2026-08-23', '2026-09-22').filter((x) => !isFriday(x));
    fill(uSudden, '2026-08-23', '2026-09-22', { lateDates: curWork.filter((_, i) => i % 3 === 0).slice(0, 8), seed: 4 });
    // ۵) ورود همیشه ۰۷:۵۰ (به‌موقع، ولی دقیقاً یکسان)؛ خروج متنوع
    fill(uIdentical, '2026-08-23', '2026-09-22', { fixedIn: 7 * 60 + 50, seed: 5 });
    // کنترل منفی و کاربر بیرون از تیم
    fill(uClean, '2026-08-23', '2026-09-22', { seed: 6 });
    fill(outsider, '2026-08-23', '2026-09-22', { seed: 7 });

    report = detectPatterns({ users: usersRepo.listUsers({ onlyActive: true }), year: Y, month: M, now: NOW });
  });
  after(cleanup);

  test('هر قاعده فقط برای کاربر مربوط؛ کنترل منفی هیچ نشانه‌ای ندارد', () => {
    assert.deepEqual(rulesOf('پشت‌سرهم'), ['consecutive_late']);
    assert.deepEqual(rulesOf('دوشنبه‌ها'), ['weekday_late']);
    assert.deepEqual(rulesOf('آخرهفته'), ['weekend_adjacent_absence']);
    assert.ok(rulesOf('ناگهانی').includes('sudden_increase'), rulesOf('ناگهانی').join());
    assert.deepEqual(rulesOf('یکسان'), ['identical_times']);
    assert.deepEqual(rulesOf('سالم'), []);
    assert.deepEqual(rulesOf('بیرونی'), []);
    for (const n of ['ادمین', 'منابع', 'سرپرست']) assert.deepEqual(rulesOf(n), [], n);
  });

  test('هر نشانه دلیل فارسی با عدد دارد و evidence ساختاریافته', () => {
    for (const u of report.users) {
      for (const f of u.findings) {
        assert.ok(f.title && f.reason.length > 20, `${u.user.fullName}/${f.rule}`);
        assert.ok(f.evidence && typeof f.evidence === 'object');
      }
    }
    const c = findingOf('پشت‌سرهم', 'consecutive_late');
    assert.equal(c.evidence.longest, 3);
    assert.deepEqual(c.evidence.streaks[0].dates, ['2026-08-23', '2026-08-24', '2026-08-25']);
    const w = findingOf('دوشنبه‌ها', 'weekday_late');
    assert.equal(w.evidence.weekdayName, 'دوشنبه');
    assert.equal(w.evidence.lateCount, 5);
    const a = findingOf('آخرهفته', 'weekend_adjacent_absence');
    assert.equal(a.evidence.adjacentAbsentDays, 4);
    assert.equal(a.evidence.absentDays, 4);
    const s = findingOf('ناگهانی', 'sudden_increase');
    assert.equal(s.evidence.baselineMonths, 3);
    assert.equal(s.evidence.currentLateCount, 8);
    const i = findingOf('یکسان', 'identical_times');
    assert.equal(i.evidence.field, 'check_in');
    assert.equal(i.evidence.time, '07:50');
  });

  test('خلاصه، قواعد، آستانه‌ها و هشدار «نشانه نه اتهام»', () => {
    assert.equal(report.source, 'live');
    assert.equal(report.label.includes('1405') || report.label.length > 0, true);
    assert.match(report.disclaimer, /نشانه/);
    assert.match(report.disclaimer, /نه اتهام/);
    assert.equal(report.summary.usersAnalyzed, 10); // ادمین، hr، سرپرست، ۶ کارمند الگودار/کنترل و ۱ بیرونی
    assert.equal(report.summary.usersWithFindings, report.users.length);
    assert.equal(report.summary.findings, report.users.reduce((n, u) => n + u.findings.length, 0));
    assert.equal(report.summary.byRule.consecutive_late, 1);
    assert.equal(report.summary.byRule.identical_times, 1);
    assert.equal(report.rules.length, 5);
    assert.ok(report.rules.every((r) => r.enabled === true));
    assert.equal(report.thresholds.consecutiveLateDays, 3);
  });

  test('آستانه از تنظیمات: بالا بردن ⇒ نشانه حذف؛ ۰ ⇒ قاعده خاموش (در rules هم enabled=false)', () => {
    settingsRepo.update({ patternConsecutiveLateDays: 4 });
    let r = detectPatterns({ users: [uConsec], year: Y, month: M, now: NOW });
    assert.deepEqual(r.users, []);
    settingsRepo.update({ patternConsecutiveLateDays: 3 });
    r = detectPatterns({ users: [uConsec], year: Y, month: M, now: NOW });
    assert.equal(r.users.length, 1);
    settingsRepo.update({ patternConsecutiveLateDays: 0, patternSuddenIncreaseFactor: 0, patternIdenticalTimeMinDays: 0 });
    r = detectPatterns({ users: [uConsec, uSudden, uIdentical], year: Y, month: M, now: NOW });
    const off = new Set(['consecutive_late', 'sudden_increase', 'identical_times']);
    assert.deepEqual(r.users.flatMap((u) => u.findings).filter((f) => off.has(f.rule)), []); // سه قاعده‌ی خاموش هیچ نشانه‌ای نمی‌دهند (ناگهانی‌ِ بدون قاعده‌ی روز هفته‌اش می‌تواند weekday_late بگیرد؛ داده‌ی ساختگی یک‌روز-در-میان‌ سه‌تایی الگوی هفتگی هم دارد)
    assert.equal(r.rules.find((x) => x.id === 'consecutive_late').enabled, false);
    assert.equal(r.rules.find((x) => x.id === 'sudden_increase').enabled, false);
    assert.equal(r.rules.find((x) => x.id === 'weekday_late').enabled, true);
    settingsRepo.update({ patternConsecutiveLateDays: 3, patternSuddenIncreaseFactor: 2, patternIdenticalTimeMinDays: 5 });
  });

  test('فهرست خالی، ماه بدون داده و ماه نامعتبر (RangeError)', () => {
    const empty = detectPatterns({ users: [], year: Y, month: M, now: NOW });
    assert.equal(empty.summary.usersAnalyzed, 0);
    assert.deepEqual(empty.users, []);
    const other = detectPatterns({ users: [uConsec], year: 1405, month: 1, now: NOW });
    assert.deepEqual(other.users, []);
    assert.throws(() => detectPatterns({ users: [], year: 1405, month: 13, now: NOW }), RangeError);
  });

  // ---- API (با express) ----
  describe('API: اسکوپ و ممنوعیت کارمند', () => {
    let server; let base; let cookies;
    before(async () => {
      const { createApp } = require('../src/server');
      cookies = { admin: sessionCookie(admin.id), hr: sessionCookie(hr.id), manager: sessionCookie(mgr.id), employee: sessionCookie(uConsec.id) };
      server = createApp().listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { if (server) server.close(); });
    const get = async (role, url) => {
      const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    const URL_ = `/api/admin/analytics/patterns?year=${Y}&month=${M}`;

    test('کارمند ممنوع (۴۰۳)', async () => {
      assert.equal((await get('employee', URL_)).status, 403);
    });
    test('سرپرست فقط تیم خودش؛ userId بیرون از تیم ⇒ ۴۰۳؛ admin/hr همه', async () => {
      const m = await get('manager', URL_);
      assert.equal(m.status, 200);
      const names = m.json.users.map((u) => u.user.fullName).sort();
      assert.deepEqual(names, ['آخرهفته', 'دوشنبه‌ها', 'پشت‌سرهم'].sort());
      assert.equal((await get('manager', `${URL_}&userId=${uSudden.id}`)).status, 403);
      for (const role of ['admin', 'hr']) {
        const r = await get(role, URL_);
        assert.equal(r.status, 200, role);
        assert.ok(r.json.users.length >= 5, role);
        assert.match(r.json.disclaimer, /نشانه/);
      }
    });
    test('فیلتر دپارتمان و userId؛ پارامتر نامعتبر ⇒ ۴۰۰ با کد', async () => {
      const dep = await get('admin', `${URL_}&department=${encodeURIComponent('فروش')}`);
      assert.deepEqual(dep.json.users.map((u) => u.user.fullName).sort(), ['ناگهانی', 'یکسان'].sort());
      const one = await get('admin', `${URL_}&userId=${uIdentical.id}`);
      assert.equal(one.json.summary.usersAnalyzed, 1);
      assert.equal((await get('admin', `/api/admin/analytics/patterns?year=${Y}&month=13`)).json.code, 'INVALID_MONTH');
      assert.equal((await get('admin', `${URL_}&userId=abc`)).json.code, 'INVALID_USER');
    });
  });
});
