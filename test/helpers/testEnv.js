// باید «اولین» require در هر فایل تست باشد (قبل از هر require به src/).
// محیط hermetic می‌سازد: دیتابیس موقت، توکن بات و راز سشن ساختگی، رنج شبکه ثابت.
// هر فایل تست در پروسه جدا اجرا می‌شود (node --test)، پس env بین فایل‌ها نشت نمی‌کند.

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-0123456789abcdef0123456789abcdef';
process.env.TELEGRAM_BOT_TOKEN = '123456789:TEST_FAKE_TOKEN_abcdefghijklmnopqrstuvwxyz0123';
process.env.TELEGRAM_BOT_USERNAME = 'test_bot';
process.env.ALLOWED_NETWORK_CIDR = '192.168.10.0/24';
process.env.TRUST_PROXY = 'false';
process.env.ADMIN_SESSION_MAX_AGE_DAYS = '7';

const { closeDb, getDb } = require('../../src/db/connection');

// دیتابیس تازه (با همه migrationها) برای شروع هر تست
function resetDb() {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(process.env.DB_PATH + suffix, { force: true });
  }
  fs.rmSync(path.join(tmpDir, 'backups'), { recursive: true, force: true });
  return getDb();
}

function cleanup() {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

module.exports = { resetDb, cleanup, tmpDir };
