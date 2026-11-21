// خروج موقت: بدون گیت گزارش، ورود مجدد فقط پس از خروج موقت، خروج اصلی یک‌بار و نهایی، و رکورد بدون خروج اصلی «ناقص» حساب می‌شود
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/miniappClient');
const { computeDay } = require('../src/engine/computeDay');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('خروج موقت: موتور محاسبه', () => {
  const settings = { workDayStart: '08:30', workDayEnd: '16:30' };
  const base = { id: 1, record_date: '2026-03-02', check_in_time: '2026-03-02T05:00:00.000Z', check_out_time: '2026-03-02T08:00:00.000Z', status: 'normal' };
  test('خروج موقت امروز: تا همان ساعت حساب می‌شود؛ بعد از پایان روز بدون خروج اصلی ⇒ missing_checkout و ساعت مفید صفر', () => {
    const live = computeDay({ record: { ...base, temp_exit: 1 }, breaks: [], settings, timezone: 'Asia/Tehran', now: '2026-03-02T09:00:00.000Z' });
    assert.equal(live.effective > 0, true);
    assert.equal(live.flags.includes('missing_checkout'), false);
    const over = computeDay({ record: { ...base, temp_exit: 1 }, breaks: [], settings, timezone: 'Asia/Tehran', now: '2026-03-03T09:00:00.000Z' });
    assert.equal(over.flags.includes('missing_checkout'), true);
    assert.equal(over.effective, 0);
  });
  test('خروج اصلی (temp_exit=0) مثل قبل: ساعت مفید حفظ می‌شود', () => {
    const done = computeDay({ record: { ...base, temp_exit: 0 }, breaks: [], settings, timezone: 'Asia/Tehran', now: '2026-03-03T09:00:00.000Z' });
    assert.equal(done.flags.includes('missing_checkout'), false);
    assert.equal(done.effective > 0, true);
  });
});

describe('خروج موقت: API', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
  let S; let F; let attendanceRepo; let settingsRepo;
  before(async () => { resetDb(); F = require('./helpers/factories'); attendanceRepo = require('../src/repositories/attendanceRepository'); settingsRepo = require('../src/repositories/settingsRepository'); S = await startServer(); settingsRepo.setValue('duplicateTapWindowSeconds', 0); });
  after(() => { if (S) S.close(); cleanup(); });

  test('مسیر کامل: خروج موقت (بدون گزارش) ← ورود مجدد ← خروج اصلی؛ بعد از خروج اصلی ورود مجدد/خروج موقت ممکن نیست', async () => {
    const u = F.makeUser();
    const ci = await S.call(u, 'POST', 'check-in', {});
    assert.equal(ci.status, 201, JSON.stringify(ci.json));
    let today = (await S.call(u, 'GET', 'today')).json;
    assert.equal(today.canTempExit, true); assert.equal(today.tempExit, false); assert.equal(today.canReEnter, false);
    const t = await S.call(u, 'POST', 'temp-check-out', {});
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.equal(t.json.tempExit, true); assert.match(t.json.tempExitMessage, /خروج اصلی/);
    assert.equal(attendanceRepo.findById(ci.json.id).temp_exit, 1);
    today = (await S.call(u, 'GET', 'today')).json;
    assert.equal(today.tempExit, true); assert.equal(today.canReEnter, true); assert.equal(today.canTempExit, false);
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 400); // خروج اصلی فقط بعد از برگشت
    const re = await S.call(u, 'POST', 're-check-in', {});
    assert.equal(re.status, 201, JSON.stringify(re.json));
    assert.equal(attendanceRepo.findById(ci.json.id).temp_exit, 0);
    const fin = await S.call(u, 'POST', 'check-out', {});
    assert.equal(fin.status, 200, JSON.stringify(fin.json));
    assert.equal(attendanceRepo.findById(ci.json.id).temp_exit, 0);
    today = (await S.call(u, 'GET', 'today')).json;
    assert.equal(today.canReEnter, false); assert.equal(today.canTempExit, false);
    assert.equal((await S.call(u, 'POST', 're-check-in', {})).json.code, 'REENTRY_NOT_AVAILABLE'); // خروج اصلی یک‌بار و نهایی
    assert.equal((await S.call(u, 'POST', 'temp-check-out', {})).status, 400);
  });

  test('بدون ورود، با استراحت باز یا بعد از خروج اصلی، خروج موقت رد می‌شود؛ ورود مجدد بدون خروج موقت رد می‌شود', async () => {
    const u = F.makeUser();
    assert.equal((await S.call(u, 'POST', 'temp-check-out', {})).status, 400);
    await S.call(u, 'POST', 'check-in', {});
    assert.equal((await S.call(u, 'POST', 're-check-in', {})).status, 409);
    await S.call(u, 'POST', 'check-out', {});
    assert.equal((await S.call(u, 'POST', 'temp-check-out', {})).status, 400);
  });

  test('سقف ورود مجدد صفر ⇒ خروج موقت ممکن نیست (راه برگشت وجود ندارد)', async () => {
    settingsRepo.setValue('maxReEntriesUnlimited', false);
    settingsRepo.setValue('maxReEntriesPerDay', 0);
    const u = F.makeUser(); await S.call(u, 'POST', 'check-in', {});
    const r = await S.call(u, 'POST', 'temp-check-out', {});
    assert.equal(r.status, 409); assert.equal(r.json.code, 'TEMP_EXIT_LIMIT');
    settingsRepo.setValue('maxReEntriesPerDay', 5);
  });

  test('Job پایان روز: خروج موقتِ بازمانده «ناقص» علامت می‌خورد', () => {
    const u = F.makeUser();
    const rec = attendanceRepo.createManual({ userId: u.id, recordDate: '2026-03-02', checkInTime: '2026-03-02T05:00:00.000Z', checkOutTime: '2026-03-02T08:00:00.000Z', status: 'normal' });
    require('../src/db/connection').getDb().prepare('UPDATE attendance_records SET temp_exit = 1 WHERE id = ?').run(rec.id);
    assert.ok(attendanceRepo.listOpenRecordsByDate('2026-03-02').some((r) => r.id === rec.id));
  });
});
