// بازیابی دیتابیس از بک‌آپ (S2-2a).
//   node scripts/restore-backup.js                       → فهرست بک‌آپ‌ها
//   node scripts/restore-backup.js <نام یا مسیر فایل>      → بازیابی
//   node scripts/restore-backup.js <فایل> --dry-run       → فقط بررسی و گزارش؛ هیچ فایلی تغییر نمی‌کند
// گزینه‌ها: --dir <پوشه‌ی بک‌آپ‌ها>  --db <فایل دیتابیس>  (پیش‌فرض: BACKUP_DIR و DB_PATH از .env)
//
// ترتیب ایمن: (۱) سرویس روشن نباشد (۲) فایل بک‌آپ به یک فایل موقت کنار دیتابیس کپی و integrity_check شود
// (۳) از وضعیت فعلی pre-restore-YYYYMMDD-HHmmss.db گرفته شود (۴) جایگزینی atomic + حذف -wal/-shm قدیمی (۵) integrity_check نهایی.
// اگر هر مرحله‌ی ۱ تا ۳ شکست بخورد، دیتابیس فعلی دست‌نخورده می‌ماند.
// کد خروج: ۰ موفق | ۱ خطای اجرا/فایل نامعتبر | ۲ آرگومان نادرست | ۳ سرویس روشن است.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { DAILY_RE, MONTHLY_RE } = require('../src/utils/backupRetention');
const { integrityCheckFile } = require('../src/repositories/monitorRepository');

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const SIDECARS = ['-wal', '-shm'];

class RestoreError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.exitCode = code;
  }
}

function rmQuiet(file) {
  try { fs.rmSync(file, { force: true }); } catch (_) { /* قفل/وجود ندارد */ }
}

function removeSidecars(dbFile) {
  SIDECARS.forEach((s) => rmQuiet(dbFile + s));
}

// فقط فایل‌های «منتشرشده» (.db)؛ .partial و .suspect فهرست نمی‌شوند. جدیدترین اول (بر اساس mtime)
function listBackups(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names
    .filter((f) => /\.db$/i.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      const kind = DAILY_RE.test(f) ? 'daily' : MONTHLY_RE.test(f) ? 'monthly'
        : f.startsWith('pre-migration-') ? 'pre-migration' : f.startsWith('pre-restore-') ? 'pre-restore' : 'other';
      return { file: f, kind, sizeBytes: st.size, mtime: st.mtime };
    })
    .filter((e) => e.sizeBytes > 0)
    .sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? 1 : -1));
}

// تشخیص سرویس روشن: تلاش برای گرفتن قفل انحصاری کامل روی دیتابیس (WAL + locking_mode=EXCLUSIVE).
// اگر پروسه‌ی دیگری (NSSM/سرور/CLI) دیتابیس را باز نگه داشته باشد SQLITE_BUSY می‌دهد. اگر -wal باقی‌مانده‌ی
// کرش باشد و کسی متصل نباشد، قفل گرفته می‌شود و با بستن اتصال WAL داخل فایل checkpoint می‌شود (بی‌خطر).
function isDatabaseInUse(dbPath) {
  if (!fs.existsSync(dbPath)) return false;
  let conn = null;
  try {
    conn = new Database(dbPath, { fileMustExist: true, timeout: 0 });
    conn.pragma('locking_mode = EXCLUSIVE');
    conn.prepare('SELECT count(*) FROM sqlite_master').get(); // اولین دسترسی قفل را می‌گیرد
    conn.exec('BEGIN IMMEDIATE; ROLLBACK;');
    return false;
  } catch (err) {
    if (err && (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED' || /database is locked/i.test(err.message))) return true;
    throw err; // خطای دیگر (مثلاً دیتابیس فعلی خراب است) در بالا جداگانه مدیریت می‌شود
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* بسته شده */ }
  }
}

// snapshot سازگار با WAL از وضعیت فعلی؛ اگر دیتابیس فعلی خراب باشد (دلیل اصلی restore!) کپی خام فایل‌ها
async function snapshotCurrent(dbPath, dest) {
  let conn = null;
  try {
    conn = new Database(dbPath, { readonly: true, fileMustExist: true });
    await conn.backup(dest);
    return { method: 'backup-api' };
  } catch (err) {
    rmQuiet(dest);
    removeSidecars(dest);
    fs.copyFileSync(dbPath, dest);
    for (const s of SIDECARS) if (fs.existsSync(dbPath + s)) fs.copyFileSync(dbPath + s, dest + s);
    return { method: 'raw-copy', warning: `دیتابیس فعلی با API رسمی بک‌آپ نشد (${err.message}) ⇒ کپی خام فایل‌ها` };
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* بسته شده */ }
  }
}

