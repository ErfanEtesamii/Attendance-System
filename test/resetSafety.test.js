// B3: لایه‌ی ایمنی ریست — نقش، Go-Live، تأیید دوگانه، re-auth با کد تلگرام، epoch در /me، rate limit، اعلان.
const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const config = require('../src/config');
const F = require('./helpers/factories');
const svc = require('../src/services/resetService');
const settingsRepo = require('../src/repositories/settingsRepository');
const panelLoginCodes = require('../src/utils/panelLoginCodes');
const { createRateLimiter } = require('../src/middleware/rateLimiter');
const { fakeReq, fakeRes } = require('./helpers/factories');

describe('گیت‌های ریست (B3) — سرویس', () => {
  let db; let admin; let manager; let emp;
  const code = (u) => panelLoginCodes.issueCode(u.id).code;
  const ok = (u, extra = {}) => ({ confirmText: 'RESET', reauthCode: code(u), ...extra });

  before(() => {
    db = resetDb();
    config.monitor.backupDir = path.join(tmpDir, 'bk');
    admin = F.makeUser({ role: 'admin' });
    manager = F.makeUser({ role: 'manager' });
    emp = F.makeUser();
  });
  after(cleanup);

  test('نقش غیرادمین ⇒ ۴۰۳ (حتی با همه‌ی تأییدها)', () => {
    for (const u of [manager, emp, F.makeUser({ role: 'hr' })]) {
      const r = svc.checkResetRequest(ok(u), u);
      assert.deepEqual([r.ok, r.status, r.code], [false, 403, 'forbidden']);
    }
    assert.equal(svc.checkResetRequest(ok(admin), null).status, 403);
  });

  test('بدون تأیید/با تأیید اشتباه ⇒ ۴۰۰ و کد re-auth سوخته نمی‌شود', () => {
    const c = code(admin);
    for (const confirmText of [undefined, '', 'reset', 'RESET!', 'yes']) {
      const r = svc.checkResetRequest({ confirmText, reauthCode: c }, admin);
      assert.deepEqual([r.ok, r.status, r.code], [false, 400, 'confirm_required']);
    }
    // همان کد هنوز معتبر است
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: c }, admin).ok, true);
  });

  test('عبارت فارسی «ریست» (با ی/ک عربی هم) پذیرفته می‌شود', () => {
    assert.equal(svc.checkResetRequest({ confirmText: ' ریست ', reauthCode: code(admin) }, admin).ok, true);
    assert.equal(svc.checkResetRequest({ confirmText: 'ريست', reauthCode: code(admin) }, admin).ok, true);
  });

  test('re-auth: نبودن کد ⇒ ۴۰۰؛ کد اشتباه/کد کاربر دیگر/مصرف‌شده ⇒ ۴۰۳؛ کد درست یک‌بارمصرف', () => {
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET' }, admin).code, 'reauth_required');
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: '12345678' }, admin).code, 'reauth_invalid');
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: 'abc' }, admin).code, 'reauth_invalid');
    const otherCode = code(manager);
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: otherCode }, admin).code, 'reauth_invalid');
    assert.equal(panelLoginCodes.consumeCode(otherCode), manager.id, 'کد سرپرست با تلاش ادمین سوخته نشد');
    const c = code(admin);
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: c }, admin).ok, true);
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: c }, admin).code, 'reauth_invalid');
  });

  test('ورودی نامعتبر (گروه/تاریخ) ⇒ ۴۰۰ قبل از مصرف کد re-auth', () => {
    const c = code(admin);
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: c, groups: ['users'] }, admin).code, 'INVALID_GROUPS');
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: c, beforeDate: 'x' }, admin).code, 'INVALID_DATE');
    assert.equal(svc.checkResetRequest({ confirmText: 'RESET', reauthCode: c }, admin).ok, true);
  });

  test('Go-Live: روشن ⇒ ۴۰۳ مگر ALLOW_DATA_RESET=true؛ خاموش ⇒ آزاد', () => {
    assert.equal(svc.isResetLocked(), false);
    settingsRepo.setValue('systemGoLive', true);
    try {
      assert.equal(svc.isResetLocked(), true);
      const r = svc.checkResetRequest(ok(admin), admin);
      assert.deepEqual([r.ok, r.status, r.code], [false, 403, 'go_live_locked']);
      config.allowDataReset = true;
      assert.equal(svc.isResetLocked(), false);
      assert.equal(svc.checkResetRequest(ok(admin), admin).ok, true);
    } finally {
      config.allowDataReset = false;
      settingsRepo.setValue('systemGoLive', false);
    }
  });

  test('تنظیم systemGoLive: پیش‌فرض false در گروه امنیت', () => {
    const item = settingsRepo.getItem('systemGoLive');
    assert.equal(item.type, 'boolean');
    assert.equal(item.group, 'security');
    assert.equal(item.value, false);
  });

  test('reset_epoch: شروع از ۰، با هر ریست موفق +۱', async () => {
    const e0 = settingsRepo.getResetEpoch();
    assert.equal(e0, 0);
    const r = await svc.executeReset({ groups: ['jobs'] }, { actor: admin.id });
    assert.equal(r.resetEpoch, 1);
    assert.equal(settingsRepo.getResetEpoch(), 1);
  });

  test('rate limit ریست: چهارمین تلاش در ساعت ⇒ ۴۲۹ (همان تنظیم route)', () => {
    const store = (() => { const m = new Map(); return { hit: (l, k, w, now) => { const id = `${l}|${k}`; const b = m.get(id) || { count: 0, resetAt: now + w }; b.count += 1; m.set(id, b); return b; } }; })();
    const lim = createRateLimiter({ name: 'system-reset-test', windowMs: 3600000, max: 3, message: 'x', keyFn: () => `reset:${admin.id}`, store, audit: false });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = fakeRes(); res.set = () => res; res.setHeader = () => res;
      let passed = false;
      lim(fakeReq({ method: 'POST', url: '/api/admin/system/reset' }), res, () => { passed = true; });
      statuses.push(passed ? 200 : res.statusCode);
    }
    assert.deepEqual(statuses, [200, 200, 200, 429]);
  });

  test('اعلان تلگرام: متن شامل انجام‌دهنده/تعداد/بک‌آپ و شکست ارسال خطا نمی‌دهد', async () => {
    const notifier = require('../src/bot/notifier');
    const sent = [];
    const real = notifier.sendMessage;
    db.prepare("UPDATE users SET telegram_user_id = telegram_user_id WHERE id = ?").run(admin.id);
    notifier.sendMessage = async (chat, text) => { sent.push([chat, text]); return true; };
    try {
      const n = await svc.notifyAdminsOfReset({ total: 5, beforeDate: null, backup: { file: 'pre-reset-x.db' } }, admin);
      assert.equal(n, sent.length);
      assert.ok(sent.length >= 1);
      assert.match(sent[0][1], /ریست برنامه[\s\S]*5[\s\S]*pre-reset-x\.db/);
      notifier.sendMessage = async () => { throw new Error('tg down'); };
      assert.equal(await svc.notifyAdminsOfReset({ total: 1, backup: { file: 'f' } }, admin), 0);
    } finally { notifier.sendMessage = real; }
  });
});

