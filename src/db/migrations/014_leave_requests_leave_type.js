// migration شماره ۰۱۴ — بازسازی leave_requests برای اتصال به leave_types (S4-7b). فقط ساختار + نگاشت داده؛ هیچ کد مصرف‌کننده‌ای عوض نمی‌شود (S4-7c).
//
//   leave_type_id    — NOT NULL، FK به leave_types(id). نگاشت درخواست‌های موجود: leave → annual (مرخصی استحقاقی)، mission → mission (مأموریت)
//   rejected_reason  — nullable؛ دلیل رد درخواست (اتصال به رد کردن در پرامپت‌های بعدی؛ اینجا فقط ستون)
//
// ستون قدیمی leave_type ('leave'|'mission' با CHECK) عمداً می‌ماند تا همه‌ی کدهای فعلی (بات، Mini App، پنل، موتور، اعلان‌ها) بدون تغییر کار کنند؛
// قاعده‌ی هم‌ارزی: leave_type = kind نوعِ leave_type_id (repository هر دو را با هم می‌نویسد). حذف/جایگزینی این ستون کار S4-7c یا بعد از آن است.
//
// بدون از دست رفتن داده: rebuildTable (روش ۱۲ مرحله‌ای SQLite) همه‌ی ستون‌های قبلی را با همان id و زمان‌ها کپی می‌کند، شمارنده‌ی AUTOINCREMENT و ایندکس
// idx_leave_user_status را حفظ می‌کند و foreign_key_check می‌زند؛ هر خطا = rollback کامل. پیش از اعمال، migrator طبق معمول بک‌آپ pre-migration می‌گیرد.
//
// پیش‌شرط نگاشت: ردیف‌های annual (kind=leave) و mission (kind=mission) باید در leave_types باشند. اگر ادمین بعد از migration ۰۱۳ آن‌ها را حذف کرده باشد
// (تا این migration ارجاعی نداشتند) با همان مقادیر پیش‌فرض دوباره ساخته می‌شوند؛ اگر kind آن‌ها را عوض کرده باشد migration با پیام راهنما متوقف می‌شود (بدون هیچ تغییری).

const MAPPING = [
  { legacy: 'leave', code: 'annual', kind: 'leave' },
  { legacy: 'mission', code: 'mission', kind: 'mission' },
];

module.exports = {
  name: '014_leave_requests_leave_type',
  foreignKeys: false,
  up(db, { rebuildTable }) {
    db.prepare(
      `INSERT OR IGNORE INTO leave_types (code, title, kind, is_paid, requires_attachment, counts_against_balance, allowed_units, max_consecutive_days)
       VALUES ('annual', 'مرخصی استحقاقی', 'leave', 1, 0, 1, '["day"]', NULL)`
    ).run();
    db.prepare(
      `INSERT OR IGNORE INTO leave_types (code, title, kind, is_paid, requires_attachment, counts_against_balance, allowed_units, max_consecutive_days)
       VALUES ('mission', 'مأموریت', 'mission', 1, 0, 0, '["day"]', NULL)`
    ).run();
    for (const m of MAPPING) {
      const row = db.prepare('SELECT kind FROM leave_types WHERE code = ?').get(m.code);
      if (!row || row.kind !== m.kind) {
        throw new Error(
          `migration 014: نوع «${m.code}» باید kind=${m.kind} باشد (الان: ${row ? row.kind : 'ناموجود'}). ` +
          `kind آن را از پنل (انواع مرخصی) به ${m.kind} برگردانید و دوباره migrate کنید.`
        );
      }
    }

    rebuildTable(
      db,
      'leave_requests',
      `CREATE TABLE leave_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        leave_type TEXT NOT NULL DEFAULT 'leave'
          CHECK (leave_type IN ('leave','mission')),
        leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','approved','rejected')),
        approver_id INTEGER REFERENCES users(id),
        reason TEXT,
        rejected_reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      {
        expressions: {
          leave_type_id:
            `(SELECT t.id FROM leave_types t WHERE t.code = CASE "leave_requests".leave_type WHEN 'mission' THEN 'mission' ELSE 'annual' END)`,
        },
      }
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_leave_type_id ON leave_requests(leave_type_id);');
  },
};
