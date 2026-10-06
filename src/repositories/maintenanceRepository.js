// دستورهای نگهداری دیتابیس (S2-7b): ANALYZE، PRAGMA optimize، VACUUM، checkpoint. SQL فقط اینجاست.
// هیچ‌کدام داده‌ی منطقی را تغییر نمی‌دهند؛ VACUUM فایل را بازنویسی می‌کند (به فضای آزاد ≈ دو برابر حجم نیاز دارد، قفل نوشتن می‌گیرد)
// و نباید داخل تراکنش اجرا شود.

const { getDb } = require('../db/connection');

function analyze() {
  getDb().exec('ANALYZE');
}

function optimize() {
  getDb().pragma('optimize');
}

function vacuum() {
  getDb().exec('VACUUM');
}

// بعد از VACUUM در حالت WAL، فایل -wal را به اندازه‌ی کم برمی‌گرداند. نتیجه مهم نیست (اگر خواننده‌ی فعال باشد ناقص می‌ماند).
function checkpointTruncate() {
  getDb().pragma('wal_checkpoint(TRUNCATE)');
}

module.exports = { analyze, optimize, vacuum, checkpointTruncate };
