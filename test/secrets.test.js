require('./helpers/testEnv');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { assessSessionSecret, checkConfig, runStartupChecks } = require('../src/utils/startupChecks');
const { scanText, scanProject } = require('../scripts/lib/secretScan');
const { createZip, readZip } = require('../scripts/lib/zip');
const { isExcludedFile } = require('../scripts/lib/releaseFiles');
const { buildRelease } = require('../scripts/package-release');
const { cleanup } = require('./helpers/testEnv');

const ROOT = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
after(() => {
  fs.rmSync(work, { recursive: true, force: true });
  cleanup();
});

// مقدارهای ساختگی عمداً تکه‌تکه ساخته می‌شوند تا خودِ این فایل در اسکن پروژه یافته نشود
const FAKE_TOKEN = `${'987654321'}:${'AAF-fakeFakeFakeFake_0123456789abcdef'}`;
const FAKE_PEM = `-----BEGIN ${'RSA PRIVATE KEY'}-----`;
const GOOD_SECRET = require('crypto').randomBytes(32).toString('hex');

function tree(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

describe('startupChecks — ADMIN_SESSION_SECRET', () => {
  const cases = [
    ['خالی', '', false],
    ['کوتاه (31)', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d', false],
    ['نمونه‌ی dev پیش‌فرض', 'dev-only-insecure-secret-change-me-please-0123', false],
    ['شامل change-me', 'please-change-me-to-something-random-0123456789', false],
    ['شروع با test', 'test-session-secret-0123456789abcdef0123456789abcdef', false],
    ['تکراری و غیرتصادفی', 'ab'.repeat(20), false],
    ['hex تصادفی ۶۴ نویسه', GOOD_SECRET, true],
  ];
  for (const [title, secret, ok] of cases) {
    test(title, () => assert.equal(assessSessionSecret(secret).ok, ok));
  }

  test('پیام خطا هرگز خودِ راز را نشان نمی‌دهد', () => {
    const weak = 'dev-only-insecure-secret-change-me-please-0123';
    const { errors } = checkConfig({ nodeEnv: 'production', adminSessionSecret: weak, telegramBotUsername: 'bot' });
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].includes(weak));
  });
});

describe('startupChecks — رفتار بر اساس محیط', () => {
  const base = { adminSessionSecret: GOOD_SECRET, telegramBotUsername: 'my_bot', telegramBotToken: 'x' };

  test('production + راز ضعیف → خطا (throw)', () => {
    assert.throws(
      () => runStartupChecks({ ...base, nodeEnv: 'production', adminSessionSecret: 'short' }, { warn() {} }),
      /سرور بالا نمی‌آید/
    );
  });

  test('development + راز ضعیف → فقط هشدار', () => {
    const logs = [];
    const r = runStartupChecks({ ...base, nodeEnv: 'development', adminSessionSecret: 'short' }, { warn: (m) => logs.push(m) });
    assert.equal(r.errors.length, 0);
    assert.ok(logs.some((l) => l.includes('ADMIN_SESSION_SECRET')));
  });

  test('TELEGRAM_BOT_USERNAME خالی → هشدار (نه خطا) حتی در production', () => {
    const logs = [];
    const r = runStartupChecks({ ...base, nodeEnv: 'production', telegramBotUsername: '' }, { warn: (m) => logs.push(m) });
    assert.equal(r.errors.length, 0);
    assert.ok(logs.some((l) => l.includes('TELEGRAM_BOT_USERNAME')));
  });

  test('پیکربندی سالم → بدون خطا و هشدار', () => {
    const r = checkConfig({ ...base, nodeEnv: 'production' });
    assert.deepEqual(r, { errors: [], warnings: [] });
  });
});

