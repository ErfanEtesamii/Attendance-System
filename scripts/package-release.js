// ساخت zip تحویل/استقرار بدون رازها (بخش ۲-ب۱).
//   npm run package                 → dist/farazhonar-attendance-<نسخه>-<تاریخ>.zip
//   node scripts/package-release.js --out C:\temp\release.zip
//
// همیشه حذف می‌شوند: .env و هر .env.* (به‌جز .env.example)، .ssl/، data/ (دیتابیس‌ها و بک‌آپ‌ها)، node_modules/، .git/،
// لاگ‌ها، *.pem/*.key/*.pfx/*.db و zipهای قبلی. بعد از ساخت، محتوای zip دوباره (۱) با فهرست ممنوعه‌ها و (۲) با اسکنر رازها
// بررسی می‌شود؛ اگر چیزی رد شده باشد فایل خروجی پاک و با کد ۱ خارج می‌شود (fail-closed).
// بدون وابستگی npm: zip با ماژول داخلی zlib ساخته می‌شود و روی ویندوز هم کار می‌کند.

const fs = require('fs');
const path = require('path');
const { collectReleaseFiles, isExcludedFile, EXCLUDED_DIRS } = require('./lib/releaseFiles');
const { createZip, readZip } = require('./lib/zip');
const { scanText } = require('./lib/secretScan');

const TEXT_RE = /\.(js|json|md|html|css|txt|ps1|cmd|bat|yml|yaml|example|sql|cjs|mjs|xml|conf|ini)$/i;

function buildRelease(root, outPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const prefix = `farazhonar-attendance-${pkg.version}`;
  const files = collectReleaseFiles(root);

  const entries = files.map((f) => ({
    name: `${prefix}/${f.rel}`,
    data: fs.readFileSync(f.full),
    mtime: fs.statSync(f.full).mtime,
  }));
  const buf = createZip(entries);

  // راستی‌آزمایی روی خودِ zip ساخته‌شده (نه فقط روی فهرست ورودی)
  const problems = [];
  for (const e of readZip(buf)) {
    const rel = e.name.split('/').slice(1);
    const base = rel[rel.length - 1];
    if (isExcludedFile(base) || rel.slice(0, -1).some((d) => EXCLUDED_DIRS.has(d))) {
      problems.push(`فایل ممنوعه در بسته: ${e.name}`);
      continue;
    }
    if (TEXT_RE.test(base)) {
      for (const f of scanText(e.data.toString('utf8'), e.name)) {
        problems.push(`راز احتمالی (${f.type}) در ${f.file}:${f.line}`);
      }
    }
  }
  if (problems.length) return { ok: false, problems, count: entries.length };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { ok: true, outPath, count: entries.length, bytes: buf.length };
}

function main() {
  const root = path.join(__dirname, '..');
  const outIdx = process.argv.indexOf('--out');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = outIdx > -1
    ? path.resolve(process.argv[outIdx + 1])
    : path.join(root, 'dist', `farazhonar-attendance-${pkg.version}-${stamp}.zip`);

  const r = buildRelease(root, outPath);
  if (!r.ok) {
    console.error('❌ بسته ساخته نشد؛ موارد زیر باید اول رفع شوند:');
    r.problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
  console.log(`✅ ${r.count} فایل → ${r.outPath} (${(r.bytes / 1024).toFixed(0)} KB)`);
  console.log('   .env، .ssl، data، node_modules، .git و لاگ‌ها در بسته نیستند.');
}

if (require.main === module) main();

module.exports = { buildRelease };
