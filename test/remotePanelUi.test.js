// R6 (فاز ۱۴): بررسی ساختاری صفحه‌ی «دورکاری» در پنل (public-admin/js/views-remote.js) — بدون inline، بدون alert/confirm/prompt،
// مجوزها، ثبت در index.html، شمارنده‌ی ناوبری و اتصال به APIهای R5.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('صفحه‌ی دورکاری در پنل (R6)', () => {
  const src = read('public-admin', 'js', 'views-remote.js');

  test('ثبت صفحه: perm = remote_work.read، nav با شمارنده، اسکلت جدول', () => {
    assert.match(src, /AP\.view\('remote', \{/);
    assert.match(src, /perm: 'remote_work\.read'/);
    assert.match(src, /counter: true/);
    assert.match(src, /skeleton: 'table'/);
  });

  test('فقط با مجوز review دکمه‌ی دسته‌ای دارد و دکمه‌های هر ردیف به canReview سرور وابسته است', () => {
    assert.match(src, /AP\.can\('remote_work\.review'\)/);
    assert.match(src, /if \(!it\.canReview\) return ''/);
    assert.match(src, /it\.overlapsOnsite/);
  });

  test('APIها: صف، تأیید، رد، دسته‌ای؛ تأیید هم‌پوشانی با overlap_decision و رد با review_note', () => {
    assert.match(src, /\/admin\/remote-work\?\$\{query\(\)\}/);
    assert.match(src, /\/admin\/remote-work\/\$\{it\.id\}\/approve/);
    assert.match(src, /\/admin\/remote-work\/\$\{it\.id\}\/reject/);
    assert.match(src, /\/admin\/remote-work\/approve-batch/);
    assert.match(src, /overlap_decision/);
    assert.match(src, /review_note: note/);
    assert.match(src, /approved_start_at/);
  });

  test('قواعد پروژه: بدون inline style/handler، بدون alert/confirm/prompt، هر مودال با AP.dates.mount برای ساعت‌ها', () => {
    assert.doesNotMatch(src, /\sstyle=|\sonclick=|\sonchange=|javascript:/);
    assert.doesNotMatch(src, /\b(alert|confirm|prompt)\(/);
    assert.match(src, /AP\.dates\.mount\(/);
  });

  test('index.html: اسکریپت بعد از views-nextplan.js و قبل از bell.js/boot.js', () => {
    const html = read('public-admin', 'index.html');
    const i = html.indexOf('/admin/js/views-remote.js');
    assert.ok(i > html.indexOf('/admin/js/views-nextplan.js'));
    assert.ok(i < html.indexOf('/admin/js/bell.js'));
  });

  test('core.js: شمارنده‌ی ناوبری از GET /admin/remote-work/count فقط با remote_work.read', () => {
    const core = read('public-admin', 'js', 'core.js');
    assert.match(core, /AP\.can\('remote_work\.read'\)/);
    assert.match(core, /\/admin\/remote-work\/count/);
    assert.match(core, /'remote'\]\.forEach/);
  });

  test('فایل‌های جدید CRLF‌اند', () => {
    for (const f of ['public-admin/js/views-remote.js', 'src/bot/commands/pendingRemote.js', 'src/bot/scheduler/remoteWorkReminder.js']) {
      const t = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      assert.ok(!/(^|[^\r])\n/.test(t), `${f}: LF خالص دارد`);
    }
  });
});
