// اجرای تست‌ها با test runner داخلی Node (بدون وابستگی اضافه).
// به‌جای تکیه بر glob خود node (که در Node 18 پشتیبانی نمی‌شود)، فایل‌های test/**/*.test.js را خودمان پیدا می‌کنیم.
//   npm test              → یک‌بار اجرا
//   npm run test:watch    → اجرای مجدد با هر تغییر

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');

function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'helpers' && entry.name !== 'fixtures') out.push(...collect(full));
    } else if (entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out.sort();
}

const files = collect(testDir);
if (files.length === 0) {
  console.error('هیچ فایل تستی در test/ پیدا نشد.');
  process.exit(1);
}

const args = ['--test'];
if (process.argv.includes('--watch')) args.push('--watch');
args.push(...files);

// NODE_ENV=test: config.js فایل .env واقعی را نمی‌خواند (تست‌ها hermetic هستند)
const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'test' },
});
process.exit(result.status === null ? 1 : result.status);
