// migration شماره ۰۱۷ — زنجیره‌ی تأیید مرخصی (S4-11a). فقط ساختار؛ درخواست‌های موجود دست نمی‌خورند.
//   leave_approvals: یک ردیف برای هر «مرحله»ی تأیید هر درخواست (step از ۱)، نقش تأییدکننده‌ی آن مرحله (manager|admin|hr)،
//                    وضعیت (pending|approved|rejected)، تصمیم‌گیرنده/زمان/یادداشت. با حذف درخواست پاک می‌شود.
//   leave_requests.current_step: مرحله‌ی فعالِ درخواستِ pending؛ NULL = بدون زنجیره (درخواست قدیمی/ثبت مستقیم توسط مدیر یا درخواست نهایی‌شده)
//                    ⇒ مثل قبل «تک‌مرحله‌ای» (ادمین یا سرپرست مستقیم تصمیم می‌گیرد).
module.exports = {
  name: '017_leave_approvals',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS leave_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
      step INTEGER NOT NULL CHECK (step >= 1),
      approver_role TEXT NOT NULL CHECK (approver_role IN ('manager','admin','hr')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      decided_by INTEGER REFERENCES users(id),
      decided_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (leave_request_id, step)
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_leave_approvals_request ON leave_approvals(leave_request_id);');
    const cols = db.prepare('PRAGMA table_info(leave_requests)').all().map((c) => c.name);
    if (!cols.includes('current_step')) db.exec('ALTER TABLE leave_requests ADD COLUMN current_step INTEGER;');
  },
};