function resolveSource(arg, backupDir) {
  const candidates = path.isAbsolute(arg) || arg.includes(path.sep) || arg.includes('/') ? [path.resolve(arg)] : [path.join(backupDir, arg), path.resolve(arg)];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new RestoreError(`فایل بک‌آپ پیدا نشد: ${arg}`);
  if (!fs.statSync(found).isFile()) throw new RestoreError(`مسیر یک فایل نیست: ${found}`);
  if (/\.(suspect|partial)$/i.test(found)) throw new RestoreError(`فایل ${path.basename(found)} مشکوک/نیمه‌کاره است و بازیابی نمی‌شود.`);
  return found;
}

// ساختار حداقلی برنامه را دارد؟ (جلوگیری از جایگزینی با یک SQLite سالم اما بی‌ربط)
function inspectBackup(file) {
  let conn = null;
  try {
    conn = new Database(file, { readonly: true, fileMustExist: true });
    const has = (t) => !!conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!has('users') || !has('schema_migrations')) throw new RestoreError('این فایل دیتابیس این برنامه نیست (جدول users/schema_migrations ندارد).');
    return { users: conn.prepare('SELECT COUNT(*) AS c FROM users').get().c, lastMigration: conn.prepare('SELECT MAX(id) AS m FROM schema_migrations').get().m };
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* بسته شده */ }
  }
}

/**
 * @param {{source: string, dbPath: string, backupDir: string, dryRun?: boolean, now?: Date, log?: Function}} opts
 * @returns {Promise<object>} گزارش (در dry-run هیچ فایلی تغییر نکرده است)
 * @throws {RestoreError}
 */
