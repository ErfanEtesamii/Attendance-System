// اسکنر رازها (بخش ۲-ب۱). بدون وابستگی؛ هم از scripts/secret-scan.js و هم از scripts/package-release.js و تست‌ها استفاده می‌شود.
//
// چه چیزهایی «یافته» حساب می‌شوند:
//   • telegram_token : توکن بات تلگرام (الگوی ^\d+:[A-Za-z0-9_-]{30,}$ ولی داخل متن، حتی داخل URL مثل api.telegram.org/bot<TOKEN>/)
//   • private_key    : بلوک PEM کلید خصوصی
//   • secret_assign  : انتساب مشکوک به نام‌هایی مثل SECRET/TOKEN/PASSWORD/API_KEY با مقدار رشته‌ای طولانی و غیرنمونه
// استثنا: خطی که عبارت «secret-scan:allow» داشته باشد (مثلاً توکن ساختگی تست‌ها).
// ⚠️ مقدار راز هرگز در خروجی چاپ نمی‌شود؛ فقط نوع، فایل، شماره خط و یک پیش‌نمایش ماسک‌شده.

const fs = require('fs');
const path = require('path');

const ALLOW_MARKER = 'secret-scan:allow';

// پوشه‌ها/فایل‌هایی که اسکن نمی‌شوند (راز محلیِ مجاز یا محتوای غیرمتنی)
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', '.ssl', 'dist']);
const SKIP_FILES = new Set(['.env', 'package-lock.json']); // فقط .env محلیِ ریشه؛ هر .env.* دیگری اسکن می‌شود
const TEXT_EXT = new Set([
  '.js', '.json', '.md', '.html', '.css', '.txt', '.ps1', '.cmd', '.bat', '.yml', '.yaml', '.example', '.sql', '.cjs', '.mjs', '.xml', '.conf', '.ini', '.env', '',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const TOKEN_RE = /(?<![0-9])[0-9]{6,}:[A-Za-z0-9_-]{30,}(?![A-Za-z0-9_-])/;
const PEM_RE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/;
// نام شامل SECRET/TOKEN/PASSWORD/... ، بعد = یا : ، بعد یک مقدار رشته‌ای (در کوتیشن یا بدون آن)
const ASSIGN_RE = /([A-Za-z0-9_.-]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z0-9_.-]*)\s*[=:]\s*(['"`]?)([^\s'"`,;)]{20,})\2/i;

const PLACEHOLDER_RE = /change[-_ ]?me|changeme|your[-_ ]|example|placeholder|sample|dummy|xxxx|<[^>]+>|\.\.\.|test[-_]|fake|dev-only/i;
// مقدار «کد» است نه راز: ارجاع به متغیر/تابع/پراپرتی
const CODE_REF_RE = /^(?:process\.|config\.|req\.|res\.|this\.|opts\.|options\.|env\.|require\(|[a-z]+\()/i;

function maskPreview(value) {
  const v = String(value);
  if (v.length <= 6) return '***';
  return `${v.slice(0, 3)}…(${v.length} نویسه)`;
}

function looksRandom(value) {
  // نسبت نویسه‌های یکتا؛ رشته‌ی تکراری/ساده راز واقعی نیست
  return new Set(value).size >= 8;
}

// خطوط یک متن را اسکن می‌کند و یافته‌ها را برمی‌گرداند
function scanText(text, file = '(memory)') {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    const lineNo = i + 1;

    const tok = TOKEN_RE.exec(line);
    if (tok) {
      findings.push({ type: 'telegram_token', file, line: lineNo, preview: maskPreview(tok[0]) });
    }
    if (PEM_RE.test(line)) {
      findings.push({ type: 'private_key', file, line: lineNo, preview: 'PRIVATE KEY' });
    }
    const m = ASSIGN_RE.exec(line);
    if (m && !tok) {
      const value = m[3];
      const isRef = CODE_REF_RE.test(value);
      const isPlaceholder = PLACEHOLDER_RE.test(value);
      // فقط وقتی مقدار شبیه راز واقعی است: بدون نقطه‌ی کدی، تصادفی‌نما
      if (!isRef && !isPlaceholder && looksRandom(value) && /^[A-Za-z0-9+/_=-]+$/.test(value)) {
        findings.push({ type: 'secret_assign', file, line: lineNo, preview: `${m[1]}=${maskPreview(value)}` });
      }
    }
  });
  return findings;
}

function* walk(dir, root, isSkippedDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name, rel)) continue;
      yield* walk(full, root, isSkippedDir);
    } else if (entry.isFile()) {
      yield { full, rel, name: entry.name };
    }
  }
}

// کل پروژه را اسکن می‌کند. .env محلیِ ریشه، .ssl/ ، data/ ، node_modules/ و .git/ عمداً کنار گذاشته می‌شوند
// (آن‌ها راز محلی‌اند؛ جلوگیری از رفتنشان به خروجی کار package-release است).
function scanProject(root, { extraSkipDirs = [] } = {}) {
  const skip = new Set([...SKIP_DIRS, ...extraSkipDirs]);
  const findings = [];
  let scanned = 0;
  for (const f of walk(root, root, (name) => skip.has(name))) {
    if (f.rel === '.env' || SKIP_FILES.has(f.name)) continue;
    // کلیدها و گواهی‌ها به‌خودیِ‌خود یافته‌اند، حتی خارج از .ssl
    if (/\.(pem|key|pfx|p12)$/i.test(f.name)) {
      findings.push({ type: 'key_file', file: f.rel, line: 0, preview: f.name });
      continue;
    }
    const ext = path.extname(f.name).toLowerCase();
    // هر فایل .env* (مثل .env.production) متنی است حتی اگر «پسوند» نامتعارفی داشته باشد
    if (!TEXT_EXT.has(ext) && !f.name.startsWith('.env')) continue;
    let stat;
    try { stat = fs.statSync(f.full); } catch (_) { continue; }
    if (stat.size > MAX_FILE_BYTES) continue;
    scanned += 1;
    findings.push(...scanText(fs.readFileSync(f.full, 'utf8'), f.rel));
  }
  return { findings, scanned };
}

module.exports = { scanText, scanProject, maskPreview, ALLOW_MARKER };
