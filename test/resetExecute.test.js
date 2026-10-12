// B2: اجرای ریست — بک‌آپ، حالت نگهداری، تراکنش/rollback، sqlite_sequence، epoch، audit.
const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/config');
const F = require('./helpers/factories');
const svc = require('../src/services/resetService');
const maintenance = require('../src/utils/maintenanceMode');
const { maintenanceGate } = require('../src/middleware/maintenanceGate');
const settingsRepo = require('../src/repositories/settingsRepository');
const breakRepo = require('../src/repositories/breakRepository');
const leaveRepo = require('../src/repositories/leaveRepository');
const { fakeReq, fakeRes } = require('./helpers/factories');

describe('اجرای ریست (B2)', () => {
  let db; let admin; let emp; let backupDir;
  const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  const addRecord = (userId, date) => db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, ?, '2026-01-01T05:00:00.000Z')").run(userId, date).lastInsertRowid;

  const wipe = () => db.exec('DELETE FROM break_records; DELETE FROM attendance_records; DELETE FROM leave_requests;');

  function seed() {
    wipe();
    const r1 = addRecord(emp.id, '2026-05-01');
    addRecord(emp.id, '2026-09-01');
    breakRepo.startBreak(r1, 'lunch');
    leaveRepo.createLeaveRequest({ userId: emp.id, startDate: '2026-05-02', endDate: '2026-05-02', leaveType: 'leave', reason: 'x' });
    db.prepare("INSERT OR REPLACE INTO rate_limit_hits (limiter, bucket_key, count, reset_at) VALUES ('a','k',1,1)").run();
    db.prepare("INSERT INTO job_runs (job_name, started_at, status) VALUES ('j', '2026-05-01T00:00:00.000Z', 'success')").run();
  }

  before(() => {
    db = resetDb();
    backupDir = path.join(tmpDir, 'bk');
    config.monitor.backupDir = backupDir;
    admin = F.makeUser({ role: 'admin' });
    emp = F.makeUser();
  });
  after(cleanup);

  test('اجرا: داده‌ی عملیاتی پاک، users/settings/audit سالم، بک‌آپ ساخته، شمارنده‌ها از ۱، epoch زیاد، audit ثبت', async () => {
    seed();
    const usersBefore = count('users');
    const epochBefore = settingsRepo.getResetEpoch();
    const r = await svc.executeReset({}, { actor: admin.id, ip: '10.0.0.1' });
    assert.equal(r.deleted.attendance_records, 2);
    assert.equal(r.deleted.break_records, 1);
    assert.equal(r.deleted.leave_requests, 1);
    for (const t of ['attendance_records', 'break_records', 'leave_requests', 'rate_limit_hits']) assert.equal(count(t), 0, t);
    assert.equal(count('job_runs'), 1, 'گروه jobs انتخاب نشده بود');
    assert.equal(count('users'), usersBefore);
    assert.equal(r.resetEpoch, epochBefore + 1);
    assert.equal(settingsRepo.getResetEpoch(), epochBefore + 1);
    assert.ok(fs.existsSync(r.backup.path) && /^pre-reset-\d{8}-\d{4}\.db$/.test(r.backup.file));
    assert.equal(maintenance.isActive(), false);

    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'system_reset'").get();
    const d = JSON.parse(audit.details);
    assert.equal(audit.user_id, admin.id);
    assert.equal(audit.ip_address, '10.0.0.1');
    assert.equal(d.total, r.total);
    assert.deepEqual(d.groups, ['operational']);
    assert.equal(d.backupFile, r.backup.file);

    // بعد از ریست، ورود جدید ممکن است و شناسه‌ها از ۱ شروع می‌شوند
    const id = addRecord(emp.id, '2026-10-01');
    assert.equal(id, 1);
  });

  test('beforeDate: فقط قدیمی‌ها حذف؛ شمارنده‌ی AUTOINCREMENT جدولِ غیرخالی دست نمی‌خورد', async () => {
    wipe();
    const old = addRecord(emp.id, '2026-05-01');
    const recent = addRecord(emp.id, '2026-09-01');
    const r = await svc.executeReset({ beforeDate: '2026-08-01' }, { actor: admin.id });
    assert.equal(r.deleted.attendance_records, 1);
    assert.equal(db.prepare('SELECT id FROM attendance_records').all().map((x) => x.id).join(), String(recent));
    assert.ok(addRecord(emp.id, '2026-10-02') > recent && old < recent);
  });

  test('گروه jobs: فقط job_runs/monitor_alerts پاک می‌شود', async () => {
    seed();
    const r = await svc.executeReset({ groups: ['jobs'] }, { actor: admin.id });
    assert.deepEqual(Object.keys(r.deleted), ['job_runs', 'monitor_alerts']);
    assert.equal(count('job_runs'), 0);
    assert.ok(count('attendance_records') > 0);
  });

  test('خطا در تراکنش ⇒ rollback کامل، حالت نگهداری آزاد، audit خطا، بک‌آپ باقی', async () => {
    seed();
    db.exec("CREATE TRIGGER block_leave_delete BEFORE DELETE ON leave_requests BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const before = { att: count('attendance_records'), brk: count('break_records'), lv: count('leave_requests') };
    const epoch = settingsRepo.getResetEpoch();
    await assert.rejects(() => svc.executeReset({}, { actor: admin.id }), /boom/);
    assert.deepEqual({ att: count('attendance_records'), brk: count('break_records'), lv: count('leave_requests') }, before);
    assert.equal(settingsRepo.getResetEpoch(), epoch);
    assert.equal(maintenance.isActive(), false);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'system_reset_failed'").get());
    db.exec('DROP TRIGGER block_leave_delete');
  });

  test('شکست بک‌آپ ⇒ ریست انجام نمی‌شود', async () => {
    const lv = count('leave_requests');
    const real = require('../src/bot/scheduler/backup').runPreResetBackup;
    const backupMod = require('../src/bot/scheduler/backup');
    backupMod.runPreResetBackup = async () => { throw new Error('disk full'); };
    try {
      await assert.rejects(() => svc.executeReset({}, { actor: admin.id }), (e) => e.code === 'BACKUP_FAILED');
    } finally { backupMod.runPreResetBackup = real; }
    assert.equal(count('leave_requests'), lv);
    assert.equal(maintenance.isActive(), false);
  });

  test('ورودی نامعتبر قبل از هر کاری رد می‌شود؛ ریست همزمان ⇒ BUSY', async () => {
    await assert.rejects(() => svc.executeReset({ groups: ['users'] }), (e) => e.code === 'INVALID_GROUPS');
    const p1 = svc.executeReset({ groups: ['jobs'] }, { actor: admin.id });
    await assert.rejects(() => svc.executeReset({ groups: ['jobs'] }, { actor: admin.id }), (e) => e.code === 'BUSY');
    await p1;
  });

  test('middleware نگهداری: روشن ⇒ ۵۰۳ با code=maintenance؛ خاموش ⇒ عبور', () => {
    let nexted = false;
    const res = fakeRes();
    res.set = () => res;
    maintenance.enter('t');
    maintenanceGate(fakeReq({ method: 'POST', url: '/api/miniapp/check-in' }), res, () => { nexted = true; });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'maintenance');
    assert.equal(nexted, false);
    maintenance.leave();
    maintenanceGate(fakeReq(), fakeRes(), () => { nexted = true; });
    assert.equal(nexted, true);
  });
});
