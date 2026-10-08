// migration شماره ۰۱۸ — جانشین مرخصی (S4-11b): leave_requests.substitute_user_id (nullable؛ NULL = بدون جانشین). فقط یک ستون؛ داده‌ی موجود دست نمی‌خورد.
module.exports = {
  name: '018_leave_substitute',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(leave_requests)').all().map((c) => c.name);
    if (!cols.includes('substitute_user_id')) db.exec('ALTER TABLE leave_requests ADD COLUMN substitute_user_id INTEGER REFERENCES users(id);');
  },
};
