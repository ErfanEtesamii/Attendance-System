// R1-ب: migration ۰۳۷ — جدول remote_work_breaks: ساختار، CHECKها، «یک استراحت باز در هر نشست» و CASCADE.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('مدل داده‌ی دورکاری — استراحت‌ها (R1-ب)', () => {
  let db; let u; let boss; let s1; let s2;
  const session = (userId, date) => db.prepare('INSERT INTO remote_work_sessions (user_id, work_date, start_at, end_at) VALUES (?, ?, ?, ?)')
    .run(userId, date, `${date}T05:00:00.000Z`, `${date}T12:00:00.000Z`).lastInsertRowid;
  const brk = (sessionId, start, end = null) => db.prepare('INSERT INTO remote_work_breaks (session_id, start_at, end_at) VALUES (?, ?, ?)').run(sessionId, start, end);
  before(() => {
    db = resetDb();
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
    s1 = session(u.id, '2026-10-21');
    s2 = session(u.id, '2026-10-22');
  });
  after(cleanup);

  test('migration: جدول و ایندکس‌ها ساخته شده و ثبت شده‌اند', () => {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='remote_work_breaks'").get());
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_remote_breaks_%'").all().map((r) => r.name).sort();
    assert.deepEqual(idx, ['idx_remote_breaks_one_open', 'idx_remote_breaks_session']);
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '037_remote_work_breaks'").get());
  });

  test('افزودن استراحت: created_at خودکار؛ استراحت باز با end_at = NULL', () => {
    const id = brk(s1, '2026-10-21T08:00:00.000Z').lastInsertRowid;
    const row = db.prepare('SELECT * FROM remote_work_breaks WHERE id = ?').get(id);
    assert.equal(row.end_at, null);
    assert.ok(row.created_at);
    db.prepare('UPDATE remote_work_breaks SET end_at = ? WHERE id = ?').run('2026-10-21T08:30:00.000Z', id);
  });

  test('CHECK: پایان قبل از شروع رد می‌شود؛ پایان برابر شروع مجاز است', () => {
    assert.throws(() => brk(s1, '2026-10-21T10:00:00.000Z', '2026-10-21T09:00:00.000Z'), /CHECK|constraint/i);
    assert.ok(brk(s1, '2026-10-21T10:00:00.000Z', '2026-10-21T10:00:00.000Z').lastInsertRowid);
  });

  test('یک استراحت باز در هر نشست؛ نشست دیگر آزاد؛ بعد از بستن، استراحت تازه مجاز', () => {
    const a = brk(s1, '2026-10-21T11:00:00.000Z');
    assert.throws(() => brk(s1, '2026-10-21T11:05:00.000Z'), /UNIQUE|constraint/i);
    assert.ok(brk(s2, '2026-10-22T11:00:00.000Z').lastInsertRowid);
    db.prepare('UPDATE remote_work_breaks SET end_at = ? WHERE id = ?').run('2026-10-21T11:20:00.000Z', a.lastInsertRowid);
    assert.ok(brk(s1, '2026-10-21T11:30:00.000Z').lastInsertRowid);
  });

  test('کلید خارجی: شناسه‌ی نشستِ ناموجود رد می‌شود؛ حذف نشست ⇒ استراحت‌هایش پاک', () => {
    assert.throws(() => brk(999999, '2026-10-21T08:00:00.000Z'), /FOREIGN KEY|constraint/i);
    const s3 = session(u.id, '2026-10-23');
    brk(s3, '2026-10-23T08:00:00.000Z', '2026-10-23T08:10:00.000Z');
    brk(s3, '2026-10-23T09:00:00.000Z', '2026-10-23T09:10:00.000Z');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks WHERE session_id = ?').get(s3).n, 2);
    db.prepare('DELETE FROM remote_work_sessions WHERE id = ?').run(s3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_breaks WHERE session_id = ?').get(s3).n, 0);
  });
});
