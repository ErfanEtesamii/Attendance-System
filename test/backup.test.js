// S2-1a: Job بک‌آپ روزانه — فایل بک‌آپ ساخته می‌شود، داده‌ی داخلش درست است، Job در scheduler ثبت و با wrapJob اجرا می‌شود.
const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('../src/config');
const { getDb } = require('../src/db/connection');
const { runDailyBackup, backupStamp } = require('../src/bot/scheduler/backup');
const { wrapJob } = require('../src/utils/jobRunner');
const { makeUser } = require('./helpers/factories');
const systemHealth = require('../src/utils/systemHealth');
const monitorRepository = require('../src/repositories/monitorRepository');
const { runWatchdog, _resetMemory } = require('../src/bot/scheduler/watchdog');

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
    assert.ok(require('../src/bot/scheduler').jobNames().includes('dailyBackup')); // S3-8c
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

// ---------- S2-1c (قسمت ۱): integrity_check، ثبت نتیجه در job_runs، جداسازی .suspect ----------
describe('S2-1c-1 — تأیید سلامت بک‌آپ', () => {
  let d;
  const ls = () => fs.readdirSync(d).sort();
  // db ساختگی: بک‌آپ واقعی می‌سازد و بعد فایل را با تابع corrupt خراب می‌کند
  const corruptingDb = (corrupt) => ({ backup: async (dest) => { await getDb().backup(dest); corrupt(dest); } });
  // وسط فایل (صفحه‌های داده) را با بایت‌های بی‌معنی بازنویسی می‌کند؛ هدر سالم می‌ماند
  const smashMiddle = (dest) => {
    const size = fs.statSync(dest).size;
    assert.ok(size >= 4096 * 6, 'دیتابیس نمونه برای خراب‌کردن وسط فایل خیلی کوچک است');
    const fd = fs.openSync(dest, 'r+');
    try { fs.writeSync(fd, Buffer.alloc(4096 * 2, 0xff), 0, 4096 * 2, 4096 * 2); } finally { fs.closeSync(fd); }
  };

  before(() => { resetDb(); });
  after(() => cleanup());
  const fresh = () => { d = fs.mkdtempSync(path.join(tmpDir, 'chk-')); };

  test('بک‌آپ سالم: integrity=ok، بدون .suspect، .partial و -wal/-shm باقی‌مانده', async () => {
    fresh();
    const res = await runDailyBackup({ dir: d, now: new Date(2026, 3, 1, 2, 30) });
    assert.equal(res.integrity, 'ok');
    assert.deepEqual(ls().filter((f) => /\.(suspect|partial)$|-wal$|-shm$/.test(f)), []);
    assert.ok(ls().includes('daily-20260401-0230.db'));
  });

  test('فایل خراب (وسط فایل): ⇒ خطا، فقط .suspect می‌ماند، نام روزانه‌ی معتبر ساخته نمی‌شود', async () => {
    fresh();
    await assert.rejects(
      () => runDailyBackup({ db: corruptingDb(smashMiddle), dir: d, now: new Date(2026, 3, 2, 2, 30) }),
      /integrity_check.*daily-20260402-0230\.db.*\.suspect/
    );
    assert.deepEqual(ls(), ['daily-20260402-0230.db.suspect']);
  });

  test('فایل اصلاً SQLite نیست ⇒ همان رفتار؛ بک‌آپ سالمِ هم‌نام بازنویسی نمی‌شود و retention اجرا نمی‌شود', async () => {
    fresh();
    const now = new Date(2026, 3, 3, 2, 30);
    for (let day = 1; day <= 5; day += 1) fs.writeFileSync(path.join(d, `daily-202603${String(day).padStart(2, '0')}-0230.db`), 'old');
    await runDailyBackup({ dir: d, now, keepDaily: 99, keepMonthly: 99 });
    const goodBytes = fs.readFileSync(path.join(d, 'daily-20260403-0230.db'));
    const before = ls();

    const garbage = corruptingDb((dest) => fs.writeFileSync(dest, Buffer.alloc(8192, 7)));
    await assert.rejects(() => runDailyBackup({ db: garbage, dir: d, now, keepDaily: 1, keepMonthly: 1 }), /integrity_check/);
    assert.ok(fs.readFileSync(path.join(d, 'daily-20260403-0230.db')).equals(goodBytes), 'بک‌آپ سالم بازنویسی شد');
    assert.deepEqual(ls(), [...before, 'daily-20260403-0230.db.suspect'].sort(), 'retention نباید چیزی پاک/ساخته باشد');
  });

  test('wrapJob: شکست integrity در job_runs با status=error و متن نتیجه ثبت می‌شود؛ اجرای سالم success', async () => {
    fresh();
    const bad = await wrapJob('dailyBackup', () => runDailyBackup({ db: corruptingDb(smashMiddle), dir: d, now: new Date(2026, 3, 4, 2, 30) }))();
    assert.equal(bad.ok, false);
    let row = getDb().prepare("SELECT status, error FROM job_runs WHERE job_name='dailyBackup' ORDER BY id DESC").get();
    assert.equal(row.status, 'error');
    assert.match(row.error, /integrity_check/);
    assert.match(row.error, /\.suspect/);

    const good = await wrapJob('dailyBackup', () => runDailyBackup({ dir: d, now: new Date(2026, 3, 5, 2, 30) }))();
    assert.equal(good.ok, true);
    row = getDb().prepare("SELECT status FROM job_runs WHERE job_name='dailyBackup' ORDER BY id DESC").get();
    assert.equal(row.status, 'success');
  });
});

