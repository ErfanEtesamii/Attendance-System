// R1-ج: migrationهای ۰۳۶ و ۰۳۷ در کنار هم — ارتقا از ۰۳۵ روی دیتابیسِ دارای داده، idempotent بودن، زنجیره‌ی کلیدهای خارجی و جدا بودن داده‌ی رسمی.
require('./helpers/testEnv');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate, loadMigrations, MIGRATIONS_DIR } = require('../src/db/migrator');
const { cleanup } = require('./helpers/testEnv');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-migration-test-'));
after(() => {
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { /* ویندوز: فایل هنوز باز است؛ پوشه‌ی temp را سیستم‌عامل بعداً پاک می‌کند */ }
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
// پوشه‌ای با migrationهای واقعی تا شماره‌ی n (مثل test/leaveUnits.test.js)
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
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();

function seed035(db) {
  db.exec(`
    INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id) VALUES
      ('2001','مدیر نمونه','R1','فنی','admin',NULL),
      ('2002','سرپرست نمونه','R2','فنی','manager',1),
      ('2003','کارمند نمونه','R3','فنی','employee',2);
    INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_out_time, check_out_ip, status) VALUES
      (3,'2026-10-10','2026-10-10T05:00:00.000Z','192.168.10.5','2026-10-10T13:00:00.000Z','192.168.10.5','normal'),
      (3,'2026-10-11','2026-10-11T05:20:00.000Z','192.168.10.5',NULL,NULL,'late');
    INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (1,'lunch','2026-10-10T08:00:00.000Z','2026-10-10T08:40:00.000Z');
  `);
}

describe('migration ۰۳۶/۰۳۷ — ارتقا و idempotent (R1-ج)', () => {
  test('ارتقا از ۰۳۵ روی دیتابیس دارای داده: فقط دو migration اعمال می‌شود، داده‌ی رسمی بدون تغییر، جدول‌های جدید خالی', () => {
    const db = newDb();
    migrate(db, { dir: migrationsUpTo(35) });
    assert.equal(hasTable(db, 'remote_work_sessions'), false);
    assert.equal(hasTable(db, 'remote_work_breaks'), false);
    seed035(db);
    const before = { users: dump(db, 'users'), att: dump(db, 'attendance_records'), brk: dump(db, 'break_records') };

    const backupDir = path.join(work, 'backups-remote');
    const res = migrate(db, { dir: MIGRATIONS_DIR, backupDir });
    assert.deepEqual(res.applied, ['036_remote_work_sessions', '037_remote_work_breaks']);
    assert.ok(res.backupPath && fs.existsSync(res.backupPath), 'قبل از migration بک‌آپ گرفته می‌شود');

    assert.deepEqual(dump(db, 'users'), before.users);
    assert.deepEqual(dump(db, 'attendance_records'), before.att);
    assert.deepEqual(dump(db, 'break_records'), before.brk);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_sessions').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks').get().n, 0);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');

    assert.deepEqual(migrate(db, { dir: MIGRATIONS_DIR, backupDir }).applied, [], 'اجرای دوم کاری نمی‌کند');
  });

  test('تابع up هر دو migration idempotent است: اجرای دوباره خطا نمی‌دهد و داده‌ی نشست/استراحت را نمی‌خورد', () => {
    const db = newDb();
    migrate(db, {});
    const sid = db.prepare("INSERT INTO remote_work_sessions (user_id, work_date, start_at) VALUES (NULL, '2026-10-17', '2026-10-17T05:00:00.000Z')");
    assert.throws(() => sid.run(), /NOT NULL|constraint/i, 'user_id اجباری است');
    db.exec("INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES ('2101','کارمند','RX1','فنی','employee')");
    const uid = db.prepare("SELECT id FROM users WHERE telegram_user_id = '2101'").get().id;
    const s = db.prepare("INSERT INTO remote_work_sessions (user_id, work_date, start_at) VALUES (?, '2026-10-17', '2026-10-17T05:00:00.000Z')").run(uid).lastInsertRowid;
    db.prepare("INSERT INTO remote_work_breaks (session_id, start_at) VALUES (?, '2026-10-17T08:00:00.000Z')").run(s);

    const list = loadMigrations(MIGRATIONS_DIR);
    for (const name of ['036_remote_work_sessions', '037_remote_work_breaks']) {
      const m = list.find((x) => x.name === name);
      assert.ok(m, name);
      assert.doesNotThrow(() => { m.up(db); m.up(db); }, name);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_sessions').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks').get().n, 1);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_remote_%' ORDER BY name").all().map((r) => r.name);
    assert.deepEqual(idx, [
      'idx_remote_breaks_one_open', 'idx_remote_breaks_session',
      'idx_remote_sessions_one_open', 'idx_remote_sessions_status_date', 'idx_remote_sessions_user_date',
    ]);
  });

  test('شماره‌گذاری: migrationها پیوسته‌اند و ۰۳۶ و ۰۳۷ آخرین‌های فعلی‌اند، با کلید خارجی روشن', () => {
    const list = loadMigrations(MIGRATIONS_DIR);
    assert.deepEqual(list.map((m) => m.id), list.map((_, i) => i + 1), 'شماره‌ها بدون جا افتادگی');
    const i36 = list.findIndex((m) => m.name === '036_remote_work_sessions');
    assert.ok(i36 >= 0 && list[i36 + 1] && list[i36 + 1].name === '037_remote_work_breaks');
    assert.equal(list[i36].foreignKeys, true);
    assert.equal(list[i36 + 1].foreignKeys, true);
  });
});

