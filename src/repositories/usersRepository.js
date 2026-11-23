const { getDb } = require('../db/connection');

// Phase 20: نرخ ساعتی (hourly_rate_kt) یک داده‌ی حساس است و عمداً در «SELECT *» نمی‌آید تا هیچ route/خروجی/لاگی
// که ردیف کاربر را کامل برمی‌گرداند آن را درز ندهد. فقط getHourlyRateKt / setHourlyRateKt به آن دست می‌زنند.
const SENSITIVE_COLUMNS = new Set(['hourly_rate_kt', 'insurance_deduction_toman']);
const columnListCache = new WeakMap();
function userColumns(db) {
  let list = columnListCache.get(db);
  if (!list) {
    list = db.prepare("PRAGMA table_info('users')").all().map((c) => c.name).filter((n) => !SENSITIVE_COLUMNS.has(n)).join(', ');
    columnListCache.set(db, list);
  }
  return list;
}

// owner جزو کارمندان شرکت نیست: به‌طور پیش‌فرض در فهرست نمی‌آید (کارمندان، حضور و غیاب، گزارش‌ها، عملکرد).
// فقط جاهایی که «حساب‌های دارای دسترسی» لازم است (گیرنده‌ی اعلان، تأییدکننده، مدیریت کاربران) includeOwner:true می‌دهند.
function listUsers({ onlyActive = false, managerId = null, includeOwner = false } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  if (onlyActive) conditions.push('is_active = 1');
  if (!includeOwner) conditions.push("role <> 'owner'");
  if (managerId != null) {
    conditions.push('manager_id = ?');
    params.push(managerId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT ${userColumns(db)} FROM users ${where} ORDER BY full_name`).all(...params);
}

function findById(id) {
  const db = getDb();
  return db.prepare(`SELECT ${userColumns(db)} FROM users WHERE id = ?`).get(id);
}

// سرپرستانی که این کاربر جانشینشان است (ردیف خام؛ فعال‌بودن/غیبت در supervisorDeputyService سنجیده می‌شود)
function listByDeputy(deputyId) {
  const db = getDb();
  return db.prepare(`SELECT ${userColumns(db)} FROM users WHERE deputy_id = ?`).all(deputyId);
}

function findByTelegramId(telegramUserId) {
  const db = getDb();
  return db.prepare(`SELECT ${userColumns(db)} FROM users WHERE telegram_user_id = ?`).get(telegramUserId);
}

function createUser({ telegramUserId, fullName, personnelCode, department, role, managerId }) {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(telegramUserId || null, fullName, personnelCode || null, department || null, role || 'employee', managerId || null);
  return findById(result.lastInsertRowid);
}

function updateUser(id, fields) {
  const db = getDb();
  const allowed = ['telegram_user_id', 'full_name', 'personnel_code', 'department', 'role', 'manager_id', 'deputy_id', 'is_active'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findById(id);

  // بخش ۲-الف: تغییر وضعیت فعال، نقش یا آیدی تلگرام = باطل‌شدن خودکار همه‌ی نشست‌های پنل این کاربر
  // (در خود repository انجام می‌شود تا هر مسیری — پنل، بات، اسکریپت — را پوشش دهد).
  const before = findById(id);
  let bump = false;
  if (before) {
    if ('is_active' in fields && Number(fields.is_active) !== Number(before.is_active)) bump = true;
    if ('role' in fields && fields.role !== before.role) bump = true;
    if ('telegram_user_id' in fields) {
      const next = fields.telegram_user_id == null || fields.telegram_user_id === '' ? null : String(fields.telegram_user_id);
      const prev = before.telegram_user_id == null ? null : String(before.telegram_user_id);
      if (next !== prev) bump = true;
    }
  }

  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  const bumpSql = bump ? ', session_version = session_version + 1' : '';
  db.prepare(`UPDATE users SET ${setClause}${bumpSql}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return findById(id);
}

// نرخ ساعتی (هزار تومان در ساعت). NULL = تعریف نشده. کاربر نبود ⇒ undefined.
function getHourlyRateKt(id, date) {
  const row = getDb().prepare('SELECT hourly_rate_kt AS rate FROM users WHERE id = ?').get(id);
  if (!row) return undefined;
  return date ? rateOn(getRateTimeline(id, 'rate', row.rate), date) : row.rate;
}

// ---------- تاریخچه‌ی تاریخ‌دار نرخ/بیمه (migration 059) ----------
const BASE_FROM = '0000-00-00';
const FIELD_COLUMN = { rate: 'hourly_rate_kt', insurance: 'insurance_deduction_toman' };

function historyTableExists() {
  try { return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_rate_history'").get(); } catch (_) { return false; }
}

// { current, rows: [{ from, value }] } برای یک کاربر/فیلد؛ rows خالی ⇒ بدون تاریخچه (همان مقدار فعلی برای همه‌ی روزها)
function getRateTimeline(id, field, current) {
  const col = FIELD_COLUMN[field];
  let cur = current;
  if (cur === undefined) { const r = getDb().prepare(`SELECT ${col} AS v FROM users WHERE id = ?`).get(id); cur = r ? r.v : undefined; }
  const rows = historyTableExists()
    ? getDb().prepare('SELECT effective_from AS "from", value FROM user_rate_history WHERE user_id = ? AND field = ? ORDER BY effective_from').all(id, field)
    : [];
  return { current: cur, rows };
}

// مقدار مؤثر در یک تاریخ (YYYY-MM-DD)
function rateOn(timeline, date) {
  if (!timeline.rows.length || !date) return timeline.current;
  let pick;
  for (const r of timeline.rows) { if (r.from <= date) pick = r; else break; }
  return pick ? pick.value : timeline.current;
}

// ثبت «از تاریخ from مقدار تازه newVal است». ردیف پایه (مقدار قبلی از ابتدا) اگر نبود ساخته می‌شود، ردیف‌های بعد از from حذف می‌شوند
// و ستون users با آخرین مقدار تاریخچه هم‌گام می‌ماند.
function recordFieldChange(id, field, from, oldVal, newVal) {
  const db = getDb();
  const col = FIELD_COLUMN[field];
  db.transaction(() => {
    const has = db.prepare('SELECT 1 FROM user_rate_history WHERE user_id = ? AND field = ? LIMIT 1').get(id, field);
    if (!has) db.prepare('INSERT INTO user_rate_history (user_id, field, effective_from, value) VALUES (?, ?, ?, ?)').run(id, field, BASE_FROM, oldVal);
    db.prepare('DELETE FROM user_rate_history WHERE user_id = ? AND field = ? AND effective_from > ?').run(id, field, from);
    db.prepare(`INSERT INTO user_rate_history (user_id, field, effective_from, value) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, field, effective_from) DO UPDATE SET value = excluded.value`).run(id, field, from, newVal);
    const latest = db.prepare('SELECT value FROM user_rate_history WHERE user_id = ? AND field = ? ORDER BY effective_from DESC LIMIT 1').get(id, field);
    db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(latest ? latest.value : newVal, id);
  })();
}

// نوشتن یک فیلد حساس: با effectiveFrom و مقدار قبلیِ غیر‌NULL ⇒ تاریخ‌دار؛ وگرنه جایگزینی ساده (و پاک‌شدن تاریخچه‌ی همان فیلد تا ستون و تاریخچه ناسازگار نمانند).
function writeSensitive(id, field, value, effectiveFrom) {
  const db = getDb();
  const col = FIELD_COLUMN[field];
  const row = db.prepare(`SELECT ${col} AS v FROM users WHERE id = ?`).get(id);
  if (!row) return false;
  const old = row.v === undefined ? null : row.v;
  if (effectiveFrom && historyTableExists()) {
    if (old === value && !db.prepare('SELECT 1 FROM user_rate_history WHERE user_id = ? AND field = ? LIMIT 1').get(id, field)) return true;
    recordFieldChange(id, field, effectiveFrom, old, value);
    return true;
  }
  if (historyTableExists()) db.prepare('DELETE FROM user_rate_history WHERE user_id = ? AND field = ?').run(id, field);
  return db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(value, id).changes > 0;
}

// value = عدد صحیح نامنفی یا null؛ اعتبارسنجی با caller است (CHECK دیتابیس آخرین سد). updated_at و نسخه‌ی نشست عمداً دست نمی‌خورد.
function setHourlyRateKt(id, value, opts = {}) {
  return writeSensitive(id, 'rate', value, opts.effectiveFrom);
}

// کسر ماهانه‌ی حق بیمه (تومان) برای فیش حقوقی. NULL = تعریف نشده (۰). کاربر نبود ⇒ undefined.
function getInsuranceDeductionToman(id, date) {
  const row = getDb().prepare('SELECT insurance_deduction_toman AS v FROM users WHERE id = ?').get(id);
  if (!row) return undefined;
  return date ? rateOn(getRateTimeline(id, 'insurance', row.v), date) : row.v;
}
function setInsuranceDeductionToman(id, value, opts = {}) {
  return writeSensitive(id, 'insurance', value, opts.effectiveFrom);
}

// باطل‌کردن همه‌ی نشست‌های پنل یک کاربر (دکمه‌ی «خروج از همه‌ی نشست‌ها»). نسخه‌ی جدید را برمی‌گرداند یا null اگر کاربر نبود.
function revokeSessions(id) {
  const db = getDb();
  const info = db.prepare("UPDATE users SET session_version = session_version + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  if (info.changes === 0) return null;
  return findById(id).session_version;
}

// انتساب شیفت (S3-6a): shiftId = عدد یا null (بدون شیفت). وجود شیفت را route چک می‌کند؛ FK هم جلوی شیفت ناموجود را می‌گیرد.
// نسخه‌ی نشست (session_version) عمداً تغییر نمی‌کند: انتساب شیفت دسترسی کاربر را عوض نمی‌کند. کاربر نبود ⇒ null.
function setUserShift(id, shiftId) {
  // B1 (فاز ۱۲): برای همه‌ی تاریخ‌ها (تاریخچه‌ی انتساب پاک و از ابتدا). انتساب با «تاریخ اعمال»: shiftsRepository.assignShift.
  const changes = require('./shiftsRepository').setForAllDates(id, shiftId);
  return changes === 0 ? null : findById(id);
}

function deactivateUser(id) {
  return updateUser(id, { is_active: 0 });
}


// تعداد سوابق وابسته به کاربر (برای هشدار قبل از حذف)
function getHistoryCounts(id) {
  const db = getDb();
  const n = (sql) => db.prepare(sql).get(id).n;
  return {
    attendance: n('SELECT COUNT(*) n FROM attendance_records WHERE user_id = ?'),
    leave: n('SELECT COUNT(*) n FROM leave_requests WHERE user_id = ?'),
    disputes: n('SELECT COUNT(*) n FROM record_disputes WHERE user_id = ?'),
    subordinates: n('SELECT COUNT(*) n FROM users WHERE manager_id = ?'),
  };
}

// حذف دائمی کاربر همراه با سوابقش (تردد، استراحت، مرخصی، اعتراض). در یک تراکنش انجام می‌شود.
// - زیرمجموعه‌های او بدون سرپرست می‌شوند (manager_id = NULL)
// - درخواست‌های مرخصی دیگران که او تأییدشان کرده باقی می‌ماند (approver_id = NULL)
// - رکوردهای audit_log (و audit_log_archive، S2-6a) حذف نمی‌شوند؛ فقط ارتباطشان با کاربر قطع می‌شود (user_id = NULL)
function deleteUserPermanently(id) {
  const db = getDb();
  const tx = db.transaction((userId) => {
    db.prepare('UPDATE users SET manager_id = NULL WHERE manager_id = ?').run(userId);
    db.prepare('UPDATE users SET deputy_id = NULL WHERE deputy_id = ?').run(userId);
    db.prepare('UPDATE leave_requests SET approver_id = NULL WHERE approver_id = ?').run(userId);
    db.prepare(
      `DELETE FROM record_disputes WHERE user_id = ?
         OR attendance_record_id IN (SELECT id FROM attendance_records WHERE user_id = ?)`
    ).run(userId, userId);
    db.prepare(
      'DELETE FROM break_records WHERE attendance_record_id IN (SELECT id FROM attendance_records WHERE user_id = ?)'
    ).run(userId);
    db.prepare('DELETE FROM attendance_records WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM leave_requests WHERE user_id = ?').run(userId);
    db.prepare('UPDATE audit_log SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('UPDATE audit_log_archive SET user_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx(id);
}

module.exports = {
  getRateTimeline,
  rateOn,
  listUsers,
  findById,
  listByDeputy,
  findByTelegramId,
  createUser,
  updateUser,
  deactivateUser,
  revokeSessions,
  setUserShift,
  getHistoryCounts,
  deleteUserPermanently,
  getHourlyRateKt,
  getInsuranceDeductionToman,
  setInsuranceDeductionToman,
  setHourlyRateKt,
};
