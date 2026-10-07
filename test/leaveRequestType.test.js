// S4-7b: بازسازی leave_requests — migration ۰۱۴ (leave_type_id NOT NULL + rejected_reason)، نگاشت leave→annual و mission→mission بدون از دست رفتن داده،
// guardهای پیش‌شرط، و repository (نوشتن هم‌زمان leave_type_id و leave_type=kind). کدهای مصرف‌کننده‌ی leave_type تا S4-7c دست‌نخورده‌اند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate, MIGRATIONS_DIR } = require('../src/db/migrator');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-type-migration-'));
let counter = 0;

// پوشه‌ی migration فقط تا شماره‌ی n (تست باید با اضافه‌شدن migrationهای بعدی هم همین رفتار را داشته باشد)
function migrationsUpTo(n) {
  counter += 1;
  const dir = path.join(work, `m${counter}`);
  fs.mkdirSync(dir);
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    const m = /^(\d{3,})_/.exec(f);
    if (m && parseInt(m[1], 10) <= n) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  return dir;
}

// دیتابیس «قبل از ۰۱۴»: همه‌ی migrationها تا ۰۱۳ + سه کاربر + درخواست‌های قدیمی (شامل یک ردیف حذف‌شده برای شمارنده‌ی AUTOINCREMENT)
function makeDbBefore014() {
  counter += 1;
  const db = new Database(path.join(work, `db${counter}.db`));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db, { dir: migrationsUpTo(13) });
  db.exec(`
    INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role, manager_id) VALUES
      ('2001','مدیر نمونه','Q1','فنی','admin',NULL), ('2002','سرپرست نمونه','Q2','فنی','manager',1), ('2003','کارمند نمونه','Q3','فنی','employee',2);
    INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, status, approver_id, reason, created_at, updated_at) VALUES
      (3,'2026-09-25','2026-09-26','leave','approved',2,'مرخصی تست','2026-09-01 10:00:00','2026-09-02 11:00:00'),
      (3,'2026-10-02','2026-10-02','mission','pending',NULL,NULL,'2026-09-03 08:00:00','2026-09-03 08:00:00'),
      (3,'2026-10-05','2026-10-06','leave','rejected',2,'رد شده','2026-09-04 09:30:00','2026-09-05 09:30:00'),
      (3,'2026-10-10','2026-10-10','mission','approved',1,'مأموریت تایید','2026-09-06 07:00:00','2026-09-06 12:00:00'),
      (3,'2026-10-20','2026-10-20','leave','pending',NULL,'موقت','2026-09-07 07:00:00','2026-09-07 07:00:00');
    DELETE FROM leave_requests WHERE id = 5;
  `);
  return db;
}

