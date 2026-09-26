// تنظیمات پویای سیستم (فاز ۸ - صفحه «تنظیمات» پنل مدیریتی وب).
// این ۵ مقدار زمانی از پنل تغییر کنند، همان لحظه روی موتور محاسبه (workHours.js) و
// اسکجولرهای یادآوری اثر می‌گذارند - بدون نیاز به ویرایش .env یا ری‌استارت سرور،
// چون هر بار مستقیم از دیتابیس خوانده می‌شوند، نه یک بار در زمان بالا آمدن پروسه.

const { getDb } = require('../db/connection');
const config = require('../config');

const KEY_MAP = {
  workDayStart: 'work_day_start',
  workDayEnd: 'work_day_end',
  lateCheckinGraceMinutes: 'late_checkin_grace_minutes',
  checkoutReminderMinutesBefore: 'checkout_reminder_minutes_before',
  repeatedLatenessThreshold: 'repeated_lateness_threshold',
};

const DEFAULTS = () => ({
  workDayStart: config.workDayStart,
  workDayEnd: config.workDayEnd,
  lateCheckinGraceMinutes: config.lateCheckinGraceMinutes,
  checkoutReminderMinutesBefore: config.checkoutReminderMinutesBefore,
  repeatedLatenessThreshold: config.repeatedLatenessThreshold,
});

function getAll() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  rows.forEach((r) => { stored[r.key] = r.value; });

  const defaults = DEFAULTS();
  const result = {};
  Object.keys(KEY_MAP).forEach((camelKey) => {
    const dbKey = KEY_MAP[camelKey];
    const raw = stored[dbKey];
    if (raw === undefined) {
      result[camelKey] = defaults[camelKey];
    } else if (camelKey === 'workDayStart' || camelKey === 'workDayEnd') {
      result[camelKey] = raw;
    } else {
      result[camelKey] = parseInt(raw, 10);
    }
  });
  return result;
}

function update(fields) {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  );
  Object.keys(fields).forEach((camelKey) => {
    const dbKey = KEY_MAP[camelKey];
    const value = fields[camelKey];
    if (!dbKey || value === undefined || value === null || value === '') return;
    upsert.run(dbKey, String(value));
  });
  return getAll();
}

module.exports = { getAll, update };
