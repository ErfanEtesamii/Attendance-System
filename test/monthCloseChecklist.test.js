// S5-3a: چک‌لیست پیش از بستن ماه — migration ۰۲۰، سرویس (هر مورد، مانع/هشدار با تنظیمات) و route (مجوز/اعتبارسنجی).
// ماه آزمایشی: شهریور ۱۴۰۵ = ۲۰۲۶-۰۸-۲۳ تا ۲۰۲۶-۰۹-۲۲. «الان» پیش‌فرض ۲۰۲۶-۱۰-۰۵ (ماه تمام شده).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const { buildChecklist } = require('../src/services/monthCloseService');
const settingsRepo = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const leaveRepo = require('../src/repositories/leaveRepository');
const leaveTypesRepo = require('../src/repositories/leaveTypesRepository');
const disputeRepo = require('../src/repositories/disputeRepository');
const suspiciousRepo = require('../src/repositories/suspiciousRepository');
const monthClosuresRepo = require('../src/repositories/monthClosuresRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const NOW = at('2026-10-05', '10:00');
const Y = 1405;
const M = 6;

function rec(userId, date, inn, out) {
  return attendanceRepo.createManual({ userId, recordDate: date, checkInTime: inn ? at(date, inn) : null, checkOutTime: out ? at(date, out) : null, status: 'normal' });
}
const item = (cl, key) => cl.items.find((i) => i.key === key);
const setCreatedAt = (userId, createdAt) => getDb().prepare('UPDATE users SET created_at = ? WHERE id = ?').run(createdAt, userId);

describe('migration ۰۲۰ — month_closures (S5-3a)', () => {
  before(() => { resetDb(); });
  after(cleanup);

  test('ستون‌ها، قیدها و یکتایی (سال، ماه)', () => {
    const db = getDb();
    const cols = db.prepare('PRAGMA table_info(month_closures)').all().map((c) => c.name);
    for (const c of ['jalali_year', 'jalali_month', 'status', 'period_from', 'period_to', 'snapshot_json', 'checklist_json', 'close_note', 'close_count', 'closed_by', 'closed_at', 'reopened_by', 'reopened_at', 'reopen_reason']) {
      assert.ok(cols.includes(c), c);
    }
    const ins = db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (?, ?, ?, '2026-08-23', '2026-09-22')");
    ins.run(Y, M, 'closed');
    assert.throws(() => ins.run(Y, M, 'closed'), /UNIQUE/);
    assert.throws(() => ins.run(Y, 13, 'closed'), /CHECK/);
    assert.throws(() => ins.run(Y, 5, 'weird'), /CHECK/);
    assert.throws(() => ins.run(1299, 5, 'closed'), /CHECK/);
    assert.equal(monthClosuresRepo.findByMonth(Y, M).status, 'closed');
    assert.equal(monthClosuresRepo.findByMonth(Y, 7), null);
    assert.deepEqual(monthClosuresRepo.listByYear(Y).map((r) => r.jalali_month), [M]);
  });
});

describe('چک‌لیست بستن ماه — سرویس (S5-3a)', () => {
  let admin; let emp; let emp2;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین' });
    emp = makeUser({ name: 'الف' });
    emp2 = makeUser({ name: 'ب' });
    for (const u of [admin, emp, emp2]) setCreatedAt(u.id, '2020-01-01 00:00:00');
  });
  after(cleanup);
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM month_closures').run();
    db.prepare('DELETE FROM record_disputes').run();
    db.prepare('DELETE FROM suspicious_events').run();
    db.prepare('DELETE FROM overtime_approvals').run();
    db.prepare('DELETE FROM leave_requests').run();
    db.prepare('DELETE FROM attendance_records').run();
    db.prepare("DELETE FROM settings WHERE key LIKE 'month_close_%' OR key LIKE 'overtime_%'").run();
  });

  test('ماه تمیز و تمام‌شده: همه‌ی موارد ok، قابل‌بستن؛ ساختار پاسخ', () => {
    rec(emp.id, '2026-08-23', '08:00', '16:30');
    const cl = buildChecklist({ year: Y, month: M, now: NOW });
    assert.equal(cl.from, '2026-08-23');
    assert.equal(cl.to, '2026-09-22');
    assert.equal(cl.today, '2026-10-05');
    assert.deepEqual(cl.items.map((i) => i.key), ['month_not_ended', 'incomplete', 'open_disputes', 'pending_leave', 'pending_overtime', 'suspicious']);
    assert.ok(cl.items.every((i) => i.ok && i.count === 0 && Array.isArray(i.samples) && i.title && i.hint));
    assert.equal(cl.blockingCount, 0);
    assert.equal(cl.warningCount, 0);
    assert.equal(cl.canClose, true);
    assert.deepEqual(cl.closure, { status: 'open' });
    // پیش‌فرض‌ها: چهار مانع + پایان ماه؛ مورد مشکوک هشدار است
    assert.deepEqual(cl.items.map((i) => i.blocking), [true, true, true, true, true, false]);
  });

  test('ماه هنوز تمام نشده ⇒ مانع؛ با خاموش‌کردن تنظیم فقط هشدار', () => {
    const during = at('2026-09-22', '12:00'); // آخرین روز ماه
    let cl = buildChecklist({ year: Y, month: M, now: during });
    assert.equal(item(cl, 'month_not_ended').count, 1);
    assert.equal(cl.canClose, false);
    assert.equal(cl.blockingCount, 1);
    cl = buildChecklist({ year: Y, month: M, now: at('2026-09-23', '00:30') });
    assert.equal(item(cl, 'month_not_ended').count, 0, 'روز بعد از آخرین روز ⇒ تمام شده');
    settingsRepo.update({ monthCloseRequireMonthEnded: false });
    cl = buildChecklist({ year: Y, month: M, now: during });
    assert.equal(item(cl, 'month_not_ended').blocking, false);
    assert.equal(item(cl, 'month_not_ended').count, 1);
    assert.equal(cl.canClose, true);
    assert.equal(cl.warningCount, 1);
  });

  test('روز ناقص: ورود بدون خروجِ روز گذشته؛ نمونه‌ها با نام و تاریخ', () => {
    rec(emp.id, '2026-08-24', '08:00', null);
    rec(emp2.id, '2026-08-25', '08:00', '16:30');
    const cl = buildChecklist({ year: Y, month: M, now: NOW });
    const it = item(cl, 'incomplete');
    assert.equal(it.count, 1);
    assert.deepEqual(it.samples, [{ userId: emp.id, fullName: 'الف', date: '2026-08-24' }]);
    assert.equal(cl.canClose, false);
    // خاموش‌کردن مانع ⇒ هشدار؛ بستن ممکن
    settingsRepo.update({ monthCloseBlockIncomplete: false });
    const cl2 = buildChecklist({ year: Y, month: M, now: NOW });
    assert.equal(cl2.canClose, true);
    assert.equal(cl2.warningCount, 1);
  });

  test('رکورد ناقصِ ماه دیگر شمرده نمی‌شود', () => {
    rec(emp.id, '2026-09-23', '08:00', null); // اول مهر
    rec(emp.id, '2026-08-22', '08:00', null); // آخر مرداد
    assert.equal(item(buildChecklist({ year: Y, month: M, now: NOW }), 'incomplete').count, 0);
  });

  test('اعتراض باز: وصل به رکوردِ ماه ⇒ شمرده؛ حل‌شده یا رکورد ماه دیگر ⇒ نه', () => {
    const inMonth = rec(emp.id, '2026-09-01', '08:00', '16:30');
    const outMonth = rec(emp.id, '2026-10-01', '08:00', '16:30');
    const resolved = rec(emp.id, '2026-09-02', '08:00', '16:30');
    disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: inMonth.id, message: 'ساعت خروج اشتباه است' });
    disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: outMonth.id, message: 'ماه دیگر' });
    const d3 = disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: resolved.id, message: 'حل شد' });
    disputeRepo.setStatus(d3.id, 'resolved');
    const cl = buildChecklist({ year: Y, month: M, now: NOW });
    const it = item(cl, 'open_disputes');
    assert.equal(it.count, 1);
    assert.equal(it.samples[0].date, '2026-09-01');
    assert.equal(it.samples[0].fullName, 'الف');
    assert.match(it.samples[0].message, /ساعت خروج/);
  });

  test('اعتراض بدون رکورد با روز ثبت (created_at) سنجیده می‌شود', () => {
    const d = disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'بدون رکورد' });
    getDb().prepare('UPDATE record_disputes SET created_at = ? WHERE id = ?').run('2026-09-10 09:00:00', d.id);
    const d2 = disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'خارج' });
    getDb().prepare('UPDATE record_disputes SET created_at = ? WHERE id = ?').run('2026-11-10 09:00:00', d2.id);
    const it = item(buildChecklist({ year: Y, month: M, now: NOW }), 'open_disputes');
    assert.equal(it.count, 1);
    assert.equal(it.samples[0].date, '2026-09-10');
  });

  test('مرخصی در انتظار: هم‌پوشانی با ماه (حتی شروع از ماه قبل)؛ تأییدشده/ردشده/خارج از ماه ⇒ نه', () => {
    const t = leaveTypesRepo.findByCode('annual');
    const mk = (s, e, status) => {
      const r = leaveRepo.createLeaveRequest({ userId: emp.id, startDate: s, endDate: e, leaveTypeId: t.id, unit: 'day' });
      if (status !== 'pending') leaveRepo.setStatus(r.id, status, null);
      return r;
    };
    const straddle = mk('2026-08-20', '2026-08-24', 'pending');
    mk('2026-09-05', '2026-09-05', 'approved');
    mk('2026-09-06', '2026-09-06', 'rejected');
    mk('2026-10-10', '2026-10-11', 'pending'); // ماه بعد
    const it = item(buildChecklist({ year: Y, month: M, now: NOW }), 'pending_leave');
    assert.equal(it.count, 1);
    assert.equal(it.samples[0].requestId, straddle.id);
    assert.equal(it.samples[0].fullName, 'الف');
  });

  test('اضافه‌کاری منتظر تأیید: فقط با «الزام تأیید»؛ تأییدشده خارج می‌شود', () => {
    settingsRepo.update({ overtimeEnabled: true });
    const r1 = rec(emp.id, '2026-08-24', '08:00', '18:30'); // ۱۲۰ دقیقه اضافه
    rec(emp2.id, '2026-08-24', '08:00', '16:30'); // بدون اضافه
    // الزام تأیید خاموش ⇒ مورد قابل‌اعمال نیست
    let it = item(buildChecklist({ year: Y, month: M, now: NOW }), 'pending_overtime');
    assert.equal(it.count, 0);
    assert.equal(it.applicable, false);
    // روشن ⇒ معلق
    settingsRepo.update({ overtimeRequiresApproval: true });
    let cl = buildChecklist({ year: Y, month: M, now: NOW });
    it = item(cl, 'pending_overtime');
    assert.equal(it.applicable, true);
    assert.equal(it.count, 1);
    assert.equal(it.samples[0].fullName, 'الف');
    assert.equal(it.samples[0].date, '2026-08-24');
    assert.ok(it.samples[0].minutes > 0);
    assert.equal(cl.canClose, false);
    // تأیید ⇒ از چک‌لیست خارج
    getDb().prepare("INSERT INTO overtime_approvals (attendance_record_id, user_id, status, decided_by) VALUES (?, ?, 'approved', ?)").run(r1.id, emp.id, admin.id);
    cl = buildChecklist({ year: Y, month: M, now: NOW });
    assert.equal(item(cl, 'pending_overtime').count, 0);
    assert.equal(cl.canClose, true);
  });

  test('موارد مشکوک: open در بازه شمرده می‌شود و پیش‌فرض فقط هشدار است؛ reviewed و خارج از ماه نه', () => {
    suspiciousRepo.create({ eventType: 'shared_device', userIds: [emp.id, emp2.id], eventDate: '2026-09-03' });
    const done = suspiciousRepo.create({ eventType: 'shared_device', userIds: [emp.id], eventDate: '2026-09-04' }).event;
    suspiciousRepo.markReviewed(done.id, { status: 'reviewed', reviewedBy: admin.id });
    suspiciousRepo.create({ eventType: 'shared_device', userIds: [emp.id], eventDate: '2026-10-04' });
    let cl = buildChecklist({ year: Y, month: M, now: NOW });
    const it = item(cl, 'suspicious');
    assert.equal(it.count, 1);
    assert.equal(it.blocking, false);
    assert.deepEqual(it.samples[0].users.map((u) => u.fullName), ['الف', 'ب']);
    assert.equal(cl.canClose, true);
    assert.equal(cl.warningCount, 1);
    // اگر ادمین مانع کند
    settingsRepo.update({ monthCloseBlockSuspicious: true });
    cl = buildChecklist({ year: Y, month: M, now: NOW });
    assert.equal(cl.canClose, false);
    assert.equal(cl.blockingCount, 1);
  });

  test('نمونه‌ها سقف ۱۰ دارند ولی count شمارش کامل است', () => {
    const t = leaveTypesRepo.findByCode('annual');
    for (let i = 0; i < 13; i += 1) leaveRepo.createLeaveRequest({ userId: emp.id, startDate: '2026-09-05', endDate: '2026-09-05', leaveTypeId: t.id, unit: 'day' });
    const it = item(buildChecklist({ year: Y, month: M, now: NOW }), 'pending_leave');
    assert.equal(it.count, 13);
    assert.equal(it.samples.length, 10);
  });

  test('ماهِ بسته‌شده قابل‌بستن نیست (باید اول باز شود)؛ وضعیت closure در پاسخ می‌آید', () => {
    getDb().prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to, closed_by) VALUES (?, ?, 'closed', '2026-08-23', '2026-09-22', ?)").run(Y, M, admin.id);
    let cl = buildChecklist({ year: Y, month: M, now: NOW });
    assert.equal(cl.closure.status, 'closed');
    assert.equal(cl.closure.closedBy, admin.id);
    assert.equal(cl.blockingCount, 0);
    assert.equal(cl.canClose, false);
    getDb().prepare("UPDATE month_closures SET status = 'reopened'").run();
    cl = buildChecklist({ year: Y, month: M, now: NOW });
    assert.equal(cl.closure.status, 'reopened');
    assert.equal(cl.canClose, true, 'ماهِ بازشده دوباره قابل‌بستن است');
  });

  test('ورودی نامعتبر ⇒ RangeError', () => {
    assert.throws(() => buildChecklist({ year: 1405, month: 13, now: NOW }), RangeError);
    assert.throws(() => buildChecklist({ year: 'x', month: 1, now: NOW }), RangeError);
  });
});

