// دورکاریِ ادغام‌شده در رکورد حضوری (R5-۶، overlapDecision = merge): ساعت ورود/خروجِ «حضوریِ اصلی» پیش از ادغام روی نشست ذخیره می‌شود.
// بدون آن، اصلاحِ بعدیِ ساعت دورکاری نمی‌توانست رکورد و استراحت‌های ساخته‌شده را «کوتاه» کند (فقط گسترش می‌داد).
// ردیف‌های قدیمیِ ادغام‌شده NULL می‌مانند (بازه‌ی حضوری‌شان دیگر قابل‌بازیابی نیست) و رفتار قبلی را دارند.
module.exports = {
  name: '051_remote_onsite_span',
  up(db) {
    const cols = db.prepare('PRAGMA table_info(remote_work_sessions)').all().map((c) => c.name);
    if (!cols.includes('onsite_in_at')) db.exec('ALTER TABLE remote_work_sessions ADD COLUMN onsite_in_at TEXT');
    if (!cols.includes('onsite_out_at')) db.exec('ALTER TABLE remote_work_sessions ADD COLUMN onsite_out_at TEXT');
  },
};
