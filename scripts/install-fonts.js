#!/usr/bin/env node
// S5-8b: کپی فایل فونت Vazirmatn (woff2، نسخه‌ی variable) به public/fonts با نام ثابتی که CSS انتظار دارد.
// استفاده: node scripts/install-fonts.js <پوشه‌ی-حاوی-woff2> [پوشه‌ی-مقصد]
// بدون شبکه و بدون وابستگی؛ فقط یک فایل را پیدا و کپی می‌کند.
const fs = require('fs');
const path = require('path');

const TARGET_NAME = 'Vazirmatn-Variable.woff2';

function findFont(dir) {
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (/^vazirmatn.*(\[wght\]|variable).*\.woff2$/i.test(e.name)) return full;
    }
  }
  return null;
}

function install(srcDir, destDir) {
  if (!srcDir || !fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) throw new Error('پوشه‌ی مبدأ پیدا نشد');
  const found = findFont(srcDir);
  if (!found) throw new Error('فایل Vazirmatn[wght].woff2 (نسخه‌ی variable) در پوشه‌ی مبدأ پیدا نشد');
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, TARGET_NAME);
  fs.copyFileSync(found, dest);
  return { from: found, to: dest, bytes: fs.statSync(dest).size };
}

if (require.main === module) {
  try {
    const r = install(process.argv[2], process.argv[3] || path.join(__dirname, '..', 'public', 'fonts'));
    console.log(`✅ ${r.from} → ${r.to} (${r.bytes} بایت)`);
  } catch (e) { console.error(`❌ ${e.message}`); process.exit(1); }
}
module.exports = { install, findFont, TARGET_NAME };
