// S3-8c: تست «زنده» با تایمر واقعی node-cron: تغییر cron از مسیر تنظیمات + reload، بدون ری‌استارت پروسه، بلافاصله اثر می‌کند.
// از عبارت ۶ فیلدی (ثانیه) استفاده می‌شود تا تست چند ثانیه طول بکشد. Job آزمایشی autoCloseIncomplete است (روی DB خالی بی‌اثر).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const settingsRepo = require('../src/repositories/settingsRepository');
const registry = require('../src/utils/settingsRegistry');
const scheduler = require('../src/bot/scheduler');

const FAR = '0 0 1 1 *'; // اول ژانویه؛ در طول تست هرگز اجرا نمی‌شود
const EVERY_SECOND = '* * * * * *';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('تغییر cron بدون ری‌استارت — تایمر واقعی (S3-8c)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(() => { scheduler.stopSchedulers(); cleanup(); });
  const runs = () => db.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE job_name = 'autoCloseIncomplete'").get().n;

  test('Job با cron دورِ آینده اجرا نمی‌شود؛ بعد از تغییر به هر ثانیه و reload اجرا می‌شود؛ با برگرداندن cron و reload دوباره می‌ایستد', async () => {
    registry.cronJobs().forEach(({ key }) => settingsRepo.setValue(key, FAR)); // هیچ Job دیگری وسط تست اجرا نشود
    scheduler.startSchedulers({ sendMessage: async () => {} });
    await sleep(1100);
    assert.equal(runs(), 0, 'cron آینده‌ی دور ⇒ اجرایی نیست');

    settingsRepo.setValue('cronAutoCloseIncomplete', EVERY_SECOND);
    assert.deepEqual(scheduler.reload().changed, [{ job: 'autoCloseIncomplete', from: FAR, to: EVERY_SECOND }]);
    await sleep(2100);
    const during = runs();
    assert.ok(during >= 1, `بعد از reload باید اجرا شود (اجراها: ${during})`);

    settingsRepo.setValue('cronAutoCloseIncomplete', FAR);
    assert.equal(scheduler.reload().changed.length, 1);
    await sleep(150); // اجرای در حال انجام (اگر بود) تمام شود
    const frozen = runs();
    await sleep(2100);
    assert.equal(runs(), frozen, 'بعد از برگرداندن cron و reload اجرای تازه‌ای نیست');
  });
});
