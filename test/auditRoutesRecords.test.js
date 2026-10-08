// S4-1c: routeهای رکورد تردد، استراحت، مرخصی و اعتراض با auditRepository.logChange ثبت می‌شوند (تعطیلات: holidaysApi/holidaysImport).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('audit با قالب logChange — تردد/استراحت/مرخصی/اعتراض (S4-1c)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, admin, emp, cookie, F;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const { createApp } = require('../src/server');
    admin = F.makeUser({ role: 'admin' });
    emp = F.makeUser({ role: 'employee' });
    cookie = F.sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(method, url, body) {
    const res = await fetch(base + url, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const last = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1').get(action);
  const d = (row) => JSON.parse(row.details);

  test('رکورد تردد: ایجاد/ویرایش/حذف با قبل/بعد دقیق؛ فقط فیلد تغییرکرده؛ تاریخچه‌ی رکورد با recordId هنوز پیدا می‌شود', async () => {
    const date = F.workdayDate(1);
    const c = await hit('POST', '/api/admin/attendance-records', {
      userId: emp.id, date, checkInTime: `${date}T04:30:00.000Z`, checkOutTime: `${date}T13:00:00.000Z`, status: 'normal', reason: 'فراموشی ثبت',
    });
    assert.equal(c.status, 201);
    const id = c.json.id;
    let det = d(last('attendance_record_manually_created'));
    assert.equal(det.entityType, 'attendance_record');
    assert.equal(det.entityId, id);
    assert.equal(det.targetUserId, emp.id);
    assert.deepEqual(det.changes.status, { before: null, after: 'normal' });
    assert.equal(det.changes.record_date.after, date);
    assert.equal(det.reason, 'فراموشی ثبت');
    assert.equal(last('attendance_record_manually_created').user_id, admin.id);

    // ویرایش: فقط ساعت خروج و وضعیت تغییر می‌کند؛ ورود دست‌نخورده ⇒ در changes نیست
    const newOut = `${date}T12:15:00.000Z`;
    const e = await hit('PATCH', `/api/admin/attendance-records/${id}`, { checkInTime: `${date}T04:30:00.000Z`, checkOutTime: newOut, status: 'late', reason: 'اصلاح ساعت خروج' });
    assert.equal(e.status, 200);
    det = d(last('attendance_record_manually_fixed'));
    assert.deepEqual(det.changes, {
      check_out_time: { before: `${date}T13:00:00.000Z`, after: newOut },
      status: { before: 'normal', after: 'late' },
    });
    assert.equal(det.recordId, id);
    assert.equal(det.targetUserId, emp.id);
    assert.deepEqual(det.fields, ['check_in_time', 'check_out_time', 'status']);
    assert.equal(det.reason, 'اصلاح ساعت خروج');
    assert.equal(det.source, 'admin_panel');

    // تاریخچه‌ی جزئیات رکورد (جستجو با "recordId":N) هر دو رویداد را می‌بیند
    const detail = await hit('GET', `/api/admin/attendance-records/${id}`);
    assert.equal(detail.status, 200);
    const actions = detail.json.history.map((h) => h.action);
    assert.ok(actions.includes('attendance_record_manually_fixed') && actions.includes('attendance_record_manually_created'));

    const del = await hit('DELETE', `/api/admin/attendance-records/${id}?reason=${encodeURIComponent('تکراری')}`);
    assert.equal(del.status, 200);
    det = d(last('attendance_record_deleted'));
    assert.deepEqual(det.changes.status, { before: 'late', after: null });
    assert.deepEqual(det.changes.check_out_time, { before: newOut, after: null });
    assert.equal(det.reason, 'تکراری');
  });

  test('استراحت: ایجاد/ویرایش/حذف با قبل/بعد و recordId/breakId/targetUserId', async () => {
    const date = F.workdayDate(2);
    const rec = (await hit('POST', '/api/admin/attendance-records', { userId: emp.id, date, checkInTime: `${date}T04:30:00.000Z`, reason: 'x' })).json;
    const b = await hit('POST', `/api/admin/attendance-records/${rec.id}/breaks`, { breakType: 'lunch', startTime: `${date}T08:00:00.000Z`, endTime: `${date}T08:30:00.000Z`, reason: 'ناهار' });
    assert.equal(b.status, 201);
    let det = d(last('break_record_manually_created'));
    assert.deepEqual(det.changes.break_type, { before: null, after: 'lunch' });
    assert.equal(det.recordId, rec.id);
    assert.equal(det.breakId, b.json.id);
    assert.equal(det.targetUserId, emp.id);

    const e = await hit('PATCH', `/api/admin/break-records/${b.json.id}`, { endTime: `${date}T08:45:00.000Z`, reason: 'اصلاح پایان' });
    assert.equal(e.status, 200);
    det = d(last('break_record_manually_edited'));
    assert.deepEqual(det.changes, { end_time: { before: `${date}T08:30:00.000Z`, after: `${date}T08:45:00.000Z` } });
    assert.deepEqual(det.fields, ['end_time']);

    const del = await hit('DELETE', `/api/admin/break-records/${b.json.id}?reason=${encodeURIComponent('اشتباه')}`);
    assert.equal(del.status, 200);
    det = d(last('break_record_deleted'));
    assert.deepEqual(det.changes.break_type, { before: 'lunch', after: null });
    assert.equal(det.reason, 'اشتباه');
  });

  test('مرخصی: تصمیم (یادداشت ⇒ دلیل)، ایجاد/ویرایش/حذف ادمین با قبل/بعد وضعیت و تاریخ', async () => {
    const lr = require('../src/repositories/leaveRepository');
    const pending = lr.createLeaveRequest({ userId: emp.id, startDate: '2026-09-01', endDate: '2026-09-02', leaveType: 'leave', reason: 'سفر' });
    const ap = await hit('POST', `/api/admin/leave-requests/${pending.id}/approve`, { note: 'موافقم' });
    assert.equal(ap.status, 200);
    let det = d(last('leave_request_approved'));
    assert.deepEqual(det.changes, { status: { before: 'pending', after: 'approved' } });
    assert.equal(det.reason, 'موافقم');
    assert.equal(det.requestId, pending.id);
    assert.equal(det.targetUserId, emp.id);

    const c = await hit('POST', '/api/admin/leave-requests', { userId: emp.id, startDate: '2026-10-10', endDate: '2026-10-11', leaveType: 'mission', reason: 'نمایشگاه', status: 'approved' });
    assert.equal(c.status, 201);
    det = d(last('leave_request_created_by_admin'));
    assert.deepEqual(det.changes.status, { before: null, after: 'approved' });
    assert.deepEqual(det.changes.leave_type, { before: null, after: 'mission' });

    const e = await hit('PATCH', `/api/admin/leave-requests/${c.json.id}`, { endDate: '2026-10-12', status: 'rejected' });
    assert.equal(e.status, 200);
    det = d(last('leave_request_edited_by_admin'));
    assert.deepEqual(det.changes, {
      end_date: { before: '2026-10-11', after: '2026-10-12' },
      status: { before: 'approved', after: 'rejected' },
      duration_minutes: { before: 1020, after: 1530 }, // S4-10d: مدت با تغییر تاریخ دوباره محاسبه می‌شود (۳ روز کاری)
    });
    assert.deepEqual(det.fields, ['status', 'end_date']);

    const del = await hit('DELETE', `/api/admin/leave-requests/${c.json.id}`);
    assert.equal(del.status, 200);
    det = d(last('leave_request_deleted_by_admin'));
    assert.deepEqual(det.changes.start_date, { before: '2026-10-10', after: null });
    assert.equal(det.entityId, c.json.id);
  });

  test('اعتراض: بستن/بازگشایی با قبل/بعد وضعیت و یادداشت به‌عنوان دلیل', async () => {
    const dr = require('../src/repositories/disputeRepository');
    const dis = dr.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'ساعت خروج اشتباه است' });
    const r1 = await hit('POST', `/api/admin/disputes/${dis.id}/resolve`, { note: 'اصلاح شد' });
    assert.equal(r1.status, 200);
    let det = d(last('dispute_resolved'));
    assert.deepEqual(det.changes, { status: { before: 'open', after: 'resolved' } });
    assert.equal(det.reason, 'اصلاح شد');
    assert.equal(det.disputeId, dis.id);
    assert.equal(det.targetUserId, emp.id);

    const r2 = await hit('POST', `/api/admin/disputes/${dis.id}/reopen`, {});
    assert.equal(r2.status, 200);
    det = d(last('dispute_reopened'));
    assert.deepEqual(det.changes, { status: { before: 'resolved', after: 'open' } });
    assert.equal(det.reason, undefined, 'بدون یادداشت ⇒ بدون دلیل');
  });
});
