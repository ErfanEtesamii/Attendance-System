// اجرای مستقل: node src/db/init.js  (یا: npm run init-db)
// جداول را در صورت نبودن می‌سازد و خروجی وضعیت را چاپ می‌کند.
// این اسکریپت idempotent است؛ اجرای چندباره‌اش خطا نمی‌دهد چون از CREATE TABLE IF NOT EXISTS استفاده می‌شود.

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
