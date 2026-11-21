// ناهار فقط برای کارمندِ حاضر در بازه‌ی ناهار + خروج/ورود مجدد چندباره + سقف استراحت + تنظیم‌های جدید پنل
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/miniappClient');

const { computeDay } = require('../src/engine/computeDay');
const { zonedTimeToUtc } = require('../src/utils/time');

const TEHRAN = 'Asia/Tehran';
const DAY = '2026-10-06';
const at = (hhmm) => zonedTimeToUtc(DAY, hhmm, TEHRAN).toISOString();
const BASE = { workDayStart: '08:00', workDayEnd: '16:30', fixedLunchDeductMinutes: 45, fixedLunchMinPresenceMinutes: 0 };
const WINDOW = { ...BASE, fixedLunchMode: 'present_in_window', lunchWindowStart: '12:00', lunchWindowEnd: '14:00', fixedLunchMinOverlapMinutes: 15, fixedLunchProRate: true };
const run = (inT, outT, settings, extra = {}) => computeDay({
  record: { check_in_time: at(inT), check_out_time: at(outT), status: 'normal', record_date: DAY }, breaks: [], settings, timezone: TEHRAN, now: at('18:00'), ...extra,
});

describe('کسر ناهار فقط برای کارمندِ حاضر در بازه‌ی ناهار (computeDay)', () => {
  test('حاضر در کل بازه ⇒ کسر کامل؛ قبل از ناهار رفته ⇒ بدون کسر (در حالت قدیمی «همیشه» کسر می‌شد)', () => {
    assert.equal(run('08:00', '16:30', WINDOW).breakAuto, 45);
    const early = run('08:00', '11:50', { ...WINDOW, fixedLunchMinPresenceMinutes: 0 });
    assert.equal(early.breakAuto, 0);
    assert.equal(early.effective, early.workedGross); // چیزی از ساعت مفید کم نشده
    assert.equal(run('08:00', '11:50', { ...BASE, fixedLunchMode: 'always' }).breakAuto, 45);
    assert.equal(run('08:00', '11:50', BASE).breakAuto, 45, 'بدون تنظیم جدید ⇒ رفتار قبلی');
  });

  test('بعد از ناهار رسیده ⇒ بدون کسر', () => {
    assert.equal(run('14:10', '17:00', WINDOW).breakAuto, 0);
  });

  test('حضور جزئی: حداقل همپوشانی و کسر متناسب', () => {
    // ۱۳:۴۰ تا ۱۶:۳۰ ⇒ ۲۰ دقیقه در بازه
    assert.equal(run('13:40', '16:30', WINDOW).breakAuto, 20); // متناسب
    assert.equal(run('13:40', '16:30', { ...WINDOW, fixedLunchProRate: false }).breakAuto, 45); // کسر ثابت کامل
    assert.equal(run('13:40', '16:30', { ...WINDOW, fixedLunchMinOverlapMinutes: 30 }).breakAuto, 0); // کمتر از حداقل
    assert.equal(run('13:55', '16:30', WINDOW).breakAuto, 0); // ۵ دقیقه < ۱۵
  });

  test('چند نوبت (خروج و ورود مجدد): حضورِ نوبت‌ها جمع می‌شود', () => {
    const segments = [{ in: at('08:00'), out: at('12:20') }, { in: at('13:40'), out: at('17:00') }];
    const r = computeDay({ record: { check_in_time: at('08:00'), check_out_time: at('17:00'), status: 'normal', record_date: DAY }, segments, breaks: [], settings: WINDOW, timezone: TEHRAN, now: at('18:00') });
    assert.equal(r.breakAuto, 40); // ۲۰ + ۲۰ = ۴۰ دقیقه در بازه ⇒ min(45, 40) با کسر متناسب
    const away = computeDay({ record: { check_in_time: at('08:00'), check_out_time: at('17:00'), status: 'normal', record_date: DAY }, segments: [{ in: at('08:00'), out: at('11:50') }, { in: at('14:05'), out: at('17:00') }], breaks: [], settings: WINDOW, timezone: TEHRAN, now: at('18:00') });
    assert.equal(away.breakAuto, 0, 'در کل بازه‌ی ناهار بیرون بوده');
  });

  test('ناهارِ ثبت‌شده کسر ثابت نمی‌سازد و بازه‌ی نامعتبر به رفتار قبلی برمی‌گردد', () => {
    const withLunch = run('08:00', '16:30', WINDOW, { breaks: [{ start_time: at('12:30'), end_time: at('13:00'), break_type: 'lunch' }] });
    assert.equal(withLunch.breakAuto, 0);
    assert.equal(withLunch.break, 30);
    assert.equal(run('08:00', '11:50', { ...WINDOW, lunchWindowStart: '14:00', lunchWindowEnd: '12:00' }).breakAuto, 45);
  });

  test('رکورد باز ⇒ هنوز کسر نمی‌شود؛ شیفت شب با بازه‌ی بعد از نیمه‌شب', () => {
    const open = computeDay({ record: { check_in_time: at('08:00'), check_out_time: null, status: 'normal', record_date: DAY }, breaks: [], settings: WINDOW, timezone: TEHRAN, now: at('13:00') });
    assert.equal(open.breakAuto, 0);
    const shift = { startTime: '22:00', endTime: '06:00', overnight: true, graceLateMinutes: 0, graceEarlyMinutes: 0, maxLunchMinutes: 0, fixedLunchDeductMinutes: 45 };
    const nextDay = zonedTimeToUtc('2026-10-07', '06:00', TEHRAN).toISOString();
    const night = computeDay({ record: { check_in_time: at('22:00'), check_out_time: nextDay, status: 'normal', record_date: DAY }, breaks: [], shift, settings: { ...WINDOW, lunchWindowStart: '01:00', lunchWindowEnd: '03:00' }, timezone: TEHRAN, now: nextDay });
    assert.equal(night.breakAuto, 45);
  });
});

