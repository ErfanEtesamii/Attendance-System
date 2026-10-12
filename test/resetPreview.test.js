// B1: رجیستری ریست و پیش‌نمایش (dry-run) — می‌شمارد، چیزی حذف نمی‌کند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./helpers/factories');
const resetRepo = require('../src/repositories/resetRepository');
const svc = require('../src/services/resetService');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const breakRepo = require('../src/repositories/breakRepository');
const leaveRepo = require('../src/repositories/leaveRepository');
const notificationsRepo = require('../src/repositories/notificationsRepository');

const TABLES = ['attendance_records', 'break_records', 'record_disputes', 'leave_requests', 'overtime_approvals', 'suspicious_events', 'notifications', 'month_closures', 'rate_limit_hits', 'leave_balance_adjustments', 'job_runs', 'monitor_alerts', 'users', 'settings', 'audit_log', 'leave_types', 'work_shifts', 'holidays'];

describe('رجیستری و پیش‌نمایش ریست (B1)', () => {
  let db; let u;
  const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c]));
  const insertRecord = (userId, date) => db.prepare(
    "INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, ?, '2026-01-01T05:00:00.000Z')",
  ).run(userId, date).lastInsertRowid;

  before(() => {
    db = resetDb();
    u = F.makeUser();
    const old = insertRecord(u.id, '2026-05-01');
    const recent = insertRecord(u.id, '2026-09-01');
    breakRepo.startBreak(old, 'lunch');
    breakRepo.startBreak(recent, 'short_break');
    leaveRepo.createLeaveRequest({ userId: u.id, startDate: '2026-05-02', endDate: '2026-05-02', leaveType: 'leave', reason: 'قدیمی' });
    leaveRepo.createLeaveRequest({ userId: u.id, startDate: '2026-09-02', endDate: '2026-09-02', leaveType: 'leave', reason: 'تازه' });
    db.prepare("INSERT INTO record_disputes (user_id, attendance_record_id, message) VALUES (?, ?, 'x')").run(u.id, old);
    db.prepare("INSERT INTO rate_limit_hits (limiter, bucket_key, count, reset_at) VALUES ('a','k',1,1)").run();
    db.prepare("INSERT INTO job_runs (job_name, started_at, status) VALUES ('j', '2026-05-01T00:00:00.000Z', 'success')").run();
    if (notificationsRepo.insert) notificationsRepo.insert({ userId: u.id, type: 't', title: 'x', body: 'y' });
  });
  after(cleanup);

  test('رجیستری: فرزند قبل از والد و هیچ جدول محافظت‌شده‌ای در آن نیست', () => {
    const names = resetRepo.ENTRIES.map((e) => e.table);
    assert.ok(names.indexOf('break_records') < names.indexOf('attendance_records'));
    assert.ok(names.indexOf('leave_approvals') < names.indexOf('leave_requests'));
    assert.ok(names.indexOf('month_closure_adjustments') < names.indexOf('month_closures'));
    for (const p of resetRepo.PROTECTED_TABLES) assert.ok(!names.includes(p), `${p} نباید در رجیستری باشد`);
    for (const must of ['users', 'work_shifts', 'holidays', 'leave_types', 'settings', 'audit_log']) assert.ok(resetRepo.PROTECTED_TABLES.includes(must));
    assert.ok(new Set(names).size === names.length);
  });

  test('گروه‌ها: پیش‌فرض فقط الف؛ ب اختیاری', () => {
    const g = svc.listGroups();
    assert.deepEqual(g.filter((x) => x.defaultSelected).map((x) => x.key), ['operational']);
    assert.ok(g.some((x) => x.key === 'balances') && g.some((x) => x.key === 'jobs'));
  });

  test('پیش‌نمایش درست می‌شمارد و هیچ داده‌ای را تغییر نمی‌دهد', () => {
    const before = snapshot();
    const p = svc.previewReset();
    assert.deepEqual(p.groups, ['operational']);
    const by = Object.fromEntries(p.tables.map((t) => [t.table, t.count]));
    assert.equal(by.attendance_records, 2);
    assert.equal(by.break_records, 2);
    assert.equal(by.leave_requests, 2);
    assert.equal(by.record_disputes, 1);
    assert.equal(by.rate_limit_hits, 1);
    assert.ok(!('job_runs' in by));
    assert.equal(p.total, p.tables.reduce((s, t) => s + t.count, 0));
    assert.deepEqual(snapshot(), before);
  });

  test('beforeDate: فقط ردیف‌های قبل از تاریخ؛ شمارنده‌ی موقت همچنان کامل', () => {
    const p = svc.previewReset({ beforeDate: '2026-08-01' });
    const by = Object.fromEntries(p.tables.map((t) => [t.table, t.count]));
    assert.equal(by.attendance_records, 1);
    assert.equal(by.break_records, 1);
    assert.equal(by.leave_requests, 1);
    assert.equal(by.record_disputes, 1);
    assert.equal(by.rate_limit_hits, 1);
    assert.equal(p.beforeDate, '2026-08-01');
  });

  test('گروه ب و jobs با انتخاب صریح شمرده می‌شوند', () => {
    const p = svc.previewReset({ groups: ['jobs'] });
    assert.deepEqual(p.tables.map((t) => t.table), ['job_runs', 'monitor_alerts']);
    assert.equal(p.tables[0].count, 1);
    assert.equal(svc.previewReset({ groups: ['jobs'], beforeDate: '2026-04-01' }).tables[0].count, 0);
  });

  test('اعتبارسنجی: گروه ناشناخته/خالی و تاریخ نامعتبر ⇒ ResetError', () => {
    assert.throws(() => svc.previewReset({ groups: ['users'] }), (e) => e.code === 'INVALID_GROUPS');
    assert.throws(() => svc.previewReset({ groups: [] }), (e) => e.code === 'INVALID_GROUPS');
    assert.throws(() => svc.previewReset({ beforeDate: '2026-13-40' }), (e) => e.code === 'INVALID_DATE');
    assert.throws(() => svc.previewReset({ beforeDate: '1405/01/01' }), (e) => e.code === 'INVALID_DATE');
    assert.throws(() => svc.previewReset({ beforeDate: '2026-02-30' }), (e) => e.code === 'INVALID_DATE');
  });
});
