// D1 (فاز ۱۱): migration ۰۲۷ (dispute_messages + ستون‌های جدید record_disputes) و توابع repository گفت‌وگوی اعتراض.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { migrate, MIGRATIONS_DIR } = require('../src/db/migrator');
const migration027 = require('../src/db/migrations/027_dispute_messages');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dispute-migration-'));
after(() => {
  try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { /* ویندوز: فایل هنوز باز است */ }
});

// پوشه‌ای با migrationهای ۰۰۱ تا max (بقیه‌ی migrationهای بعدی عمداً کنار گذاشته می‌شوند تا تست فقط ۰۲۷ را بسنجد)
function dirUpTo(max) {
  const dir = fs.mkdtempSync(path.join(work, `upto${max}-`));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    if (/^\d{3}_.*\.js$/.test(f) && parseInt(f.slice(0, 3), 10) <= max) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  return dir;
}
// دیتابیس «قبل از D1» = migrationهای ۰۰۱ تا ۰۲۶
const dirBefore027 = () => dirUpTo(26);

const columnNames = (db, table) => db.pragma(`table_info(${table})`).map((c) => c.name);

describe('migration ۰۲۷ — روی دیتابیس با اعتراض‌های قدیمی', () => {
  let db;
  const LONG = 'ن'.repeat(900); // اعتراض قدیمی بدون سقف طول بوده؛ migration نباید روی آن بشکند
  before(() => {
    db = new Database(path.join(work, 'legacy.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db, { dir: dirBefore027() });
    db.exec(`
      INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES
        ('1','ادمین','P1','فنی','admin'), ('2','کارمند','P2','فنی','employee');
      INSERT INTO attendance_records (user_id, record_date, status) VALUES (2,'2026-09-20','normal');
      INSERT INTO record_disputes (user_id, attendance_record_id, message, status, created_at, updated_at) VALUES
        (2, 1, 'ساعت خروج اشتباه است', 'open',     '2026-09-21 06:00:00', '2026-09-21 06:00:00'),
        (2, NULL, '${LONG}',            'resolved', '2026-09-22 07:00:00', '2026-09-23 08:30:00');
    `);
  });
  after(() => db.close());

  test('پیش از اعمال: ستون‌ها و جدول جدید وجود ندارند', () => {
    assert.ok(!columnNames(db, 'record_disputes').includes('closed_by'));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'dispute_messages'").get().n, 0);
  });

  test('اعمال: پیام اولیه‌ی هر اعتراض اولین پیام thread می‌شود و ستون‌های قدیمی دست‌نخورده می‌مانند', () => {
    const before = db.prepare('SELECT id, user_id, attendance_record_id, message, status, created_at, updated_at FROM record_disputes ORDER BY id').all();
    const res = migrate(db, { dir: dirUpTo(27) });
    assert.deepEqual(res.applied, ['027_dispute_messages']);
    assert.deepEqual(
      db.prepare('SELECT id, user_id, attendance_record_id, message, status, created_at, updated_at FROM record_disputes ORDER BY id').all(),
      before,
      'ستون‌های قدیمی نباید تغییر کنند'
    );
    const msgs = db.prepare('SELECT * FROM dispute_messages ORDER BY dispute_id, id').all();
    assert.equal(msgs.length, 2);
    assert.deepEqual(msgs.map((m) => [m.dispute_id, m.sender_user_id, m.sender_role, m.created_at]), [
      [1, 2, 'user', '2026-09-21 06:00:00'],
      [2, 2, 'user', '2026-09-22 07:00:00'],
    ]);
    assert.equal(msgs[0].message, 'ساعت خروج اشتباه است');
    assert.equal(msgs[1].message, LONG);
  });

  test('وضعیت قدیمی: open ⇒ closed_by تهی؛ resolved ⇒ closed_by=admin با closed_at=updated_at؛ reopen_count=۰؛ last_message_at=created_at', () => {
    const [open, resolved] = db.prepare('SELECT * FROM record_disputes ORDER BY id').all();
    assert.equal(open.closed_by, null);
    assert.equal(open.closed_at, null);
    assert.equal(resolved.closed_by, 'admin');
    assert.equal(resolved.closed_at, '2026-09-23 08:30:00');
    assert.equal(open.reopen_count, 0);
    assert.equal(resolved.reopen_count, 0);
    assert.equal(open.last_message_at, open.created_at);
    assert.equal(resolved.last_message_at, resolved.created_at);
  });

  test('idempotent: اجرای دوباره‌ی up() چیزی اضافه یا عوض نمی‌کند', () => {
    const snap = () => JSON.stringify([
      db.prepare('SELECT * FROM record_disputes ORDER BY id').all(),
      db.prepare('SELECT * FROM dispute_messages ORDER BY id').all(),
    ]);
    const before = snap();
    migration027.up(db);
    migration027.up(db);
    assert.equal(snap(), before);
  });

  test('قیدها: sender_role و closed_by نامعتبر رد می‌شود؛ ایندکس thread ساخته شده', () => {
    assert.throws(() => db.prepare("INSERT INTO dispute_messages (dispute_id, sender_role, message) VALUES (1, 'hacker', 'x')").run(), /CHECK/);
    assert.throws(() => db.prepare("UPDATE record_disputes SET closed_by = 'nobody' WHERE id = 1").run(), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO dispute_messages (dispute_id, sender_role, message) VALUES (999, 'user', 'x')").run(), /FOREIGN KEY/);
    assert.ok(db.pragma('index_list(dispute_messages)').some((i) => i.name === 'idx_dispute_messages_dispute'));
  });
});

describe('disputeRepository — گفت‌وگو (D1)', () => {
  let repo; let F; let attendanceRepo; let usersRepo; let resetRepo; let db;
  let emp; let admin; let record;
  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/disputeRepository');
    attendanceRepo = require('../src/repositories/attendanceRepository');
    usersRepo = require('../src/repositories/usersRepository');
    resetRepo = require('../src/repositories/resetRepository');
    emp = F.makeUser({ name: 'کارمند' });
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
  });
  after(cleanup);
  beforeEach(() => {
    db.prepare('DELETE FROM dispute_messages').run();
    db.prepare('DELETE FROM record_disputes').run();
  });

  const make = (message = 'اعتراض من') => repo.createDispute({ userId: emp.id, attendanceRecordId: record.id, message });

  test('createDispute: پیام اولیه در thread هم نوشته می‌شود؛ فیلدهای تازه مقدار اولیه دارند', () => {
    const d = make('متن اولیه');
    assert.equal(d.message, 'متن اولیه'); // ستون قدیمی هم پر است
    assert.equal(d.status, 'open');
    assert.equal(d.closed_by, null);
    assert.equal(d.reopen_count, 0);
    assert.equal(d.last_message_at, d.created_at);
    const { messages } = repo.getThread(d.id);
    assert.equal(messages.length, 1);
    assert.deepEqual([messages[0].sender_role, messages[0].sender_user_id, messages[0].message], ['user', emp.id, 'متن اولیه']);
  });

  test('addMessage: ترتیب thread با id است؛ last_message_at و updated_at به‌روز می‌شوند؛ نقش نامعتبر یا اعتراض ناموجود', () => {
    const d = make();
    repo.addMessage({ disputeId: d.id, senderUserId: admin.id, senderRole: 'admin', message: 'پاسخ ادمین' });
    repo.addMessage({ disputeId: d.id, senderUserId: emp.id, senderRole: 'user', message: 'پاسخ دوم' });
    const { dispute, messages } = repo.getThread(d.id);
    assert.deepEqual(messages.map((m) => m.sender_role), ['user', 'admin', 'user']);
    assert.deepEqual(messages.map((m) => m.message), ['اعتراض من', 'پاسخ ادمین', 'پاسخ دوم']);
    assert.ok(dispute.last_message_at >= d.created_at);
    assert.throws(() => repo.addMessage({ disputeId: d.id, senderRole: 'root', message: 'x' }), /senderRole/);
    assert.equal(repo.addMessage({ disputeId: 99999, senderRole: 'user', message: 'x' }), null);
    assert.equal(repo.getThread(99999), null);
  });

  test('setStatus: resolved ⇒ closed_by پیش‌فرض admin (سازگاری با مسیر ادمین فعلی) یا user؛ open ⇒ پاک‌شدن closed_*', () => {
    const d = make();
    let u = repo.setStatus(d.id, 'resolved');
    assert.deepEqual([u.status, u.closed_by], ['resolved', 'admin']);
    assert.ok(u.closed_at);
    u = repo.setStatus(d.id, 'open');
    assert.deepEqual([u.status, u.closed_by, u.closed_at, u.reopen_count], ['open', null, null, 0]);
    u = repo.setStatus(d.id, 'resolved', { closedBy: 'user' });
    assert.equal(u.closed_by, 'user');
  });

  test('reopenWithMessage: فقط از resolved؛ پیام ثبت و reopen_count زیاد می‌شود؛ سقف در همان UPDATE اعمال می‌شود', () => {
    const d = make();
    assert.equal(repo.reopenWithMessage({ id: d.id, senderUserId: emp.id, message: 'ادامه', maxReopens: 2 }), null, 'اعتراض باز را نمی‌شود reopen کرد');
    assert.equal(repo.getThread(d.id).messages.length, 1);

    repo.setStatus(d.id, 'resolved');
    let u = repo.reopenWithMessage({ id: d.id, senderUserId: emp.id, message: 'ادامه ۱', maxReopens: 2 });
    assert.deepEqual([u.status, u.closed_by, u.closed_at, u.reopen_count], ['open', null, null, 1]);
    repo.setStatus(d.id, 'resolved', { closedBy: 'user' });
    u = repo.reopenWithMessage({ id: d.id, senderUserId: emp.id, message: 'ادامه ۲', maxReopens: 2 });
    assert.equal(u.reopen_count, 2);
    repo.setStatus(d.id, 'resolved');
    assert.equal(repo.reopenWithMessage({ id: d.id, senderUserId: emp.id, message: 'ادامه ۳', maxReopens: 2 }), null, 'سقف پر است');
    assert.equal(repo.findById(d.id).status, 'resolved');
    assert.deepEqual(repo.getThread(d.id).messages.map((m) => m.message), ['اعتراض من', 'ادامه ۱', 'ادامه ۲']);
  });

  test('reopenWithMessage با countAsReopen=false (reopen ادمین) شمارنده را زیاد نمی‌کند؛ incrementReopenCount جدا کار می‌کند', () => {
    const d = make();
    repo.setStatus(d.id, 'resolved');
    const u = repo.reopenWithMessage({ id: d.id, senderUserId: admin.id, senderRole: 'admin', message: 'باز شد', countAsReopen: false, maxReopens: 1 });
    assert.deepEqual([u.status, u.reopen_count], ['open', 0]);
    assert.equal(repo.incrementReopenCount(d.id).reopen_count, 1);
  });

  test('اعتراضِ قدیمیِ بدون پیام (درج مستقیم): thread همان متن اولیه است و با اولین پیام جدید در جدول می‌نشیند', () => {
    const id = db.prepare("INSERT INTO record_disputes (user_id, attendance_record_id, message) VALUES (?, ?, 'متن قدیمی')").run(emp.id, record.id).lastInsertRowid;
    let msgs = repo.listMessages(id);
    assert.equal(msgs.length, 1);
    assert.deepEqual([msgs[0].id, msgs[0].sender_role, msgs[0].message], [null, 'user', 'متن قدیمی']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM dispute_messages WHERE dispute_id = ?').get(id).n, 0);

    repo.addMessage({ disputeId: id, senderUserId: admin.id, senderRole: 'admin', message: 'پاسخ' });
    msgs = repo.listMessages(id);
    assert.deepEqual(msgs.map((m) => [m.sender_role, m.message]), [['user', 'متن قدیمی'], ['admin', 'پاسخ']]);
    assert.ok(msgs.every((m) => m.id !== null));
  });

  test('listByUserWithSummary: تعداد پیام و فرستنده‌ی آخر؛ اعتراض بدون پیام = یک پیام از کارمند؛ فقط اعتراض‌های همان کاربر', () => {
    const other = F.makeUser({ name: 'دیگری' });
    const a = make('الف');
    repo.addMessage({ disputeId: a.id, senderUserId: admin.id, senderRole: 'admin', message: 'پاسخ' });
    const legacyId = db.prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'قدیمی')").run(emp.id).lastInsertRowid;
    repo.createDispute({ userId: other.id, attendanceRecordId: null, message: 'مال دیگری' });

    const list = repo.listByUserWithSummary(emp.id);
    assert.equal(list.length, 2);
    const byId = Object.fromEntries(list.map((r) => [r.id, r]));
    assert.deepEqual([byId[a.id].message_count, byId[a.id].last_sender_role, byId[a.id].record_date], [2, 'admin', '2026-09-20']);
    assert.deepEqual([byId[legacyId].message_count, byId[legacyId].last_sender_role, byId[legacyId].record_date], [1, 'user', null]);
  });

  test('سازگاری با چک‌لیست بستن ماه: listOpenInRange فقط اعتراضِ باز را می‌شمارد (حل‌شده یا خاتمه‌یافته‌ی کارمند نه؛ reopen‌شده بله)', () => {
    const open = make('باز');
    const byAdmin = make('حل توسط ادمین');
    const byUser = make('خاتمه توسط کارمند');
    repo.setStatus(byAdmin.id, 'resolved');
    repo.setStatus(byUser.id, 'resolved', { closedBy: 'user' });
    const ids = () => repo.listOpenInRange('2026-09-01', '2026-09-30').map((d) => d.id);
    assert.deepEqual(ids(), [open.id]);
    repo.reopenWithMessage({ id: byUser.id, senderUserId: emp.id, message: 'ادامه', maxReopens: 3 });
    assert.deepEqual(ids().sort(), [open.id, byUser.id].sort());
  });

  test('حذف: پیام‌ها با اعتراض (حذف رکورد/کاربر) پاک می‌شوند؛ حذف فرستنده‌ی ادمین پیام را نگه می‌دارد (sender_user_id تهی)', () => {
    const d = make();
    repo.addMessage({ disputeId: d.id, senderUserId: admin.id, senderRole: 'admin', message: 'پاسخ' });

    const replier = F.makeUser({ role: 'admin', name: 'پاسخ‌دهنده' });
    repo.addMessage({ disputeId: d.id, senderUserId: replier.id, senderRole: 'admin', message: 'پاسخ دوم' });
    usersRepo.deleteUserPermanently(replier.id);
    const kept = repo.listMessages(d.id).find((m) => m.message === 'پاسخ دوم');
    assert.equal(kept.sender_user_id, null);

    attendanceRepo.removeWithBreaks(record.id);
    assert.equal(repo.findById(d.id), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM dispute_messages').get().n, 0);

    const victim = F.makeUser({ name: 'حذف‌شونده' });
    const d2 = repo.createDispute({ userId: victim.id, attendanceRecordId: null, message: 'x' });
    repo.addMessage({ disputeId: d2.id, senderUserId: admin.id, senderRole: 'admin', message: 'y' });
    usersRepo.deleteUserPermanently(victim.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM dispute_messages').get().n, 0);
    // بازسازی رکورد برای تست‌های بعدی
    record = attendanceRepo.createManual({ userId: emp.id, recordDate: '2026-09-20', checkInTime: '2026-09-20T05:00:00.000Z', checkOutTime: '2026-09-20T13:00:00.000Z', status: 'normal' });
  });

  test('رجیستری ریست: dispute_messages قبل از record_disputes می‌آید، شمارش و حذف تاریخ‌دار دنبال برش اعتراض است', () => {
    const names = resetRepo.ENTRIES.map((e) => e.table);
    assert.ok(names.indexOf('dispute_messages') !== -1 && names.indexOf('dispute_messages') < names.indexOf('record_disputes'));
    const entry = resetRepo.ENTRIES.find((e) => e.table === 'dispute_messages');
    assert.equal(entry.group, 'operational');

    const old = make('قدیمی'); // رکورد ۲۰۲۶-۰۹-۲۰
    repo.addMessage({ disputeId: old.id, senderUserId: admin.id, senderRole: 'admin', message: 'پاسخ' });
    const noRecord = repo.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'بدون رکورد' });

    assert.equal(resetRepo.countRows(entry, null), 3);
    assert.equal(resetRepo.countRows(entry, '2026-10-01'), 2); // فقط پیام‌های اعتراضِ وصل‌به‌رکوردِ قدیمی
    assert.equal(resetRepo.countRows(entry, '2026-09-01'), 0);

    resetRepo.deleteRows(entry, '2026-10-01');
    assert.equal(repo.listMessages(noRecord.id).length, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM dispute_messages WHERE dispute_id = ?').get(old.id).n, 0);
    resetRepo.deleteRows(entry, null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM dispute_messages').get().n, 0);
  });
});
