// S3-5c: تأیید اضافه‌کاری (overtime_approvals، تنظیم overtimeRequiresApproval، route تأیید/رد، معلق خارج از payable).
// بخش API روی اپ واقعی است و بدون express نصب‌شده skip می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dayService = require('../src/engine/dayService');
const settingsRepo = require('../src/repositories/settingsRepository');
const approvalRepo = require('../src/repositories/overtimeApprovalRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const TEHRAN = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TEHRAN).toISOString();
const outAt = (raw) => { const t = 16 * 60 + 30 + raw; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

describe('تأیید اضافه‌کاری (S3-5c)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  // رکورد با «raw» دقیقه اضافه‌کاری خام (ضریب ۱ ⇒ payable = raw)
  const mkRecord = (user, date, raw) => {
    const id = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, date, at(date, '08:00'), at(date, outAt(raw)), 'normal').lastInsertRowid;
    return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  };
  const resetOvertime = () => db.exec("DELETE FROM settings WHERE key LIKE 'overtime\\_%' ESCAPE '\\'");

  test('migration 008: ساختار، قیدها و حذف آبشاری (حذف رکورد/کاربر، حذف تصمیم‌گیرنده)', () => {
    const cols = db.prepare("PRAGMA table_info('overtime_approvals')").all().map((c) => c.name);
    assert.deepEqual(cols, ['id', 'attendance_record_id', 'user_id', 'status', 'reason', 'decided_by', 'decided_at']);
    assert.equal(db.prepare("SELECT name FROM schema_migrations WHERE name = '008_overtime_approvals'").all().length, 1);
    assert.doesNotThrow(() => require('../src/db/migrations/008_overtime_approvals').up(db), 'اجرای دوباره بی‌خطاست');

    const manager = makeUser({ role: 'manager' });
    const emp = makeUser({ role: 'employee', managerId: manager.id });
    const r1 = mkRecord(emp, '2026-07-01', 30);
    const r2 = mkRecord(emp, '2026-07-04', 30);
    const raw = (recordId, status) => db.prepare('INSERT INTO overtime_approvals (attendance_record_id, user_id, status, decided_by) VALUES (?, ?, ?, ?)').run(recordId, emp.id, status, manager.id);
    assert.throws(() => raw(r1.id, 'pending'), /CHECK/, 'pending ردیف نمی‌شود');
    raw(r1.id, 'approved');
    assert.throws(() => raw(r1.id, 'rejected'), /UNIQUE/, 'حداکثر یک تصمیم برای هر رکورد');
    // repository: رد بدون دلیل پذیرفته نمی‌شود؛ تغییر تصمیم UPSERT است (یک ردیف می‌ماند)
    assert.throws(() => approvalRepo.upsertDecision({ attendanceRecordId: r2.id, userId: emp.id, status: 'rejected', reason: '  ', decidedBy: manager.id }), RangeError);
    approvalRepo.upsertDecision({ attendanceRecordId: r2.id, userId: emp.id, status: 'approved', decidedBy: manager.id });
    approvalRepo.upsertDecision({ attendanceRecordId: r2.id, userId: emp.id, status: 'rejected', reason: ' خارج از برنامه ', decidedBy: manager.id });
    assert.deepEqual(db.prepare('SELECT status, reason FROM overtime_approvals WHERE attendance_record_id = ?').all(r2.id), [{ status: 'rejected', reason: 'خارج از برنامه' }]);

    // حذف رکورد (تابع موجود، بدون تغییر) ردیف تصمیم را هم می‌برد
    attendanceRepo.removeWithBreaks(r1.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM overtime_approvals WHERE attendance_record_id = ?').get(r1.id).n, 0);
    // حذف تصمیم‌گیرنده: ردیف می‌ماند و decided_by = NULL
    usersRepo.deleteUserPermanently(manager.id);
    assert.deepEqual(db.prepare('SELECT status, decided_by FROM overtime_approvals WHERE attendance_record_id = ?').get(r2.id), { status: 'rejected', decided_by: null });
    // حذف دائمی کارمند همه‌ی تصمیم‌هایش را می‌برد
    usersRepo.deleteUserPermanently(emp.id);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM overtime_approvals').get().n, 0);
  });

  test('محاسبه‌ی ماهانه: معلق و ردشده خارج از payable، سقف فقط روی تأییدشده‌ها؛ خاموش ⇒ رفتار S3-5b', () => {
    // خالص: وضعیت و قابل‌پرداخت
    assert.deepEqual([[false, 40, undefined], [true, 40, undefined], [true, 0, undefined], [true, 40, { status: 'approved' }], [true, 40, { status: 'rejected' }]]
      .map(([req, p, d]) => dayService.approvalStatusOf(req, p, d)), ['not_required', 'pending', 'none', 'approved', 'rejected']);
    assert.deepEqual(['not_required', 'none', 'approved', 'pending', 'rejected'].map((s) => dayService.eligiblePayable(40, s)), [40, 40, 40, 0, 0]);

    const emp = makeUser({ role: 'employee' });
    const d1 = mkRecord(emp, '2026-08-01', 40); // تأییدشده
    const d2 = mkRecord(emp, '2026-08-02', 50); // معلق
    const d3 = mkRecord(emp, '2026-08-03', 30); // ردشده
    const d4 = mkRecord(emp, '2026-08-04', 20); // تأییدشده
    const d5 = mkRecord(emp, '2026-08-05', 0); // اضافه‌کاری ندارد
    const all = [d5, d4, d3, d2, d1];
    const decide = (rec, status, reason) => approvalRepo.upsertDecision({ attendanceRecordId: rec.id, userId: emp.id, status, reason, decidedBy: emp.id });
    try {
      settingsRepo.update({ overtimeEnabled: true });
      // تأیید لازم نیست (پیش‌فرض) ⇒ همه payable
      let m = dayService.computeMonthOvertime(all);
      assert.equal(m.requiresApproval, false);
      assert.deepEqual([m.totalPayableDaily, m.totalEligible, m.totalPayable, m.pendingMinutes], [140, 140, 140, 0]);
      assert.ok(m.days.every((d) => d.approvalStatus === 'not_required'));

      settingsRepo.update({ overtimeRequiresApproval: true });
      decide(d1, 'approved'); decide(d3, 'rejected', 'بدون هماهنگی'); decide(d4, 'approved');
      m = dayService.computeMonthOvertime(all);
      assert.equal(m.requiresApproval, true);
      assert.deepEqual(m.days.map((d) => [d.recordDate, d.approvalStatus, d.overtimePayableDaily, d.overtimePayableEligible, d.overtimePayable]), [
        ['2026-08-01', 'approved', 40, 40, 40], ['2026-08-02', 'pending', 50, 0, 0], ['2026-08-03', 'rejected', 30, 0, 0],
        ['2026-08-04', 'approved', 20, 20, 20], ['2026-08-05', 'none', 0, 0, 0],
      ]);
      assert.deepEqual([m.totalOvertime, m.totalPayableDaily, m.pendingMinutes, m.rejectedMinutes, m.totalEligible, m.totalPayable, m.clippedMinutes], [140, 140, 50, 30, 60, 60, 0]);

      // سقف فقط روی تأییدشده‌ها: سقف ۵۰ ⇒ ۴۰ + ۱۰ (معلق/ردشده سقف را مصرف نمی‌کنند)
      m = dayService.computeMonthOvertime(all, { capMinutes: 50 });
      assert.deepEqual([m.totalEligible, m.totalPayable, m.clippedMinutes], [60, 50, 10]);
      // تأییدِ روز معلق ⇒ وارد payable می‌شود (و سقف ۱۰۰ پس از آن می‌برد)
      decide(d2, 'approved');
      m = dayService.computeMonthOvertime(all, { capMinutes: 100 });
      assert.deepEqual(m.days.map((d) => d.overtimePayable), [40, 50, 0, 10, 0]);
      assert.deepEqual([m.totalEligible, m.totalPayable, m.clippedMinutes], [110, 100, 10]);
      // برگشت تصمیم به رد ⇒ دوباره خارج می‌شود
      decide(d2, 'rejected', 'اشتباه ثبت شده');
      assert.equal(dayService.computeMonthOvertime(all).totalEligible, 60);
    } finally { resetOvertime(); }
  });

  describe('API', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
    let server, base, cookies, ids;
    before(async () => {
      const { createApp } = require('../src/server');
      const admin = makeUser({ role: 'admin' });
      const manager = makeUser({ role: 'manager' });
      const manager2 = makeUser({ role: 'manager' });
      const employee = makeUser({ role: 'employee', managerId: manager.id });
      const outsider = makeUser({ role: 'employee', managerId: manager2.id });
      ids = { admin: admin.id, manager: manager.id, employee: employee.id, outsider: outsider.id };
      cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(manager.id), manager2: sessionCookie(manager2.id), employee: sessionCookie(employee.id) };
      server = createApp().listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { if (server) server.close(); resetOvertime(); });

    async function hit(role, method, url, body, { csrf = true } = {}) {
      const headers = { 'content-type': 'application/json' };
      if (csrf) headers['x-requested-with'] = 'AttendancePanel';
      if (cookies[role]) headers.cookie = cookies[role];
      const res = await fetch(base + url, { method, headers, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
      let json = null;
      try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
      return { status: res.status, json };
    }
    const auditRows = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action);
    const url = (id, action) => `/api/admin/overtime-approvals/${id}/${action}`;

    test('تأیید/رد: دلیل رد اجباری، audit، تغییر تصمیم و خطاها (۴۰۳/۴۰۹/۴۰۴)', async () => {
      const rec = mkRecord({ id: ids.employee }, '2026-09-01', 45);
      const none = mkRecord({ id: ids.employee }, '2026-09-02', 0);
      try {
        // تنظیم خاموش ⇒ ۴۰۹ (حتی با دسترسی درست)
        assert.equal((await hit('manager', 'POST', url(rec.id, 'approve'), {})).status, 409);
        settingsRepo.update({ overtimeEnabled: true, overtimeRequiresApproval: true });

        // دسترسی: کارمند ۴۰۳، سرپرست تیم دیگر ۴۰۳، بدون هدر CSRF ۴۰۳، شناسه‌ی بد ۴۰۰، ناموجود ۴۰۴
        assert.equal((await hit('employee', 'POST', url(rec.id, 'approve'), {})).status, 403);
        assert.equal((await hit('manager2', 'POST', url(rec.id, 'approve'), {})).status, 403);
        assert.equal((await hit('manager', 'POST', url(rec.id, 'approve'), {}, { csrf: false })).status, 403);
        assert.equal((await hit('manager', 'POST', url('abc', 'approve'), {})).status, 400);
        assert.equal((await hit('manager', 'POST', url(99999, 'approve'), {})).status, 404);
        // رکوردِ بدون اضافه‌کاری ⇒ ۴۰۹
        assert.equal((await hit('manager', 'POST', url(none.id, 'approve'), {})).status, 409);
        // هیچ‌کس اضافه‌کاری خودش را تأیید نمی‌کند (ادمین روی رکورد خودش)
        const own = mkRecord({ id: ids.admin }, '2026-09-05', 45);
        assert.equal((await hit('admin', 'POST', url(own.id, 'approve'), {})).status, 403);

        // رد بدون دلیل ⇒ ۴۰۰ و هیچ ردیفی ساخته نمی‌شود
        for (const body of [{}, { reason: '   ' }]) assert.equal((await hit('manager', 'POST', url(rec.id, 'reject'), body)).status, 400);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM overtime_approvals WHERE attendance_record_id = ?').get(rec.id).n, 0);
        assert.equal(auditRows('overtime_rejected').length, 0);

        // رد با دلیل ⇒ ۲۰۰ + audit
        let r = await hit('manager', 'POST', url(rec.id, 'reject'), { reason: 'هماهنگ نشده بود' });
        assert.equal(r.status, 200);
        assert.deepEqual([r.json.recordId, r.json.status, r.json.reason, r.json.decidedBy.id], [rec.id, 'rejected', 'هماهنگ نشده بود', ids.manager]);
        let a = auditRows('overtime_rejected');
        assert.equal(a.length, 1);
        assert.equal(a[0].user_id, ids.manager);
        assert.deepEqual(
          (({ recordId, targetUserId, payableMinutes, previousStatus, reason }) => ({ recordId, targetUserId, payableMinutes, previousStatus, reason }))(JSON.parse(a[0].details)),
          { recordId: rec.id, targetUserId: ids.employee, payableMinutes: 45, previousStatus: 'pending', reason: 'هماهنگ نشده بود' },
        );
        // تکرار همان تصمیم ⇒ ۴۰۹؛ تغییر به تأیید (دلیل اختیاری) ⇒ ۲۰۰ با previousStatus
        assert.equal((await hit('manager', 'POST', url(rec.id, 'reject'), { reason: 'باز هم' })).status, 409);
        r = await hit('admin', 'POST', url(rec.id, 'approve'), {});
        assert.equal(r.status, 200);
        assert.deepEqual([r.json.status, r.json.reason, r.json.decidedBy.id], ['approved', null, ids.admin]);
        a = auditRows('overtime_approved');
        assert.equal(a.length, 1);
        assert.equal(JSON.parse(a[0].details).previousStatus, 'rejected');
        assert.equal(db.prepare('SELECT COUNT(*) n FROM overtime_approvals WHERE attendance_record_id = ?').get(rec.id).n, 1);
        // تأثیر روی محاسبه: تأییدشده ⇒ در payable ماهانه
        assert.equal(dayService.computeMonthOvertime([attendanceRepo.findById(rec.id)]).totalPayable, 45);
      } finally { resetOvertime(); }
    });

    test('فهرست: معلق/تأییدشده/ردشده، فیلتر وضعیت، اسکوپ سرپرست، اعتبارسنجی و ممنوعیت کارمند', async () => {
      const emp = { id: ids.employee };
      const outsider = { id: ids.outsider };
      const a = mkRecord(emp, '2026-10-04', 40);
      const b = mkRecord(emp, '2026-10-05', 30);
      const c = mkRecord(outsider, '2026-10-04', 20);
      mkRecord(emp, '2026-10-03', 0); // اضافه‌کاری ندارد ⇒ در فهرست نمی‌آید
      const q = '?from=2026-10-01&to=2026-10-31';
      try {
        settingsRepo.update({ overtimeEnabled: true, overtimeRequiresApproval: true });
        approvalRepo.upsertDecision({ attendanceRecordId: a.id, userId: ids.employee, status: 'approved', decidedBy: ids.manager });

        let r = await hit('admin', 'GET', `/api/admin/overtime-approvals${q}`);
        assert.equal(r.status, 200);
        assert.equal(r.json.requiresApproval, true);
        assert.deepEqual(r.json.items.map((i) => [i.recordId, i.status, i.overtimePayable]).sort((x, y) => x[0] - y[0]),
          [[a.id, 'approved', 40], [b.id, 'pending', 30], [c.id, 'pending', 20]]);
        assert.equal(r.json.items.find((i) => i.recordId === a.id).decision.decidedBy.id, ids.manager);
        // فیلتر وضعیت
        r = await hit('admin', 'GET', `/api/admin/overtime-approvals${q}&status=pending`);
        assert.deepEqual(r.json.items.map((i) => i.recordId).sort((x, y) => x - y), [b.id, c.id].sort((x, y) => x - y));
        // اسکوپ سرپرست: فقط تیم خودش
        r = await hit('manager', 'GET', `/api/admin/overtime-approvals${q}`);
        assert.deepEqual(r.json.items.map((i) => i.recordId).sort((x, y) => x - y), [a.id, b.id].sort((x, y) => x - y));
        // اعتبارسنجی و دسترسی
        assert.equal((await hit('admin', 'GET', `/api/admin/overtime-approvals${q}&status=done`)).status, 400);
        assert.equal((await hit('admin', 'GET', '/api/admin/overtime-approvals?from=01-10-2026')).status, 400);
        assert.equal((await hit('employee', 'GET', `/api/admin/overtime-approvals${q}`)).status, 403);
        // تنظیم خاموش ⇒ وضعیت not_required
        settingsRepo.update({ overtimeRequiresApproval: false });
        r = await hit('admin', 'GET', `/api/admin/overtime-approvals${q}&status=pending`);
        assert.deepEqual([r.json.requiresApproval, r.json.items.length], [false, 0]);
      } finally { resetOvertime(); }
    });
  });
});
