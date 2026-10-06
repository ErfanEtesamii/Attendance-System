// S2-6b: Job ماهانه‌ی آرشیو audit در حالت dry-run — فقط می‌شمارد و لاگ می‌کند، هرگز چیزی منتقل نمی‌کند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const settings = require('../src/repositories/settingsRepository');
const auditRepository = require('../src/repositories/auditRepository');
const { runAuditArchive, cutoffFor } = require('../src/bot/scheduler/auditArchive');
const { wrapJob } = require('../src/utils/jobRunner');
const config = require('../src/config');

describe('Job آرشیو audit — dry-run (S2-6b)', () => {
  let db;
  const NOW = new Date('2026-10-06T12:30:45Z');
  const seed = (date, action) => {
    const row = auditRepository.logEvent({ action, details: { d: date } });
    db.prepare('UPDATE audit_log SET occurred_at = ? WHERE id = ?').run(date, row.id);
  };
  const state = () => ({
    main: db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
    archive: db.prepare('SELECT COUNT(*) n FROM audit_log_archive').get().n,
  });

  before(() => {
    db = resetDb();
    db.exec('DELETE FROM audit_log');
    // آستانه‌ی ۲۴ ماه از ۲۰۲۶-۱۰-۰۶ ۱۲:۳۰:۴۵ ⇒ ۲۰۲۴-۱۰-۰۶ ۱۲:۳۰:۴۵
    seed('2020-01-01 00:00:00', 'very_old');
    seed('2024-10-06 12:30:44', 'just_before_cutoff');
    seed('2024-10-06 12:30:45', 'exactly_cutoff');      // مرز: «قدیمی‌تر از» ⇒ شامل نمی‌شود
    seed('2025-06-01 08:00:00', 'recent');
    seed('2026-10-05 08:00:00', 'yesterday');
  });
  after(() => cleanup());

  test('آستانه: ماه‌ها از «الان» کم می‌شود، آخر ماه کوتاه‌تر clamp می‌شود، قالب ذخیره‌ی audit_log', () => {
    assert.equal(cutoffFor(NOW, 24), '2024-10-06 12:30:45');
    assert.equal(cutoffFor(NOW, 12), '2025-10-06 12:30:45');
    assert.equal(cutoffFor(NOW, 10), '2025-12-06 12:30:45', 'عبور از مرز سال');
    assert.equal(cutoffFor(new Date('2026-03-31T00:00:00Z'), 1), '2026-02-28 00:00:00');
    assert.equal(cutoffFor(new Date('2024-03-31T00:00:00Z'), 1), '2024-02-29 00:00:00', 'سال کبیسه');
    assert.equal(cutoffFor(new Date('2026-01-15T05:06:07Z'), 1), '2025-12-15 05:06:07');
    assert.match(cutoffFor(NOW, 1), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('dry-run: فقط رکوردهای قدیمی‌تر از آستانه شمرده می‌شود و هیچ چیز جابه‌جا نمی‌شود (خاموش و روشن)', () => {
    const before = state();
    assert.equal(before.archive, 0);
    for (const enabled of [false, true]) {
      const logs = [];
      const r = runAuditArchive({ now: NOW, retentionMonths: 24, enabled, log: (m) => logs.push(m) });
      assert.equal(r.mode, 'dry-run');
      assert.equal(r.candidates, 2, 'very_old و just_before_cutoff؛ نه رکورد مرزی');
      assert.equal(r.oldest, '2020-01-01 00:00:00');
      assert.equal(r.newest, '2024-10-06 12:30:44');
      assert.equal(r.moved, 0);
      assert.equal(r.enabled, enabled);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /dry-run: 2 رکورد/);
      assert.match(logs[0], enabled ? /آرشیو روشن/ : /آرشیو خاموش/);
      assert.match(logs[0], /چیزی منتقل نشد/);
      assert.deepEqual(state(), before, 'audit_log دست‌نخورده و آرشیو خالی');
    }
  });

  test('نگهداری از تنظیمات خوانده می‌شود (۲۴ پیش‌فرض، تغییر با تنظیم، مقدار خراب ⇒ ۲۴) و رکورد بدون تاریخ‌های قدیمی صفر می‌دهد', () => {
    const silent = () => {};
    assert.equal(runAuditArchive({ now: NOW, log: silent }).retentionMonths, 24);
    assert.equal(runAuditArchive({ now: NOW, log: silent }).enabled, false);
    settings.update({ auditRetentionMonths: 12 });
    const r12 = runAuditArchive({ now: NOW, log: silent });
    assert.equal(r12.retentionMonths, 12);
    assert.equal(r12.candidates, 4, 'با ۱۲ ماه (آستانه ۲۰۲۵-۱۰-۰۶)، رکورد مرزیِ ۲۰۲۴ و رکورد ۲۰۲۵-۰۶ هم قدیمی حساب می‌شوند');
    db.prepare("UPDATE settings SET value = 'x' WHERE key = 'audit_retention_months'").run();
    assert.equal(runAuditArchive({ now: NOW, log: silent }).retentionMonths, 24);
    settings.update({ auditRetentionMonths: 1 });
    assert.equal(runAuditArchive({ now: new Date('2019-01-01T00:00:00Z'), log: silent }).candidates, 0);
    settings.update({ auditRetentionMonths: 24 });
    assert.equal(state().archive, 0);
  });

  test('wrapJob: اجرا در job_runs ثبت می‌شود، خطای دیتابیس Job را «error» می‌کند و استثنا بیرون نمی‌زند؛ cron معتبر و ثبت‌شده در scheduler', async () => {
    const origLog = console.log;
    console.log = () => {};
    let ok;
    try { ok = await wrapJob('auditArchive', () => runAuditArchive())(); } finally { console.log = origLog; }
    assert.equal(ok.ok, true);
    assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'auditArchive' ORDER BY id DESC").get().status, 'success');

    const orig = auditRepository.summarizeOlderThan;
    const origErr = console.error;
    console.error = () => {};
    auditRepository.summarizeOlderThan = () => { throw new Error('boom'); };
    try {
      const bad = await wrapJob('auditArchive', () => runAuditArchive())();
      assert.equal(bad.ok, false);
      assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'auditArchive' ORDER BY id DESC").get().status, 'error');
    } finally {
      auditRepository.summarizeOlderThan = orig;
      console.error = origErr;
    }
    assert.throws(() => auditRepository.summarizeOlderThan("2024-10-06'; DROP TABLE audit_log; --"), /cutoff/);

    assert.ok(require('node-cron').validate(config.cron.auditArchive));
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'scheduler', 'index.js'), 'utf8');
    assert.match(src, /wrapJob\('auditArchive'/);
  });
});
