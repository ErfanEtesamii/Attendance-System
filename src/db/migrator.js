// سیستم migration دیتابیس (بخش ۱-الف).
//
// قواعد:
//   • هر migration یک فایل شماره‌دار در src/db/migrations است: NNN_name.js  با خروجی { name, up(db, helpers), foreignKeys? }
//   • هر migration داخل یک transaction (BEGIN IMMEDIATE ... COMMIT) اجرا می‌شود؛ خطا = rollback کامل و توقف.
//   • فقط migrationهای «اعمال‌نشده» اجرا می‌شوند؛ ترتیب با شماره فایل است.
//   • قبل از اجرای migrationها، اگر دیتابیس داده دارد، یک بک‌آپ سازگار با WAL (VACUUM INTO) گرفته می‌شود.
//   • برای تغییر CHECK/نوع ستون در SQLite باید جدول بازسازی شود: migration باید `foreignKeys: false` اعلام کند
//     و از helpers.rebuildTable استفاده کند (PRAGMA foreign_keys داخل transaction بی‌اثر است، پس runner آن را بیرون از transaction خاموش/روشن می‌کند).
//
// ⚠️ از دیتابیس سازگار با better-sqlite3 فقط این APIها استفاده می‌شود: exec، prepare().run/get/all، pragma().

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_RE = /^(\d{3,})_([a-z0-9_]+)\.js$/;
const KEEP_PRE_MIGRATION_BACKUPS = 10;

// ---------- بارگذاری فایل‌های migration ----------

function checksumOf(filePath) {
  // \r حذف می‌شود تا تفاوت پایان‌خط ویندوز/گیت (CRLF/LF) باعث «تغییر» کاذب نشود
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function loadMigrations(dir = MIGRATIONS_DIR) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
  const list = [];
  for (const file of files) {
    const m = FILE_RE.exec(file);
    if (!m) {
      if (file.endsWith('.js')) throw new Error(`نام فایل migration نامعتبر است (الگو: 002_add_something.js): ${file}`);
      continue;
    }
    const mod = require(path.join(dir, file));
    if (typeof mod.up !== 'function') throw new Error(`migration ${file} تابع up(db) ندارد.`);
    const expectedName = file.replace(/\.js$/, '');
    if (mod.name !== expectedName) {
      throw new Error(`name داخل ${file} باید «${expectedName}» باشد (الان: «${mod.name}»).`);
    }
    list.push({
      id: parseInt(m[1], 10),
      name: expectedName,
      up: mod.up,
      foreignKeys: mod.foreignKeys !== false,
      checksum: checksumOf(path.join(dir, file)),
    });
  }
  list.sort((a, b) => a.id - b.id);
  for (let i = 1; i < list.length; i += 1) {
    if (list[i].id === list[i - 1].id) {
      throw new Error(`شماره migration تکراری است: ${list[i].name} و ${list[i - 1].name}`);
    }
  }
  return list;
}

// ---------- جدول وضعیت ----------

