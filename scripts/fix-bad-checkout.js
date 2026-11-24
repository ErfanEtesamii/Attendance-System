// اصلاح رکوردهایی که ساعت خروجشان با روز اشتباه ثبت شده (مثلاً خروج سه روز بعد از ورود):
//   node scripts/fix-bad-checkout.js 188 2026-10-27T17:00:00.000Z          → فقط گزارش (dry-run)
//   node scripts/fix-bad-checkout.js 188 2026-10-27T17:00:00.000Z --apply  → اعمال
// فقط وقتی اجرا می‌شود که خروج فعلی بیش از ۱۶ ساعت بعد از ورود باشد و خروج جدید بعد از ورود و حداکثر ۱۶ ساعت پس از آن باشد.
// قبل از --apply از دیتابیس بک‌آپ بگیرید. کد خروج: ۰ موفق | ۱ خطا | ۲ آرگومان نادرست
const { getDb, closeDb } = require('../src/db/connection');

function main(argv) {
  const apply = argv.includes('--apply');
  const [id, out] = argv.filter((a) => !a.startsWith('--'));
  const t = Date.parse(out || '');
  if (!/^\d+$/.test(id || '') || Number.isNaN(t)) { console.error('استفاده: node scripts/fix-bad-checkout.js <recordId> <خروج جدید ISO/UTC> [--apply]'); return 2; }
  const db = getDb();
  const rec = db.prepare('SELECT id, user_id, record_date, check_in_time, check_out_time, status FROM attendance_records WHERE id = ?').get(Number(id));
  if (!rec) { console.error('رکورد پیدا نشد.'); return 1; }
  const inT = Date.parse(rec.check_in_time);
  const curOut = rec.check_out_time ? Date.parse(rec.check_out_time) : null;
  const H = 16 * 3600000;
  if (curOut === null || curOut - inT <= H) { console.error('خروج فعلی غیرعادی نیست؛ چیزی تغییر نکرد.'); return 1; }
  if (t <= inT || t - inT > H) { console.error('خروج جدید باید بعد از ورود و حداکثر ۱۶ ساعت پس از آن باشد.'); return 1; }
  const iso = new Date(t).toISOString();
  console.log(`رکورد ${rec.id} (${rec.record_date}): ورود ${rec.check_in_time} | خروج ${rec.check_out_time} ⇒ ${iso}`);
  if (!apply) { console.log('dry-run: چیزی تغییر نکرد. برای اعمال --apply بدهید.'); return 0; }
  const tx = db.transaction(() => {
    db.prepare("UPDATE attendance_records SET check_out_time = ?, updated_at = datetime('now') WHERE id = ?").run(iso, rec.id);
    db.prepare("INSERT INTO audit_log (user_id, action, details) VALUES (NULL, 'attendance_record_manually_fixed', ?)").run(JSON.stringify({ source: 'script', recordId: rec.id, targetUserId: rec.user_id, fields: ['check_out_time'], changes: { check_out_time: { before: rec.check_out_time, after: iso } } }));
  });
  tx();
  console.log('اصلاح شد.');
  return 0;
}

try { process.exitCode = main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exitCode = 1; } finally { closeDb(); }
