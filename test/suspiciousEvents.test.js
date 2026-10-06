// S2-4a: ساختار suspicious_events و ثبت‌کننده با dedupe (بدون هیچ قاعده‌ی تشخیص).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const repo = require('../src/repositories/suspiciousRepository');
const { makeUser } = require('./helpers/factories');

describe('suspicious_events (S2-4a)', () => {
  let db; let u1; let u2; let u3;
  before(() => {
    db = resetDb();
    u1 = makeUser(); u2 = makeUser(); u3 = makeUser();
  });
  after(() => cleanup());

  test('ساخت: فیلدها، JSON نرمال‌شده (مرتب/یکتا) و پیش‌فرض status=open', () => {
    const { created, event } = repo.create({
      eventType: 'shared_device', userIds: [u2.id, u1.id, u2.id], recordIds: [9, 3],
      eventDate: '2026-10-01', details: { deviceId: 'abc' },
    });
    assert.equal(created, true);
    assert.deepEqual(event.user_ids, [u1.id, u2.id].sort((a, b) => a - b));
    assert.deepEqual(event.record_ids, [3, 9]);
    assert.deepEqual(event.details, { deviceId: 'abc' });
    assert.equal(event.status, 'open');
    assert.equal(event.reviewed_by, null);
    assert.match(event.created_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('تکراری (همان نوع/کاربران/تاریخ، با ترتیب متفاوت) ساخته نمی‌شود و رکورد قبلی برمی‌گردد', () => {
    const a = repo.create({ eventType: 'same_ip_close', userIds: [u1.id, u3.id], eventDate: '2026-10-02', details: { n: 1 } });
    const b = repo.create({ eventType: 'same_ip_close', userIds: [u3.id, u1.id], eventDate: '2026-10-02', details: { n: 2 } });
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(b.event.id, a.event.id);
    assert.deepEqual(b.event.details, { n: 1 }, 'رکورد اول بازنویسی نمی‌شود');
    const n = db.prepare("SELECT COUNT(*) n FROM suspicious_events WHERE event_type='same_ip_close'").get().n;
    assert.equal(n, 1);
  });

  test('تفاوت در نوع، کاربران یا تاریخ ⇒ مورد جدا', () => {
    const base = { eventType: 'device_change', userIds: [u1.id], eventDate: '2026-10-03' };
    const a = repo.create(base);
    assert.equal(repo.create({ ...base, eventType: 'shared_device' }).created, true);
    assert.equal(repo.create({ ...base, userIds: [u1.id, u2.id] }).created, true);
    assert.equal(repo.create({ ...base, eventDate: '2026-10-04' }).created, true);
    assert.equal(repo.create(base).event.id, a.event.id);
  });

  test('ورودی نامعتبر ⇒ خطا و چیزی ذخیره نمی‌شود', () => {
    const before = db.prepare('SELECT COUNT(*) n FROM suspicious_events').get().n;
    assert.throws(() => repo.create({ eventType: 'Bad Type', userIds: [1], eventDate: '2026-10-01' }));
    assert.throws(() => repo.create({ eventType: 'x_y', userIds: [], eventDate: '2026-10-01' }));
    assert.throws(() => repo.create({ eventType: 'x_y', userIds: ['a'], eventDate: '2026-10-01' }));
    assert.throws(() => repo.create({ eventType: 'x_y', userIds: [1], eventDate: '01/10/2026' }));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM suspicious_events').get().n, before);
  });

  test('CHECK روی status در دیتابیس', () => {
    assert.throws(() => db.prepare("UPDATE suspicious_events SET status = 'banned' WHERE id = 1").run());
  });
});