function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    checksum TEXT NOT NULL
  );`);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

function getApplied(db) {
  if (!tableExists(db, 'schema_migrations')) return [];
  return db.prepare('SELECT id, name, applied_at, checksum FROM schema_migrations ORDER BY id').all();
}

// وضعیت برای CLI و تست: اعمال‌شده / در انتظار / ناسازگاری‌ها
function getStatus(db, dir = MIGRATIONS_DIR) {
  const all = loadMigrations(dir);
  const applied = getApplied(db);
  const appliedById = new Map(applied.map((a) => [a.id, a]));
  const known = new Set(all.map((m) => m.id));

  const items = all.map((m) => {
    const a = appliedById.get(m.id);
    return {
      id: m.id,
      name: m.name,
      state: a ? 'applied' : 'pending',
      appliedAt: a ? a.applied_at : null,
      checksumMismatch: a ? a.checksum !== m.checksum : false,
    };
  });
  const unknownApplied = applied.filter((a) => !known.has(a.id)).map((a) => a.name);
  return { items, pending: items.filter((i) => i.state === 'pending'), unknownApplied };
}

// ---------- بک‌آپ قبل از migration ----------

// VACUUM INTO: یک اسنپ‌شات سازگار و transactional از دیتابیس (شامل محتوای WAL) می‌سازد و همزمان (sync) است؛
// برخلاف کپی ساده فایل .db که در حالت WAL می‌تواند ناقص/خراب باشد.
function backupBeforeMigration(db, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupDir, `pre-migration-${stamp}.db`);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } catch (err) {
    // فایل ناقص/صفربایتی نباید به‌عنوان «بک‌آپ» باقی بماند (و بک‌آپ‌های سالم قبلی را از چرخه خارج کند)
    try { fs.unlinkSync(dest); } catch (_) { /* وجود ندارد */ }
    throw err;
  }

  // فقط چند بک‌آپ آخر نگه داشته شود تا دیسک پر نشود
  const old = fs
    .readdirSync(backupDir)
    .filter((f) => /^pre-migration-.*\.db$/.test(f))
    .sort();
  while (old.length > KEEP_PRE_MIGRATION_BACKUPS) {
    fs.unlinkSync(path.join(backupDir, old.shift()));
  }
  return dest;
}

// ---------- helper بازسازی جدول (روش ۱۲ مرحله‌ای رسمی SQLite) ----------

function qid(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function columnsOf(db, table) {
  return db.pragma(`table_info(${qid(table)})`).map((c) => c.name);
}

/**
 * جدول را با تعریف جدید می‌سازد، داده را کپی می‌کند، جدول قدیمی را حذف و نام جدید را جایگزین می‌کند،
 * ایندکس/trigger های قبلی را بازسازی می‌کند و شمارنده AUTOINCREMENT را حفظ می‌کند.
 *
 * @param {object} db
 * @param {string} table نام جدول موجود
 * @param {string} createSql  CREATE TABLE کامل با نام «اصلی» جدول (مثلاً CREATE TABLE users (...))
 * @param {object} [opts]
 * @param {string[]} [opts.columns] ستون‌های جدید که باید کپی شوند (پیش‌فرض: اشتراک ستون‌های قدیم و جدید)
 * @param {Object<string,string>} [opts.expressions] { ستونِ جدید: 'عبارت SQL روی ستون‌های قدیمی' } برای تبدیل داده
 *
 * ⚠️ باید داخل migration با foreignKeys:false صدا زده شود.
 */
function rebuildTable(db, table, createSql, opts = {}) {
  if (!db.inTransaction && typeof db.inTransaction !== 'undefined') {
    // خارج از transaction: خود helper هم transaction و هم pragma را مدیریت می‌کند
    return runOutsideTx(db, () => rebuildTable(db, table, createSql, opts));
  }
  const fkOn = db.pragma('foreign_keys', { simple: true });
  if (fkOn) {
    throw new Error(
      `rebuildTable(${table}): باید PRAGMA foreign_keys=OFF باشد. در migration مقدار foreignKeys: false را export کنید.`
    );
  }

  const tmp = `${table}__new`;
  const oldCols = columnsOf(db, table);
  const sideObjects = db
    .prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL")
    .all(table)
    .map((r) => r.sql);
  const seqRow = tableExists(db, 'sqlite_sequence')
    ? db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table)
    : undefined;

  const createTmp = createSql.replace(
    /^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["`]?\w+["`]?/i,
    `CREATE TABLE ${qid(tmp)}`
  );
  if (createTmp === createSql) throw new Error('rebuildTable: createSql باید با CREATE TABLE <name> شروع شود.');
  db.exec(`DROP TABLE IF EXISTS ${qid(tmp)}`);
  db.exec(createTmp);

  const newCols = columnsOf(db, tmp);
  const expressions = opts.expressions || {};
  const copyCols = (opts.columns || newCols.filter((c) => oldCols.includes(c))).filter((c) => !(c in expressions));
  const targetCols = [...copyCols, ...Object.keys(expressions)];
  const selectExprs = [...copyCols.map(qid), ...Object.values(expressions)];
  for (const c of targetCols) {
    if (!newCols.includes(c)) throw new Error(`rebuildTable(${table}): ستون «${c}» در تعریف جدید نیست.`);
  }
  if (targetCols.length) {
    db.exec(
      `INSERT INTO ${qid(tmp)} (${targetCols.map(qid).join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${qid(table)}`
    );
  }

  db.exec(`DROP TABLE ${qid(table)}`);
  db.exec(`ALTER TABLE ${qid(tmp)} RENAME TO ${qid(table)}`);
  for (const sql of sideObjects) db.exec(sql);

  // AUTOINCREMENT: اگر ردیف‌های آخر قبلاً حذف شده بودند، شمارنده نباید عقب برود (استفاده مجدد از id قدیمی)
  if (seqRow && tableExists(db, 'sqlite_sequence')) {
    const cur = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
    if (cur) {
      if (cur.seq < seqRow.seq) db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(seqRow.seq, table);
    } else {
      db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, seqRow.seq);
    }
  }

  const violations = db.pragma('foreign_key_check');
  if (violations.length) {
    throw new Error(`rebuildTable(${table}): نقض کلید خارجی بعد از بازسازی (${violations.length} مورد).`);
  }
}

