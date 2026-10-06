// S2-7b: Job ماهانه‌ی نگهداری دیتابیس — cleanup ← ANALYZE/optimize ← VACUUM (فقط با فضای کافی).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const F = require('./helpers/factories');
const config = require('../src/config');
const maintenanceRepository = require('../src/repositories/maintenanceRepository');
const { runDbMaintenance, vacuumDecision } = require('../src/bot/scheduler/dbMaintenance');
const { wrapJob } = require('../src/utils/jobRunner');

describe('Job نگهداری ماهانه‌ی دیتابیس (S2-7b)', () => {
  let db;
  const silent = () => {};
  const MB = 1048576;
  const spyRepo = (calls) => ({
    analyze: () => calls.push('analyze'),
    optimize: () => calls.push('optimize'),
    vacuum: () => calls.push('vacuum'),
    checkpointTruncate: () => calls.push('checkpoint'),
  });
  const disk = (freeMb, applicable = true) => () => ({ applicable, ok: true, freeMb, totalMb: 100000, minFreeMb: 1024 });

  before(() => { db = resetDb(); });
  after(() => cleanup());

  test('تصمیم VACUUM: لازم = ۲×حجم + حداقل آزاد؛ مرز دقیق، فضای ناکافی و دیسکِ نامشخص', () => {
    const size = 100 * MB; // ⇒ لازم = 200 + 1024 = 1224MB
    assert.deepEqual(vacuumDecision({ disk: disk(1224)(), sizeBytes: size, minFreeMb: 1024 }), { ok: true, requiredMb: 1224, freeMb: 1224, reason: 'فضای کافی' });
    const low = vacuumDecision({ disk: disk(1223)(), sizeBytes: size, minFreeMb: 1024 });
    assert.equal(low.ok, false);
    assert.equal(low.requiredMb, 1224);
    assert.match(low.reason, /کمتر از حداقل لازم 1224MB/);
    assert.equal(vacuumDecision({ disk: disk(99999, false)(), sizeBytes: size, minFreeMb: 1024 }).ok, false, 'قابل اندازه‌گیری نیست ⇒ رد');
    assert.equal(vacuumDecision({ disk: null, sizeBytes: size, minFreeMb: 1024 }).ok, false);
    assert.equal(vacuumDecision({ disk: disk(1025)(), sizeBytes: 0, minFreeMb: 1024 }).ok, true, 'دیتابیس خالی فقط حداقل آزاد را می‌خواهد');
  });

  test('فضای ناکافی ⇒ VACUUM اجرا نمی‌شود (cleanup و ANALYZE/optimize اجرا می‌شوند) و Job خطا نمی‌دهد', async () => {
    const calls = [];
    const logs = [];
    const r = runDbMaintenance({
      log: (m) => logs.push(m), cleanup: () => { calls.push('cleanup'); return { ok: 1 }; },
      disk: disk(500), sizeBytes: () => 100 * MB, repo: spyRepo(calls), minFreeMb: 1024,
    });
    assert.deepEqual(calls, ['cleanup', 'analyze', 'optimize'], 'vacuum و checkpoint صدا زده نشد');
    assert.equal(r.vacuum.ran, false);
    assert.equal(r.vacuum.freeMb, 500);
    assert.equal(r.analyzed && r.optimized, true);
    assert.ok(logs.some((m) => /VACUUM رد شد/.test(m)));

    // دیسک نامشخص هم همین‌طور
    const calls2 = [];
    runDbMaintenance({ log: silent, cleanup: () => null, disk: disk(0, false), sizeBytes: () => 0, repo: spyRepo(calls2), minFreeMb: 1024 });
    assert.ok(!calls2.includes('vacuum'));

    // با wrapJob موفق ثبت می‌شود (رد VACUUM خطا نیست)
    const res = await wrapJob('dbMaintenance', () => runDbMaintenance({ log: silent, cleanup: () => null, disk: disk(1), sizeBytes: () => 0, repo: spyRepo([]), minFreeMb: 1024 }))();
    assert.equal(res.ok, true);
    assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'dbMaintenance' ORDER BY id DESC").get().status, 'success');
  });

  test('فضای کافی: ترتیب cleanup ← ANALYZE ← optimize ← VACUUM ← checkpoint؛ اجرای واقعی فایل را جمع می‌کند، cleanup واقعی حذف می‌کند و داده‌ی کاربری می‌ماند', () => {
    const calls = [];
    runDbMaintenance({ log: silent, cleanup: () => { calls.push('cleanup'); return null; }, disk: disk(5000), sizeBytes: () => 10 * MB, repo: spyRepo(calls), minFreeMb: 1024 });
    assert.deepEqual(calls, ['cleanup', 'analyze', 'optimize', 'vacuum', 'checkpoint']);

    // اجرای واقعی با repository و cleanup واقعی
    const u = F.makeUser();
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, '2020-01-01', '2020-01-01T05:00:00.000Z')").run(u.id);
    db.exec('DELETE FROM rate_limit_hits');
    db.prepare('INSERT INTO rate_limit_hits (limiter, bucket_key, count, reset_at) VALUES (?, ?, 1, ?)').run('login', 'old', Date.now() - 400 * 86400000);
    db.prepare('INSERT INTO rate_limit_hits (limiter, bucket_key, count, reset_at) VALUES (?, ?, 1, ?)').run('login', 'live', Date.now() + 60000);
    db.exec('CREATE TABLE IF NOT EXISTS _bloat (id INTEGER PRIMARY KEY, pad TEXT)');
    const ins = db.prepare('INSERT INTO _bloat (pad) VALUES (?)');
    db.transaction(() => { for (let i = 0; i < 3000; i += 1) ins.run('x'.repeat(500)); })();
    db.exec('DROP TABLE _bloat');
    assert.ok(db.pragma('freelist_count', { simple: true }) > 100, 'صفحه‌های آزاد برای جمع‌شدن');
    const usersBefore = db.prepare('SELECT COUNT(*) n FROM users').get().n;

    const r = runDbMaintenance({ log: silent, disk: disk(100000), minFreeMb: 1 }); // cleanup و repository واقعی
    assert.equal(r.vacuum.ran, true);
    assert.equal(db.pragma('freelist_count', { simple: true }), 0, 'VACUUM صفحه‌های آزاد را برگرداند');
    assert.deepEqual(db.prepare('SELECT bucket_key FROM rate_limit_hits').all().map((x) => x.bucket_key), ['live'], 'cleanup واقعی ردیف منقضیِ قدیمی را حذف کرد');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, usersBefore);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 1);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.doesNotThrow(() => maintenanceRepository.analyze());
  });

  test('خطای cleanup بقیه‌ی مراحل را متوقف نمی‌کند ولی Job «error» می‌شود؛ cron معتبر و با wrapJob ثبت شده', async () => {
    const calls = [];
    const origErr = console.error;
    console.error = silent;
    let res;
    try {
      res = await wrapJob('dbMaintenance', () => runDbMaintenance({
        log: silent, cleanup: () => { throw new Error('پاک‌سازی ناقص: job_runs'); },
        disk: disk(5000), sizeBytes: () => 0, repo: spyRepo(calls), minFreeMb: 1024,
      }))();
    } finally { console.error = origErr; }
    assert.equal(res.ok, false);
    assert.match(res.error, /پاک‌سازی ناقص/);
    assert.deepEqual(calls, ['analyze', 'optimize', 'vacuum', 'checkpoint'], 'بقیه‌ی مراحل اجرا شدند');
    assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'dbMaintenance' ORDER BY id DESC").get().status, 'error');

    assert.ok(require('node-cron').validate(config.cron.dbMaintenance));
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'scheduler', 'index.js'), 'utf8');
    assert.match(src, /wrapJob\('dbMaintenance'/);
  });
});
