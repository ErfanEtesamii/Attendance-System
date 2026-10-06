// بخش ۲-ج۱: مانیتورینگ و هشدار — job_runs، wrapper، نبض polling، سلامت سیستم، watchdog (با بات ماک‌شده)،
// /api/health عمومی و /api/admin/system/status (فقط ادمین).
const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const config = require('../src/config');

// از S2-1c پیش‌فرض MONITOR_BACKUP_CHECK روشن است؛ این فایل روی بقیه‌ی بررسی‌ها (db/bot/disk/jobs) تمرکز دارد و پوشه‌ی بک‌آپ ندارد،
// پس بررسی بک‌آپ را خاموش نگه می‌دارد. رفتار بک‌آپ/.suspect در test/backup.test.js و تست «بک‌آپ» همین فایل (با روشن‌کردن صریح) پوشش داده می‌شود.
config.monitor.backupCheck = false;
const jobRunsRepository = require('../src/repositories/jobRunsRepository');
const monitorRepository = require('../src/repositories/monitorRepository');
const { wrapJob, runAll } = require('../src/utils/jobRunner');
const botHealth = require('../src/utils/botHealth');
const systemHealth = require('../src/utils/systemHealth');
const { sanitizeText } = require('../src/utils/sanitize');
const { runWatchdog, _resetMemory } = require('../src/bot/scheduler/watchdog');
const { getDb } = require('../src/db/connection');
const { makeUser } = require('./helpers/factories');

const FAKE_TOKEN = '123456789:AAFakeTokenFakeTokenFakeTokenFake_123'; // secret-scan:allow (مقدار ساختگی تست)
const HOUR = 3600 * 1000;

function mockBot({ failFor = [] } = {}) {
  return {
    sent: [],
    async sendMessage(chatId, text) {
      if (failFor.includes(String(chatId))) throw new Error('blocked');
      this.sent.push({ chatId: String(chatId), text });
    },
  };
}

const rows = (sql, ...p) => getDb().prepare(sql).all(...p);