function runOutsideTx(db, fn) {
  db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      fn();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// ---------- اجرا ----------

function applyOne(db, migration) {
  if (!migration.foreignKeys) db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      // اگر پروسه دیگری (مثلاً CLI هم‌زمان با سرویس) همین migration را زودتر اعمال کرده، رد می‌شود
      const already = db.prepare('SELECT 1 AS x FROM schema_migrations WHERE id = ?').get(migration.id);
      if (already) {
        db.exec('COMMIT');
        return false;
      }
      migration.up(db, { rebuildTable, columnsOf, tableExists });
      if (!migration.foreignKeys) {
        const violations = db.pragma('foreign_key_check');
        if (violations.length) throw new Error(`نقض کلید خارجی بعد از migration ${migration.name} (${violations.length} مورد)`);
      }
      db.prepare('INSERT INTO schema_migrations (id, name, checksum) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        migration.checksum
      );
      db.exec('COMMIT');
      return true;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    if (!migration.foreignKeys) db.pragma('foreign_keys = ON');
  }
}

/**
 * @param {object} db
 * @param {object} [opts]
 * @param {string} [opts.backupDir] مسیر بک‌آپ قبل از migration (اگر ندهید و دیتابیس داده داشته باشد، بک‌آپ گرفته نمی‌شود)
 * @param {string} [opts.dir] پوشه migrationها (برای تست)
 * @param {(msg:string)=>void} [opts.log]
 * @returns {{applied: string[], backupPath: string|null}}
 */
function migrate(db, opts = {}) {
  const log = opts.log || (() => {});
  const all = loadMigrations(opts.dir);

  // ⚠️ تا قبل از گرفتن بک‌آپ هیچ چیزی روی دیتابیس نوشته نمی‌شود (حتی ساخت جدول schema_migrations)،
  // تا اگر بک‌آپ شکست خورد (دیسک پر، دیتابیس خراب، ...) دیتابیس دست‌نخورده بماند.
  const status = getStatus(db, opts.dir);
  for (const i of status.items) {
    if (i.checksumMismatch) {
      log(`⚠️ migration ${i.name} بعد از اعمال ویرایش شده است (checksum متفاوت). فایل‌های اعمال‌شده را تغییر ندهید.`);
    }
  }
  if (status.unknownApplied.length) {
    log(`⚠️ این migrationها در دیتابیس اعمال شده‌اند ولی فایلشان نیست (کد قدیمی‌تر از دیتابیس؟): ${status.unknownApplied.join(', ')}`);
  }

  const appliedIds = new Set(getApplied(db).map((a) => a.id));
  const pending = all.filter((m) => !appliedIds.has(m.id));
  if (pending.length === 0) return { applied: [], backupPath: null };

  const maxApplied = Math.max(0, ...appliedIds);
  const outOfOrder = pending.filter((m) => m.id < maxApplied);
  if (outOfOrder.length) {
    throw new Error(`migration خارج از ترتیب (شماره کمتر از آخرین اعمال‌شده): ${outOfOrder.map((m) => m.name).join(', ')}`);
  }

  // بک‌آپ فقط وقتی دیتابیس واقعاً داده دارد (جدول users وجود دارد)؛ روی دیتابیس تازه چیزی برای از دست رفتن نیست
  let backupPath = null;
  if (opts.backupDir && tableExists(db, 'users')) {
    backupPath = backupBeforeMigration(db, opts.backupDir);
    log(`بک‌آپ قبل از migration: ${backupPath}`);
  }

  ensureMigrationsTable(db);
  const applied = [];
  for (const m of pending) {
    log(`اجرای migration ${m.name} ...`);
    if (applyOne(db, m)) applied.push(m.name);
  }
  return { applied, backupPath };
}

module.exports = {
  migrate,
  getStatus,
  loadMigrations,
  rebuildTable,
  columnsOf,
  tableExists,
  backupBeforeMigration,
  MIGRATIONS_DIR,
};
