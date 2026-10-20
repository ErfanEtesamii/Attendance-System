// شیفت چرخشیِ بدون ساعت: روزهای کاری دارد، اما تردد و محاسبه‌ی زمانی ندارد.
module.exports = {
  name: '041_untimed_rotating_shifts',
  up(db) {
    const cols = new Set(db.prepare("PRAGMA table_info('work_shifts')").all().map((c) => c.name));
    if (!cols.has('is_untimed')) db.exec('ALTER TABLE work_shifts ADD COLUMN is_untimed INTEGER NOT NULL DEFAULT 0 CHECK (is_untimed IN (0, 1));');
  },
};