let hasExpress = true;
try { require.resolve('express'); } catch (_) { hasExpress = false; }

describe('چک‌لیست بستن ماه — route (S5-3a)', { skip: hasExpress ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let cookies;
  before(async () => {
    resetDb();
    const { sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const hr = makeUser({ role: 'hr' });
    const mgr = makeUser({ role: 'manager' });
    const emp = makeUser({ role: 'employee', managerId: mgr.id });
    cookies = { admin: sessionCookie(admin.id), hr: sessionCookie(hr.id), manager: sessionCookie(mgr.id), employee: sessionCookie(emp.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const get = async (role, url) => {
    const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
    return { status: res.status, json: await res.json() };
  };

  test('admin و hr چک‌لیست و فهرست سال را می‌بینند؛ سرپرست و کارمند ۴۰۳', async () => {
    for (const role of ['admin', 'hr']) {
      const r = await get(role, `/api/admin/month-closures/${Y}/${M}/checklist`);
      assert.equal(r.status, 200, role);
      assert.equal(r.json.year, Y);
      assert.equal(r.json.month, M);
      assert.equal(r.json.items.length, 6);
      const l = await get(role, `/api/admin/month-closures?year=${Y}`);
      assert.equal(l.status, 200);
      assert.equal(l.json.months.length, 12);
      assert.ok(l.json.months.every((m) => m.status === 'open'));
    }
    for (const role of ['manager', 'employee']) {
      assert.equal((await get(role, `/api/admin/month-closures/${Y}/${M}/checklist`)).status, 403, role);
      assert.equal((await get(role, `/api/admin/month-closures?year=${Y}`)).status, 403, role);
    }
  });

  test('ورودی نامعتبر ⇒ ۴۰۰ با کد', async () => {
    assert.equal((await get('admin', `/api/admin/month-closures/${Y}/13/checklist`)).json.code, 'INVALID_MONTH');
    assert.equal((await get('admin', `/api/admin/month-closures/12/6/checklist`)).json.code, 'INVALID_YEAR');
    assert.equal((await get('admin', '/api/admin/month-closures')).json.code, 'INVALID_YEAR');
    assert.equal((await get('admin', '/api/admin/month-closures?year=abcd')).status, 400);
  });
});
