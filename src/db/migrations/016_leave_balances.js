// migration شماره ۰۱۶ — ledger مانده‌ی مرخصی (S4-9a). فقط ساختار؛ هیچ داده‌ی موجودی تغییر نمی‌کند و هیچ عدد قانونی (۲۶ روز و …) ثبت نمی‌شود.
//
// همه‌ی مقادیر «دقیقه» هستند (تبدیل به روز/ساعت = S4-9b). مانده «ذخیره نمی‌شود»، محاسبه می‌شود:
//   remaining = entitled + carried_over + مجموع تعدیل‌ها − مجموع duration_minutes درخواست‌های «approved» همان نوع در همان سال شمسی
// (سالِ هر درخواست از start_date آن؛ فقط نوع‌هایی که counts_against_balance = ۱ دارند).
//
//   leave_balances             یک ردیف برای هر (کاربر، نوع، سال شمسی): entitled_minutes (استحقاق سال)، carried_over_minutes (انتقالی از سال قبل)
//   leave_balance_adjustments  تعدیل‌های دستی «فقط‌افزودنی» (امضادار: + افزایش، − کاهش) با دلیل اجباری و ثبت‌کننده؛ هرگز ویرایش/حذف نمی‌شوند
//                              (اصلاح = تعدیل معکوس) تا ردپای مالی/ممیزی کامل بماند. هر تعدیل در audit_log هم ثبت می‌شود (leaveBalanceService).
// کران ۱۳۰۰..۱۸۰۰ برای سال فقط محافظ داده‌ی خراب است، نه قاعده‌ی تجاری.

module.exports = {
  name: '016_leave_balances',
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
      jalali_year INTEGER NOT NULL CHECK (jalali_year BETWEEN 1300 AND 1800),
      entitled_minutes INTEGER NOT NULL DEFAULT 0 CHECK (entitled_minutes >= 0),
      carried_over_minutes INTEGER NOT NULL DEFAULT 0 CHECK (carried_over_minutes >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, leave_type_id, jalali_year)
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS leave_balance_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
      jalali_year INTEGER NOT NULL CHECK (jalali_year BETWEEN 1300 AND 1800),
      minutes INTEGER NOT NULL CHECK (minutes <> 0),
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      actor_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_leave_adj_key ON leave_balance_adjustments(user_id, leave_type_id, jalali_year);');
  },
};
