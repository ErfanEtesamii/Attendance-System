// اسکیمای کامل دیتابیس مطابق بخش ۴ سند پروژه.
// نام ستون‌ها به انگلیسی است تا با اکوسیستم کد سازگار باشد؛ معادل فارسی هر ستون در کامنت آمده.
// تمام timestamp ها با datetime('now') یعنی زمان سرور SQLite ثبت می‌شوند، نه زمان کلاینت.

const SCHEMA_STATEMENTS = [
  // Users: کاربران (کارمندان/مدیران/ادمین‌ها)
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT UNIQUE,        -- آیدی عددی تلگرام کاربر
    full_name TEXT NOT NULL,             -- نام و نام‌خانوادگی
    personnel_code TEXT UNIQUE,          -- کد پرسنلی
    department TEXT,                     -- واحد/دپارتمان
    role TEXT NOT NULL DEFAULT 'employee' -- 'employee' | 'manager' | 'admin'
      CHECK (role IN ('employee', 'manager', 'admin')),
    manager_id INTEGER REFERENCES users(id), -- مدیر مستقیم
    is_active INTEGER NOT NULL DEFAULT 1, -- ۱=فعال، ۰=غیرفعال
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

  // AttendanceRecords: رکورد روزانه تردد هر کارمند
  `CREATE TABLE IF NOT EXISTS attendance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    record_date TEXT NOT NULL,           -- تاریخ به فرمت YYYY-MM-DD
    check_in_time TEXT,                  -- زمان ورود (server timestamp)
    check_in_ip TEXT,                    -- IP مبدأ ثبت ورود
    check_out_time TEXT,                 -- زمان خروج (server timestamp)
    check_out_ip TEXT,                   -- IP مبدأ ثبت خروج
    status TEXT NOT NULL DEFAULT 'normal' -- 'normal'|'late'|'incomplete'|'leave'|'holiday'
      CHECK (status IN ('normal','late','incomplete','leave','holiday')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, record_date)
  );`,

  // BreakRecords: استراحت‌های ناهار/کوتاه در دل هر رکورد روزانه
  `CREATE TABLE IF NOT EXISTS break_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_record_id INTEGER NOT NULL REFERENCES attendance_records(id),
    break_type TEXT NOT NULL DEFAULT 'lunch' -- 'lunch' | 'short_break'
      CHECK (break_type IN ('lunch','short_break')),
    start_time TEXT NOT NULL,
    end_time TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

  // LeaveRequests: درخواست‌های مرخصی/مأموریت
  `CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    leave_type TEXT NOT NULL DEFAULT 'leave' -- 'leave' | 'mission'
      CHECK (leave_type IN ('leave','mission')),
    status TEXT NOT NULL DEFAULT 'pending'   -- 'pending'|'approved'|'rejected'
      CHECK (status IN ('pending','approved','rejected')),
    approver_id INTEGER REFERENCES users(id),
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

  // Holidays: تقویم تعطیلات رسمی
  `CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL
  );`,

  // AuditLog: لاگ غیرقابل‌ویرایش تمام رویدادهای حساس
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,                -- مثلاً 'check_in_rejected_ip', 'record_manually_fixed'
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    ip_address TEXT,
    details TEXT                          -- توضیحات آزاد یا JSON
  );`,

  // ایندکس‌های کاربردی برای گزارش‌گیری سریع‌تر (فاز ۶)
  `CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_records(user_id, record_date);`,
  `CREATE INDEX IF NOT EXISTS idx_leave_user_status ON leave_requests(user_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);`,
];

module.exports = { SCHEMA_STATEMENTS };
