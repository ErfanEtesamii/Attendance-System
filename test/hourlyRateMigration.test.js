// Phase 20 — migration ۰۴۳: ستون hourly_rate_kt روی users (ارتقا از ۰۴۲ روی دیتابیس دارای داده، idempotent، پیش‌فرض NULL).
require('./helpers/testEnv');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate, MIGRATIONS_DIR } = require('../src/db/migrator');
const { cleanup } = require('./helpers/testEnv');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hourly-rate-migration-test-'));
after(() => {
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { /* ویندوز */ }
  cleanup();
});

let counter = 0;
function newDb() {
  counter += 1;
  const db = new Database(path.join(work, `db${counter}.db`));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
function migrationsUpTo(n) {
  counter += 1;
  const dir = path.join(work, `m${counter}`);
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    const m = /^(\d{3,})_/.exec(f);
    if (m && parseInt(m[1], 10) <= n) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  return dir;
}
const userCols = (db) => db.prepare("PRAGMA table_info('users')").all();

describe('migration ۰۴۳ — hourly_rate_kt', () => {
  test('ارتقا از ۰۴۲ روی دیتابیس دارای داده: ستون NULL‌پذیر اضافه می‌شود و داده‌ی قبلی دست‌نخورده می‌ماند', () => {
    const db = newDb();
    migrate(db, { dir: migrationsUpTo(42) });
    assert.equal(userCols(db).some((c) => c.name === 'hourly_rate_kt'), false);
    db.exec("INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES ('9001','کارمند نمونه','H1','فنی','employee')");
    const before = db.prepare('SELECT id, full_name, role FROM users').all();

    migrate(db);
    const col = userCols(db).find((c) => c.name === 'hourly_rate_kt');
    assert.ok(col);
    assert.equal(col.notnull, 0);
    assert.equal(col.dflt_value, null);
    assert.deepEqual(db.prepare('SELECT id, full_name, role FROM users').all(), before);
    assert.equal(db.prepare('SELECT hourly_rate_kt AS r FROM users').get().r, null);
    db.close();
  });

  test('idempotent: اجرای دوباره (و وجود قبلیِ ستون) خطا نمی‌دهد', () => {
    const db = newDb();
    migrate(db);
    migrate(db);
    assert.equal(userCols(db).filter((c) => c.name === 'hourly_rate_kt').length, 1);

    const db2 = newDb();
    migrate(db2, { dir: migrationsUpTo(42) });
    db2.exec('ALTER TABLE users ADD COLUMN hourly_rate_kt INTEGER NULL');
    assert.doesNotThrow(() => migrate(db2));
    db.close(); db2.close();
  });

  test('مقدار عدد صحیحِ نامنفی پذیرفته می‌شود و مقدار منفی رد می‌شود', () => {
    const db = newDb();
    migrate(db);
    db.exec("INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES ('9002','کارمند','H2','فنی','employee')");
    db.prepare('UPDATE users SET hourly_rate_kt = ? WHERE id = 1').run(100);
    assert.equal(db.prepare('SELECT hourly_rate_kt AS r FROM users WHERE id = 1').get().r, 100);
    assert.throws(() => db.prepare('UPDATE users SET hourly_rate_kt = -1 WHERE id = 1').run());
    db.close();
  });
});