describe('migration ۰۱۴ — leave_requests ↔ leave_types (S4-7b)', () => {
  after(() => { fs.rmSync(work, { recursive: true, force: true }); });

  test('DB نمونه با درخواست‌های قدیمی: همه‌ی داده و شناسه‌ها حفظ، leave→استحقاقی و mission→مأموریت، ایندکس/FK/شمارنده/بک‌آپ سالم، اجرای دوباره بی‌اثر', () => {
    const db = makeDbBefore014();
    const before = db.prepare('SELECT * FROM leave_requests ORDER BY id').all();
    assert.equal(before.length, 4);
    assert.ok(!Object.keys(before[0]).includes('leave_type_id'));

    const backupDir = path.join(work, 'backups');
    const res = migrate(db, { dir: migrationsUpTo(14), backupDir });
    assert.deepEqual(res.applied, ['014_leave_requests_leave_type']);
    assert.ok(res.backupPath && fs.existsSync(res.backupPath));
    const bak = new Database(res.backupPath, { readonly: true });
    assert.equal(bak.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(bak.prepare('SELECT * FROM leave_requests ORDER BY id').all(), before, 'بک‌آپ = وضعیت قبل از migration');
    bak.close();

    const annual = db.prepare("SELECT id FROM leave_types WHERE code = 'annual'").get().id;
    const mission = db.prepare("SELECT id FROM leave_types WHERE code = 'mission'").get().id;
    const after = db.prepare('SELECT * FROM leave_requests ORDER BY id').all();
    assert.equal(after.length, before.length);
    after.forEach((row, i) => {
      const { leave_type_id: typeId, rejected_reason: rejectedReason, ...legacyColumns } = row;
      assert.deepEqual(legacyColumns, before[i], `ردیف ${before[i].id}: همه‌ی ستون‌های قبلی (id، تاریخ‌ها، وضعیت، تأییدکننده، زمان‌ها) دست‌نخورده`);
      assert.equal(typeId, before[i].leave_type === 'mission' ? mission : annual, `نگاشت ردیف ${before[i].id}`);
      assert.equal(rejectedReason, null);
    });
    assert.deepEqual(after.map((r) => r.leave_type_id), [annual, mission, annual, mission]);

    const cols = db.prepare("PRAGMA table_info('leave_requests')").all();
    assert.deepEqual(cols.map((c) => c.name), ['id', 'user_id', 'start_date', 'end_date', 'leave_type', 'leave_type_id', 'status', 'approver_id', 'reason', 'rejected_reason', 'created_at', 'updated_at']);
    assert.equal(cols.find((c) => c.name === 'leave_type_id').notnull, 1);
    assert.equal(cols.find((c) => c.name === 'rejected_reason').notnull, 0);
    assert.ok(db.pragma("foreign_key_list('leave_requests')").some((f) => f.from === 'leave_type_id' && f.table === 'leave_types'));
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'leave_requests'").all().map((r) => r.name);
    assert.ok(indexes.includes('idx_leave_user_status') && indexes.includes('idx_leave_type_id'), indexes.join());
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

    // شمارنده‌ی AUTOINCREMENT عقب نمی‌رود: ردیف ۵ قبلاً حذف شده بود ⇒ ردیف بعدی ۶ است
    const ins = db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (3, '2026-11-01', '2026-11-01', 'leave', ?)").run(annual);
    assert.equal(Number(ins.lastInsertRowid), 6);
    // CHECKها و NOT NULL/FK
    assert.throws(() => db.exec("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type) VALUES (3, '2026-11-02', '2026-11-02', 'leave')"), /NOT NULL/);
    assert.throws(() => db.exec("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (3, '2026-11-02', '2026-11-02', 'leave', 9999)"), /FOREIGN KEY/);
    assert.throws(() => db.exec("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (3, '2026-11-02', '2026-11-02', 'sick', 1)"), /CHECK/);
    assert.throws(() => db.prepare('DELETE FROM leave_types WHERE id = ?').run(annual), /FOREIGN KEY/);

    assert.deepEqual(migrate(db, { dir: migrationsUpTo(14), backupDir }).applied, [], 'اجرای دوباره');
    db.close();
  });

  test('پیش‌شرط‌ها: annual حذف‌شده دوباره ساخته می‌شود؛ kind دست‌کاری‌شده ⇒ توقف با پیام راهنما و rollback کامل، بعد از اصلاح موفق', () => {
    // الف) ادمین بعد از ۰۱۳ نوع annual را (که ارجاعی نداشت) حذف کرده
    const a = makeDbBefore014();
    a.prepare("DELETE FROM leave_types WHERE code = 'annual'").run();
    migrate(a, { dir: migrationsUpTo(14), backupDir: path.join(work, 'backups-a') });
    const annual = a.prepare("SELECT id, title, kind FROM leave_types WHERE code = 'annual'").get();
    assert.deepEqual([annual.title, annual.kind], ['مرخصی استحقاقی', 'leave']);
    assert.deepEqual(a.prepare('SELECT leave_type_id FROM leave_requests ORDER BY id').all().map((r) => r.leave_type_id).filter((_, i) => i % 2 === 0), [annual.id, annual.id]);
    a.close();

    // ب) kind نوع mission عوض شده ⇒ migration نباید چیزی را نیمه‌کاره بگذارد
    const b = makeDbBefore014();
    b.prepare("UPDATE leave_types SET kind = 'leave' WHERE code = 'mission'").run();
    const rowsBefore = b.prepare('SELECT * FROM leave_requests ORDER BY id').all();
    assert.throws(() => migrate(b, { dir: migrationsUpTo(14), backupDir: path.join(work, 'backups-b') }), /kind=mission/);
    assert.deepEqual(b.prepare('SELECT * FROM leave_requests ORDER BY id').all(), rowsBefore);
    assert.equal(b.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name LIKE '014%'").get().n, 0);
    assert.ok(!b.prepare("PRAGMA table_info('leave_requests')").all().some((c) => c.name === 'leave_type_id'));
    assert.equal(b.pragma('foreign_keys', { simple: true }), 1);
    b.prepare("UPDATE leave_types SET kind = 'mission' WHERE code = 'mission'").run();
    assert.deepEqual(migrate(b, { dir: migrationsUpTo(14), backupDir: path.join(work, 'backups-b') }).applied, ['014_leave_requests_leave_type']);
    b.close();
  });
});

describe('leaveRepository با leave_type_id (S4-7b)', () => {
  let db, repo, typesRepo, user;
  before(() => {
    db = resetDb();
    repo = require('../src/repositories/leaveRepository');
    typesRepo = require('../src/repositories/leaveTypesRepository');
    user = require('./helpers/factories').makeUser();
  });
  after(cleanup);

  const mk = (extra = {}) => repo.createLeaveRequest({ userId: user.id, startDate: '2026-10-01', endDate: '2026-10-02', reason: 'تست', ...extra });
  const typeId = (code) => typesRepo.findByCode(code).id;

  test('ایجاد: leave→annual، mission→mission؛ leaveTypeId اولویت دارد و leave_type = kind؛ ورودی نامعتبر چیزی نمی‌نویسد؛ hasApproved* همان رفتار قبلی', () => {
    const l = mk();
    const m = mk({ leaveType: 'mission' });
    assert.deepEqual([l.leave_type, l.leave_type_id, l.rejected_reason], ['leave', typeId('annual'), null]);
    assert.deepEqual([m.leave_type, m.leave_type_id], ['mission', typeId('mission')]);

    const sick = typesRepo.createLeaveType({ code: 'sick', title: 'استعلاجی', kind: 'leave', isPaid: true, requiresAttachment: true, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: true });
    const trip = typesRepo.createLeaveType({ code: 'trip', title: 'سفر کاری', kind: 'mission', isPaid: true, requiresAttachment: false, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: true });
    const s = mk({ leaveTypeId: sick.id, leaveType: 'mission' }); // leaveType نادیده گرفته می‌شود
    const t = mk({ leaveTypeId: trip.id });
    assert.deepEqual([s.leave_type, s.leave_type_id, t.leave_type, t.leave_type_id], ['leave', sick.id, 'mission', trip.id]);

    const count = () => db.prepare('SELECT COUNT(*) n FROM leave_requests').get().n;
    const n = count();
    assert.throws(() => mk({ leaveType: 'sick' }), /نامعتبر/);
    assert.throws(() => mk({ leaveType: 'constructor' }), /نامعتبر/);
    assert.throws(() => mk({ leaveTypeId: 99999 }), /وجود ندارد/);
    assert.equal(count(), n);

    // موتور/IP هنوز با ستون قدیمی کار می‌کند (S4-7c این‌ها را به kind می‌برد)
    repo.setStatus(m.id, 'approved', null);
    repo.setStatus(t.id, 'approved', null);
    repo.setStatus(l.id, 'approved', null);
    assert.equal(repo.hasApprovedMissionOnDate(user.id, '2026-10-01'), true);
    assert.equal(repo.hasApprovedLeaveOnDate(user.id, '2026-10-02', 'leave'), true);
  });

  test('updateManual: تغییر leave_type هر دو ستون را هم‌زمان عوض می‌کند؛ ارسال دوباره‌ی همان kind نوع دقیق (استعلاجی) را به annual برنمی‌گرداند؛ وضعیت/تأییدکننده مثل قبل', () => {
    const sick = typesRepo.findByCode('sick');
    const r = mk({ leaveTypeId: sick.id });
    const same = repo.updateManual(r.id, { leave_type: 'leave', reason: 'ویرایش دلیل' }, 1);
    assert.deepEqual([same.leave_type, same.leave_type_id, same.reason], ['leave', sick.id, 'ویرایش دلیل']);

    const toMission = repo.updateManual(r.id, { leave_type: 'mission' }, 1);
    assert.deepEqual([toMission.leave_type, toMission.leave_type_id], ['mission', typeId('mission')]);
    const back = repo.updateManual(r.id, { leave_type: 'leave', status: 'approved' }, user.id);
    assert.deepEqual([back.leave_type, back.leave_type_id, back.status, back.approver_id], ['leave', typeId('annual'), 'approved', user.id]);

    assert.throws(() => repo.updateManual(r.id, { leave_type: 'sick' }, 1), /نامعتبر/);
    assert.equal(repo.findById(r.id).leave_type_id, typeId('annual'), 'خطا چیزی را عوض نکرد');
    assert.equal(repo.updateManual(r.id, {}, 1).id, r.id);
    const noop = repo.updateManual(r.id, { leave_type: 'leave' }, 1);
    assert.equal(noop.leave_type_id, typeId('annual'));
  });

  test('نوع ارجاع‌شده: countRequests/isReferenced دقیق، حذف رد می‌شود، rejected_reason قابل‌نوشتن است', () => {
    const annual = typeId('annual');
    const n = db.prepare('SELECT COUNT(*) n FROM leave_requests WHERE leave_type_id = ?').get(annual).n;
    assert.ok(n >= 1);
    assert.equal(typesRepo.countRequests(annual), n);
    assert.equal(typesRepo.isReferenced(annual), true);
    assert.equal(typesRepo.deleteIfUnused(annual), false);
    const free = typesRepo.createLeaveType({ code: 'spare', title: 'بدون استفاده', kind: 'leave', isPaid: true, requiresAttachment: false, countsAgainstBalance: true, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: true });
    assert.equal(typesRepo.deleteIfUnused(free.id), true);

    const r = mk();
    db.prepare("UPDATE leave_requests SET status = 'rejected', rejected_reason = ? WHERE id = ?").run('مغایر با برنامه', r.id);
    assert.equal(repo.findById(r.id).rejected_reason, 'مغایر با برنامه');
  });
});

describe('API مرخصی با leave_type_id (S4-7b)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookie, employee;
  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    employee = makeUser({ role: 'employee' });
    cookie = sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(method, url, body) {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  }

  test('ثبت و ویرایش از پنل: leave_type_id و leave_type با هم؛ خروجی API همان شکل قبلی (leaveType) است', async () => {
    const id = (code) => db.prepare('SELECT id FROM leave_types WHERE code = ?').get(code).id;
    const created = await hit('POST', '/api/admin/leave-requests', { userId: employee.id, startDate: '2026-10-11', endDate: '2026-10-12', leaveType: 'mission', reason: 'بازدید' });
    assert.equal(created.status, 201);
    const row = () => db.prepare('SELECT leave_type, leave_type_id FROM leave_requests WHERE id = ?').get(created.json.id);
    assert.deepEqual(row(), { leave_type: 'mission', leave_type_id: id('mission') });

    const patched = await hit('PATCH', `/api/admin/leave-requests/${created.json.id}`, { leaveType: 'leave' });
    assert.equal(patched.status, 200);
    assert.deepEqual(row(), { leave_type: 'leave', leave_type_id: id('annual') });

    const list = await hit('GET', '/api/admin/leave-requests?status=all');
    assert.equal(list.json.find((r) => r.id === created.json.id).leaveType, 'leave');
    const types = await hit('GET', '/api/admin/leave-types');
    assert.equal(types.json.find((t) => t.code === 'annual').requestCount, 1);
    assert.equal((await hit('DELETE', `/api/admin/leave-types/${id('annual')}`, { reason: 'تلاش' })).status, 409);
  });
});
