// S3-8c: عبارت‌های cron در رجیستری تنظیمات + scheduler.reload() (توقف/ساخت مجدد با اعتبارسنجی) + فراخوانی بعد از ذخیره‌ی تنظیمات.
// node-cron با mock.method جایگزین می‌شود تا هیچ تایمر واقعی ساخته نشود (تست زنده‌ی تایمر واقعی: schedulerReloadLive.test.js).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const cron = require('node-cron');
const config = require('../src/config');
const registry = require('../src/utils/settingsRegistry');
const settingsRepo = require('../src/repositories/settingsRepository');
const scheduler = require('../src/bot/scheduler');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const DEFAULT = '0 17 * * *';
const NEW_EXPR = '30 18 * * 0-4';

describe('زمان‌بندی از رجیستری و reload (S3-8c)', () => {
  let db; let tasks; let sched;

  before(() => { db = resetDb(); });
  after(() => cleanup());
  beforeEach(() => {
    db.prepare("DELETE FROM settings WHERE key LIKE 'cron_%'").run();
    tasks = [];
    sched = mock.method(cron, 'schedule', (expr, fn) => {
      const t = { expr, fn, stopped: false, stop() { this.stopped = true; } };
      tasks.push(t);
      return t;
    });
  });
  afterEach(() => { scheduler.stopSchedulers(); mock.restoreAll(); });

  test('رجیستری: ۱۳ کلید cron با پیش‌فرض .env/کد؛ ذخیره غالب است، reset به پیش‌فرض برمی‌گرداند، نامعتبر رد می‌شود، .env خراب ⇒ fallback', () => {
    assert.deepEqual(registry.selfCheck(), []);
    const jobs = registry.cronJobs();
    assert.equal(jobs.length, 13);
    assert.deepEqual(jobs.map((j) => j.job).filter((n) => n !== 'watchdog'), Object.keys(config.cron), 'همه‌ی Jobهای config.cron، هم‌ترتیب');
    jobs.forEach(({ job, key }) => assert.equal(registry.defaultOf(key), job === 'watchdog' ? config.monitor.watchdogCron : config.cron[job], key));
    assert.equal(registry.getDef('cronDailyReport').group, 'schedule');

    assert.equal(settingsRepo.getCronExpressions().dailyReport, DEFAULT);
    settingsRepo.setValue('cronDailyReport', `  ${NEW_EXPR} `);
    assert.equal(settingsRepo.getCronExpressions().dailyReport, NEW_EXPR, 'trim و ذخیره');
    assert.equal(registry.validate('cronDailyReport', 'هر روز').ok, false);
    assert.equal(registry.validate('cronDailyReport', '61 * * * *').ok, false);
    assert.throws(() => settingsRepo.setValue('cronDailyReport', 'abc'), /نامعتبر/);
    assert.equal(settingsRepo.resetValue('cronDailyReport'), true);
    assert.equal(settingsRepo.getCronExpressions().dailyReport, DEFAULT);

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cron_daily_report', 'خراب')").run(); // مقدار خراب در DB ⇒ پیش‌فرض
    assert.equal(settingsRepo.getCronExpressions().dailyReport, DEFAULT);
    const saved = config.cron.dailyReport;
    config.cron.dailyReport = 'not a cron'; // غلط تایپی در .env ⇒ fallback کد، نه exception
    try { assert.equal(registry.defaultOf('cronDailyReport'), '0 17 * * *'); } finally { config.cron.dailyReport = saved; }
  });

  test('reload: قبل از شروع کاری نمی‌کند؛ بدون تغییر ⇒ هیچ Jobی دست نمی‌خورد؛ تغییر یک cron ⇒ فقط همان Job ساخته و قبلی متوقف؛ عبارت نامعتبر زمان‌بندی فعلی را نمی‌شکند', async () => {
    assert.deepEqual(scheduler.reload(), { reloaded: false, reason: 'scheduler_not_started', changed: [], errors: [] });

    scheduler.startSchedulers({ sendMessage: async () => {} });
    const names = scheduler.jobNames();
    assert.equal(names.length, 13);
    assert.equal(sched.mock.callCount(), 13);
    assert.equal(scheduler.activeCrons().dailyReport, DEFAULT);

    assert.deepEqual(scheduler.reload(), { reloaded: true, changed: [], errors: [] });
    assert.equal(sched.mock.callCount(), 13, 'بدون تغییر ⇒ ساخت مجدد ندارد');
    assert.equal(tasks.filter((t) => t.stopped).length, 0);

    settingsRepo.setValue('cronDailyReport', NEW_EXPR);
    const r = scheduler.reload();
    assert.deepEqual(r, { reloaded: true, changed: [{ job: 'dailyReport', from: DEFAULT, to: NEW_EXPR }], errors: [] });
    assert.equal(sched.mock.callCount(), 14);
    assert.deepEqual(tasks.filter((t) => t.stopped).map((t) => t.expr), [DEFAULT], 'فقط تسک قبلی همان Job متوقف شد');
    assert.equal(tasks[13].expr, NEW_EXPR);
    assert.equal(scheduler.activeCrons().dailyReport, NEW_EXPR);

    // callback ثبت‌شده همان Job است و با wrapJob در job_runs ثبت می‌شود
    const idx = names.indexOf('autoCloseIncomplete');
    assert.deepEqual(await tasks[idx].fn(), { ok: true });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE job_name = 'autoCloseIncomplete' AND status = 'success'").get().n, 1);

    // عبارت نامعتبر (مثلاً خرابیِ غیرمنتظره‌ی لایه‌ی تنظیمات): خطا گزارش می‌شود، زمان‌بندی قبلی می‌ماند و بقیه‌ی Jobها اعمال می‌شوند
    const realGet = settingsRepo.getCronExpressions;
    const errLog = mock.method(console, 'error', () => {});
    mock.method(settingsRepo, 'getCronExpressions', () => ({ ...realGet(), dailyReport: 'bad cron', weeklyReport: '0 9 * * 6' }));
    const bad = scheduler.reload();
    assert.deepEqual(bad.changed, [{ job: 'weeklyReport', from: '0 8 * * 6', to: '0 9 * * 6' }]);
    assert.equal(bad.errors.length, 1);
    assert.equal(bad.errors[0].job, 'dailyReport');
    assert.equal(scheduler.activeCrons().dailyReport, NEW_EXPR, 'زمان‌بندی قبلی حفظ شد');
    assert.ok(tasks.filter((t) => t.expr === NEW_EXPR).every((t) => !t.stopped));
    assert.ok(errLog.mock.callCount() >= 1);

    scheduler.stopSchedulers();
    assert.equal(tasks.every((t) => t.stopped), true, 'stopSchedulers همه را متوقف می‌کند');
    assert.deepEqual(scheduler.activeCrons(), {});
  });

  test('API: PUT/reset/PATCH تنظیم cron بلافاصله reload می‌کند؛ نامعتبر ⇒ ۴۰۰ بدون reload؛ تنظیم غیر cron ⇒ بدون reload؛ وضعیت سیستم cron مؤثر را نشان می‌دهد', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, async () => {
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const manager = makeUser({ role: 'manager' });
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const hit = async (who, method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: sessionCookie(who.id) }, body: body ? JSON.stringify(body) : undefined });
      let json = null;
      try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
      return { status: res.status, json };
    };
    const put = (key, value) => hit(admin, 'PUT', `/api/admin/settings/${key}`, { value, reason: 'تست زمان‌بندی' });
    try {
      // پروسه‌ای که زمان‌بندی را بالا نیاورده (مثلاً فقط API): ذخیره می‌شود، reload بی‌اثر گزارش می‌شود
      const early = await put('cronDailyReport', NEW_EXPR);
      assert.equal(early.status, 200);
      assert.equal(early.json.scheduler.reason, 'scheduler_not_started');
      assert.equal((await put('cronDailyReport', DEFAULT)).json.item.value, DEFAULT);

      scheduler.startSchedulers({ sendMessage: async () => {} });
      const base12 = sched.mock.callCount();

      const r1 = await put('cronDailyReport', NEW_EXPR);
      assert.equal(r1.status, 200);
      assert.deepEqual(r1.json.scheduler, { reloaded: true, changed: [{ job: 'dailyReport', from: DEFAULT, to: NEW_EXPR }], errors: [] });
      assert.equal(sched.mock.callCount(), base12 + 1);
      assert.equal(scheduler.activeCrons().dailyReport, NEW_EXPR);

      const bad = await put('cronDailyReport', 'every day');
      assert.equal(bad.status, 400);
      assert.equal(scheduler.activeCrons().dailyReport, NEW_EXPR);
      assert.equal(sched.mock.callCount(), base12 + 1, 'نامعتبر ⇒ reload نشد');
      assert.equal((await hit(manager, 'PUT', '/api/admin/settings/cronDailyReport', { value: DEFAULT, reason: 'x' })).status, 403);

      const same = await put('cronDailyReport', NEW_EXPR);
      assert.equal(same.json.changed, false);
      assert.equal('scheduler' in same.json, false);

      const other = await put('workDayStart', '07:30');
      assert.equal(other.json.changed, true);
      assert.equal('scheduler' in other.json, false, 'تنظیم غیر cron ⇒ reload نمی‌شود');

      const status = await hit(admin, 'GET', '/api/admin/system/status');
      assert.equal(status.status, 200);
      assert.equal(status.json.jobs.find((j) => j.name === 'dailyReport').cron, NEW_EXPR, 'صفحه‌ی وضعیت سیستم cron مؤثر را نشان می‌دهد');

      const patch = await hit(admin, 'PATCH', '/api/admin/settings', { cronNightlyReview: '0 21 * * *' });
      assert.equal(patch.status, 200);
      assert.equal(patch.json.cronNightlyReview, '0 21 * * *', 'شکل پاسخ PATCH قدیمی (آبجکت تخت) حفظ شد');
      assert.equal(scheduler.activeCrons().nightlyReview, '0 21 * * *');
      await hit(admin, 'PATCH', '/api/admin/settings', { cronNightlyReview: 'خراب' }); // نامعتبر در PATCH قدیمی بی‌صدا نادیده می‌شود (رفتار قبلی)
      assert.equal(scheduler.activeCrons().nightlyReview, '0 21 * * *');

      const reset = await hit(admin, 'POST', '/api/admin/settings/cronDailyReport/reset', { reason: 'بازگشت' });
      assert.equal(reset.status, 200);
      assert.deepEqual(reset.json.scheduler.changed, [{ job: 'dailyReport', from: NEW_EXPR, to: DEFAULT }]);
      assert.equal(scheduler.activeCrons().dailyReport, DEFAULT);
    } finally {
      server.close();
    }
  });
});