describe('دورکاری — زنجیره‌ی کلیدهای خارجی و جدا بودن از داده‌ی رسمی (R1-ج)', () => {
  const db = newDb();
  migrate(db, {});
  const mkUser = (code) => db.prepare("INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES (?, 'کارمند', ?, 'فنی', 'employee')").run(`3${code}`, `RC${code}`).lastInsertRowid;

  test('جدول‌های رسمی حضور و استراحت هیچ ستونی برای دورکاری ندارند (تا تأیید R5 داده‌ی دورکاری وارد آن‌ها نمی‌شود)', () => {
    for (const t of ['attendance_records', 'break_records']) {
      const cols = db.pragma(`table_info(${t})`).map((c) => c.name);
      assert.ok(!cols.some((c) => /remote/i.test(c)), `${t}: ${cols.join()}`);
    }
  });

  test('حذف رکورد رسمیِ پیوندخورده ⇒ attendance_record_id نشست NULL می‌شود و نشست و استراحتش می‌مانند', () => {
    const uid = mkUser('01');
    const rec = db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status) VALUES (?, '2026-10-17', '2026-10-17T05:00:00.000Z', 'normal')").run(uid).lastInsertRowid;
    const s = db.prepare("INSERT INTO remote_work_sessions (user_id, work_date, start_at, end_at, status, attendance_record_id) VALUES (?, '2026-10-17', '2026-10-17T05:00:00.000Z', '2026-10-17T12:00:00.000Z', 'approved', ?)").run(uid, rec).lastInsertRowid;
    db.prepare("INSERT INTO remote_work_breaks (session_id, start_at, end_at) VALUES (?, '2026-10-17T08:00:00.000Z', '2026-10-17T08:30:00.000Z')").run(s);
    db.prepare('DELETE FROM attendance_records WHERE id = ?').run(rec);
    assert.equal(db.prepare('SELECT attendance_record_id FROM remote_work_sessions WHERE id = ?').get(s).attendance_record_id, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks WHERE session_id = ?').get(s).n, 1);
  });

  test('حذف کاربر ⇒ نشست‌هایش و استراحت‌های آن نشست‌ها پشت‌سرهم پاک می‌شوند؛ کاربر دیگر دست‌نخورده', () => {
    const a = mkUser('02');
    const b = mkUser('03');
    const mk = (uid, date) => {
      const sid = db.prepare("INSERT INTO remote_work_sessions (user_id, work_date, start_at, end_at) VALUES (?, ?, ?, ?)").run(uid, date, `${date}T05:00:00.000Z`, `${date}T12:00:00.000Z`).lastInsertRowid;
      db.prepare('INSERT INTO remote_work_breaks (session_id, start_at, end_at) VALUES (?, ?, ?)').run(sid, `${date}T08:00:00.000Z`, `${date}T08:20:00.000Z`);
      return sid;
    };
    const sa = mk(a, '2026-10-24');
    const sb = mk(b, '2026-10-24');
    db.prepare('DELETE FROM users WHERE id = ?').run(a);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_sessions WHERE id = ?').get(sa).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks WHERE session_id = ?').get(sa).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_sessions WHERE id = ?').get(sb).n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks WHERE session_id = ?').get(sb).n, 1);
    assert.equal(db.pragma('foreign_key_check').length, 0);
  });
});
