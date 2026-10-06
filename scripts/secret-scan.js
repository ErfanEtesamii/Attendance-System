// اسکن رازها در پروژه (بخش ۲-ب۱).
//   npm run secret-scan            → اسکن کل پروژه (به‌جز .env/.ssl/data/node_modules/.git محلی)
//   node scripts/secret-scan.js --json
// کد خروج: ۰ = تمیز، ۱ = یافته دارد (برای قفل‌کردن commit/release)، ۲ = خطای اجرا.
// مقدار راز هرگز چاپ نمی‌شود. برای نادیده‌گرفتن یک خط عمدی (مثل توکن ساختگی تست): عبارت «secret-scan:allow» را در همان خط بگذارید.

const path = require('path');
const { scanProject } = require('./lib/secretScan');

const LABELS = {
  telegram_token: 'توکن بات تلگرام',
  private_key: 'کلید خصوصی PEM',
  secret_assign: 'انتساب مشکوک به راز',
  key_file: 'فایل کلید/گواهی',
};

function main() {
  const root = path.join(__dirname, '..');
  const asJson = process.argv.includes('--json');
  let result;
  try {
    result = scanProject(root);
  } catch (err) {
    console.error('خطا در اسکن:', err.message);
    process.exit(2);
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.findings.length === 0) {
    console.log(`✅ هیچ رازی پیدا نشد (${result.scanned} فایل متنی اسکن شد).`);
  } else {
    console.error(`❌ ${result.findings.length} مورد مشکوک پیدا شد:`);
    for (const f of result.findings) {
      console.error(`  - [${LABELS[f.type] || f.type}] ${f.file}${f.line ? `:${f.line}` : ''}  ${f.preview}`);
    }
    console.error('\nاگر مورد عمدی و بی‌خطر است (مثلاً داده‌ی ساختگی تست)، در همان خط عبارت «secret-scan:allow» را کامنت کنید.');
    console.error('اگر راز واقعی بود: آن را حذف کنید و طبق docs/SECRETS.md بچرخانید (ابطال و ساخت مقدار جدید).');
  }
  process.exit(result.findings.length ? 1 : 0);
}

main();
