require('./helpers/testEnv');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionToken, verifySessionToken } = require('../src/utils/session');
const { parseCookies } = require('../src/utils/cookies');

const SECRET = 'a-test-secret-long-enough-0123456789';

test('سشن معتبر: payload برگردانده می‌شود و exp در آینده است', () => {
  const p = verifySessionToken(createSessionToken({ userId: 7 }, SECRET, 60), SECRET);
  assert.equal(p.userId, 7);
  assert.ok(p.exp > Math.floor(Date.now() / 1000));
});

test('سشن منقضی رد می‌شود', () => {
  assert.equal(verifySessionToken(createSessionToken({ userId: 7 }, SECRET, -5), SECRET), null);
});

test('راز اشتباه رد می‌شود (چرخش ADMIN_SESSION_SECRET همه سشن‌ها را باطل می‌کند)', () => {
  const t = createSessionToken({ userId: 7 }, SECRET, 60);
  assert.equal(verifySessionToken(t, 'another-secret-0123456789-abcdef'), null);
});

test('دستکاری payload (ارتقا به userId دیگر) با همان امضا رد می‌شود', () => {
  const t = createSessionToken({ userId: 7 }, SECRET, 60);
  const [, sig] = t.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ userId: 1, exp: Math.floor(Date.now() / 1000) + 9999 })).toString('base64url');
  assert.equal(verifySessionToken(`${forgedPayload}.${sig}`, SECRET), null);
});

test('ورودی‌های ناقص/نامعتبر رد می‌شود و exception نمی‌دهد', () => {
  for (const bad of [undefined, null, '', 'abc', 'a.b.c', '.', 'x.y', 12345, {}]) {
    assert.equal(verifySessionToken(bad, SECRET), null);
  }
  // امضا درست روی payload غیر JSON
  const crypto = require('crypto');
  const b64 = Buffer.from('not-json').toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  assert.equal(verifySessionToken(`${b64}.${sig}`, SECRET), null);
});

test('parseCookies: چند کوکی، مقدار encode‌شده، و هدر خالی', () => {
  assert.deepEqual(parseCookies({ headers: {} }), {});
  const c = parseCookies({ headers: { cookie: 'a=1; attendance_admin_session=x%2By.z; junk' } });
  assert.equal(c.a, '1');
  assert.equal(c.attendance_admin_session, 'x+y.z');
});
