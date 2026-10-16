// R1-الف: migration ۰۳۶ — جدول remote_work_sessions: ساختار، پیش‌فرض‌ها، CHECKها، «یک نشست باز برای هر کاربر» و کلیدهای خارجی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('مدل داده‌ی دورکاری — نشست‌ها (R1-الف)', () => {
  let db; let u1; let u2; let boss;
  const insert = (userId, extra = {}) => {
    const r = { work_date: '2026-10-17', start_at: '2026-10-17T05:00:00.000Z', end_at: null, ...extra };
    return db.prepare('INSERT INTO remote_work_sessions (user_id, work_date, start_at, end_at) VALUES (?, ?, ?, ?)').run(userId, r.work_date, r.start_at, r.end_at);
  };
  before(() => {
    db = resetDb();
    boss = F.makeUser({ role: 'manager' });
    u1 = F.makeUser({ managerId: boss.id });
    u2 = F.makeUser({ managerId: boss.id });
  });
  after(cleanup);

  test('migration: جدول و ایندکس‌ها ساخته شده و ثبت شده‌اند', () => {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='remote_work_sessions'").get());
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_remote_sessions_%'").all().map((r) => r.name).sort();
    assert.deepEqual(idx, ['idx_remote_sessions_one_open', 'idx_remote_sessions_status_date', 'idx_remote_sessions_user_date']);
    assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = '036_remote_work_sessions'").get());
  });

  test('پیش‌فرض‌ها: status=pending، auto_closed=0، created_at پر، بدون تأییدکننده', () => {
    const id = insert(u1.id).lastInsertRowid;
    const row = db.prepare('SELECT * FROM remote_work_sessions WHERE id = ?').get(id);
    assert.equal(row.status, 'pending');
    assert.equal(row.auto_closed, 0);
    assert.ok(row.created_at);
    assert.equal(row.reviewed_by, null);
    assert.equal(row.attendance_record_id, null);
    db.prepare('UPDATE remote_work_sessions SET end_at = ? WHERE id = ?').run('2026-10-17T09:00:00.000Z', id);
  });

  test('CHECKها: وضعیت نامعتبر، تاریخ نامعتبر، خروج قبل از ورود، یادداشت طولانی', () => {
    assert.throws(() => db.prepare("INSERT INTO remote_work_sessions (user_id, work_date, start_at, status) VALUES (?, '2026-10-18', '2026-10-18T05:00:00.000Z', 'done')").run(u2.id), /CHECK|constraint/i);
    assert.throws(() => insert(u2.id, { work_date: '۱۴۰۵/۰۷/۲۵' }), /CHECK|constraint/i);
    assert.throws(() => insert(u2.id, { work_date: '2026-10-18', start_at: '2026-10-18T09:00:00.000Z', end_at: '2026-10-18T05:00:00.000Z' }), /CHECK|constraint/i);
    const ok = insert(u2.id, { work_date: '2026-10-18', start_at: '2026-10-18T05:00:00.000Z', end_at: '2026-10-18T05:00:00.000Z' });
    assert.throws(() => db.prepare('UPDATE remote_work_sessions SET review_note = ? WHERE id = ?').run('x'.repeat(501), ok.lastInsertRowid), /CHECK|constraint/i);
  });

  test('یک نشست باز برای هر کاربر؛ کاربر دیگر آزاد؛ بعد از بستن، نشست تازه مجاز', () => {
    const a = insert(u1.id, { work_date: '2026-10-19', start_at: '2026-10-19T05:00:00.000Z' });
    assert.throws(() => insert(u1.id, { work_date: '2026-10-19', start_at: '2026-10-19T06:00:00.000Z' }), /UNIQUE|constraint/i);
    assert.ok(insert(u2.id, { work_date: '2026-10-19', start_at: '2026-10-19T06:00:00.000Z' }).lastInsertRowid);
    db.prepare('UPDATE remote_work_sessions SET end_at = ? WHERE id = ?').run('2026-10-19T09:00:00.000Z', a.lastInsertRowid);
    assert.ok(insert(u1.id, { work_date: '2026-10-19', start_at: '2026-10-19T10:00:00.000Z' }).lastInsertRowid);
  });

  test('کلید خارجی: حذف کاربر ⇒ نشست‌هایش پاک؛ حذف تأییدکننده ⇒ reviewed_by = NULL', () => {
    const victim = F.makeUser({ managerId: boss.id });
    const reviewer = F.makeUser({ role: 'manager' });
    const s = db.prepare('INSERT INTO remote_work_sessions (user_id, work_date, start_at, end_at, status, reviewed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(victim.id, '2026-10-20', '2026-10-20T05:00:00.000Z', '2026-10-20T09:00:00.000Z', 'approved', reviewer.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(reviewer.id);
    assert.equal(db.prepare('SELECT reviewed_by FROM remote_work_sessions WHERE id = ?').get(s.lastInsertRowid).reviewed_by, null);
    db.prepare('DELETE FROM users WHERE id = ?').run(victim.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM remote_work_sessions WHERE user_id = ?').get(victim.id).n, 0);
  });
});
