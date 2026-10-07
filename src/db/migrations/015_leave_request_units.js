// migration شماره ۰۱۵ — واحد و مدت درخواست مرخصی/مأموریت (S4-8a). فقط ساختار + CHECKهای هم‌خوانی؛ هنوز هیچ کانالی این ستون‌ها را نمی‌نویسد (S4-10).
//
//   unit              'day' | 'half_day' | 'hour' (NOT NULL، پیش‌فرض 'day' = رفتار فعلی همه‌ی درخواست‌های قدیمی)
//   half_day_part     'morning' | 'afternoon' — فقط (و حتماً) برای unit='half_day'
//   start_time/end_time  'HH:MM' (دو رقمی)، فقط (و حتماً) برای unit='hour'؛ شروع < پایان
//   duration_minutes  مدت «کاری» به دقیقه (محاسبه با تقویم/شیفت کاربر، leaveDurationService)؛ NULL = هنوز محاسبه نشده
//                     (درخواست‌های قدیمی؛ backfillMissingDurations آن‌ها را پر می‌کند). تعطیلی/آخر هفته‌ی وسط بازه شمرده نمی‌شود.
//
// قاعده‌ی دیگر: unit غیر از 'day' فقط یک روز است (start_date = end_date).
// بازسازی با rebuildTable (مثل ۰۱۴): همه‌ی داده، id، AUTOINCREMENT و ایندکس‌ها حفظ می‌شود؛ هر خطا ⇒ rollback کامل؛ بک‌آپ pre-migration مثل همیشه.

const HHMM = "'[0-2][0-9]:[0-5][0-9]'";

module.exports = {
  name: '015_leave_request_units',
  foreignKeys: false,
  up(db, { rebuildTable }) {
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
        unit TEXT NOT NULL DEFAULT 'day'
          CHECK (unit IN ('day','half_day','hour')),
        half_day_part TEXT
          CHECK (half_day_part IN ('morning','afternoon')),
        start_time TEXT,
        end_time TEXT,
        duration_minutes INTEGER
          CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK ((unit = 'half_day') = (half_day_part IS NOT NULL)),
        CHECK ((unit = 'hour') = (start_time IS NOT NULL AND end_time IS NOT NULL)),
        CHECK (unit = 'hour' OR (start_time IS NULL AND end_time IS NULL)),
        CHECK (unit <> 'hour' OR (start_time GLOB ${HHMM} AND end_time GLOB ${HHMM} AND start_time < end_time)),
        CHECK (unit = 'day' OR start_date = end_date)
      )`
    );
  },
};
