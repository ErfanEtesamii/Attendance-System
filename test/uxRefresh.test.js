// بازنگری UX پنل: استثنای IP مشترک در قاعده‌ی ب، عملیات گروهی «موارد مشکوک»، ثبت فایل‌های تازه در index.html،
// و ساختار CSS/JS جدید (بدون استایل درون‌خطی/رنگ سخت‌کد). ایستا و بدون DB.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detectSameIpClose } = require('../src/utils/fraudDetection');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const at = (sec) => new Date(Date.UTC(2026, 9, 1, 8, 0, 0) + sec * 1000).toISOString();
const rec = (id, user_id, sec, ip) => ({ id, user_id, record_date: '2026-10-01', check_in_time: at(sec), check_in_ip: ip, check_out_time: null, check_out_ip: null });

describe('قاعده‌ی ب: ignoreIps', () => {
  const rows = [rec(1, 1, 0, '192.168.10.1'), rec(2, 2, 5, '::ffff:192.168.10.1'), rec(3, 3, 0, '192.168.10.30'), rec(4, 4, 5, '192.168.10.30')];
  test('بدون ignoreIps رفتار قبلی؛ با ignoreIps فقط آن IP (با/بدون ::ffff:) نادیده می‌شود', () => {
    assert.equal(detectSameIpClose(rows).length, 2);
    const out = detectSameIpClose(rows, { ignoreIps: ['192.168.10.1'] });
    assert.equal(out.length, 1);
    assert.equal(out[0].details.ip, '192.168.10.30');
    assert.equal(detectSameIpClose(rows, { ignoreIps: ['::FFFF:192.168.10.1'] }).length, 1);
    assert.equal(detectSameIpClose(rows, { ignoreIps: 'x' }).length, 2); // ورودی نامعتبر ⇒ نادیده
  });
  test('config.fraud.ignoreIps از FRAUD_IGNORE_IPS خوانده می‌شود و runner آن را می‌دهد', () => {
    assert.match(read('src/config.js'), /ignoreIps: String\(process\.env\.FRAUD_IGNORE_IPS/);
    assert.match(read('src/utils/fraudRunner.js'), /detectSameIpClose\(todayRecords, \{ windowSeconds, ignoreIps: cfg\.ignoreIps \}\)/);
    assert.match(read('.env.example'), /^FRAUD_IGNORE_IPS=/m);
  });
});

describe('پنل: فایل‌های UX جدید', () => {
  const html = read('public-admin/index.html');
  test('CSS بعد از ۴۸ و قبل از ۳۵-mobile؛ JS قبل از boot.js', () => {
    const css = html.indexOf('polish/49-ux-refresh.css');
    assert.ok(css > html.indexOf('polish/48-task-prominent.css') && css < html.indexOf('polish/35-mobile.css'));
    const js = html.indexOf('/admin/js/ux-refresh.js');
    assert.ok(js > html.indexOf('/admin/js/bell.js') && js < html.indexOf('/admin/js/boot.js'));
  });
  test('CSS: بدون رنگ سخت‌کد hex و بدون !important؛ JS: بدون style=" و innerHTML', () => {
    const css = read('public-admin/css/polish/49-ux-refresh.css');
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /!important/);
    const js = read('public-admin/js/ux-refresh.js');
    assert.doesNotMatch(js, /style="|innerHTML/);
  });
  test('ux-refresh.js بدون DOM/MutationObserver خطا نمی‌دهد', () => {
    const vm = require('node:vm');
    assert.doesNotThrow(() => vm.runInNewContext(read('public-admin/js/ux-refresh.js'), {}));
    assert.doesNotThrow(() => vm.runInNewContext(read('public-admin/js/ux-refresh.js'), { document: { getElementById: () => null } }));
  });
  test('عملیات گروهی موارد مشکوک: فقط بررسی‌نشده‌ها، حداقل ۲ مورد، با مجوز، دلیل اجباری', () => {
    const ops = read('public-admin/js/views-ops.js');
    assert.match(ops, /suspUi\.status !== 'open' \|\| !AP\.can\('suspicious\.review'\)/);
    assert.match(ops, /by\[t\]\.length >= 2/);
    assert.match(ops, /data-bulk=/);
    assert.match(ops, /AP\.askReason\(\{\s*title: 'ثبت گروهی به‌عنوان بی‌اهمیت'/);
  });
  test('IP بدون ::ffff: در تابلوی زنده و گزارش رویدادها', () => {
    assert.match(read('public-admin/js/views-main.js'), /String\(rec\.check_in_ip\)\.replace\(\/\^::ffff:\/i, ''\)/);
    assert.match(read('public-admin/js/views-admin.js'), /String\(r\.ip_address \|\| '—'\)\.replace\(\/\^::ffff:\/i, ''\)/);
  });
});
