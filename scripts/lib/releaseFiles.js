// قوانین «چه چیزی هرگز وارد بسته‌ی release نشود» (بخش ۲-ب۱). تنها منبع حقیقت: هم package-release و هم تست‌ها از اینجا می‌خوانند.

const fs = require('fs');
const path = require('path');

// پوشه‌هایی که در هر عمقی حذف می‌شوند
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.ssl', 'data', 'dist', 'logs', 'backups', 'attachments', '.vscode', '.idea']);

// نام فایل‌هایی که هرگز نباید در بسته باشند. .env.example عمداً مجاز است (بدون مقدار واقعی).
function isExcludedFile(name) {
  if (name === '.env.example') return false;
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (/\.(pem|key|pfx|p12|crt|cer)$/i.test(name)) return true;
  if (/\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/i.test(name)) return true;
  if (/\.(log)$/i.test(name) || /^npm-debug\.log/.test(name)) return true;
  if (/\.zip$/i.test(name)) return true;
  if (name === 'Thumbs.db' || name === '.DS_Store') return true;
  return false;
}

function collectReleaseFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (isExcludedFile(entry.name)) continue;
        files.push({ full, rel: path.relative(root, full).split(path.sep).join('/') });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

module.exports = { EXCLUDED_DIRS, isExcludedFile, collectReleaseFiles };
