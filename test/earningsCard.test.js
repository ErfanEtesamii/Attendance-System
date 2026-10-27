const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { zonedTimeToUtc } = require('../src/utils/time');
const { calculateAmountToman, earningsForUser } = require('../src/services/earningsService');
const usersRepository = require('../src/repositories/usersRepository');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const disputeRepository = require('../src/repositories/disputeRepository');
const settingsRepository = require('../src/repositories/settingsRepository');
const { makeUser } = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('کارت کارکرد ماهانه (Phase 20)', () => {
  after(cleanup);

  test('مبلغ دقیقه‌ای گرد می‌شود، صفر را نگه می‌دارد و نرخ NULL مبلغ ندارد', () => {
    assert.equal(calculateAmountToman(1, 1), 17);
    assert.equal(calculateAmountToman(0, 450), 0);
    assert.equal(calculateAmountToman(60, null), null);
  });

  test('روز دارای اعتراض باز از ساعت مفید کنار گذاشته می‌شود', () => {
    resetDb();
    const user = makeUser();
    usersRepository.setHourlyRateKt(user.id, 100);
    const date = '2026-08-01';
    const record = attendanceRepository.createManual({
      userId: user.id, recordDate: date,
      checkInTime: zonedTimeToUtc(date, '08:30', 'Asia/Tehran').toISOString(),
      checkOutTime: zonedTimeToUtc(date, '16:30', 'Asia/Tehran').toISOString(), status: 'normal',
    });
    const before = earningsForUser(user, { showEarningsCard: true }, { today: '2026-08-03' });
    assert.ok(before.usefulMinutes > 0);
    disputeRepository.createDispute({ userId: user.id, attendanceRecordId: record.id, message: 'اعتراض باز' });
    const afterDispute = earningsForUser(user, { showEarningsCard: true }, { today: '2026-08-03' });
    assert.equal(afterDispute.usefulMinutes, 0);
    assert.equal(afterDispute.amountToman, 0);
  });

  test('روز گذشته‌ی ورود بدون خروج (missing_checkout) در مبلغ نمی‌آید', () => {
    resetDb();
    const user = makeUser();
    usersRepository.setHourlyRateKt(user.id, 100);
    const date = '2026-08-01';
    attendanceRepository.createManual({
      userId: user.id, recordDate: date,
      checkInTime: zonedTimeToUtc(date, '08:30', 'Asia/Tehran').toISOString(), checkOutTime: null, status: 'incomplete',
    });
    const result = earningsForUser(user, { showEarningsCard: true }, { today: '2026-08-03' });
    assert.equal(result.usefulMinutes, 0);
    assert.equal(result.amountToman, 0);
  });
});

describe('کارت کارکرد ماهانه — API Mini App', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
  let S; let userA; let userB;
  before(async () => {
    resetDb();
    userA = makeUser({ name: 'کاربر الف' });
    userB = makeUser({ name: 'کاربر ب' });
    usersRepository.setHourlyRateKt(userB.id, 250);
    const { startServer } = require('./helpers/miniappClient');
    S = await startServer();
  });
  after(() => { if (S) S.close(); });

  test('شناسه‌ی query نمی‌تواند کاربر دیگر را بخواند و نرخ خام برنمی‌گردد', async () => {
    const { initDataFor } = require('./helpers/miniappClient');
    const response = await fetch(`${S.base}/api/miniapp/today?userId=${userB.id}`, {
      headers: { 'x-telegram-init-data': initDataFor(userA) },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.earnings, null, 'نرخ کاربر B نباید برای A استفاده شود');
    assert.equal(JSON.stringify(body).includes('hourly_rate_kt'), false);
    assert.equal(JSON.stringify(body).includes('250'), false);
  });

  test('تنظیم خاموش یا نرخ NULL، earnings را null می‌دهد؛ بدون initData هم 401 است', async () => {
    usersRepository.setHourlyRateKt(userA.id, 100);
    settingsRepository.update({ showEarningsCard: false });
    assert.equal((await S.call(userA, 'GET', 'today')).json.earnings, null);

    settingsRepository.update({ showEarningsCard: true });
    const enabled = (await S.call(userA, 'GET', 'today')).json.earnings;
    assert.deepEqual(Object.keys(enabled).sort(), ['amountToman', 'enabled', 'excludedDays', 'monthLabel', 'usefulMinutes']);
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.usefulMinutes, 0);
    assert.equal(enabled.amountToman, 0);
    usersRepository.setHourlyRateKt(userA.id, null);
    assert.equal((await S.call(userA, 'GET', 'today')).json.earnings, null);
    const anonymous = await fetch(`${S.base}/api/miniapp/today`);
    assert.equal(anonymous.status, 401);
  });
});

test('رابط: کارت با مقدار نمایش داده می‌شود و حالت null آن را پنهان می‌کند', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');
  assert.match(html, /id="earnings-card"/);
  assert.match(html, /کارکرد این ماه/);
  assert.match(app, /function renderEarnings\(earnings\)/);
  assert.match(app, /card\.classList\.add\('hidden'\)/);
  assert.match(app, /toLocaleString\('en-US'\)/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.earnings-card/);
});
