// S2-2a: scripts/restore-backup.js — بازیابی، رد فایل خراب، تشخیص سرویس روشن، dry-run و CLI.
const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const { getDb, closeDb } = require('../src/db/connection');
const { runDailyBackup } = require('../src/bot/scheduler/backup');
const { makeUser } = require('./helpers/factories');
const { restoreBackup, listBackups } = require('../scripts/restore-backup');

const dbPath = process.env.DB_PATH;
const backupDir = path.join(tmpDir, 'restore-backups');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const countUsers = () => {
  const c = new Database(dbPath, { readonly: true });
  try { return c.prepare('SELECT COUNT(*) AS c FROM users').get().c; } finally { c.close(); }
};

describe('S2-2a — restore-backup', () => {
  let backupFile;
  before(async () => {
    resetDb();
    makeUser({ name: 'قبل از بک‌آپ' });
    backupFile = (await runDailyBackup({ dir: backupDir, now: new Date(2026, 2, 9, 2, 30) })).file;
  });
  after(() => cleanup());

  test('سرویس روشن (اتصال باز) ⇒ رد می‌شود با کد ۳ و دیتابیس دست‌نخورده؛ فهرست فقط .db منتشرشده', async () => {
    getDb(); // اتصال زنده‌ی سرور
    makeUser({ name: 'بعد از بک‌آپ' });
    fs.writeFileSync(path.join(backupDir, 'daily-20260310-0230.db.suspect'), 'x');
    assert.deepEqual(listBackups(backupDir).map((e) => e.file).sort(), [backupFile, 'monthly-202603.db']); // .suspect/.partial فهرست نمی‌شوند

    const before = countUsers();
    await assert.rejects(
      () => restoreBackup({ source: backupFile, dbPath, backupDir }),
      (e) => e.exitCode === 3 && /در حال استفاده/.test(e.message),
    );
    assert.equal(countUsers(), before);
    assert.equal(fs.existsSync(backupDir) && fs.readdirSync(backupDir).some((f) => f.startsWith('pre-restore-')), false);
  });

  test('dry-run (سرویس خاموش): چیزی تغییر نمی‌کند؛ سپس restore واقعی داده را برمی‌گرداند و pre-restore حاوی وضعیت قبلی است', async () => {
    closeDb();
    const usersAfter = countUsers();
    const hash = sha(dbPath);

    const dry = await restoreBackup({ source: backupFile, dbPath, backupDir, dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(sha(dbPath), hash);
    assert.equal(fs.readdirSync(backupDir).filter((f) => f.startsWith('pre-restore-')).length, 0);

    const rep = await restoreBackup({ source: backupFile, dbPath, backupDir, now: new Date(2026, 2, 11, 10, 0, 5) });
    assert.equal(rep.integrity, 'ok');
    assert.equal(path.basename(rep.preRestore), 'pre-restore-20260311-100005.db');
    assert.ok(!fs.existsSync(dbPath + '-wal') && !fs.existsSync(dbPath + '-shm'), 'WAL/SHM قدیمی نماند'); // قبل از هر اتصال تست
    assert.equal(countUsers(), usersAfter - 1, 'کاربر بعد از بک‌آپ باید برگردد');

    const pre = new Database(rep.preRestore, { readonly: true });
    try { assert.ok(pre.prepare("SELECT 1 FROM users WHERE full_name='بعد از بک‌آپ'").get()); } finally { pre.close(); }
    assert.deepEqual(fs.readdirSync(path.dirname(dbPath)).filter((f) => f.startsWith('.restore-staging')), []);
  });

  test('بک‌آپ خراب یا بی‌ربط ⇒ رد می‌شود و دیتابیس فعلی بایت‌به‌بایت دست‌نخورده می‌ماند', async () => {
    const corrupt = path.join(backupDir, 'daily-20260312-0230.db');
    const good = fs.readFileSync(path.join(backupDir, backupFile));
    fs.writeFileSync(corrupt, Buffer.concat([good.subarray(0, 4096), Buffer.alloc(8192, 0xab)])); // وسط فایل خراب
    const notApp = path.join(backupDir, 'other.db');
    const o = new Database(notApp); o.exec('CREATE TABLE t(a)'); o.close();
    const garbage = path.join(backupDir, 'garbage.db');
    fs.writeFileSync(garbage, 'this is not sqlite at all'.repeat(100));

    const hash = sha(dbPath);
    const preCount = fs.readdirSync(backupDir).filter((f) => f.startsWith('pre-restore-')).length;
    for (const f of [corrupt, notApp, garbage]) {
      await assert.rejects(() => restoreBackup({ source: f, dbPath, backupDir }), (e) => e.exitCode === 1);
    }
    await assert.rejects(() => restoreBackup({ source: 'daily-20260310-0230.db.suspect', dbPath, backupDir }), /مشکوک/);
    await assert.rejects(() => restoreBackup({ source: 'nope.db', dbPath, backupDir }), /پیدا نشد/);
    assert.equal(sha(dbPath), hash);
    assert.equal(fs.readdirSync(backupDir).filter((f) => f.startsWith('pre-restore-')).length, preCount, 'قبل از اعتبارسنجی pre-restore ساخته نشود');
    assert.deepEqual(fs.readdirSync(path.dirname(dbPath)).filter((f) => f.startsWith('.restore-staging')), []);
  });

  test('CLI: بدون آرگومان فهرست می‌دهد، dry-run کد ۰، گزینه‌ی ناشناخته کد ۲، فایل نامعتبر کد ۱', () => {
    const run = (...args) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'restore-backup.js'), '--dir', backupDir, '--db', dbPath, ...args], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });
    const list = run();
    assert.equal(list.status, 0);
    assert.match(list.stdout, new RegExp(backupFile));
    assert.equal(run(backupFile, '--dry-run').status, 0);
    assert.equal(run('--bogus').status, 2);
    assert.equal(run('garbage.db').status, 1);
  });
});