describe('migration 004 — جدول‌های مانیتورینگ', () => {
  before(() => resetDb());
  after(() => cleanup());

  test('جدول‌ها ساخته شده‌اند و باقی ساختار دست‌نخورده است', () => {
    const names = rows("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    for (const t of ['job_runs', 'monitor_alerts', 'monitor_state', 'users', 'audit_log', 'attendance_records']) assert.ok(names.includes(t), t);
    assert.ok(rows('SELECT name FROM schema_migrations').some((r) => r.name === '004_monitoring'));
  });

  test('CHECK روی status: مقدار نامعتبر رد می‌شود', () => {
    assert.throws(() => getDb().prepare("INSERT INTO job_runs (job_name, started_at, status) VALUES ('x','2026-01-01','bogus')").run());
  });
});

describe('sanitizeText', () => {
  test('توکن بات حتی داخل URL حذف می‌شود و طول محدود می‌ماند', () => {
    const out = sanitizeText(`ETIMEDOUT https://api.telegram.org/bot${FAKE_TOKEN}/getUpdates`);
    assert.ok(!out.includes('AAFake'));
    assert.ok(out.includes('[REDACTED]'));
    assert.equal(sanitizeText('x'.repeat(900)).length, 501);
    assert.equal(sanitizeText(null), '');
  });
});

describe('wrapJob / job_runs', () => {
  before(() => resetDb());
  beforeEach(() => getDb().exec('DELETE FROM job_runs'));
  after(() => cleanup());

  test('اجرای موفق: ردیف success با مدت ثبت می‌شود', async () => {
    const res = await wrapJob('okJob', async () => { await new Promise((r) => setTimeout(r, 5)); })();
    assert.deepEqual(res, { ok: true });
    const [r] = rows("SELECT * FROM job_runs WHERE job_name='okJob'");
    assert.equal(r.status, 'success');
    assert.ok(r.finished_at && r.duration_ms >= 0 && r.error === null);
  });

  test('اجرای شکست‌خورده: ردیف error، بدون throw، و توکن داخل خطا حذف می‌شود', async () => {
    const res = await wrapJob('badJob', () => { throw new Error(`fail https://api.telegram.org/bot${FAKE_TOKEN}/x`); })();
    assert.equal(res.ok, false);
    const [r] = rows("SELECT * FROM job_runs WHERE job_name='badJob'");
    assert.equal(r.status, 'error');
    assert.ok(r.error.includes('fail') && !r.error.includes('AAFake'));
  });

  test('Job همگام (sync) هم پشتیبانی می‌شود و reject هم خطا ثبت می‌کند', async () => {
    await wrapJob('syncJob', () => 1)();
    await wrapJob('rejJob', () => Promise.reject(new Error('boom')))();
    assert.equal(rows("SELECT status FROM job_runs WHERE job_name='syncJob'")[0].status, 'success');
    assert.equal(rows("SELECT status FROM job_runs WHERE job_name='rejJob'")[0].status, 'error');
  });

  test('recordSuccess=false: موفقیت ثبت نمی‌شود ولی شکست ثبت می‌شود', async () => {
    await wrapJob('quiet', () => {}, { recordSuccess: false })();
    assert.equal(rows("SELECT * FROM job_runs WHERE job_name='quiet'").length, 0);
    await wrapJob('quiet', () => { throw new Error('x'); }, { recordSuccess: false })();
    assert.equal(rows("SELECT status FROM job_runs WHERE job_name='quiet'").map((r) => r.status).join(), 'error');
  });

  test('runAll: همه‌ی کارها اجرا می‌شوند حتی اگر یکی شکست بخورد، و خطا throw می‌شود', async () => {
    let secondRan = false;
    await assert.rejects(runAll(() => { throw new Error('اولی'); }, async () => { secondRan = true; }), /اولی/);
    assert.ok(secondRan);
  });

  test('markInterrupted: running → interrupted (و خطا حساب نمی‌شود)', () => {
    const id = jobRunsRepository.start('hung');
    assert.equal(jobRunsRepository.markInterrupted(), 1);
    assert.equal(rows('SELECT status FROM job_runs WHERE id=?', id)[0].status, 'interrupted');
    assert.equal(jobRunsRepository.latestResultPerJob().length, 0, 'interrupted نتیجه‌ی Job نیست');
  });

  test('خطای دیتابیس هنگام ثبت، Job را مختل نمی‌کند', async () => {
    const orig = jobRunsRepository.start;
    jobRunsRepository.start = () => { throw new Error('db down'); };
    try {
      let ran = false;
      const res = await wrapJob('x', () => { ran = true; })();
      assert.ok(ran && res.ok);
    } finally { jobRunsRepository.start = orig; }
  });
});

describe('botHealth — نبض polling', () => {
  beforeEach(() => botHealth._reset());

  test('بدون instrument (حالت فقط-API): اعمال‌نشدنی و سالم', () => {
    assert.deepEqual(botHealth.getPollingStatus(), { applicable: false, ok: true });
  });

  test('getUpdates موفق/ناموفق ثبت می‌شود؛ قدیمی‌شدن = قطع', async () => {
    let fail = false;
    const bot = { getUpdates: async () => { if (fail) throw new Error(`net https://x/bot${FAKE_TOKEN}`); return []; } };
    const t0 = Date.now();
    botHealth.instrumentBot(bot, t0);
    botHealth.instrumentBot(bot, t0); // دوباره‌ی بی‌اثر (دو بار پیچیده نشود)
    assert.equal(botHealth.getPollingStatus({ staleSeconds: 120, now: t0 + 60_000 }).ok, true, 'در مهلت اول بعد از اتصال سالم است');
    assert.equal(botHealth.getPollingStatus({ staleSeconds: 120, now: t0 + 200_000 }).ok, false, 'هیچ موفقیتی نبوده و مهلت تمام شده');

    await bot.getUpdates();
    const ok = botHealth.getPollingStatus({ staleSeconds: 120 });
    assert.equal(ok.ok, true);
    assert.equal(ok.consecutiveErrors, 0);

    fail = true;
    await assert.rejects(bot.getUpdates(), /net/);
    await assert.rejects(bot.getUpdates(), /net/);
    const st = botHealth.getPollingStatus({ staleSeconds: 120 });
    assert.equal(st.consecutiveErrors, 2);
    assert.ok(st.lastError.includes('[REDACTED]') && !st.lastError.includes('AAFake'));
    assert.equal(botHealth.getPollingStatus({ staleSeconds: 120, now: Date.now() + 300_000 }).ok, false);
  });
});

describe('systemHealth — دیسک، بک‌آپ، Jobها', () => {
  before(() => resetDb());
  beforeEach(() => { getDb().exec('DELETE FROM job_runs'); botHealth._reset(); });
  after(() => cleanup());

  const saved = { ...config.monitor };
  const restore = () => Object.assign(config.monitor, saved);

  test('وضعیت پایه: ok و همه‌ی بررسی‌ها حاضرند', () => {
    const r = systemHealth.collect();
    assert.equal(r.status, 'ok');
    for (const k of ['db', 'bot', 'disk', 'backup', 'jobs']) assert.ok(k in r.checks, k);
    assert.equal(r.checks.db.ok, true);
  });

  test('فضای دیسک: آستانه‌ی بسیار بزرگ ⇒ degraded', () => {
    config.monitor.diskMinFreeMb = 1e12;
    try {
      const r = systemHealth.collect();
      if (!r.checks.disk.applicable) return; // statfs در این محیط نیست
      assert.equal(r.checks.disk.ok, false);
      assert.equal(r.status, 'degraded');
    } finally { restore(); }
  });

  test('بک‌آپ: بررسی خاموش ⇒ ok؛ روشن بدون بک‌آپ ⇒ degraded؛ pre-migration حساب نمی‌شود؛ بک‌آپ تازه ⇒ ok؛ قدیمی ⇒ degraded', () => {
    const dir = path.join(tmpDir, 'bk');
    fs.mkdirSync(dir, { recursive: true });
    config.monitor.backupDir = dir;
    try {
      config.monitor.backupCheck = false;
      assert.equal(systemHealth.collect().checks.backup.ok, true);

      config.monitor.backupCheck = true;
      assert.equal(systemHealth.collect().checks.backup.ok, false);

      fs.writeFileSync(path.join(dir, 'pre-migration-2026.db'), 'x');
      assert.equal(systemHealth.collect().checks.backup.ok, false, 'pre-migration نباید بک‌آپ روزانه حساب شود');
      fs.writeFileSync(path.join(dir, 'pre-restore-20260101-000000.db'), 'x');
      assert.equal(systemHealth.collect().checks.backup.ok, false, 'pre-restore نباید بک‌آپ روزانه حساب شود');

      const daily = path.join(dir, 'daily-2026-10-06.db');
      fs.writeFileSync(daily, 'x');
      const fresh = systemHealth.collect();
      assert.equal(fresh.checks.backup.ok, true);
      assert.equal(fresh.checks.backup.lastBackupFile, 'daily-2026-10-06.db');

      const old = new Date(Date.now() - 100 * HOUR);
      fs.utimesSync(daily, old, old);
      assert.equal(systemHealth.collect().checks.backup.ok, false);
    } finally { restore(); }
  });

  test('شکست Job داخل پنجره ⇒ degraded؛ بعد از موفقیت بعدی ⇒ ok؛ شکست قدیمی‌تر از پنجره نادیده', async () => {
    await wrapJob('dailyReport', () => { throw new Error('گزارش خراب'); })();
    let r = systemHealth.collect();
    assert.equal(r.status, 'degraded');
    assert.equal(r.checks.jobs.failing[0].job, 'dailyReport');

    await wrapJob('dailyReport', () => {})();
    assert.equal(systemHealth.collect().status, 'ok');

    await wrapJob('weeklyReport', () => { throw new Error('x'); })();
    r = systemHealth.collect({ now: Date.now() + (config.monitor.jobFailureWindowHours + 1) * HOUR });
    assert.equal(r.checks.jobs.ok, true, 'شکست خیلی قدیمی وضعیت را degraded نگه نمی‌دارد');
  });

  test('deep=true: quick_check اجرا می‌شود و سالم است', () => {
    assert.equal(systemHealth.collect({ deep: true }).checks.db.ok, true);
  });
});

describe('watchdog — هشدار تلگرامی (بات ماک‌شده)', () => {
  let admin1; let admin2; let employee; let inactiveAdmin;
  before(() => {
    resetDb();
    admin1 = makeUser({ role: 'admin' });
    admin2 = makeUser({ role: 'admin' });
    inactiveAdmin = makeUser({ role: 'admin', active: false });
    employee = makeUser({ role: 'employee' });
  });
  beforeEach(() => {
    getDb().exec('DELETE FROM job_runs; DELETE FROM monitor_alerts;');
    botHealth._reset();
    _resetMemory();
  });
  after(() => cleanup());

  const adminIds = () => [admin1, admin2].map((u) => String(u.telegram_user_id));

  test('سالم: هیچ پیامی ارسال نمی‌شود', async () => {
    const bot = mockBot();
    const r = await runWatchdog({ bot });
    assert.equal(r.status, 'ok');
    assert.equal(bot.sent.length, 0);
  });

  test('شکست عمدی یک Job ⇒ ثبت در job_runs + هشدار فقط به ادمین‌های فعال (نه کارمند/ادمین غیرفعال)', async () => {
    await wrapJob('nightlyReview', () => { throw new Error(`خطا https://api.telegram.org/bot${FAKE_TOKEN}/x`); })();
    assert.equal(rows("SELECT status FROM job_runs WHERE job_name='nightlyReview'")[0].status, 'error');

    const bot = mockBot();
    const r = await runWatchdog({ bot });
    assert.deepEqual(r.alertsSent, ['job_failed:nightlyReview']);
    assert.deepEqual(bot.sent.map((m) => m.chatId).sort(), adminIds().sort());
    assert.ok(!bot.sent.some((m) => [employee, inactiveAdmin].map((u) => String(u.telegram_user_id)).includes(m.chatId)));
    assert.match(bot.sent[0].text, /nightlyReview/);
    assert.ok(!bot.sent[0].text.includes('AAFake'), 'توکن نباید داخل پیام هشدار برود');
    assert.equal(monitorRepository.getAlert('job_failed:nightlyReview').state, 'firing');
  });

  test('throttle: اجرای دوباره‌ی نزدیک ⇒ هشدار تکراری نمی‌رود؛ شکست Job بعد از ۲۴ ساعت یادآوری می‌شود', async () => {
    await wrapJob('dailyReport', () => { throw new Error('x'); })();
    const bot = mockBot();
    const t0 = Date.now();
    await runWatchdog({ bot, now: t0 });
    const first = bot.sent.length;
    await runWatchdog({ bot, now: t0 + 5 * 60 * 1000 });
    await runWatchdog({ bot, now: t0 + 2 * HOUR });
    assert.equal(bot.sent.length, first, 'Job: ساعتی تکرار نمی‌شود');
    // شکست باید هنوز داخل پنجره‌ی ۷۲ساعته باشد؛ now همان ۲۵ ساعت بعد
    await runWatchdog({ bot, now: t0 + 25 * HOUR });
    assert.equal(bot.sent.length, first * 2, 'بعد از ۲۴ ساعت یک یادآوری');
  });

  test('رفع مشکل ⇒ یک پیام «رفع شد» و بعد از آن سکوت؛ بروز دوباره ⇒ هشدار تازه', async () => {
    await wrapJob('dailyReport', () => { throw new Error('x'); })();
    const bot = mockBot();
    await runWatchdog({ bot });
    const afterAlert = bot.sent.length;

    await wrapJob('dailyReport', () => {})(); // اجرای بعدی موفق
    const r = await runWatchdog({ bot });
    assert.deepEqual(r.recovered, ['job_failed:dailyReport']);
    assert.equal(bot.sent.length, afterAlert + adminIds().length);
    assert.match(bot.sent[bot.sent.length - 1].text, /رفع شد/);
    assert.equal(monitorRepository.getAlert('job_failed:dailyReport').state, 'ok');

    await runWatchdog({ bot });
    assert.equal(bot.sent.length, afterAlert + adminIds().length, 'بعد از رفع، پیام دیگری نمی‌رود');

    await wrapJob('dailyReport', () => { throw new Error('دوباره'); })();
    const r2 = await runWatchdog({ bot });
    assert.deepEqual(r2.alertsSent, ['job_failed:dailyReport'], 'خرابی تازه بلافاصله هشدار می‌دهد');
  });

  test('قطع polling بات ⇒ هشدار bot_polling؛ برگشت ⇒ رفع شد', async () => {
    const fake = { getUpdates: async () => [] };
    const t0 = Date.now();
    botHealth.instrumentBot(fake, t0 - 10 * 60 * 1000); // ۱۰ دقیقه پیش وصل شده و هیچ موفقیتی نبوده
    const bot = mockBot();
    const r = await runWatchdog({ bot, now: t0 });
    assert.deepEqual(r.alertsSent, ['bot_polling']);
    assert.match(bot.sent[0].text, /polling/);

    await fake.getUpdates(); // polling برگشت
    const r2 = await runWatchdog({ bot, now: Date.now() });
    assert.deepEqual(r2.recovered, ['bot_polling']);
  });

  test('دیسک کم ⇒ disk_low (با collect تزریقی)', async () => {
    const collect = () => ({
      status: 'degraded',
      checks: { db: { ok: true }, bot: { applicable: false, ok: true }, disk: { applicable: true, ok: false, freeMb: 100, minFreeMb: 1024 }, backup: { applicable: false, ok: true }, jobs: { ok: true, failing: [] } },
    });
    const bot = mockBot();
    const r = await runWatchdog({ bot, collect });
    assert.deepEqual(r.alertsSent, ['disk_low']);
    assert.match(bot.sent[0].text, /100/);
  });

  test('بک‌آپ قدیمی ⇒ backup_stale (با collect تزریقی)', async () => {
    const collect = () => ({
      status: 'degraded',
      checks: { db: { ok: true }, bot: { applicable: false, ok: true }, disk: { applicable: false, ok: true }, backup: { applicable: true, ok: false, ageHours: 80, maxAgeHours: 36, lastBackupAt: 'x' }, jobs: { ok: true, failing: [] } },
    });
    const r = await runWatchdog({ bot: mockBot(), collect });
    assert.deepEqual(r.alertsSent, ['backup_stale']);
  });

  test('هشدار تنها وقتی «ارسال‌شده» حساب می‌شود که حداقل یک ادمین دریافت کرده باشد', async () => {
    await wrapJob('dailyReport', () => { throw new Error('x'); })();
    const deadBot = mockBot({ failFor: adminIds() });
    const r1 = await runWatchdog({ bot: deadBot });
    assert.deepEqual(r1.alertsSent, [], 'هیچ‌کس دریافت نکرد ⇒ ارسال‌شده نیست');
    const okBot = mockBot();
    const r2 = await runWatchdog({ bot: okBot });
    assert.deepEqual(r2.alertsSent, ['job_failed:dailyReport'], 'چرخه‌ی بعد دوباره تلاش می‌کند');
  });

  test('خرابی دیتابیس: هشدار db_error حتی وقتی ذخیره‌ی وضعیت در دیتابیس شکست می‌خورد یک‌بار می‌رود (حافظه) و رفع‌شدنش اعلام می‌شود', async () => {
    const collectBad = () => ({ status: 'degraded', checks: { db: { ok: false, detail: 'disk I/O error' }, bot: { applicable: false, ok: true }, disk: { applicable: false, ok: true }, backup: { applicable: false, ok: true }, jobs: { ok: true, failing: [] } } });
    const collectGood = () => ({ status: 'ok', checks: { db: { ok: true }, bot: { applicable: false, ok: true }, disk: { applicable: false, ok: true }, backup: { applicable: false, ok: true }, jobs: { ok: true, failing: [] } } });

    // شبیه‌سازی دیتابیس خراب: همه‌ی توابع repository مانیتورینگ و فهرست کاربران throw می‌کنند
    const origs = {};
    const usersRepo = require('../src/repositories/usersRepository');
    // یک چرخه‌ی سالم قبلی تا فهرست گیرنده‌ها کش شود
    const warm = mockBot();
    await runWatchdog({ bot: warm, collect: collectGood });
    for (const k of ['getAlert', 'markFiring', 'markSent', 'markOk', 'listAlerts']) {
      origs[k] = monitorRepository[k];
      monitorRepository[k] = () => { throw new Error('db down'); };
    }
    const origList = usersRepo.listUsers;
    usersRepo.listUsers = () => { throw new Error('db down'); };
    const bot = mockBot();
    try {
      const r1 = await runWatchdog({ bot, collect: collectBad });
      assert.deepEqual(r1.alertsSent, ['db_error']);
      assert.equal(bot.sent.length, adminIds().length, 'با فهرست کش‌شده‌ی ادمین‌ها هشدار رفت');
      const r2 = await runWatchdog({ bot, collect: collectBad });
      assert.deepEqual(r2.alertsSent, [], 'در همان حالت هم تکرار نمی‌شود');
    } finally {
      Object.assign(monitorRepository, origs);
      usersRepo.listUsers = origList;
    }
    // دیتابیس برگشت
    const r3 = await runWatchdog({ bot, collect: collectGood });
    assert.deepEqual(r3.recovered, ['db_error']);
    assert.match(bot.sent[bot.sent.length - 1].text, /رفع شد/);
  });

  test('بدون bot (مثلاً حالت فقط-API) خطا نمی‌دهد و وضعیت را ثبت می‌کند', async () => {
    await wrapJob('dailyReport', () => { throw new Error('x'); })();
    const r = await runWatchdog({ bot: null });
    assert.deepEqual(r.firing, ['job_failed:dailyReport']);
    assert.deepEqual(r.alertsSent, []);
  });
});

describe('زمان‌بند — بارگذاری و عبارت‌های cron', () => {
  test('ماژول scheduler بارگذاری می‌شود و cron پیش‌فرض watchdog معتبر است', () => {
    const cron = require('node-cron');
    assert.equal(typeof require('../src/bot/scheduler').startSchedulers, 'function');
    assert.ok(cron.validate(config.monitor.watchdogCron));
    for (const [k, v] of Object.entries(config.cron)) assert.ok(cron.validate(v), `cron نامعتبر: ${k}`);
  });
});

describe('HTTP — /api/health و /api/admin/system/status', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let cookies;
  before(async () => {
    resetDb();
    const { makeUser: mk, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = mk({ role: 'admin' });
    const mgr = mk({ role: 'manager' });
    const emp = mk({ role: 'employee', managerId: mgr.id });
    cookies = { none: undefined, employee: sessionCookie(emp.id), manager: sessionCookie(mgr.id), admin: sessionCookie(admin.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  beforeEach(() => { getDb().exec('DELETE FROM job_runs'); botHealth._reset(); require('../src/api/routes/health')._resetCache(); });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, url) {
    const headers = {};
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { headers });
    let json = null;
    try { json = await res.json(); } catch (_) { /* خالی */ }
    return { status: res.status, json };
  }

  test('/api/health عمومی: فقط status و time (بدون هیچ جزئیات)؛ سالم ⇒ ok', async () => {
    const r = await hit('none', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ['status', 'time']);
    assert.equal(r.json.status, 'ok');
  });

  test('/api/health: شکست Job ⇒ degraded (باز هم ۲۰۰ و بدون جزئیات)', async () => {
    await wrapJob('dailyReport', () => { throw new Error('راز-خطا'); })();
    const r = await hit('none', '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'degraded');
    assert.ok(!JSON.stringify(r.json).includes('dailyReport'));
  });

  test('/api/admin/system/status: بدون سشن ۴۰۱، کارمند ۴۰۳، سرپرست ۴۰۳، ادمین ۲۰۰', async () => {
    assert.equal((await hit('none', '/api/admin/system/status')).status, 401);
    assert.equal((await hit('employee', '/api/admin/system/status')).status, 403);
    assert.equal((await hit('manager', '/api/admin/system/status')).status, 403);
    assert.equal((await hit('admin', '/api/admin/system/status')).status, 200);
  });

  test('/api/admin/system/status (ادمین): ساختار، فهرست Jobها، آخرین خطاها؛ هیچ توکن/رازی در خروجی نیست', async () => {
    await wrapJob('autoCloseIncomplete', () => { throw new Error(`fail https://api.telegram.org/bot${FAKE_TOKEN}/x`); })();
    await wrapJob('markNonWorkingDays', () => {})();
    const r = await hit('admin', '/api/admin/system/status');
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'degraded');
    for (const k of ['db', 'bot', 'disk', 'backup', 'jobs']) assert.ok(k in r.json.checks, k);
    const byName = Object.fromEntries(r.json.jobs.map((j) => [j.name, j]));
    assert.equal(byName.autoCloseIncomplete.lastResult.status, 'error');
    assert.equal(byName.markNonWorkingDays.lastResult.status, 'success');
    assert.equal(byName.dailyReport.lastResult, null, 'Job اجرانشده null است');
    assert.ok(byName.watchdog, 'watchdog هم در فهرست است');
    assert.equal(r.json.recentErrors[0].job_name, 'autoCloseIncomplete');
    const text = JSON.stringify(r.json);
    assert.ok(!text.includes('AAFake'), 'توکن ساختگی نباید در خروجی باشد');
    assert.ok(!text.includes(config.adminSessionSecret) && (!config.telegramBotToken || !text.includes(config.telegramBotToken)));
  });

  test('/api/admin/system/status?deep=1 کار می‌کند', async () => {
    const r = await hit('admin', '/api/admin/system/status?deep=1');
    assert.equal(r.status, 200);
    assert.equal(r.json.checks.db.ok, true);
  });
});
