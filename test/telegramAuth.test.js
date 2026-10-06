require('./helpers/testEnv');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyInitData } = require('../src/utils/telegramInitData');
const { verifyLoginWidgetData } = require('../src/utils/telegramLoginAuth');

const TOKEN = '123456789:TEST_FAKE_TOKEN_abcdefghijklmnopqrstuvwxyz0123';
const nowSec = () => Math.floor(Date.now() / 1000);

// ساخت initData مطابق الگوریتم رسمی Mini App (کلید = HMAC("WebAppData", token))
function signInitData(fields, token = TOKEN, algorithm = 'webapp') {
  const params = new URLSearchParams(fields);
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret =
    algorithm === 'webapp'
      ? crypto.createHmac('sha256', 'WebAppData').update(token).digest()
      : crypto.createHash('sha256').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

// ساخت داده Login Widget (کلید = SHA256(token))
function signWidget(data, token = TOKEN, algorithm = 'widget') {
  const dcs = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('\n');
  const secret =
    algorithm === 'widget'
      ? crypto.createHash('sha256').update(token).digest()
      : crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  return { ...data, hash: crypto.createHmac('sha256', secret).update(dcs).digest('hex') };
}

const user = JSON.stringify({ id: 555, first_name: 'تست' });

describe('initData (Mini App)', () => {
  test('امضای درست و تازه پذیرفته می‌شود', () => {
    const r = verifyInitData(signInitData({ auth_date: String(nowSec()), user }), TOKEN);
    assert.equal(r.telegramUser.id, 555);
  });
  test('توکن اشتباه / امضای دستکاری‌شده / فیلد دستکاری‌شده رد می‌شود', () => {
    const good = signInitData({ auth_date: String(nowSec()), user });
    assert.equal(verifyInitData(good, 'other:token'), null);
    // اولین کاراکتر hash را قطعاً تغییر بده (جایگزینی ثابت با '0' در ۱ از ۱۶ حالت بی‌اثر بود و تست را ناپایدار می‌کرد)
    assert.equal(verifyInitData(good.replace(/hash=([0-9a-f])/, (m, c) => `hash=${c === '0' ? '1' : '0'}`), TOKEN), null);
    const forged = new URLSearchParams(good);
    forged.set('user', JSON.stringify({ id: 1 })); // تلاش برای جعل هویت کارمند دیگر
    assert.equal(verifyInitData(forged.toString(), TOKEN), null);
  });
  test('بدون hash، خالی، بدون user، یا auth_date نامعتبر رد می‌شود', () => {
    assert.equal(verifyInitData('', TOKEN), null);
    assert.equal(verifyInitData(`auth_date=${nowSec()}&user=${encodeURIComponent(user)}`, TOKEN), null);
    assert.equal(verifyInitData(signInitData({ auth_date: String(nowSec()) }), TOKEN), null);
    assert.equal(verifyInitData(signInitData({ auth_date: 'abc', user }), TOKEN), null);
  });
  test('منقضی (بیش از ۲۴ ساعت) و تاریخ آینده‌ی دور رد می‌شود؛ حاشیه ۶۰ ثانیه ساعت مجاز', () => {
    assert.equal(verifyInitData(signInitData({ auth_date: String(nowSec() - 25 * 3600), user }), TOKEN), null);
    assert.equal(verifyInitData(signInitData({ auth_date: String(nowSec() + 600), user }), TOKEN), null);
    assert.ok(verifyInitData(signInitData({ auth_date: String(nowSec() + 20), user }), TOKEN));
  });
});

describe('Login Widget (ورود پنل)', () => {
  const base = () => ({ id: 555, first_name: 'تست', auth_date: nowSec() });
  test('امضای درست پذیرفته می‌شود و hash از خروجی حذف است', () => {
    const r = verifyLoginWidgetData(signWidget(base()), TOKEN);
    assert.equal(r.id, 555);
    assert.equal('hash' in r, false);
  });
  test('توکن اشتباه، فیلد دستکاری‌شده، بدون hash، منقضی رد می‌شود', () => {
    const good = signWidget(base());
    assert.equal(verifyLoginWidgetData(good, 'other:token'), null);
    assert.equal(verifyLoginWidgetData({ ...good, id: 1 }, TOKEN), null);
    const { hash, ...noHash } = good;
    assert.equal(verifyLoginWidgetData(noHash, TOKEN), null);
    assert.equal(verifyLoginWidgetData(signWidget({ ...base(), auth_date: nowSec() - 2 * 86400 }), TOKEN), null);
    assert.equal(verifyLoginWidgetData(null, TOKEN), null);
  });
});

describe('دو الگوریتم هرگز قابل جایگزینی نیستند', () => {
  test('initData امضا‌شده با الگوریتم Login Widget در Mini App رد می‌شود', () => {
    const wrong = signInitData({ auth_date: String(nowSec()), user }, TOKEN, 'widget');
    assert.equal(verifyInitData(wrong, TOKEN), null);
  });
  test('داده Login Widget امضا‌شده با الگوریتم Mini App در پنل رد می‌شود', () => {
    const wrong = signWidget({ id: 555, first_name: 'تست', auth_date: nowSec() }, TOKEN, 'webapp');
    assert.equal(verifyLoginWidgetData(wrong, TOKEN), null);
  });
});
