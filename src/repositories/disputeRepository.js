const { getDb } = require('../db/connection');

// ایجاد اعتراض = ردیف اعتراض + پیام اولیه‌ی کارمند در dispute_messages (یک تراکنش). ستون message (سازگاری قدیمی) هم پر می‌شود.
function createDispute({ userId, attendanceRecordId, message }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO record_disputes (user_id, attendance_record_id, message, last_message_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(userId, attendanceRecordId || null, message);
    const id = result.lastInsertRowid;
    db.prepare(
      `INSERT INTO dispute_messages (dispute_id, sender_user_id, sender_role, message, created_at)
       VALUES (?, ?, 'user', ?, (SELECT created_at FROM record_disputes WHERE id = ?))`
    ).run(id, userId, message, id);
    return id;
  });
  return findById(tx());
}

function findById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM record_disputes WHERE id = ?').get(id);
}

function listByUser(userId) {
  const db = getDb();
  return db
    .prepare('SELECT * FROM record_disputes WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

// برای فاز ۸ (پنل مدیریتی وب) - لیست اعتراض‌های باز جهت بررسی ادمین
function listOpen() {
  const db = getDb();
  return db.prepare("SELECT * FROM record_disputes WHERE status = 'open' ORDER BY created_at").all();
}

// S5-3a: اعتراض‌های «باز» مربوط به یک بازه‌ی میلادی (چک‌لیست بستن ماه).
// D4 (مدل گفت‌وگو): «باز» = status 'open' (شامل پاسخ‌داده‌شده و reopen‌شده). resolved (توسط ادمین) و خاتمه‌یافته توسط کارمند (resolved + closed_by='user') مانع نیستند.
// اعتراضِ وصل‌به‌رکورد با record_date رکورد سنجیده می‌شود؛ اعتراضِ بدون رکورد با روز ثبت (created_at به UTC).
function listOpenInRange(fromDate, toDate) {
  return getDb()
    .prepare(
      `SELECT d.*, r.record_date AS record_date
         FROM record_disputes d
         LEFT JOIN attendance_records r ON r.id = d.attendance_record_id
        WHERE d.status = 'open'
          AND ((r.id IS NOT NULL AND r.record_date BETWEEN ? AND ?)
            OR (r.id IS NULL AND substr(d.created_at, 1, 10) BETWEEN ? AND ?))
        ORDER BY d.created_at, d.id`
    )
    .all(fromDate, toDate, fromDate, toDate);
}

// تغییر وضعیت. resolved ⇒ closed_by (پیش‌فرض admin؛ فراخوان‌های موجود فقط ادمین/سرپرستند) و closed_at؛ open ⇒ پاک‌شدن closed_*.
// reopen_count اینجا دست نمی‌خورد (فقط reopenWithMessage با countAsReopen آن را زیاد می‌کند).
function setStatus(id, status, { closedBy } = {}) {
  const db = getDb();
  if (status === 'resolved') {
    db.prepare(
      `UPDATE record_disputes
          SET status = 'resolved', closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`
    ).run(closedBy === 'user' ? 'user' : 'admin', id);
  } else {
    db.prepare(
      `UPDATE record_disputes
          SET status = 'open', closed_by = NULL, closed_at = NULL, updated_at = datetime('now')
        WHERE id = ?`
    ).run(id);
  }
  return findById(id);
}

// ---------- گفت‌وگو (D1) ----------

// پیام اولیه‌ی ذخیره‌نشده‌ی اعتراضِ قدیمی (که بعد از migration مستقیم درج شده) را در جدول پیام‌ها می‌نشاند؛ اگر پیامی دارد کاری نمی‌کند.
function ensureInitialMessage(db, dispute) {
  const has = db.prepare('SELECT 1 AS x FROM dispute_messages WHERE dispute_id = ? LIMIT 1').get(dispute.id);
  if (has) return;
  db.prepare(
    `INSERT INTO dispute_messages (dispute_id, sender_user_id, sender_role, message, created_at)
     VALUES (?, ?, 'user', ?, ?)`
  ).run(dispute.id, dispute.user_id, dispute.message, dispute.created_at);
}

function insertMessage(db, dispute, { senderUserId, senderRole, message }) {
  ensureInitialMessage(db, dispute);
  const r = db
    .prepare('INSERT INTO dispute_messages (dispute_id, sender_user_id, sender_role, message) VALUES (?, ?, ?, ?)')
    .run(dispute.id, senderUserId == null ? null : senderUserId, senderRole, message);
  db.prepare(
    `UPDATE record_disputes
        SET last_message_at = (SELECT created_at FROM dispute_messages WHERE id = ?), updated_at = datetime('now')
      WHERE id = ?`
  ).run(r.lastInsertRowid, dispute.id);
  return db.prepare('SELECT * FROM dispute_messages WHERE id = ?').get(r.lastInsertRowid);
}

// افزودن پیام (sender_role: user | admin). اعتراض ناموجود ⇒ null. ترتیب پیام‌ها با id است (created_at دقت ثانیه دارد).
function addMessage({ disputeId, senderUserId = null, senderRole, message }) {
  if (!['user', 'admin'].includes(senderRole)) throw new TypeError('senderRole باید user یا admin باشد.');
  const db = getDb();
  const dispute = findById(disputeId);
  if (!dispute) return null;
  return db.transaction(() => insertMessage(db, dispute, { senderUserId, senderRole, message }))();
}

// thread کامل (قدیمی‌ترین اول). اعتراضِ قدیمیِ بدون پیام: متن اولیه‌ی خودش به‌عنوان اولین پیام (id = null) برمی‌گردد.
function listMessages(disputeId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM dispute_messages WHERE dispute_id = ? ORDER BY id').all(disputeId);
  if (rows.length) return rows;
  const d = findById(disputeId);
  if (!d) return [];
  return [{ id: null, dispute_id: d.id, sender_user_id: d.user_id, sender_role: 'user', message: d.message, created_at: d.created_at }];
}

function getThread(disputeId) {
  const dispute = findById(disputeId);
  if (!dispute) return null;
  return { dispute, messages: listMessages(disputeId) };
}

// «ادامه‌ی اعتراض»: فقط از وضعیت resolved؛ باز می‌شود (closed_* پاک)، پیام جدید ثبت می‌شود و (countAsReopen) reopen_count زیاد می‌شود.
// maxReopens (اختیاری) فقط وقتی countAsReopen است سقف را در همان UPDATE اعمال می‌کند. ⇒ ردیف به‌روز | null (resolved نبود/سقف پر)
// message = null (فقط reopen ادمین بدون یادداشت، D3): بدون پیام باز می‌شود.
function reopenWithMessage({ id, senderUserId = null, senderRole = 'user', message, countAsReopen = true, maxReopens = null }) {
  const db = getDb();
  return db.transaction(() => {
    const cap = countAsReopen && maxReopens != null ? ' AND reopen_count < ?' : '';
    const params = cap ? [id, maxReopens] : [id];
    const res = db
      .prepare(
        `UPDATE record_disputes
            SET status = 'open', closed_by = NULL, closed_at = NULL,
                reopen_count = reopen_count + ${countAsReopen ? 1 : 0}, updated_at = datetime('now')
          WHERE id = ? AND status = 'resolved'${cap}`
      )
      .run(...params);
    if (res.changes !== 1) return null;
    if (message != null) insertMessage(db, findById(id), { senderUserId, senderRole, message });
    return findById(id);
  })();
}

// بستن اعتراضِ باز توسط ادمین/سرپرست (D3) با پیام پایانیِ اختیاری، در یک تراکنش.
// فقط از وضعیت open (UPDATE شرطی)؛ closed_by = admin. ⇒ ردیف به‌روز | null (باز نبود)
function resolveWithMessage({ id, senderUserId = null, message = null }) {
  const db = getDb();
  return db.transaction(() => {
    const res = db
      .prepare(
        `UPDATE record_disputes
            SET status = 'resolved', closed_by = 'admin', closed_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND status = 'open'`
      )
      .run(id);
    if (res.changes !== 1) return null;
    if (message != null) insertMessage(db, findById(id), { senderUserId, senderRole: 'admin', message });
    return findById(id);
  })();
}

function incrementReopenCount(id) {
  getDb().prepare("UPDATE record_disputes SET reopen_count = reopen_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  return findById(id);
}

// فهرست اعتراض‌های یک کارمند با خلاصه‌ی گفت‌وگو (تعداد پیام و فرستنده‌ی آخرین پیام) و تاریخ رکورد. اعتراض قدیمیِ بدون پیام = یک پیام از کارمند.
function listByUserWithSummary(userId) {
  return getDb()
    .prepare(
      `SELECT d.*, r.record_date AS record_date,
              MAX(1, (SELECT COUNT(*) FROM dispute_messages m WHERE m.dispute_id = d.id)) AS message_count,
              COALESCE((SELECT m.sender_role FROM dispute_messages m WHERE m.dispute_id = d.id ORDER BY m.id DESC LIMIT 1), 'user') AS last_sender_role
         FROM record_disputes d
         LEFT JOIN attendance_records r ON r.id = d.attendance_record_id
        WHERE d.user_id = ?
        ORDER BY d.created_at DESC, d.id DESC`
    )
    .all(userId);
}

// فهرست ادمین (D3): همه‌ی اعتراض‌ها با خلاصه‌ی گفت‌وگو (تعداد پیام و فرستنده‌ی آخرین پیام) و تاریخ رکورد؛ جدیدترین اول.
// status: open | resolved | null؛ userIds: آرایه‌ی شناسه (اسکوپ سرپرست/کارمند) یا null = همه (آرایه‌ی خالی ⇒ نتیجه‌ی خالی).
// اعتراض قدیمیِ بدون پیام = یک پیام از کارمند (مثل listByUserWithSummary).
function listAllWithSummary({ status = null, userIds = null } = {}) {
  if (Array.isArray(userIds) && userIds.length === 0) return [];
  const where = [];
  const params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (Array.isArray(userIds)) {
    where.push(`d.user_id IN (${userIds.map(() => '?').join(',')})`);
    params.push(...userIds);
  }
  return getDb()
    .prepare(
      `SELECT d.*, r.record_date AS record_date,
              MAX(1, (SELECT COUNT(*) FROM dispute_messages m WHERE m.dispute_id = d.id)) AS message_count,
              COALESCE((SELECT m.sender_role FROM dispute_messages m WHERE m.dispute_id = d.id ORDER BY m.id DESC LIMIT 1), 'user') AS last_sender_role
         FROM record_disputes d
         LEFT JOIN attendance_records r ON r.id = d.attendance_record_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY d.created_at DESC, d.id DESC`
    )
    .all(...params);
}

function listAll({ status } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM record_disputes WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return db.prepare('SELECT * FROM record_disputes ORDER BY created_at DESC').all();
}

module.exports = {
  listAll, createDispute, findById, listByUser, listOpen, listOpenInRange, setStatus,
  addMessage, listMessages, getThread, reopenWithMessage, resolveWithMessage, incrementReopenCount, listByUserWithSummary, listAllWithSummary,
};
