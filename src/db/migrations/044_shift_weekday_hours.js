// ساعت ثابتِ روزهای مشخص داخل شیفتِ چرخشی (بدون ساعت): { "3": { startTime, endTime }, ... } با کلید = روز هفته (۰=یکشنبه … ۶=شنبه).
module.exports = {
  name: '044_shift_weekday_hours',
  up(db) {
    const cols = new Set(db.prepare("PRAGMA table_info('work_shifts')").all().map((c) => c.name));
    if (!cols.has('weekday_hours')) db.exec("ALTER TABLE work_shifts ADD COLUMN weekday_hours TEXT NOT NULL DEFAULT '{}';");
  },
};
