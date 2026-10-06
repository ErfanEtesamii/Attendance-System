require('./helpers/testEnv');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { migrate, getStatus, loadMigrations, rebuildTable, MIGRATIONS_DIR } = require('../src/db/migrator');
const { SCHEMA_STATEMENTS: LEGACY_STATEMENTS } = require('./fixtures/legacy-schema');
const { cleanup } = require('./helpers/testEnv');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-test-'));
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
  cleanup();
});

let n = 0;
function newDb() {
  n += 1;
  const db = new Database(path.join(work, `db${n}.db`));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function userTables(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY name")
    .all()
    .map((r) => r.name);
}

// ستون session_version را (که migration شماره ۰۰۲ عمداً اضافه می‌کند) کنار می‌گذاریم تا مقایسه‌ی «هیچ داده‌ای تغییر نکرده»
// فقط روی ستون‌های اصلی باشد؛ خودِ ۰۰۲ در تست جدا (migration 002) بررسی می‌شود.
function snapshot(db) {
  const out = {};
  // rate_limit_hits (migration ۰۰۳) و job_runs/monitor_alerts/monitor_state (migration ۰۰۴) جدول‌های جدیدِ عملیاتی‌اند (داده‌ی کاربری نیستند)
  // suspicious_events (migration ۰۰۶، S2-4a) هم جدول جدید و خالی است
  // پس از مقایسه‌ی «بدون تغییر داده» کنار می‌مانند
  const OPERATIONAL = ['rate_limit_hits', 'job_runs', 'monitor_alerts', 'monitor_state', 'suspicious_events'];
  for (const t of userTables(db).filter((n) => !OPERATIONAL.includes(n))) {
    out[t] = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((r) => {
      const row = { ...r };
      if (t === 'users') delete row.session_version;
      // ستون‌های device/UA (migration ۰۰۵، S2-3) جدیدند و روی رکوردهای قدیمی NULL می‌مانند
      if (t === 'attendance_records') for (const c of ['check_in_device', 'check_out_device', 'check_in_ua', 'check_out_ua']) delete row[c];
      return row;
    });
  }
  return out;
}

function shape(db) {
  const out = {};
  for (const t of userTables(db)) {
    out[t] = db.pragma(`table_info("${t}")`).map((c) => `${c.name}:${c.type}:${c.notnull}:${c.pk}`);
  }
  out.__indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  return out;
}

// دیتابیس «قدیمی» دقیقاً با ساختار پیش از migration + چند رکورد واقعی‌نما
function makeLegacyDb() {
  const db = newDb();
  for (const s of LEGACY_STATEMENTS) db.exec(s);
  db.exec(`
    INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id) VALUES
      ('1001','مدیر نمونه','P1','فنی','admin',NULL),
      ('1002','سرپرست نمونه','P2','فنی','manager',1),
      ('1003','کارمند نمونه','P3','فنی','employee',2);
    INSERT INTO attendance_records (user_id, record_date, check_in_time, check_in_ip, check_out_time, check_out_ip, status) VALUES
      (3,'2026-09-20','2026-09-20T05:00:00.000Z','192.168.10.5','2026-09-20T13:00:00.000Z','192.168.10.5','normal'),
      (3,'2026-09-21','2026-09-21T05:20:00.000Z','192.168.10.5',NULL,NULL,'late');
    INSERT INTO break_records (attendance_record_id, break_type, start_time, end_time) VALUES (1,'lunch','2026-09-20T08:00:00.000Z','2026-09-20T08:40:00.000Z');
    INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, status, approver_id, reason) VALUES (3,'2026-09-25','2026-09-26','leave','approved',2,'تست');
    INSERT INTO holidays (holiday_date, title) VALUES ('2026-10-01','تعطیلی تست');
    INSERT INTO record_disputes (user_id, attendance_record_id, message) VALUES (3,2,'اعتراض نمونه');
    INSERT INTO settings (key, value) VALUES ('work_day_start','08:30');
    INSERT INTO audit_log (user_id, action, ip_address, details) VALUES (1,'record_manually_fixed','192.168.10.2','{"a":1}');
  `);
  return db;
}

describe('migration runner — پایه', () => {
  test('دیتابیس خالی: baseline اعمال و ثبت می‌شود، اجرای دوم هیچ کاری نمی‌کند', () => {
    const db = newDb();
    const r1 = migrate(db, {});
    assert.deepEqual(r1.applied, ['001_baseline', '002_session_version', '003_rate_limits', '004_monitoring', '005_attendance_devices', '006_suspicious_events']);
    assert.equal(r1.backupPath, null, 'روی دیتابیس خالی بک‌آپ لازم نیست');
    for (const t of ['users', 'attendance_records', 'break_records', 'leave_requests', 'holidays', 'record_disputes', 'settings', 'audit_log']) {
      assert.ok(userTables(db).includes(t), `جدول ${t} باید ساخته شود`);
    }
    const row = db.prepare('SELECT * FROM schema_migrations').all();
    assert.equal(row.length, 6);
    assert.equal(row[0].name, '001_baseline');
    assert.match(row[0].checksum, /^[0-9a-f]{64}$/);

    const r2 = migrate(db, {});
    assert.deepEqual(r2.applied, []);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 6);
  });

  test('دیتابیس قدیمی با داده: adopt می‌شود، هیچ داده‌ای تغییر نمی‌کند، بک‌آپ سالم گرفته می‌شود', () => {
    const db = makeLegacyDb();
    const before = snapshot(db);
    const backupDir = path.join(work, 'backups-adopt');

    const logs = [];
    const res = migrate(db, { backupDir, log: (m) => logs.push(m) });
    assert.deepEqual(res.applied, ['001_baseline', '002_session_version', '003_rate_limits', '004_monitoring', '005_attendance_devices', '006_suspicious_events']);
    assert.deepEqual(snapshot(db), before, 'محتوای همه جدول‌ها باید دقیقاً یکسان بماند');

    // بک‌آپ: فایل معتبر با همان داده‌ها
    assert.ok(res.backupPath && fs.existsSync(res.backupPath));
    const bak = new Database(res.backupPath);
    assert.equal(bak.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(snapshot(bak), before);
    bak.close();
  });

  test('parity: ساختار دیتابیس تازه با دیتابیس قدیمیِ migrate‌شده یکی است', () => {
    const fresh = newDb();
    migrate(fresh, {});
    const legacy = makeLegacyDb();
    migrate(legacy, {});
    assert.deepEqual(shape(legacy), shape(fresh));
  });

  test('migrationهای واقعی پروژه: نام/شماره معتبر و بدون تکرار', () => {
    const list = loadMigrations(MIGRATIONS_DIR);
    assert.ok(list.length >= 1);
    assert.equal(list[0].name, '001_baseline');
    assert.equal(new Set(list.map((m) => m.id)).size, list.length);
  });
});

// ---- پوشه موقت migration برای سناریوهای شکست/بازسازی ----
function makeMigrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(work, 'mdir-'));
  fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_baseline.js'), path.join(dir, '001_baseline.js'));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);
  return dir;
}

