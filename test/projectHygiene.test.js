// نظافت پروژه: فایل‌های پشتیبان دستی نباید در پروژه/بسته بمانند؛ تاریخ شروع فقط برای تنظیمات تاریخ‌دار؛ رفع هشدار checksum.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'dist', 'logs'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}

describe('نظافت پروژه', () => {
  test('هیچ فایل پشتیبان دستی (*.bak*, *.orig) داخل پروژه نیست', () => {
    const stray = walk(ROOT).filter((f) => /\.(bak|orig)(-.*)?$/i.test(f)).map((f) => path.relative(ROOT, f));
    assert.deepEqual(stray, []);
  });

  test('بسته‌ی تحویل و .gitignore فایل‌های پشتیبان را کنار می‌گذارند', () => {
    const { isExcludedFile } = require('../scripts/lib/releaseFiles');
    for (const n of ['config.js.bak-ai4', 'x.bak', 'y.orig']) assert.equal(isExcludedFile(n), true, n);
    assert.equal(isExcludedFile('config.js'), false);
    assert.match(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /\*\.bak/);
  });
});

describe('تاریخ شروع اعمال و checksum', () => {
  let adminRouteSrc; let migrator; let db;
  before(() => {
    resetDb(); adminRouteSrc = fs.readFileSync(path.join(ROOT, 'src/api/routes/admin/settings.js'), 'utf8');
    migrator = require('../src/db/migrator'); db = require('../src/db/connection').getDb();
  });
  after(() => cleanup());

  test('API: effectiveFrom برای کلید غیرتاریخ‌دار رد می‌شود (کد منبع)', () => {
    assert.match(adminRouteSrc, /تاریخ‌دار نیست/);
    assert.match(adminRouteSrc, /settingsHistory\.isTracked/);
  });

  test('restampChecksum: ناهماهنگی را درست می‌کند و بار دوم تغییری نمی‌دهد', () => {
    const name = db.prepare('SELECT name FROM schema_migrations ORDER BY id LIMIT 1').get().name;
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE name = ?').run('x'.repeat(64), name);
    assert.equal(migrator.getStatus(db).items.find((i) => i.name === name).checksumMismatch, true);
    assert.equal(migrator.restampChecksum(db, name).changed, true);
    assert.equal(migrator.getStatus(db).items.find((i) => i.name === name).checksumMismatch, false);
    assert.equal(migrator.restampChecksum(db, name).changed, false);
    assert.throws(() => migrator.restampChecksum(db, 'no_such_migration'), /پیدا نشد/);
  });
});
