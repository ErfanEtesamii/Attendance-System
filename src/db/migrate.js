// CLI مدیریت migration:
//   npm run migrate          → اجرای migrationهای اعمال‌نشده (همراه بک‌آپ قبل از اجرا)
//   npm run migrate:status   → فقط نمایش وضعیت؛ هیچ تغییری نمی‌دهد
//
// ⚠️ روی سرور production بهتر است قبل از migrate دستی، سرویس را stop کنید (nssm stop <service>).

const path = require('path');
const config = require('../config');
const { openDatabase } = require('./connection');
const { migrate, getStatus } = require('./migrator');

function printStatus(db) {
  const { items, unknownApplied } = getStatus(db);
  if (!items.length) console.log('هیچ migrationای تعریف نشده است.');
  for (const i of items) {
    const mark = i.state === 'applied' ? '✔' : '…';
    const extra = i.state === 'applied' ? `(${i.appliedAt})` : '(در انتظار)';
    console.log(` ${mark} ${i.name} ${extra}${i.checksumMismatch ? '  ⚠️ فایل بعد از اعمال تغییر کرده' : ''}`);
  }
  if (unknownApplied.length) console.log(`⚠️ اعمال‌شده در DB ولی بدون فایل: ${unknownApplied.join(', ')}`);
  return items.filter((i) => i.state === 'pending').length;
}

function main() {
  const statusOnly = process.argv.includes('--status');
  const db = openDatabase();
  try {
    console.log(`دیتابیس: ${config.dbPath}`);
    if (statusOnly) {
      const pending = printStatus(db);
      process.exitCode = 0;
      console.log(pending ? `${pending} migration در انتظار اجراست.` : 'دیتابیس به‌روز است.');
      return;
    }
    const { applied, backupPath } = migrate(db, {
      backupDir: path.join(path.dirname(config.dbPath), 'backups'),
      log: (m) => console.log(m),
    });
    console.log(applied.length ? `اعمال شد: ${applied.join(', ')}` : 'چیزی برای اجرا نبود؛ دیتابیس به‌روز است.');
    if (backupPath) console.log(`بک‌آپ: ${backupPath}`);
    printStatus(db);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (err) {
  console.error('❌ migration ناموفق:', err.message);
  console.error('   migration شکست‌خورده rollback شده است؛ اگر لازم شد از آخرین فایل pre-migration-*.db در data/backups برگردید.');
  process.exit(1);
}
