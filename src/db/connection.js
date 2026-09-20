// اتصال واحد (singleton) به فایل دیتابیس SQLite با better-sqlite3.
// انتخاب SQLite برای فاز ۱: نیاز به سرویس دیتابیس جداگانه ندارد و روی ویندوز
// در کنار اجرای برنامه با NSSM به‌سادگی کار می‌کند (فقط یک فایل .db).

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const { SCHEMA_STATEMENTS } = require('./schema');

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;

  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dbInstance = new Database(config.dbPath);
  dbInstance.pragma('journal_mode = WAL'); // پایداری بهتر روی نوشتن‌های همزمان
  dbInstance.pragma('foreign_keys = ON');

  for (const statement of SCHEMA_STATEMENTS) {
    dbInstance.exec(statement);
  }

  return dbInstance;
}

module.exports = { getDb };