describe('startupChecks — اجرای واقعی createApp در پروسه‌ی جدا (production)', () => {
  function runCreateApp(env) {
    const cwd = fs.mkdtempSync(path.join(work, 'cwd-')); // cwd خالی: .env واقعی پروژه خوانده نشود
    const code = `require(${JSON.stringify(path.join(ROOT, 'src', 'server.js'))}).createApp(); console.log('CREATED'); process.exit(0);`;
    const dbPath = path.join(cwd, 'x.db');
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NODE_ENV: 'production', DB_PATH: dbPath, ...env },
    });
    return { ...r, dbCreated: fs.existsSync(dbPath) };
  }

  test('راز خالی → خروج با خطا، بدون ساخت اپ', () => {
    const r = runCreateApp({ ADMIN_SESSION_SECRET: '', TELEGRAM_BOT_USERNAME: 'b' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ADMIN_SESSION_SECRET/);
    assert.ok(!r.stdout.includes('CREATED'));
    assert.equal(r.dbCreated, false, 'پیکربندی ناامن نباید به دیتابیس دست بزند (migration/ساخت فایل)');
  });

  test('راز کوتاه → خروج با خطا', () => {
    const r = runCreateApp({ ADMIN_SESSION_SECRET: 'tooshort', TELEGRAM_BOT_USERNAME: 'b' });
    assert.notEqual(r.status, 0);
    assert.ok(!r.stdout.includes('CREATED'));
  });

  test('راز قوی + username خالی → بالا می‌آید و هشدار می‌دهد', () => {
    const r = runCreateApp({ ADMIN_SESSION_SECRET: GOOD_SECRET, TELEGRAM_BOT_USERNAME: '' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('CREATED'));
    assert.match(r.stderr + r.stdout, /TELEGRAM_BOT_USERNAME/);
  });
});

describe('secretScan.scanText', () => {
  test('توکن بات (حتی داخل URL) و PEM پیدا می‌شوند', () => {
    const f = scanText(`fetch("https://api.telegram.org/bot${FAKE_TOKEN}/getMe")\n${FAKE_PEM}\n`, 'a.js');
    assert.deepEqual(f.map((x) => [x.type, x.line]), [['telegram_token', 1], ['private_key', 2]]);
  });

  test('خروجی یافته مقدار کامل راز را ندارد', () => {
    const [f] = scanText(`TOKEN_X=${FAKE_TOKEN}\n`, 'a.js');
    assert.ok(!JSON.stringify(f).includes(FAKE_TOKEN.split(':')[1]));
  });

  test('انتساب مشکوک با مقدار تصادفی یافته است', () => {
    const f = scanText(`ADMIN_SESSION_SECRET=${GOOD_SECRET}\n`, '.env.production');
    assert.equal(f.length, 1);
    assert.equal(f[0].type, 'secret_assign');
  });

  test('بدون مثبت کاذب: ارجاع به env، placeholder، مقدار خالی', () => {
    const ok = [
      'secret: process.env.ADMIN_SESSION_SECRET || config.adminSessionSecret',
      'ADMIN_SESSION_SECRET=your-random-secret-value-goes-here',
      'ADMIN_SESSION_SECRET=',
      'const token = req.headers.authorization;',
      'TELEGRAM_BOT_TOKEN=<token-from-botfather-here>',
    ].join('\n');
    assert.deepEqual(scanText(ok, 'a.js'), []);
  });

  test('مارکر secret-scan:allow خط را نادیده می‌گیرد', () => {
    assert.deepEqual(scanText(`const t = "${FAKE_TOKEN}"; // secret-scan:allow\n`, 'a.js'), []);
  });
});

describe('secretScan.scanProject', () => {
  test('.env و .ssl و data محلی نادیده‌اند، ولی .env.production و *.pem سرگردان یافته‌اند', () => {
    const dir = fs.mkdtempSync(path.join(work, 'proj-'));
    tree(dir, {
      '.env': `TELEGRAM_BOT_TOKEN=${FAKE_TOKEN}\n`,
      '.ssl/key.pem': `${FAKE_PEM}\nabc\n`,
      'data/a.db': 'binary',
      'node_modules/x/index.js': `const t="${FAKE_TOKEN}"`,
      '.env.production': `TELEGRAM_BOT_TOKEN=${FAKE_TOKEN}\n`,
      'certs/server.pem': 'x',
      'src/ok.js': 'module.exports = 1;\n',
    });
    const { findings } = scanProject(dir);
    const files = findings.map((f) => f.file).sort();
    assert.deepEqual(files, ['.env.production', 'certs/server.pem']);
  });

  test('خودِ پروژه تمیز است (جلوگیری از بازگشت راز به کد)', () => {
    const { findings, scanned } = scanProject(ROOT);
    assert.ok(scanned > 50);
    assert.deepEqual(findings, [], JSON.stringify(findings));
  });
});