describe('migration runner — شکست و ایمنی', () => {
  test('خطا در میانه migration: rollback کامل، ثبت نمی‌شود، migration قبلی سالم می‌ماند', () => {
    const dir = makeMigrationsDir({
      '002_boom.js': `module.exports = { name: '002_boom', up(db) {
        db.exec('CREATE TABLE half_done (id INTEGER)');
        db.exec("INSERT INTO settings (key, value) VALUES ('x','1')");
        throw new Error('عمداً خراب');
      } };`,
    });
    const db = newDb();
    assert.throws(() => migrate(db, { dir }), /عمداً خراب/);
    assert.ok(!userTables(db).includes('half_done'), 'جدول نیمه‌کاره نباید بماند');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE key='x'").get().n, 0);
    assert.deepEqual(db.prepare('SELECT name FROM schema_migrations ORDER BY id').all().map((r) => r.name), ['001_baseline']);
    assert.equal(db.inTransaction, false);
    // pragma باید دوباره روشن باشد
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  });

  test('تغییر فایل migration اعمال‌شده هشدار می‌دهد؛ تفاوت CRLF/LF هشدار نمی‌دهد', () => {
    const dir = makeMigrationsDir({});
    const db = newDb();
    migrate(db, { dir });

    const logs = [];
    migrate(db, { dir, log: (m) => logs.push(m) });
    assert.equal(logs.filter((l) => l.includes('checksum')).length, 0);

    const p = path.join(dir, '001_baseline.js');
    const src = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, src.replace(/\n/g, '\r\n')); // فقط پایان‌خط
    migrate(db, { dir, log: (m) => logs.push(m) });
    assert.equal(logs.filter((l) => l.includes('checksum')).length, 0, 'CRLF نباید تغییر محسوب شود');

    fs.writeFileSync(p, src + '\n// ویرایش واقعی\n');
    migrate(db, { dir, log: (m) => logs.push(m) });
    assert.equal(logs.filter((l) => l.includes('checksum')).length, 1);
    assert.equal(getStatus(db, dir).items[0].checksumMismatch, true);
  });

  test('نام نامعتبر، شماره تکراری، و migration خارج از ترتیب رد می‌شود', () => {
    assert.throws(() => loadMigrations(makeMigrationsDir({ 'bad name.js': '' })), /نام فایل migration نامعتبر/);
    assert.throws(
      () => loadMigrations(makeMigrationsDir({ '001_other.js': "module.exports={name:'001_other',up(){}}" })),
      /تکراری/
    );
    assert.throws(
      () => loadMigrations(makeMigrationsDir({ '002_x.js': "module.exports={name:'002_wrong',up(){}}" })),
      /name داخل/
    );

    const db = newDb();
    const dirA = makeMigrationsDir({ '005_late.js': "module.exports={name:'005_late',up(){}}" });
    migrate(db, { dir: dirA });
    const dirB = makeMigrationsDir({
      '005_late.js': "module.exports={name:'005_late',up(){}}",
      '003_early.js': "module.exports={name:'003_early',up(){}}",
    });
    assert.throws(() => migrate(db, { dir: dirB }), /خارج از ترتیب/);
  });

  test('شکست بک‌آپ: هیچ چیزی روی دیتابیس نوشته نمی‌شود و migration اجرا نمی‌شود', () => {
    const db = makeLegacyDb();
    const before = snapshot(db);
    const notADir = path.join(work, 'i-am-a-file');
    fs.writeFileSync(notADir, 'x');
    assert.throws(() => migrate(db, { backupDir: notADir }));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='schema_migrations'").get().n, 0, 'حتی جدول schema_migrations هم ساخته نشود');
    assert.deepEqual(snapshot(db), before);
  });

  test('اگر migration جدیدی وجود دارد و دیتابیس داده دارد، قبل از اجرا بک‌آپ گرفته می‌شود', () => {
    const dir = makeMigrationsDir({ '002_noop.js': "module.exports={name:'002_noop',up(){}}" });
    const db = makeLegacyDb();
    migrate(db, { dir: makeMigrationsDir({}) }); // baseline
    const backupDir = path.join(work, 'backups-002');
    const res = migrate(db, { dir, backupDir });
    assert.deepEqual(res.applied, ['002_noop']);
    assert.ok(fs.existsSync(res.backupPath));
  });
});

