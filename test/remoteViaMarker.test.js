// R5-۲ (فاز ۱۴): migration ۰۳۸ — ستون نشانگر via_remote روی attendance_records و break_records.
// فقط نشانگر است: ارتقا از ۰۳۷ روی دیتابیسِ دارای داده، پیش‌فرض ۰، قید ۰/۱، idempotent بودن و استقلال از via_pending_mission.
require('./helpers/testEnv');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate, loadMigrations, MIGRATIONS_DIR } = require('../src/db/migrator');
const { cleanup } = require('./helpers/testEnv');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-marker-test-'));
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
// پوشه‌ای با migrationهای واقعی تا شماره‌ی n
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
const dump = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const withoutMarker = (rows) => rows.map((r) => { const { via_remote: _v, ...rest } = r; return rest; });
const colInfo = (db, table, col) => db.pragma(`table_info(${table})`).find((c) => c.name === col);

function seed037(db) {
  db.exec(`
    INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id) VALUES
      ('4001','مدیر نمونه','M1','فنی','admin',NULL),
      ('4002','سرپرست نمونه','M2','فنی','manager',1),
      ('4003','کارمند نمونه','M3','فنی','employee',2);
    INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_out_time, check_out_ip, status) VALUES
      (3,'2026-10-10','2026-10-10T05:00:00.000Z','192.168.10.5','2026-10-10T13:00:00.000Z','192.168.10.5','normal'),
      (3,'2026-10-11','2026-10-11T05:20:00.000Z','192.168.10.5',NULL,NULL,'late');
    INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (1,'lunch','2026-10-10T08:00:00.000Z','2026-10-10T08:40:00.000Z');
  `);
}

describe('migration ۰۳۸ — نشانگر via_remote (R5-۲)', () => {
  test('ارتقا از ۰۳۷ روی دیتابیس دارای داده: فقط ۰۳۸ اعمال می‌شود، ردیف‌های قبلی همه via_remote = 0 و بقیه‌ی ستون‌ها بدون تغییر', () => {
    const db = newDb();
    migrate(db, { dir: migrationsUpTo(37) });
    seed037(db);
    const before = { att: dump(db, 'attendance_records'), brk: dump(db, 'break_records'), users: dump(db, 'users') };
    assert.ok(!('via_remote' in before.att[0]));

    const backupDir = path.join(work, 'backups-marker');
    const res = migrate(db, { dir: MIGRATIONS_DIR, backupDir });
    assert.deepEqual(res.applied, ['038_remote_via_marker']);
    assert.ok(res.backupPath && fs.existsSync(res.backupPath), 'قبل از migration بک‌آپ گرفته می‌شود');

    const att = dump(db, 'attendance_records');
    const brk = dump(db, 'break_records');
    assert.deepEqual(withoutMarker(att), before.att);
    assert.deepEqual(withoutMarker(brk), before.brk);
    assert.deepEqual(att.map((r) => r.via_remote), [0, 0]);
    assert.deepEqual(brk.map((r) => r.via_remote), [0]);
    assert.deepEqual(dump(db, 'users'), before.users);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');

    assert.deepEqual(migrate(db, { dir: MIGRATIONS_DIR, backupDir }).applied, [], 'اجرای دوم کاری نمی‌کند');
  });

  test('تعریف ستون: INTEGER، NOT NULL، پیش‌فرض ۰ روی هر دو جدول رسمی', () => {
    const db = newDb();
    migrate(db, {});
    for (const t of ['attendance_records', 'break_records']) {
      const c = colInfo(db, t, 'via_remote');
      assert.ok(c, t);
      assert.equal(c.type, 'INTEGER', t);
      assert.equal(c.notnull, 1, t);
      assert.equal(String(c.dflt_value), '0', t);
    }
  });

  test('مسیرهای فعلی ثبت (بدون اشاره به via_remote) پیش‌فرض ۰ می‌گیرند؛ فقط ۰ و ۱ مجازند و NULL رد می‌شود', () => {
    const db = newDb();
    migrate(db, {});
    seed037(db);
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status) VALUES (3, '2026-10-12', '2026-10-12T05:00:00.000Z', 'normal')").run();
    const id = db.prepare("SELECT id FROM attendance_records WHERE record_date = '2026-10-12'").get().id;
    db.prepare("INSERT INTO break_records (attendance_record_id, break_type, start_time) VALUES (?, 'lunch', '2026-10-12T08:00:00.000Z')").run(id);
    assert.equal(db.prepare('SELECT via_remote FROM attendance_records WHERE id = ?').get(id).via_remote, 0);
    assert.equal(db.prepare('SELECT via_remote FROM break_records WHERE attendance_record_id = ?').get(id).via_remote, 0);

    for (const t of ['attendance_records', 'break_records']) {
      const idCol = t === 'attendance_records' ? 'id' : 'attendance_record_id';
      assert.doesNotThrow(() => db.prepare(`UPDATE ${t} SET via_remote = 1 WHERE ${idCol} = ?`).run(id), t);
      assert.throws(() => db.prepare(`UPDATE ${t} SET via_remote = 2 WHERE ${idCol} = ?`).run(id), /CHECK|constraint/i, t);
      assert.throws(() => db.prepare(`UPDATE ${t} SET via_remote = -1 WHERE ${idCol} = ?`).run(id), /CHECK|constraint/i, t);
      assert.throws(() => db.prepare(`UPDATE ${t} SET via_remote = NULL WHERE ${idCol} = ?`).run(id), /NOT NULL|constraint/i, t);
    }
  });

  test('تابع up idempotent است: اجرای دوباره خطا نمی‌دهد و ردیفِ علامت‌خورده را به ۰ برنمی‌گرداند', () => {
    const db = newDb();
    migrate(db, {});
    seed037(db);
    db.prepare('UPDATE attendance_records SET via_remote = 1 WHERE id = 2').run();
    db.prepare('UPDATE break_records SET via_remote = 1 WHERE id = 1').run();

    const m = loadMigrations(MIGRATIONS_DIR).find((x) => x.name === '038_remote_via_marker');
    assert.ok(m);
    assert.equal(m.foreignKeys, true);
    assert.doesNotThrow(() => { m.up(db); m.up(db); });
    assert.deepEqual(dump(db, 'attendance_records').map((r) => r.via_remote), [0, 1]);
    assert.deepEqual(dump(db, 'break_records').map((r) => r.via_remote), [1]);
    for (const t of ['attendance_records', 'break_records']) {
      assert.equal(db.pragma(`table_info(${t})`).filter((c) => c.name === 'via_remote').length, 1, t);
    }
  });

  test('via_remote مستقل از via_pending_mission (۰۲۴) است و ستون‌های قبلی را تغییر نمی‌دهد', () => {
    const db = newDb();
    migrate(db, {});
    seed037(db);
    db.prepare('UPDATE attendance_records SET via_pending_mission = 1 WHERE id = 1').run();
    db.prepare('UPDATE attendance_records SET via_remote = 1 WHERE id = 2').run();
    const rows = dump(db, 'attendance_records');
    assert.deepEqual(rows.map((r) => [r.via_pending_mission, r.via_remote]), [[1, 0], [0, 1]]);
    // UNIQUE(user_id, record_date) دست‌نخورده است (R5-۴ باید با آن سازگار بماند)
    assert.throws(() => db.prepare("INSERT INTO attendance_records (user_id, record_date, status) VALUES (3, '2026-10-10', 'normal')").run(), /UNIQUE|constraint/i);
  });
});
