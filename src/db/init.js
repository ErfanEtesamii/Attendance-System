// اجرای مستقل: node src/db/init.js  (یا: npm run init-db)
// دیتابیس را (در صورت نبودن) می‌سازد و همه migrationهای اعمال‌نشده را اجرا می‌کند.
// idempotent است؛ اجرای چندباره‌اش خطا نمی‌دهد. معادل «npm run migrate» با خروجی فهرست جداول.

const { getDb } = require('./connection');

function main() {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);

  console.log('دیتابیس با موفقیت مقداردهی اولیه شد.');
  console.log('جداول موجود:', tables.join(', '));
}

main();