// ---------- S2-1c (قسمت ۲): systemHealth، هشدار watchdog (bot ماک)، پیش‌فرض MONITOR_BACKUP_CHECK ----------
describe('S2-1c-2 — هشدار بک‌آپ مشکوک و سلامت', () => {
  const HOUR = 3600 * 1000;
  let d;
  let admin;
  const prev = {};
  const mockBot = ({ failFor = [] } = {}) => ({
    sent: [],
    async sendMessage(chatId, text) {
      if (failFor.includes(String(chatId))) throw new Error('blocked');
      this.sent.push({ chatId: String(chatId), text });
    },
  });
  const ago = (file, hours) => {
    const t = new Date(Date.now() - hours * HOUR);
    fs.utimesSync(path.join(d, file), t, t);
  };
  const smash = (dest) => {
    const fd = fs.openSync(dest, 'r+');
    try { fs.writeSync(fd, Buffer.alloc(4096 * 2, 0xff), 0, 4096 * 2, 4096 * 2); } finally { fs.closeSync(fd); }
  };
  const corruptingDb = { backup: async (dest) => { await getDb().backup(dest); smash(dest); } };

  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin' });
    prev.dir = config.monitor.backupDir;
    prev.check = config.monitor.backupCheck;
  });
  after(() => {
    config.monitor.backupDir = prev.dir;
    config.monitor.backupCheck = prev.check;
    cleanup();
  });
  beforeEach(() => {
    _resetMemory();
    getDb().prepare('DELETE FROM monitor_alerts').run();
    getDb().prepare('DELETE FROM job_runs').run();
    d = fs.mkdtempSync(path.join(tmpDir, 'sus-'));
    config.monitor.backupDir = d;
    config.monitor.backupCheck = true;
  });

  test('config: پیش‌فرض MONITOR_BACKUP_CHECK روشن است؛ فقط مقدار «false» خاموشش می‌کند', () => {
    const { spawnSync } = require('child_process');
    const run = (value) => {
      const env = { ...process.env, NODE_ENV: 'test' };
      delete env.MONITOR_BACKUP_CHECK;
      if (value !== undefined) env.MONITOR_BACKUP_CHECK = value;
      const out = spawnSync(process.execPath, ['-e', "console.log(require('./src/config').monitor.backupCheck)"], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env });
      return out.stdout.trim();
    };
    assert.equal(run(undefined), 'true');
    assert.equal(run('true'), 'true');
    assert.equal(run('false'), 'false');
  });

  test('systemHealth: .suspect جدیدتر از بک‌آپ سالم ⇒ degraded؛ «آخرین بک‌آپ سالم» همچنان فایل سالم است نه .suspect', () => {
    fs.writeFileSync(path.join(d, 'daily-20260401-0230.db'), 'ok');
    fs.writeFileSync(path.join(d, 'daily-20260402-0230.db.suspect'), 'bad');
    ago('daily-20260401-0230.db', 5);
    ago('daily-20260402-0230.db.suspect', 1);
    const b = systemHealth.collect().checks.backup;
    assert.equal(b.lastBackupFile, 'daily-20260401-0230.db');
    assert.equal(b.suspect.file, 'daily-20260402-0230.db.suspect');
    assert.equal(b.stale, false);
    assert.equal(b.ok, false);
    assert.equal(systemHealth.collect().status, 'degraded');
  });

  test('systemHealth: بک‌آپ سالمِ جدیدتر از .suspect ⇒ مشکل حل‌شده (ok)؛ بررسی خاموش ⇒ ok ولی suspect گزارش می‌شود؛ فقط .suspect بدون بک‌آپ سالم ⇒ ناسالم', () => {
    fs.writeFileSync(path.join(d, 'daily-20260402-0230.db.suspect'), 'bad');
    ago('daily-20260402-0230.db.suspect', 1);
    let b = systemHealth.collect().checks.backup;
    assert.equal(b.ok, false);
    assert.equal(b.lastBackupFile, null, '.suspect هرگز «بک‌آپ سالم» نیست');

    fs.writeFileSync(path.join(d, 'daily-20260403-0230.db'), 'ok');
    b = systemHealth.collect().checks.backup;
    assert.equal(b.suspect, null);
    assert.equal(b.ok, true);

    ago('daily-20260403-0230.db', 10);
    ago('daily-20260402-0230.db.suspect', 1); // دوباره جدیدتر
    config.monitor.backupCheck = false;
    b = systemHealth.collect().checks.backup;
    assert.equal(b.ok, true);
    assert.ok(b.suspect, 'حتی با بررسی خاموش، وضعیت برای صفحه‌ی سلامت گزارش می‌شود');
  });

  test('فایل خراب عمدی ⇒ watchdog با bot ماک هشدار backup_suspect به ادمین می‌دهد؛ تکرار نمی‌شود؛ بک‌آپ سالم بعدی ⇒ رفع شد', async () => {
    // بک‌آپ سالم دیروز، بعد بک‌آپ خرابِ امروز (از مسیر واقعی wrapJob + runDailyBackup)
    await runDailyBackup({ dir: d, now: new Date(2026, 3, 9, 2, 30) });
    ago('daily-20260409-0230.db', 24);
    ago('monthly-202604.db', 24); // کپی ماهانه‌ی همان بک‌آپ (retention) هم دیروز حساب شود
    const res = await wrapJob('dailyBackup', () => runDailyBackup({ db: corruptingDb, dir: d, now: new Date(2026, 3, 10, 2, 30) }))();
    assert.equal(res.ok, false);

    const bot = mockBot();
    const t0 = Date.now();
    const r = await runWatchdog({ bot, now: t0 });
    assert.ok(r.alertsSent.includes('backup_suspect'), `alertsSent=${r.alertsSent}`);
    const msg = bot.sent.find((m) => /سالم نیست/.test(m.text));
    assert.ok(msg, 'پیام هشدار بک‌آپ مشکوک ارسال شد');
    assert.equal(msg.chatId, String(admin.telegram_user_id));
    assert.match(msg.text, /daily-20260410-0230\.db\.suspect/);
    assert.match(msg.text, /daily-20260409-0230\.db/, 'آخرین بک‌آپ سالم در متن هست');
    assert.equal(monitorRepository.getAlert('backup_suspect').state, 'firing');
    assert.ok(!r.firing.includes('backup_stale'), 'بک‌آپ سالم تازه است؛ هشدار «قدیمی» نباید بیاید');

    // تکرار نزدیک و تا قبل از ۲۴ ساعت ⇒ هشدار backup_suspect تکرار نمی‌شود
    const n = bot.sent.filter((m) => /سالم نیست/.test(m.text)).length;
    await runWatchdog({ bot, now: t0 + 5 * 60 * 1000 });
    await runWatchdog({ bot, now: t0 + 2 * HOUR });
    assert.equal(bot.sent.filter((m) => /سالم نیست/.test(m.text)).length, n);

    // بک‌آپ سالمِ بعدی (فایل .suspect قدیمی‌تر می‌شود ولی پاک نمی‌ماند) ⇒ «رفع شد»
    ago('daily-20260410-0230.db.suspect', 2);
    await wrapJob('dailyBackup', () => runDailyBackup({ dir: d, now: new Date(2026, 3, 11, 2, 30), keepDaily: 99, keepMonthly: 99 }))();
    const r2 = await runWatchdog({ bot, now: Date.now() });
    assert.ok(r2.recovered.includes('backup_suspect'));
    assert.match(bot.sent[bot.sent.length - 1].text, /رفع شد/);
    assert.ok(fs.existsSync(path.join(d, 'daily-20260410-0230.db.suspect')), 'فایل .suspect دستی بررسی می‌شود، خودکار پاک نمی‌شود');
  });

  test('هشدار با MONITOR_BACKUP_CHECK خاموش نمی‌آید؛ متن هشدار راز ندارد', async () => {
    fs.writeFileSync(path.join(d, 'daily-20260402-0230.db.suspect'), 'bad');
    config.monitor.backupCheck = false;
    const bot = mockBot();
    const r = await runWatchdog({ bot });
    assert.ok(!r.firing.includes('backup_suspect'));

    config.monitor.backupCheck = true;
    const r2 = await runWatchdog({ bot });
    assert.ok(r2.alertsSent.includes('backup_suspect'));
    assert.ok(bot.sent.every((m) => !m.text.includes(process.env.TELEGRAM_BOT_TOKEN)));
  });
});
