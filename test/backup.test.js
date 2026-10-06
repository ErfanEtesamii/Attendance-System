// S2-1a: Job بک‌آپ روزانه — فایل بک‌آپ ساخته می‌شود، داده‌ی داخلش درست است، Job در scheduler ثبت و با wrapJob اجرا می‌شود.
const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('../src/config');
const { getDb } = require('../src/db/connection');
const { runDailyBackup, backupStamp } = require('../src/bot/scheduler/backup');
const { wrapJob } = require('../src/utils/jobRunner');
const { makeUser } = require('./helpers/factories');

describe('S2-1a — بک‌آپ روزانه', () => {
  let dir;
  before(() => {
    resetDb();
    dir = path.join(tmpDir, 'daily-backups');
  });
  after(() => cleanup());

  test('نام فایل: daily-YYYYMMDD-HHmm.db با ساعت محلی', () => {
    assert.equal(backupStamp(new Date(2026, 0, 5, 3, 7)), '20260105-0307');
  });

  test('فایل بک‌آپ ساخته می‌شود و داده‌ی داخلش با دیتابیس زنده یکی است', async () => {
    makeUser({ name: 'کاربر بک‌آپ' });
    const liveCount = getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c;
    assert.ok(liveCount >= 1);

    const res = await runDailyBackup({ dir, now: new Date(2026, 2, 9, 2, 30) });
    assert.equal(res.file, 'daily-20260309-0230.db');
    assert.ok(fs.existsSync(res.path) && res.sizeBytes > 0);
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.partial')), [], 'فایل موقت باقی نماند');

    const copy = new Database(res.path, { readonly: true });
    try {
      assert.equal(copy.prepare('SELECT COUNT(*) AS c FROM users').get().c, liveCount);
      assert.ok(copy.prepare("SELECT 1 FROM users WHERE full_name = 'کاربر بک‌آپ'").get());
      assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    } finally {
      copy.close();
    }
  });

  test('اجرای دوباره در همان دقیقه خطا نمی‌دهد و فایل را جایگزین می‌کند', async () => {
    const now = new Date(2026, 2, 9, 2, 30);
    await runDailyBackup({ dir, now });
    await runDailyBackup({ dir, now });
    assert.equal(fs.readdirSync(dir).filter((f) => f === 'daily-20260309-0230.db').length, 1);
  });

  test('خطا در بک‌آپ: فایل موقت پاک می‌شود، خطا throw می‌شود و wrapJob آن را در job_runs ثبت می‌کند', async () => {
    const badDb = { backup: async (dest) => { fs.writeFileSync(dest, 'x'); throw new Error('disk full'); } };
    const failDir = path.join(tmpDir, 'fail-backups');
    await assert.rejects(() => runDailyBackup({ db: badDb, dir: failDir, now: new Date(2026, 2, 10, 2, 30) }), /disk full/);
    assert.deepEqual(fs.readdirSync(failDir), []);

    const r = await wrapJob('dailyBackup', () => runDailyBackup({ db: badDb, dir: failDir }))();
    assert.equal(r.ok, false);
    const row = getDb().prepare("SELECT status, error FROM job_runs WHERE job_name='dailyBackup' ORDER BY id DESC").get();
    assert.equal(row.status, 'error');
    assert.match(row.error, /disk full/);
  });

  test('Job با نام dailyBackup در config.cron هست و cron معتبر است', () => {
    const cron = require('node-cron');
    assert.ok(cron.validate(config.cron.dailyBackup));
    const src = fs.readFileSync(path.join(__dirname, '../src/bot/scheduler/index.js'), 'utf8');
    assert.match(src, /wrapJob\('dailyBackup'/);
  });
});

// ---------- S2-1b: سیاست نگهداری ----------
const { applyRetention, ensureMonthlyCopy, pruneBackups } = require('../src/utils/backupRetention');

describe('S2-1b — سیاست نگهداری بک‌آپ', () => {
  let d;
  const touch = (name, body = 'x') => fs.writeFileSync(path.join(d, name), body);
  const ls = () => fs.readdirSync(d).sort();
  const protectedFiles = ['pre-migration-2025-01-01T00-00-00-000Z.db', 'pre-restore-20250101.db', 'daily-20250101-0230.db.suspect', 'notes.txt'];

  before(() => { resetDb(); });
  after(() => cleanup());
  const fresh = () => { d = fs.mkdtempSync(path.join(tmpDir, 'ret-')); };

  test('فقط N روزانه‌ی جدیدتر می‌مانند؛ فایل‌های غیرروزانه (pre-migration، suspect، ...) دست‌نخورده', () => {
    fresh();
    protectedFiles.forEach((f) => touch(f));
    for (let day = 1; day <= 10; day += 1) touch(`daily-202603${String(day).padStart(2, '0')}-0230.db`);
    const removed = pruneBackups(d, { keepDaily: 3, keepMonthly: 6 });
    assert.equal(removed.daily.length, 7);
    assert.deepEqual(ls().filter((f) => f.startsWith('daily-') && f.endsWith('.db')), ['daily-20260308-0230.db', 'daily-20260309-0230.db', 'daily-20260310-0230.db']);
    for (const f of protectedFiles) assert.ok(fs.existsSync(path.join(d, f)), f);
  });

  test('ماهانه: فقط M جدیدتر می‌مانند و ترتیب بر اساس نام است نه زمان فایل', () => {
    fresh();
    for (const m of ['202510', '202511', '202512', '202601', '202602']) touch(`monthly-${m}.db`);
    // قدیمی‌ترین ماه را عمداً «تازه‌ترین mtime» می‌کنیم؛ باز هم باید اول حذف شود
    fs.utimesSync(path.join(d, 'monthly-202510.db'), new Date(), new Date());
    pruneBackups(d, { keepDaily: 1, keepMonthly: 2 });
    assert.deepEqual(ls(), ['monthly-202601.db', 'monthly-202602.db']);
  });

  test('اولین بک‌آپ هر ماه ⇒ کپی ماهانه ساخته می‌شود؛ بک‌آپ بعدی همان ماه کپی جدید نمی‌سازد', () => {
    fresh();
    touch('daily-20260301-0230.db', 'first');
    assert.equal(ensureMonthlyCopy(d, 'daily-20260301-0230.db'), 'monthly-202603.db');
    assert.equal(fs.readFileSync(path.join(d, 'monthly-202603.db'), 'utf8'), 'first');
    touch('daily-20260302-0230.db', 'second');
    assert.equal(ensureMonthlyCopy(d, 'daily-20260302-0230.db'), null);
    assert.equal(fs.readFileSync(path.join(d, 'monthly-202603.db'), 'utf8'), 'first');
    assert.equal(ensureMonthlyCopy(d, 'pre-migration-x.db'), null);
  });

  test('شبیه‌سازی ۴۰ روز پشت‌سرهم: شمارش باقی‌مانده‌ها دقیق است', () => {
    fresh();
    // از ۲۰ فوریه ۲۰۲۶ به‌مدت ۴۰ روز: ۱۰ روز آخر فوریه + ۳۰ روز مارس ⇒ ماه‌های 202602 و 202603
    const start = new Date(2026, 1, 20, 2, 30);
    for (let i = 0; i < 40; i += 1) {
      const now = new Date(start.getTime() + i * 86400000);
      const file = `daily-${backupStamp(now)}.db`;
      touch(file);
      applyRetention(d, { justCreated: file, keepDaily: 14, keepMonthly: 6 });
    }
    const daily = ls().filter((f) => f.startsWith('daily-'));
    const monthly = ls().filter((f) => f.startsWith('monthly-'));
    assert.equal(daily.length, 14);
    const last = `daily-${backupStamp(new Date(start.getTime() + 39 * 86400000))}.db`;
    assert.equal(daily[daily.length - 1], last);
    assert.equal(daily[0], `daily-${backupStamp(new Date(start.getTime() + 26 * 86400000))}.db`);
    assert.deepEqual(monthly, ['monthly-202602.db', 'monthly-202603.db']);
  });

  test('فایل تازه‌ساخته هرگز پاک نمی‌شود، حتی اگر نامش «قدیمی‌تر» از بقیه باشد (ساعت سیستم عقب رفته)', () => {
    fresh();
    for (let day = 10; day <= 14; day += 1) touch(`daily-202603${day}-0230.db`);
    touch('daily-20260301-0230.db');
    applyRetention(d, { justCreated: 'daily-20260301-0230.db', keepDaily: 2, keepMonthly: 2 });
    assert.ok(fs.existsSync(path.join(d, 'daily-20260301-0230.db')));
  });

  test('مقدار keep نامعتبر ⇒ خطا و هیچ فایلی پاک نمی‌شود', () => {
    fresh();
    touch('daily-20260301-0230.db');
    touch('daily-20260302-0230.db');
    for (const bad of [0, -1, 1.5, NaN, undefined]) {
      assert.throws(() => pruneBackups(d, { keepDaily: bad, keepMonthly: 1 }));
    }
    assert.equal(ls().length, 2);
  });

  test('config: پیش‌فرض‌ها ۱۴/۶؛ مقدار نامعتبر env (۰، منفی، متن) به پیش‌فرض برمی‌گردد', () => {
    assert.equal(config.backup.keepDaily, 14);
    assert.equal(config.backup.keepMonthly, 6);
    const { spawnSync } = require('child_process');
    const out = spawnSync(process.execPath, ['-e', "const c=require('./src/config');console.log(JSON.stringify(c.backup))"], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test', BACKUP_KEEP_DAILY: '0', BACKUP_KEEP_MONTHLY: 'abc' },
    });
    assert.deepEqual(JSON.parse(out.stdout), { keepDaily: 14, keepMonthly: 6 });
  });

  test('یکپارچه با Job: runDailyBackup کپی ماهانه می‌سازد و قدیمی‌ها را پاک می‌کند', async () => {
    fresh();
    for (let day = 1; day <= 5; day += 1) touch(`daily-202603${String(day).padStart(2, '0')}-0230.db`);
    touch('pre-migration-2026-03-01T00-00-00-000Z.db');
    const res = await runDailyBackup({ dir: d, now: new Date(2026, 2, 6, 2, 30), keepDaily: 3, keepMonthly: 2 });
    assert.equal(res.monthlyCreated, 'monthly-202603.db');
    assert.deepEqual(ls().filter((f) => /^daily-/.test(f)), ['daily-20260304-0230.db', 'daily-20260305-0230.db', 'daily-20260306-0230.db']);
    assert.ok(fs.existsSync(path.join(d, 'pre-migration-2026-03-01T00-00-00-000Z.db')));
  });
});
