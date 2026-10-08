// S4-12c: بک‌آپ پیوست‌ها در Job بک‌آپ روزانه (تنظیم backupIncludeAttachments، پیش‌فرض روشن) و خارج‌ماندن attachments از بسته‌ی release و secret-scan.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ID1 = 'a'.repeat(32);
const ID2 = 'b'.repeat(32);
const ID3 = 'c'.repeat(32);

describe('بک‌آپ پیوست‌ها و بسته‌ساز (S4-12c)', () => {
  let tmp; let att; let bak; let runDailyBackup; let settingsRepo; let n = 0;
  before(() => {
    resetDb();
    ({ runDailyBackup } = require('../src/bot/scheduler/backup'));
    settingsRepo = require('../src/repositories/settingsRepository');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attbak-'));
    att = path.join(tmp, 'att');
    bak = path.join(tmp, 'bak');
    fs.mkdirSync(att);
  });
  after(() => { fs.rmSync(tmp, { recursive: true, force: true }); cleanup(); });

  const run = () => { n += 1; return runDailyBackup({ dir: bak, attachmentsDir: att, now: new Date(2028, 0, 10, 2, n) }); };
  const mirror = () => (fs.existsSync(path.join(bak, 'attachments')) ? fs.readdirSync(path.join(bak, 'attachments')).sort() : null);

  test('پیش‌فرض روشن: فایل‌های ۳۲hex کپی می‌شوند؛ .part، نام‌های دیگر و پوشه نه؛ محتوا یکسان', async () => {
    fs.writeFileSync(path.join(att, ID1), 'one');
    fs.writeFileSync(path.join(att, ID2), 'two-two');
    fs.writeFileSync(path.join(att, `${ID3}.part`), 'partial');
    fs.writeFileSync(path.join(att, 'notes.txt'), 'x');
    fs.mkdirSync(path.join(att, 'd'.repeat(32)));
    const r = await run();
    assert.deepEqual([r.attachments.copied, r.attachments.skipped, r.attachments.errors], [2, 0, []]);
    assert.deepEqual(mirror(), [ID1, ID2]);
    assert.equal(fs.readFileSync(path.join(bak, 'attachments', ID2), 'utf8'), 'two-two');
    assert.ok(fs.existsSync(path.join(bak, r.file)), 'بک‌آپ دیتابیس هم ساخته شد');
  });

  test('افزایشی: اجرای دوم چیزی کپی نمی‌کند؛ فایل تازه کپی می‌شود؛ فایلِ پاک‌شده از مبدأ در آینه می‌ماند؛ پوشه‌ی بک‌آپ‌های دیتابیس را بهم نمی‌ریزد', async () => {
    let r = await run();
    assert.deepEqual([r.attachments.copied, r.attachments.skipped], [0, 2]);
    fs.writeFileSync(path.join(att, ID3), 'three');
    fs.rmSync(path.join(att, ID1));
    r = await run();
    assert.equal(r.attachments.copied, 1);
    assert.deepEqual(mirror(), [ID1, ID2, ID3]);
    assert.ok(fs.readdirSync(bak).some((f) => /^daily-.*\.db$/.test(f)));
  });

  test('تنظیم خاموش ⇒ کپی نمی‌شود؛ مبدأ ناموجود ⇒ بی‌خطا؛ خطای کپی ⇒ بک‌آپ دیتابیس می‌ماند ولی Job خطا می‌دهد', async () => {
    settingsRepo.setValue('backupIncludeAttachments', false);
    fs.writeFileSync(path.join(att, 'e'.repeat(32)), 'new');
    const off = await run();
    assert.equal(off.attachments, null);
    assert.ok(!mirror().includes('e'.repeat(32)));
    settingsRepo.resetValue('backupIncludeAttachments');

    const noSrc = await runDailyBackup({ dir: bak, attachmentsDir: path.join(tmp, 'missing'), now: new Date(2028, 0, 11, 2, 0) });
    assert.deepEqual([noSrc.attachments.copied, noSrc.attachments.errors], [0, []]);

    const bak2 = path.join(tmp, 'bak2');
    fs.mkdirSync(bak2);
    fs.writeFileSync(path.join(bak2, 'attachments'), 'من فایلم، نه پوشه'); // ساخت آینه شکست می‌خورد
    await assert.rejects(runDailyBackup({ dir: bak2, attachmentsDir: att, now: new Date(2028, 0, 12, 2, 0) }), /پیوست‌ها ناقص/);
    assert.ok(fs.readdirSync(bak2).some((f) => /^daily-.*\.db$/.test(f)), 'بک‌آپ دیتابیس با وجود خطا ساخته شده است');
  });

  test('release و secret-scan: attachments (در هر عمقی) و data/attachments بیرون می‌مانند', () => {
    const { collectReleaseFiles } = require('../scripts/lib/releaseFiles');
    const { scanProject } = require('../scripts/lib/secretScan');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
    const token = `${'1'.repeat(9)}:AA${'x'.repeat(33)}`; // ساخت پویا تا خودِ تست یافته‌ی secret-scan نشود
    const put = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };
    put('src/app.js', 'module.exports = 1;\n');
    put('data/attachments/a.pdf', '%PDF-');
    put('attachments/b.jpg', 'jpg');
    put('attachments/note.txt', `token=${token}\n`);
    put('data/backups/attachments/c', 'c');
    put('src/x.txt', `token=${token}\n`);
    try {
      const rels = collectReleaseFiles(root).map((f) => f.rel);
      assert.deepEqual(rels, ['src/app.js', 'src/x.txt']);
      const files = scanProject(root).findings.map((f) => f.file);
      assert.ok(files.includes('src/x.txt'), 'کنترل مثبت: همان رشته در src یافته می‌شود');
      assert.ok(!files.some((f) => f.includes('attachments')), 'فایل‌های attachments اسکن نمی‌شوند');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
