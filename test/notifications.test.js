// S4-5a: جدول notifications و سرویس notify (ثبت پنل + تلگرامِ اختیاری + dedupe). بدون API/UI.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { notify } = require('../src/services/notificationService');
const usersRepository = require('../src/repositories/usersRepository');
const { makeUser } = require('./helpers/factories');

// تلگرام ساختگی: پیام‌ها را ثبت می‌کند و نتیجه‌ی دلخواه می‌دهد
function fakeTelegram(result = true) {
  const sent = [];
  const sendTelegram = async (id, text) => {
    sent.push({ id, text });
    if (result instanceof Error) throw result;
    return result;
  };
  return { sent, deps: { sendTelegram } };
}

describe('notifications — notify (S4-5a)', () => {
  let db; let u1; let u2;
  before(() => {
    db = resetDb();
    u1 = makeUser(); u2 = makeUser();
  });
  after(() => cleanup());

  const count = (where = '1=1', ...p) => db.prepare(`SELECT COUNT(*) n FROM notifications WHERE ${where}`).get(...p).n;

  test('ثبت اعلان پنل: فیلدها، پیش‌فرض‌ها، data به JSON، و بدون درخواست تلگرام هیچ پیامی نمی‌رود', async () => {
    const tg = fakeTelegram();
    const { created, notification: n } = await notify(
      u1.id,
      { type: 'leave_requested', title: '  درخواست مرخصی  ', body: 'جزئیات', link: '#/leave', data: { requestId: 7 } },
      tg.deps
    );
    assert.equal(created, true);
    assert.equal(n.user_id, u1.id);
    assert.equal(n.type, 'leave_requested');
    assert.equal(n.title, 'درخواست مرخصی');
    assert.equal(n.link, '#/leave');
    assert.deepEqual(n.data, { requestId: 7 });
    assert.equal(n.read_at, null);
    assert.equal(n.dedupe_key, null);
    assert.equal(n.telegram_status, 'none');
    assert.match(n.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(tg.sent.length, 0);
  });

  test('dedupe: همان (کاربر، کلید) دوباره ساخته نمی‌شود و تلگرام دوباره نمی‌رود؛ کاربر/کلید دیگر یا بدون کلید ⇒ جدا', async () => {
    const tg = fakeTelegram(true);
    const base = { type: 'dispute_opened', title: 'اعتراض جدید', dedupeKey: 'dispute:5', telegram: true };
    const a = await notify(u1.id, base, tg.deps);
    const b = await notify(u1.id, { ...base, title: 'عنوان دیگر', body: 'نباید بازنویسی شود' }, tg.deps);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.notification.id, a.notification.id);
    assert.equal(b.notification.title, 'اعتراض جدید', 'رکورد اول بازنویسی نمی‌شود');
    assert.equal(count('user_id = ? AND dedupe_key = ?', u1.id, 'dispute:5'), 1);
    assert.equal(tg.sent.length, 1, 'تلگرام فقط یک‌بار برای ردیف تازه');

    assert.equal((await notify(u2.id, base, tg.deps)).created, true, 'کاربر دیگر با همان کلید ⇒ اعلان جدا');
    assert.equal((await notify(u1.id, { ...base, dedupeKey: 'dispute:6' }, tg.deps)).created, true, 'کلید دیگر ⇒ جدا');
    const free = { type: 'system_alert', title: 'بدون کلید' };
    const c = await notify(u1.id, free, tg.deps);
    const d = await notify(u1.id, free, tg.deps);
    assert.notEqual(c.notification.id, d.notification.id, 'بدون dedupeKey هر بار ساخته می‌شود');
  });

  test('تلگرام: موفق ⇒ sent با متن عنوان+بدنه؛ شکست/استثنا ⇒ failed ولی ردیف پنل می‌ماند؛ غیرفعال/بدون آیدی ⇒ skipped', async () => {
    const ok = fakeTelegram(true);
    const r1 = await notify(u1.id, { type: 'leave_decided', title: 'تأیید شد', body: 'مرخصی شما تأیید شد', telegram: true }, ok.deps);
    assert.equal(r1.notification.telegram_status, 'sent');
    assert.deepEqual(ok.sent, [{ id: String(u1.telegram_user_id), text: 'تأیید شد\n\nمرخصی شما تأیید شد' }]);

    const falsy = fakeTelegram(false);
    assert.equal((await notify(u1.id, { type: 'leave_decided', title: 'الف', telegram: true }, falsy.deps)).notification.telegram_status, 'failed');
    const boom = fakeTelegram(new Error('network'));
    const r3 = await notify(u1.id, { type: 'leave_decided', title: 'ب', telegram: true }, boom.deps);
    assert.equal(r3.created, true);
    assert.equal(r3.notification.telegram_status, 'failed');
    assert.ok(count('id = ?', r3.notification.id) === 1, 'شکست تلگرام ردیف پنل را از بین نمی‌برد');

    const inactive = makeUser({ active: false });
    const noTelegram = makeUser();
    db.prepare('UPDATE users SET telegram_user_id = NULL WHERE id = ?').run(noTelegram.id);
    const skip = fakeTelegram(true);
    for (const u of [inactive, noTelegram]) {
      const r = await notify(u.id, { type: 'system_alert', title: 'ج', telegram: true }, skip.deps);
      assert.equal(r.notification.telegram_status, 'skipped');
    }
    assert.equal(skip.sent.length, 0);
  });

  test('اعتبارسنجی ورودی و کاربر ناموجود؛ حذف دائمی کاربر اعلان‌هایش را پاک می‌کند', async () => {
    await assert.rejects(() => notify('x', { type: 'ab', title: 't' }), TypeError);
    await assert.rejects(() => notify(u1.id, { type: 'Bad-Type', title: 't' }), RangeError);
    await assert.rejects(() => notify(u1.id, { type: 'ok_type', title: '   ' }), RangeError);
    await assert.rejects(() => notify(u1.id, { type: 'ok_type', title: 't', dedupeKey: ' ' }), RangeError);
    await assert.rejects(() => notify(999999, { type: 'ok_type', title: 't' }), RangeError);

    const victim = makeUser();
    await notify(victim.id, { type: 'system_alert', title: 'برای حذف', dedupeKey: 'k' });
    assert.equal(count('user_id = ?', victim.id), 1);
    usersRepository.deleteUserPermanently(victim.id);
    assert.equal(count('user_id = ?', victim.id), 0);
  });
});