describe('zip writer/reader', () => {
  test('رفت‌وبرگشت: نام فارسی، فایل خالی، باینری و متن فشرده', () => {
    const bin = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256));
    const entries = [
      { name: 'a/سلام.txt', data: Buffer.from('سلام دنیا '.repeat(200)) },
      { name: 'empty.txt', data: Buffer.alloc(0) },
      { name: 'bin.dat', data: bin },
    ];
    const back = readZip(createZip(entries));
    assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
    entries.forEach((e, i) => assert.ok(e.data.equals(back[i].data)));
  });

  test('دستکاری داده → خطای CRC', () => {
    const buf = createZip([{ name: 'x.txt', data: Buffer.from('hello hello hello hello') }]);
    const idx = buf.indexOf('hello');
    if (idx > -1) buf[idx] ^= 0xff; // ذخیره‌ی بدون فشرده‌سازی نیست؛ در غیر این صورت بایت وسط را خراب کن
    else buf[40] ^= 0xff;
    assert.throws(() => readZip(buf));
  });
});

describe('package-release', () => {
  test('isExcludedFile', () => {
    for (const n of ['.env', '.env.production', 'a.pem', 'k.key', 'attendance.db', 'attendance.db-wal', 'server.log', 'old.zip']) {
      assert.equal(isExcludedFile(n), true, n);
    }
    for (const n of ['.env.example', 'app.js', 'README.md']) assert.equal(isExcludedFile(n), false, n);
  });

  test('پروژه‌ی نمونه: رازها و داده‌ها در zip نیستند', () => {
    const dir = fs.mkdtempSync(path.join(work, 'rel-'));
    tree(dir, {
      'package.json': JSON.stringify({ name: 'x', version: '9.9.9' }),
      '.env': 'A=1\n',
      '.env.example': 'A=\n',
      '.ssl/key.pem': 'k',
      'data/attendance.db': 'd',
      'data/backups/b.db': 'b',
      'node_modules/m/i.js': 'm',
      '.git/config': 'g',
      'logs/a.log': 'l',
      'src/app.js': 'module.exports = 1;\n',
      'docs/راهنما.md': '# سلام\n',
    });
    const out = path.join(work, 'out1.zip');
    const r = buildRelease(dir, out);
    assert.equal(r.ok, true, JSON.stringify(r));
    const names = readZip(fs.readFileSync(out)).map((e) => e.name.split('/').slice(1).join('/')).sort();
    assert.deepEqual(names, ['.env.example', 'docs/راهنما.md', 'package.json', 'src/app.js']);
  });

  test('اگر راز داخل کد باشد → بسته ساخته نمی‌شود و فایل خروجی وجود ندارد (fail-closed)', () => {
    const dir = fs.mkdtempSync(path.join(work, 'rel-'));
    tree(dir, {
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      'src/leak.js': `const t = "${FAKE_TOKEN}";\n`,
    });
    const out = path.join(work, 'out2.zip');
    const r = buildRelease(dir, out);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('src/leak.js')));
    assert.equal(fs.existsSync(out), false);
  });

  test('خودِ پروژه (با .env و .ssl واقعی در پوشه) بدون هیچ فایل ممنوعه بسته می‌شود', () => {
    const out = path.join(work, 'out3.zip');
    const r = buildRelease(ROOT, out);
    assert.equal(r.ok, true, JSON.stringify(r));
    const names = readZip(fs.readFileSync(out)).map((e) => e.name.split('/').slice(1).join('/'));
    assert.ok(names.includes('package.json'));
    assert.ok(names.includes('.env.example'));
    for (const n of names) {
      assert.ok(!/^(\.env$|\.env\.(?!example$)|\.ssl\/|data\/|node_modules\/|\.git\/)/.test(n), `ممنوعه در بسته: ${n}`);
      assert.ok(!/\.(pem|key|db|log)$/.test(n), `ممنوعه در بسته: ${n}`);
    }
  });
});
