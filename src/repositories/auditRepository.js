const { getDb } = require('../db/connection');
const { buildChangeDetails } = require('../utils/auditDiff');

// این لاگ عمداً هیچ تابع update/delete ندارد؛ طبق سند باید غیرقابل‌ویرایش باقی بماند.
// تنها استثنا archiveBatch (S2-6c) است: رکورد را «حذف» نمی‌کند، همان ردیف را (با همان id و زمان) به audit_log_archive
// منتقل می‌کند، آن‌هم در یک تراکنش که با ناهمخوانی تعداد برمی‌گردد (rollback)؛ پس جمع audit_log + آرشیو هرگز کم نمی‌شود.

const COLS = 'id, user_id, action, occurred_at, ip_address, details';
const MAX_BATCH_SIZE = 10000; // زیر سقف متغیرهای SQLite برای IN (...)

// منبع خواندن: فقط audit_log (پیش‌فرض، بدون ستون اضافه)، یا اتحاد audit_log و آرشیو با ستون archived (۰/۱).
// id در آرشیو همان id اصلی است و audit_log AUTOINCREMENT است؛ پس idها بین دو جدول هرگز تکراری نمی‌شوند.
function sourceSql(includeArchive) {
  if (!includeArchive) return 'audit_log';
  return `(SELECT ${COLS}, 0 AS archived FROM audit_log UNION ALL SELECT ${COLS}, 1 AS archived FROM audit_log_archive)`;
}

function assertCutoff(cutoff) {
  if (typeof cutoff !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cutoff)) {
    throw new Error('cutoff باید YYYY-MM-DD HH:MM:SS باشد.');
  }
}
function logEvent({ userId = null, action, ipAddress = null, details = null }) {
  const db = getDb();
  const detailsStr = details && typeof details === 'object' ? JSON.stringify(details) : details;
  const result = db
    .prepare(
      `INSERT INTO audit_log (user_id, action, ip_address, details)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, action, ipAddress, detailsStr);
  return db.prepare('SELECT * FROM audit_log WHERE id = ?').get(result.lastInsertRowid);
}

// S4-1a: ثبت «تغییرِ یک موجودیت» با details استاندارد (جزئیات قالب: src/utils/auditDiff.js).
// ساختار جدول و ورودی‌های قدیمی (logEvent) بدون تغییر است؛ این فقط یک لایه‌ی بالای logEvent است.
//   actor: شناسه‌ی کاربر انجام‌دهنده، یا آبجکت با id/userId (null برای سیستم)؛ در ستون user_id می‌نشیند
//   before/after: آبجکت‌های «وضعیت قبل/بعد» (null ⇒ ایجاد/حذف)؛ فقط فیلدهای تغییرکرده ثبت می‌شوند، حساس‌ها حذف
//   meta (اختیاری، S4-1b): فیلدهای کمکی کنار diff (source، targetUserId، recordId، ...) برای جستجوی `"targetUserId":N`
// ⚠️ اگر هیچ فیلدی تغییر نکرده باشد هم رکورد (با changes خالی) ثبت می‌شود: «رخ دادنِ عمل» ردپای ممیزی است و بی‌صدا گم نمی‌شود.
function resolveActorId(actor) {
  if (actor === null || actor === undefined) return null;
  const id = typeof actor === 'object' ? (actor.id !== undefined ? actor.id : actor.userId) : actor;
  if (id === null || id === undefined) return null;
  if (!Number.isInteger(id)) throw new TypeError('actor باید شناسه‌ی عددی کاربر یا آبجکت دارای id باشد.');
  return id;
}

function logChange({ actor = null, action, entityType, entityId = null, before = null, after = null, reason = null, ip = null, meta = null } = {}) {
  if (typeof action !== 'string' || !action.trim()) throw new TypeError('logChange: action الزامی است.');
  if (typeof entityType !== 'string' || !entityType.trim()) throw new TypeError('logChange: entityType الزامی است.');
  const details = buildChangeDetails({ entityType: entityType.trim(), entityId, before, after, reason, meta });
  return logEvent({ userId: resolveActorId(actor), action: action.trim(), ipAddress: ip, details });
}

// includeArchive (S2-6c): رکوردهای آرشیوشده هم در نتیجه بیایند (با ستون archived)
function listByUser(userId, limit = 100, { includeArchive = false } = {}) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${sourceSql(includeArchive)} WHERE user_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(userId, limit);
}

function listRecent(limit = 200, { includeArchive = false } = {}) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM ${sourceSql(includeArchive)} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(limit);
}

// جستجوی چندفیلتری برای پنل وب (فقط خواندنی - لاگ همچنان غیرقابل‌ویرایش است)
function search({ userId, action, from, to, q, limit = 200, includeArchive = false } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (action) { where.push('action = ?'); params.push(action); }
  if (from) { where.push('date(occurred_at) >= ?'); params.push(from); }
  if (to) { where.push('date(occurred_at) <= ?'); params.push(to); }
  if (q) {
    where.push('(details LIKE ? OR action LIKE ? OR ip_address LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM ${sourceSql(includeArchive)} ${clause} ORDER BY occurred_at DESC, id DESC LIMIT ?`)
    .all(...params, limit);
}