describe('تنظیم‌های جدید: پیش‌فرض‌ها، زیربخش‌ها و وابستگی‌ها', () => {
  let registry; let repo;
  before(() => { resetDb(); registry = require('../src/utils/settingsRegistry'); repo = require('../src/repositories/settingsRepository'); });
  after(cleanup);

  test('پیش‌فرض‌ها و سلامت رجیستری', () => {
    assert.deepEqual(registry.selfCheck(), []);
    const d = (k) => registry.defaultOf(k);
    assert.equal(d('fixedLunchMode'), 'present_in_window');
    assert.deepEqual([d('lunchWindowStart'), d('lunchWindowEnd'), d('fixedLunchMinOverlapMinutes'), d('fixedLunchProRate')], ['12:00', '14:00', 15, true]);
    assert.deepEqual([d('maxReEntriesPerDay'), d('maxReEntriesUnlimited'), d('breakMaxPerDay')], [5, false, 0]);
    assert.deepEqual([d('dailyTargetMinutes'), d('duplicateTapWindowSeconds'), d('urgentTaskReminderLeadMinutes'), d('missionReminderHour'), d('reportSoftWindowHours'), d('reportMaxExtraTasks')], [480, 120, 30, 10, 24, 10]);
    assert.equal(registry.validate('maxReEntriesPerDay', 20).ok, true);
    assert.equal(registry.validate('maxReEntriesPerDay', 51).ok, false);
    assert.equal(registry.validate('fixedLunchMode', 'whenever').ok, false);
  });

  test('زیربخش‌های ساعت کاری کنار هم می‌آیند و dependsOn به پنل می‌رسد', () => {
    const items = repo.getItems().filter((i) => i.group === 'workHours');
    const seen = []; let last = null;
    items.forEach((i) => { if (i.section !== last) { assert.ok(!seen.includes(i.section), `زیربخش «${i.section}» دوباره آمد`); seen.push(i.section); last = i.section; } });
    assert.ok(seen.includes('ناهار') && seen.includes('خروج و ورود مجدد') && seen.includes('استراحت'));
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    assert.deepEqual(byKey.lunchWindowStart.dependsOn, { key: 'fixedLunchMode', equals: 'present_in_window' });
    assert.deepEqual(byKey.maxReEntriesPerDay.dependsOn, { key: 'maxReEntriesUnlimited', equals: false });
    // هر dependsOn به کلیدی در همان گروه اشاره دارد (UI فقط همان گروه را بازبینی می‌کند)
    repo.getItems().filter((i) => i.dependsOn).forEach((i) => assert.equal(byKey[i.dependsOn.key] && byKey[i.dependsOn.key].group, i.group, i.key));
  });
});

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('خروج و ورود مجدد چندباره با استراحت — سرور', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let F; let settingsRepo; let breakRepo;
  before(async () => {
    resetDb();
    F = require('./helpers/factories');
    settingsRepo = require('../src/repositories/settingsRepository');
    breakRepo = require('../src/repositories/breakRepository');
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('با سقف پیش‌فرض، کارمند بیش از دو بار خارج می‌شود و بین نوبت‌ها استراحت می‌زند', async () => {
    const u = F.makeUser();
    assert.equal((await S.call(u, 'POST', 'check-in', {})).status, 201);
    for (let i = 0; i < 3; i += 1) {
      const out = await S.call(u, 'POST', 'temp-check-out', {});
      assert.equal(out.status, 200, JSON.stringify(out.json));
      const again = await S.call(u, 'POST', 're-check-in', {});
      assert.equal(again.status, 201, `ورود مجدد ${i + 1}: ${JSON.stringify(again.json)}`);
      const b = await S.call(u, 'POST', 'break/start', { breakType: 'short_break' });
      assert.equal(b.status, 201, `استراحت بعد از ورود مجدد ${i + 1}: ${JSON.stringify(b.json)}`);
      assert.equal((await S.call(u, 'POST', 'break/end', {})).status, 200);
    }
    const today = await S.call(u, 'GET', 'today');
    assert.equal(today.json.segments.length, 4);
    assert.equal(today.json.reEntriesMax, 5);
    assert.equal(today.json.reEntriesUnlimited, false);
    assert.equal(today.json.dailyTargetMinutes, 480);
  });

  test('سقف ۱ هنوز کار می‌کند؛ نامحدود سقف را برمی‌دارد', async () => {
    settingsRepo.update({ maxReEntriesPerDay: 1 });
    const u = F.makeUser();
    await S.call(u, 'POST', 'check-in', {});
    await S.call(u, 'POST', 'temp-check-out', {});
    assert.equal((await S.call(u, 'POST', 're-check-in', {})).status, 201);
    const blocked = await S.call(u, 'POST', 'temp-check-out', {}); // سقف ۱ پر شد ⇒ خروج موقتِ دوم (بدون راه برگشت) رد می‌شود
    assert.equal(blocked.status, 409);
    assert.equal(blocked.json.code, 'TEMP_EXIT_LIMIT');
    assert.equal((await S.call(u, 'GET', 'today')).json.canTempExit, false);

    settingsRepo.update({ maxReEntriesUnlimited: true });
    assert.equal((await S.call(u, 'POST', 'temp-check-out', {})).status, 200);
    const today = (await S.call(u, 'GET', 'today')).json;
    assert.equal(today.canReEnter, true);
    assert.equal(today.reEntriesMax, null);
    assert.equal(today.reEntriesUnlimited, true);
    assert.equal((await S.call(u, 'POST', 're-check-in', {})).status, 201);
    settingsRepo.update({ maxReEntriesUnlimited: false, maxReEntriesPerDay: 5 });
  });

  test('سقف تعداد استراحت در روز (breakMaxPerDay)', async () => {
    settingsRepo.update({ breakMaxPerDay: 2 });
    const u = F.makeUser();
    const r = await S.call(u, 'POST', 'check-in', {});
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await S.call(u, 'POST', 'break/start', { breakType: 'short_break' })).status, 201);
      assert.equal((await S.call(u, 'POST', 'break/end', {})).status, 200);
    }
    const third = await S.call(u, 'POST', 'break/start', { breakType: 'short_break' });
    assert.equal(third.status, 409);
    assert.equal(third.json.code, 'BREAK_LIMIT');
    assert.equal(breakRepo.listByAttendanceRecord(r.json.id).length, 2);
    const today = (await S.call(u, 'GET', 'today')).json;
    assert.deepEqual([today.breakMaxPerDay, today.breakCanStart], [2, false]);
    settingsRepo.update({ breakMaxPerDay: 0 });
    assert.equal((await S.call(u, 'POST', 'break/start', { breakType: 'short_break' })).status, 201);
  });

  test('مهلت ثبت تکراری قابل تنظیم است (۰ = خاموش)', async () => {
    settingsRepo.update({ duplicateTapWindowSeconds: 0 });
    const u = F.makeUser();
    assert.equal((await S.call(u, 'POST', 'check-in', {})).status, 201);
    const dup = await S.call(u, 'POST', 'check-in', {});
    assert.equal(dup.status, 400);
    settingsRepo.update({ duplicateTapWindowSeconds: 120 });
    const u2 = F.makeUser();
    await S.call(u2, 'POST', 'check-in', {});
    const dup2 = await S.call(u2, 'POST', 'check-in', {});
    assert.equal(dup2.status, 200);
    assert.equal(dup2.json.alreadyDone, true);
  });
});
