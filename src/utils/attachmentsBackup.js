// بک‌آپ پیوست‌های مرخصی (S4-12c): آینه‌ی افزایشی data/attachments ⇒ <BACKUP_DIR>/attachments.
// فایل‌های پیوست «تغییرناپذیرند» (نام تصادفی، هرگز بازنویسی نمی‌شوند) پس کپی فقط‌فایل‌های تازه کافی و سازگار است؛ فایلِ پاک‌شده از مبدأ در آینه می‌ماند (امن‌تر).
// کپی با فایل موقت + rename (نیمه‌کاره هرگز با نام نهایی دیده نمی‌شود). فقط فایل‌های معمولی با نام ۳۲ hex کپی می‌شوند (.part، symlink و بقیه نه).
// خروجی: { copied, skipped, errors: [متن‌ها] }؛ هرگز استثنا نمی‌دهد (فراخواننده تصمیم می‌گیرد Job را خطا کند).
// restore: S2-2 هنوز پیوست را برنمی‌گرداند؛ آینه را می‌توان دستی به ATTACHMENTS_DIR کپی کرد.
const fs = require('fs');
const path = require('path');
const { ID_RE } = require('../services/attachmentService');

function mirrorAttachments(srcDir, backupDir) {
  const out = { copied: 0, skipped: 0, errors: [] };
  let names;
  try {
    names = fs.readdirSync(srcDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out; // هنوز پیوستی ثبت نشده
    out.errors.push(`خواندن ${srcDir}: ${err.message}`);
    return out;
  }
  const dest = path.join(backupDir, 'attachments');
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (err) {
    out.errors.push(`ساخت ${dest}: ${err.message}`);
    return out;
  }
  for (const e of names) {
    if (!e.isFile() || !ID_RE.test(e.name)) continue;
    const from = path.join(srcDir, e.name);
    const to = path.join(dest, e.name);
    try {
      const size = fs.statSync(from).size;
      if (fs.existsSync(to) && fs.statSync(to).size === size) { out.skipped += 1; continue; }
      const tmp = `${to}.copying`;
      fs.copyFileSync(from, tmp);
      fs.renameSync(tmp, to);
      out.copied += 1;
    } catch (err) {
      out.errors.push(`${e.name}: ${err.message}`);
      try { fs.rmSync(path.join(dest, `${e.name}.copying`), { force: true }); } catch (_) { /* وجود ندارد */ }
    }
  }
  return out;
}

module.exports = { mirrorAttachments };
