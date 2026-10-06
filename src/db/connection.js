// اتصال واحد (singleton) به فایل دیتابیس SQLite با better-sqlite3.
// انتخاب SQLite برای فاز ۱: نیاز به سرویس دیتابیس جداگانه ندارد و روی ویندوز
// در کنار اجرای برنامه با NSSM به‌سادگی کار می‌کند (فقط یک فایل .db).
//
// ساختار جداول دیگر اینجا ساخته نمی‌شود؛ هنگام اولین getDb() فقط migrationهای اعمال‌نشده
// (src/db/migrations) اجرا می‌شوند. جزئیات: src/db/migrator.js

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { migrate } = require('./migrator');

let dbInstance = null;

// باز کردن فایل با pragmaهای استاندارد پروژه، بدون اجرای migration (برای CLI وضعیت/ابزارها)
function openDatabase(dbPath = config.dbPath) {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // پایداری بهتر روی نوشتن‌های همزمان
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000'); // اگر پروسه دیگری (مثلاً CLI migrate) قفل نوشتن دارد، چند ثانیه صبر کن
  return db;
}

function getDb() {
  if (dbInstance) return dbInstance;

  const db = openDatabase();
  const backupDir = path.join(path.dirname(config.dbPath), 'backups');
  try {
    const { applied, backupPath } = migrate(db, {
      backupDir,
      log: (msg) => console.log(`[migrate] ${msg}`),
    });
    if (applied.length) {
      console.log(`[migrate] ${applied.length} migration اعمال شد: ${applied.join(', ')}${backupPath ? ` (بک‌آپ: ${backupPath})` : ''}`);
    }
  } catch (err) {
    // سرور با ساختار نیمه‌کاره بالا نمی‌آید؛ migration خودش rollback شده است.
    db.close();
    throw err;
  }

  dbInstance = db;
  return dbInstance;
}

// بستن اتصال singleton (خاموشی مرتب و ایزوله‌سازی تست‌ها)
function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDb, openDatabase, closeDb };