async function restoreBackup({ source, dbPath, backupDir, dryRun = false, now = new Date(), log = () => {} }) {
  const src = resolveSource(source, backupDir);
  if (path.resolve(src) === path.resolve(dbPath)) throw new RestoreError('منبع و مقصد یک فایل‌اند.');

  if (isDatabaseInUse(dbPath)) {
    throw new RestoreError('دیتابیس در حال استفاده است (سرویس روشن است). ابتدا سرویس را متوقف کنید: nssm stop <نام سرویس>', 3);
  }

  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });
  const staging = path.join(dbDir, `.restore-staging-${process.pid}.db`);
  const report = { source: src, dryRun, preRestore: null, snapshotMethod: null, warnings: [], backupInfo: null };

  try {
    // کپی کنار دیتابیس: هم کنار فایل بک‌آپ -wal/-shm نمی‌سازیم، هم rename بعدی روی همان درایو و atomic است
    fs.copyFileSync(src, staging);
    const check = integrityCheckFile(staging);
    if (!check.ok) throw new RestoreError(`integrity_check بک‌آپ ناموفق بود (${check.result}). دیتابیس فعلی دست‌نخورده ماند.`);
    report.backupInfo = inspectBackup(staging);
    log(`بک‌آپ سالم است (کاربران: ${report.backupInfo.users}، آخرین migration: ${report.backupInfo.lastMigration}).`);

    const hasCurrent = fs.existsSync(dbPath);
    if (hasCurrent) report.preRestore = path.join(backupDir, `pre-restore-${stamp(now)}.db`);
    if (dryRun) {
      report.warnings.push('dry-run: هیچ فایلی تغییر نکرد.');
      return report;
    }

    if (hasCurrent) {
      fs.mkdirSync(backupDir, { recursive: true });
      if (fs.existsSync(report.preRestore)) throw new RestoreError(`${path.basename(report.preRestore)} از قبل وجود دارد؛ چند ثانیه بعد دوباره تلاش کنید.`);
      const snap = await snapshotCurrent(dbPath, report.preRestore);
      report.snapshotMethod = snap.method;
      if (snap.warning) report.warnings.push(snap.warning);
      if (snap.method === 'backup-api') removeSidecars(report.preRestore); // sidecar خالیِ ناشی از اتصال فقط‌خواندنی
      log(`وضعیت فعلی ذخیره شد: ${report.preRestore}`);
    }

    fs.renameSync(staging, dbPath); // روی ویندوز اگر فایل باز باشد EBUSY/EPERM می‌دهد (چیزی عوض نشده)
    removeSidecars(dbPath); // WAL قدیمی روی دیتابیس جدید نباید اعمال شود
  } catch (err) {
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`بازیابی انجام نشد: ${err.message}`);
  } finally {
    rmQuiet(staging);
    removeSidecars(staging); // اتصال فقط‌خواندنی (integrity/inspect) sidecar می‌گذارد
  }

  const final = integrityCheckFile(dbPath);
  removeSidecars(dbPath); // باز کردن فقط‌خواندنی sidecar خالی می‌گذارد
  if (!final.ok) {
    throw new RestoreError(`⚠️ integrity_check نهایی ناموفق بود (${final.result}). وضعیت قبلی در ${report.preRestore || '(نبود)'} است.`);
  }
  report.integrity = 'ok';
  return report;
}

function parseArgs(argv) {
  const out = { source: null, dryRun: false, dir: null, db: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--dir' || a === '--db') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new RestoreError(`مقدار ${a} لازم است.`, 2);
      out[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) throw new RestoreError(`گزینه‌ی ناشناخته: ${a}`, 2);
    else if (!out.source) out.source = a;
    else throw new RestoreError('فقط یک فایل بک‌آپ بدهید.', 2);
  }
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  const config = require('../src/config');
  const backupDir = path.resolve(args.dir || config.monitor.backupDir);
  const dbPath = path.resolve(args.db || config.dbPath);

  if (!args.source) {
    const list = listBackups(backupDir);
    console.log(`بک‌آپ‌ها در ${backupDir}:`);
    if (!list.length) console.log('  (هیچ بک‌آپی پیدا نشد)');
    list.forEach((e) => console.log(`  ${e.file}  [${e.kind}]  ${Math.round(e.sizeBytes / 1024)} KB  ${e.mtime.toISOString()}`));
    console.log('\nبازیابی: node scripts/restore-backup.js <نام فایل> [--dry-run]');
    return 0;
  }

  const report = await restoreBackup({ source: args.source, dbPath, backupDir, dryRun: args.dryRun, log: (m) => console.log(m) });
  report.warnings.forEach((w) => console.warn(`هشدار: ${w}`));
  if (args.dryRun) {
    console.log(`[dry-run] بازیابی ${path.basename(report.source)} روی ${dbPath} ممکن است.${report.preRestore ? ` وضعیت فعلی در ${report.preRestore} ذخیره می‌شد.` : ''}`);
  } else {
    console.log(`✅ بازیابی انجام شد و integrity_check سالم است. سرویس را دوباره روشن کنید: nssm start <نام سرویس>`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`❌ ${err.message}`);
      process.exit(err instanceof RestoreError ? err.exitCode : 1);
    },
  );
}

module.exports = { restoreBackup, listBackups, isDatabaseInUse, parseArgs, RestoreError };
