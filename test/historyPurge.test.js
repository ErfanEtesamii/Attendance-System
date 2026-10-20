const { resetDb, cleanup, tmpDir } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const config = require('../src/config');
const F = require('./helpers/factories');
const service = require('../src/services/historyPurgeService');
const leaveRepository = require('../src/repositories/leaveRepository');

describe('پاک‌سازی بازه‌ایِ تردد و برنامه‌های هفتگی', () => {
  let db; let user;
  const count = (table) => db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

  before(() => {
    db = resetDb();
    config.monitor.backupDir = path.join(tmpDir, 'history-purge-backups');
    user = F.makeUser();
  });
  after(cleanup);

  function seed() {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM break_records; DELETE FROM attendance_records; DELETE FROM leave_requests;');
    const old = db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, '2025-05-02', '2025-05-02T08:00:00.000Z')").run(user.id).lastInsertRowid;
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, '2025-08-02', '2025-08-02T08:00:00.000Z')").run(user.id);
    db.prepare("INSERT INTO break_records (attendance_record_id, break_type, start_time) VALUES (?, 'lunch', '2025-05-02T10:00:00.000Z')").run(old);
    const plan = db.prepare("INSERT INTO weekly_plans (user_id, week_start_date) VALUES (?, '2025-05-03')").run(user.id).lastInsertRowid;
    const task = db.prepare("INSERT INTO plan_tasks (plan_id, title) VALUES (?, 'قدیمی')").run(plan).lastInsertRowid;
    db.prepare("INSERT INTO task_daily_logs (task_id, user_id, log_date, status) VALUES (?, ?, '2025-05-03', 'done')").run(task, user.id);
    db.prepare("INSERT INTO weekly_plans (user_id, week_start_date) VALUES (?, '2025-08-03')").run(user.id);
    leaveRepository.createLeaveRequest({ userId: user.id, startDate: '2025-05-03', endDate: '2025-05-03', leaveType: 'leave', reason: 'نباید حذف شود' });
  }

  test('پیش‌نمایش و اجرا فقط دامنهٔ اعلام‌شده در بازه را حذف می‌کنند', async () => {
    seed();
    const preview = service.preview({ fromDate: '2025-05-01', toDate: '2025-05-31' });
    assert.equal(Object.fromEntries(preview.tables.map((r) => [r.table, r.count])).attendance_records, 1);
    assert.equal(Object.fromEntries(preview.tables.map((r) => [r.table, r.count])).weekly_plans, 1);
    const result = await service.execute({ fromDate: '2025-05-01', toDate: '2025-05-31' }, { actor: user.id });
    assert.equal(result.deleted.attendance_records, 1);
    assert.equal(result.deleted.weekly_plans, 1);
    assert.equal(count('attendance_records'), 1);
    assert.equal(count('weekly_plans'), 1);
    assert.equal(count('leave_requests'), 1, 'مرخصی نباید حذف شود');
    assert.equal(count('break_records'), 0);
    assert.equal(count('task_daily_logs'), 0);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'historical_data_purged'").get());
  });

  test('بازهٔ نامعتبر یا امروز/آینده پذیرفته نمی‌شود و متن تأیید لازم است', () => {
    assert.throws(() => service.preview({ fromDate: '2025-05-31', toDate: '2025-05-01' }), (err) => err.code === 'INVALID_RANGE');
    assert.throws(() => service.preview({ fromDate: '2025-05-01', toDate: new Date().toISOString().slice(0, 10) }), (err) => err.code === 'PAST_ONLY');
    assert.equal(service.checkRequest({ fromDate: '2025-05-01', toDate: '2025-05-31', confirmText: 'نه' }, { role: 'admin' }).code, 'confirm_required');
  });
});