describe('rebuildTable — تغییر CHECK روی جدول مرجع‌شده', () => {
  const USERS_WITH_HR = `CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT UNIQUE,
    full_name TEXT NOT NULL,
    personnel_code TEXT UNIQUE,
    department TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','manager','admin','hr')),
    manager_id INTEGER REFERENCES users(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    session_version INTEGER NOT NULL DEFAULT 0
  )`;

  function migrationSource(foreignKeysLine) {
    return `module.exports = { name: '002_users_hr', ${foreignKeysLine}
      up(db, { rebuildTable }) { rebuildTable(db, 'users', ${JSON.stringify(USERS_WITH_HR)}); } };`;
  }

  test('نقش جدید پذیرفته می‌شود، داده‌ها/FKها/ایندکس‌ها/شمارنده id سالم می‌مانند', () => {
    const dir = makeMigrationsDir({ '002_users_hr.js': migrationSource('foreignKeys: false,') });
    const db = makeLegacyDb();
    // ایجاد «حفره» در شمارنده AUTOINCREMENT: کاربر ۴ ساخته و حذف می‌شود
    db.exec("INSERT INTO users (telegram_user_id, full_name, role) VALUES ('1004','موقت','employee')");
    db.exec('DELETE FROM users WHERE id = 4');
    migrate(db, { dir: makeMigrationsDir({}) }); // baseline
    const before = snapshot(db);

    migrate(db, { dir, backupDir: path.join(work, 'backups-hr') });

    assert.deepEqual(snapshot(db), before, 'داده همه جدول‌ها (از جمله فرزندان users) بدون تغییر');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign_keys باید دوباره روشن شود');

    // CHECK جدید فعال و قدیمی رفته
    db.exec("INSERT INTO users (telegram_user_id, full_name, role) VALUES ('2001','منابع انسانی','hr')");
    assert.throws(() => db.exec("INSERT INTO users (telegram_user_id, full_name, role) VALUES ('2002','x','ceo')"), /CHECK/);

    // شمارنده id عقب نرفته (id=4 قبلاً استفاده شده بود → کاربر جدید ≥ ۵)
    const hr = db.prepare("SELECT id FROM users WHERE telegram_user_id='2001'").get();
    assert.ok(hr.id >= 5, `id جدید ${hr.id} نباید از id حذف‌شده قبلی استفاده مجدد کند`);

    // FK همچنان اعمال می‌شود (جدول فرزند به users جدید اشاره می‌کند)
    assert.throws(() => db.exec("INSERT INTO attendance_records (user_id, record_date) VALUES (9999,'2026-01-01')"), /FOREIGN KEY/);

    // ایندکس‌های جدول‌های فرزند و UNIQUE ها سالم
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().map((r) => r.name);
    assert.ok(idx.includes('idx_attendance_user_date'));
    assert.throws(() => db.exec("INSERT INTO users (telegram_user_id, full_name) VALUES ('1001','تکراری')"), /UNIQUE/);
  });

  test('بدون foreignKeys:false خطای راهنما می‌دهد و rollback می‌شود', () => {
    const dir = makeMigrationsDir({ '002_users_hr.js': migrationSource('') });
    const db = makeLegacyDb();
    migrate(db, { dir: makeMigrationsDir({}) });
    const before = snapshot(db);
    assert.throws(() => migrate(db, { dir }), /foreignKeys: false/);
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name='002_users_hr'").get().n, 0);
    assert.throws(() => db.exec("INSERT INTO users (telegram_user_id, full_name, role) VALUES ('3','x','hr')"), /CHECK/, 'نقش جدید نباید پذیرفته شده باشد');
  });

  test('expressions: تبدیل داده هنگام بازسازی (نگاشت مقدار قدیمی به جدید)', () => {
    const dir = makeMigrationsDir({
      '002_leave_kind.js': `module.exports = { name: '002_leave_kind', foreignKeys: false,
        up(db, { rebuildTable }) {
          rebuildTable(db, 'leave_requests', \`CREATE TABLE leave_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            leave_type TEXT NOT NULL DEFAULT 'annual' CHECK (leave_type IN ('annual','sick','mission')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
            approver_id INTEGER REFERENCES users(id),
            reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
          )\`, { expressions: { leave_type: "CASE leave_type WHEN 'leave' THEN 'annual' ELSE leave_type END" } });
        } };`,
    });
    const db = makeLegacyDb();
    db.exec("INSERT INTO leave_requests (user_id,start_date,end_date,leave_type,status) VALUES (3,'2026-10-02','2026-10-02','mission','approved')");
    migrate(db, { dir: makeMigrationsDir({}) });
    migrate(db, { dir });
    const types = db.prepare('SELECT leave_type FROM leave_requests ORDER BY id').all().map((r) => r.leave_type);
    assert.deepEqual(types, ['annual', 'mission']);
  });

  test('rebuildTable خارج از migration (بدون transaction) هم امن کار می‌کند', () => {
    const db = makeLegacyDb();
    migrate(db, {});
    const before = snapshot(db);
    rebuildTable(db, 'users', USERS_WITH_HR);
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  });
});

describe('migration 002 — session_version', () => {
  test('روی دیتابیس قدیمی با داده: ستون اضافه می‌شود، همه‌ی کاربران ۰ می‌گیرند و هیچ داده‌ای از بین نمی‌رود', () => {
    const db = makeLegacyDb();
    const usersBefore = db.prepare('SELECT * FROM users ORDER BY id').all();
    migrate(db, {});
    const usersAfter = db.prepare('SELECT * FROM users ORDER BY id').all();
    assert.equal(usersAfter.length, usersBefore.length);
    usersAfter.forEach((u, i) => {
      assert.equal(u.session_version, 0);
      const { session_version: _sv, ...rest } = u;
      assert.deepEqual(rest, usersBefore[i]);
    });
  });

  test('idempotent: اگر ستون از قبل وجود دارد خطا نمی‌دهد', () => {
    const db = newDb();
    migrate(db, {});
    const m = require('../src/db/migrations/002_session_version');
    assert.doesNotThrow(() => m.up(db));
  });
});
