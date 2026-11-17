// فاز D (بخش ۲): جانشین سرپرست. ستون users.deputy_id (NULL = بدون جانشین ⇒ رفتار فعلی عیناً برقرار است).
// جانشین فقط وقتی «فعال می‌شود» که سرپرست غیرفعال یا در مرخصی/ماموریتِ تمام‌روزِ تأییدشده باشد (supervisorDeputyService).
// حذف کاربر ⇒ deputy_id های اشاره‌کننده به او NULL می‌شود (ON DELETE SET NULL + پاک‌سازی صریح در usersRepository.deleteUserPermanently).
module.exports = {
  name: '054_supervisor_deputy',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    if (!cols.includes('deputy_id')) db.exec('ALTER TABLE users ADD COLUMN deputy_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  },
};