// ---- روی سرور واقعی (نیاز به express؛ وگرنه skip) ----
let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('ریست روی routeهای واقعی (B3)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let u; let admin;
  const maintenance = require('../src/utils/maintenanceMode');
  before(async () => {
    resetDb();
    config.monitor.backupDir = path.join(tmpDir, 'bk2');
    u = F.makeUser();
    admin = F.makeUser({ role: 'admin' });
    S = await require('./helpers/miniappClient').startServer();
  });
  after(() => { if (S) S.close(); });

  test('/miniapp/me مقدار reset_epoch را برمی‌گرداند و بعد از ریست زیاد می‌شود', async () => {
    const a = await S.call(u, 'GET', 'me');
    assert.equal(a.json.reset_epoch, 0);
    await svc.executeReset({ groups: ['jobs'] }, { actor: admin.id });
    assert.equal((await S.call(u, 'GET', 'me')).json.reset_epoch, 1);
  });

  test('حالت نگهداری: ثبت تردد ۵۰۳ با code=maintenance؛ خواندن‌ها آزاد', async () => {
    maintenance.enter('test');
    try {
      const r = await S.call(u, 'POST', 'check-in', {});
      assert.equal(r.status, 503);
      assert.equal(r.json.code, 'maintenance');
      assert.equal((await S.call(u, 'POST', 'break/start', {})).status, 503);
      assert.equal((await S.call(u, 'GET', 'today')).status, 200);
    } finally { maintenance.leave(); }
    assert.equal((await S.call(u, 'POST', 'check-in', {})).status, 201);
  });
});