// خلاصه‌ی رکوردهای «قدیمی‌تر از cutoff» برای dry-run آرشیو (S2-6b). فقط خواندنی.
// cutoff به قالب ذخیره‌ی occurred_at (YYYY-MM-DD HH:MM:SS) است؛ مقایسه‌ی متنی مستقیم تا ایندکس idx_audit_occurred کار کند.
function summarizeOlderThan(cutoff) {
  assertCutoff(cutoff);
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count, MIN(occurred_at) AS oldest, MAX(occurred_at) AS newest FROM audit_log WHERE occurred_at < ?')
    .get(cutoff);
  return { count: row.count, oldest: row.oldest || null, newest: row.newest || null };
}

// انتقال «یک batch» از رکوردهای قدیمی‌تر از cutoff از audit_log به audit_log_archive (S2-6c).
// کل batch در «یک تراکنش» است: انتخاب (قدیمی‌ترین‌ها اول) ← کپی با همان id/ستون‌ها ← حذف از اصلی. اگر تعداد کپی یا حذف با
// تعداد انتخاب‌شده نخواند (یا id در آرشیو تکراری باشد) استثنا پرتاب می‌شود و همه‌چیز برمی‌گردد؛ هیچ رکوردی گم نمی‌شود.
// خروجی: تعداد رکوردِ منتقل‌شده (۰ ⇒ چیزی برای انتقال نمانده).
function archiveBatch(cutoff, batchSize = 1000) {
  assertCutoff(cutoff);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize باید عدد صحیح ۱ تا ${MAX_BATCH_SIZE} باشد.`);
  }
  const db = getDb();
  const move = db.transaction(() => {
    const ids = db
      .prepare('SELECT id FROM audit_log WHERE occurred_at < ? ORDER BY occurred_at, id LIMIT ?')
      .all(cutoff, batchSize)
      .map((r) => r.id);
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const copied = db
      .prepare(`INSERT INTO audit_log_archive (${COLS}) SELECT ${COLS} FROM audit_log WHERE id IN (${placeholders})`)
      .run(...ids).changes;
    const removed = db.prepare(`DELETE FROM audit_log WHERE id IN (${placeholders})`).run(...ids).changes;
    if (copied !== ids.length || removed !== ids.length) {
      throw new Error(`انتقال آرشیو ناهمخوان بود (انتخاب ${ids.length}، کپی ${copied}، حذف ${removed}) و برگشت داده شد.`);
    }
    return ids.length;
  });
  return move();
}

function listActions() {
  return getDb()
    .prepare('SELECT action, COUNT(*) AS count FROM audit_log GROUP BY action ORDER BY count DESC')
    .all();
}

module.exports = { logEvent, logChange, listByUser, listRecent, search, listActions, summarizeOlderThan, archiveBatch };
