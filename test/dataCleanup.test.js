// S2-7a: سیاست پاک‌سازی job_runs، monitor_alerts حل‌شده و rate_limit_hits. داده‌ی کاربری هرگز لمس نمی‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./helpers/factories');
const settings = require('../src/repositories/settingsRepository');
const { runCleanup } = require('../src/utils/dataCleanup');

describe('پاک‌سازی جدول‌های فرعی (S2-7a)', () => {
  let db;
  const NOW = new Date('2026-10-06T12:00:00.000Z');
  const DAY = 86400000;
  const daysAgo = (d) => new Date(NOW.getTime() - d * DAY).toISOString();
  const silent = () => {};
  const RET = { jobRunsDays: 180, monitorAlertsDays: 180, rateLimitDays: 7, notificationsDays: 90 };
  const counts = () => Object.fromEntries(
    ['job_runs', 'monitor_alerts', 'rate_limit_hits', 'users', 'attendance_records', 'leave_requests', 'audit_log', 'settings']
      .map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])
  );

  before(() => {
    db = resetDb();
    const u = F.makeUser();
    // داده‌ی کاربری نمونه
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, '2020-01-01', '2020-01-01T05:00:00.000Z')").run(u.id);
    F.makeApprovedMission(u.id, '2020-01-02');
    db.exec('DELETE FROM job_runs; DELETE FROM monitor_alerts; DELETE FROM rate_limit_hits;');

    const jr = db.prepare('INSERT INTO job_runs (job_name, started_at, finished_at, status) VALUES (?, ?, ?, ?)');
    jr.run('monthly', daysAgo(400), daysAgo(400), 'success');  // آخرین success این Job ⇒ محافظت‌شده
    jr.run('monthly', daysAgo(390), daysAgo(390), 'error');    // آخرین error این Job ⇒ محافظت‌شده
    jr.run('daily', daysAgo(300), daysAgo(300), 'success');    // قدیمی و غیر آخرین ⇒ حذفی
    jr.run('daily', daysAgo(250), daysAgo(250), 'interrupted'); // قدیمی ⇒ حذفی (interrupted آخرین این وضعیت است ⇒ محافظت‌شده)
    jr.run('daily', daysAgo(200), daysAgo(200), 'success');    // قدیمی و غیر آخرین ⇒ حذفی
    jr.run('daily', daysAgo(181), null, 'running');            // running هرگز حذف نمی‌شود
    jr.run('daily', daysAgo(179), daysAgo(179), 'success');    // داخل نگهداری، آخرین success ⇒ می‌ماند
    jr.run('daily', daysAgo(1), daysAgo(1), 'error');          // تازه

    const ma = db.prepare('INSERT INTO monitor_alerts (alert_key, state, first_seen_at, updated_at) VALUES (?, ?, ?, ?)');
    ma.run('old_ok', 'ok', daysAgo(500), daysAgo(400));        // حل‌شده و قدیمی ⇒ حذفی
    ma.run('old_firing', 'firing', daysAgo(500), daysAgo(400)); // هنوز firing ⇒ هرگز حذف نمی‌شود
    ma.run('recent_ok', 'ok', daysAgo(50), daysAgo(10));       // حل‌شده ولی تازه ⇒ می‌ماند

    const rl = db.prepare('INSERT INTO rate_limit_hits (limiter, bucket_key, count, reset_at) VALUES (?, ?, 1, ?)');
    rl.run('login', 'a', NOW.getTime() - 30 * DAY);            // منقضی از ۳۰ روز ⇒ حذفی
    rl.run('login', 'b', NOW.getTime() - 8 * DAY);             // منقضی از ۸ روز ⇒ حذفی
    rl.run('login', 'c', NOW.getTime() - 6 * DAY);             // منقضی از ۶ روز ⇒ می‌ماند (نگهداری ۷ روز)
    rl.run('login', 'd', NOW.getTime() + 60000);               // هنوز فعال ⇒ می‌ماند
  });
  after(() => cleanup());

  test('dry-run (پیش‌فرض): فقط می‌شمارد و لاگ می‌کند؛ هیچ ردیفی در هیچ جدولی تغییر نمی‌کند', () => {
    const before = counts();
    const logs = [];
    const r = runCleanup({ now: NOW, retention: RET, log: (m) => logs.push(m) }); // dryRun پیش‌فرض
    assert.equal(r.dryRun, true);
    assert.equal(r.tables.job_runs.candidates, 2, 'daily 300 و 200 روز؛ آخرین‌های هر وضعیت و running محافظت می‌شوند');
    assert.equal(r.tables.monitor_alerts.candidates, 1);
    assert.equal(r.tables.rate_limit_hits.candidates, 2);
    for (const t of Object.values(r.tables)) assert.equal(t.deleted, 0);
    assert.equal(logs.length, 4);
    assert.ok(logs.every((m) => /dry-run/.test(m) && /چیزی حذف نشد/.test(m)));
    assert.deepEqual(counts(), before);
  });

  test('اجرای واقعی: فقط ردیف‌های مشمول حذف می‌شوند؛ firing، running، آخرین success/error هر Job و ردیف‌های تازه می‌مانند؛ داده‌ی کاربری دست‌نخورده', () => {
    const before = counts();
    const r = runCleanup({ now: NOW, retention: RET, dryRun: false, log: silent });
    assert.equal(r.dryRun, false);
    assert.deepEqual(
      Object.fromEntries(Object.entries(r.tables).map(([k, v]) => [k, v.deleted])),
      { job_runs: 2, monitor_alerts: 1, rate_limit_hits: 2, notifications: 0 }
    );
    const after = counts();
    assert.equal(after.job_runs, before.job_runs - 2);
    assert.equal(after.monitor_alerts, before.monitor_alerts - 1);
    assert.equal(after.rate_limit_hits, before.rate_limit_hits - 2);
    // داده‌ی کاربری و سایر جدول‌ها دقیقاً همان‌اند
    for (const t of ['users', 'attendance_records', 'leave_requests', 'audit_log', 'settings']) assert.equal(after[t], before[t], t);
    assert.ok(after.attendance_records >= 1 && after.leave_requests >= 1 && after.users >= 1);

    const left = db.prepare('SELECT job_name, status, started_at FROM job_runs ORDER BY id').all();
    assert.ok(left.some((x) => x.job_name === 'monthly' && x.status === 'success'), 'آخرین success ماهانه');
    assert.ok(left.some((x) => x.job_name === 'monthly' && x.status === 'error'), 'آخرین error ماهانه');
    assert.ok(left.some((x) => x.status === 'running'));
    assert.deepEqual(db.prepare('SELECT alert_key FROM monitor_alerts ORDER BY alert_key').all().map((x) => x.alert_key), ['old_firing', 'recent_ok']);
    assert.deepEqual(db.prepare('SELECT bucket_key FROM rate_limit_hits ORDER BY bucket_key').all().map((x) => x.bucket_key), ['c', 'd']);

    // اجرای دوباره: چیزی نمانده
    const again = runCleanup({ now: NOW, retention: RET, dryRun: false, log: silent });
    assert.deepEqual(Object.values(again.tables).map((t) => t.deleted), [0, 0, 0, 0]);
  });

  test('تنظیمات نگهداری: پیش‌فرض‌های محافظه‌کارانه، اعتبارسنجی بازه، مقدار خراب ⇒ پیش‌فرض، و runCleanup از همان‌ها می‌خواند', () => {
    assert.deepEqual(settings.getCleanupRetention(), { jobRunsDays: 180, monitorAlertsDays: 180, rateLimitDays: 7, notificationsDays: 90 });
    const s = settings.update({ jobRunsRetentionDays: 365, monitorAlertsRetentionDays: '90', rateLimitRetentionDays: 30 });
    assert.equal(s.jobRunsRetentionDays, 365);
    assert.equal(s.monitorAlertsRetentionDays, 90);
    assert.equal(s.rateLimitRetentionDays, 30);
    for (const [k, bad] of [['jobRunsRetentionDays', 6], ['jobRunsRetentionDays', 3651], ['monitorAlertsRetentionDays', 0], ['rateLimitRetentionDays', 366], ['rateLimitRetentionDays', 'abc'], ['jobRunsRetentionDays', 1.5]]) {
      const before = settings.getAll()[k];
      assert.equal(settings.update({ [k]: bad })[k], before, `${k}=${bad} نادیده گرفته می‌شود`);
    }
    db.prepare("UPDATE settings SET value = 'x' WHERE key = 'job_runs_retention_days'").run();
    assert.equal(settings.getCleanupRetention().jobRunsDays, 180, 'مقدار خراب ⇒ پیش‌فرض');
    assert.equal(runCleanup({ now: NOW, log: silent }).tables.rate_limit_hits.retentionDays, 30, 'از تنظیمات خوانده می‌شود');
    db.exec("DELETE FROM settings WHERE key IN ('job_runs_retention_days','monitor_alerts_retention_days','rate_limit_retention_days')");
  });

  test('خطای یک جدول بقیه را متوقف نمی‌کند اما در پایان خطا پرتاب می‌شود؛ نگهداری نامعتبر رد می‌شود و چیزی حذف نمی‌شود', () => {
    const before = counts();
    const logs = [];
    assert.throws(
      () => runCleanup({ now: NOW, retention: { jobRunsDays: 0, monitorAlertsDays: 180, rateLimitDays: 7, notificationsDays: 90 }, dryRun: false, log: (m) => logs.push(m) }),
      /پاک‌سازی ناقص: job_runs/
    );
    assert.ok(logs.some((m) => /خطا در job_runs/.test(m)));
    assert.ok(logs.some((m) => /rate_limit_hits/.test(m) && !/خطا/.test(m)), 'جدول‌های بعدی اجرا شدند');
    assert.equal(counts().job_runs, before.job_runs, 'job_runs با نگهداری نامعتبر دست‌نخورده');
  });
});
