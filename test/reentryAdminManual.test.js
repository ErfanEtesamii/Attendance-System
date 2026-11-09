// اصلاح دستی نوبت‌ها: افزودن نوبت دوم به رکوردی که یک‌بار خروج خورده + ویرایش ساعت‌های نوبت.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('اصلاح دستی: نوبت دوم و ویرایش نوبت‌ها', () => {
  let db; let server; let base; let F; let repo; let cookies; let employee;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/attendanceRepository');
    const admin = F.makeUser({ role: 'admin' });
    const manager = F.makeUser({ role: 'manager' });
    employee = F.makeUser();
    cookies = { admin: F.sessionCookie(admin.id), manager: F.sessionCookie(manager.id) };
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  async function hit(role, method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: cookies[role] },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  const mk = (date) => repo.createManual({ userId: employee.id, recordDate: date, checkInTime: `${date}T04:30:00.000Z`, checkOutTime: `${date}T08:30:00.000Z`, status: 'normal' });

  test('نوبت دوم روی رکوردِ خروج‌خورده (مدل قدیمی بدون segment) ساخته می‌شود و رکورد والد همگام می‌ماند', async () => {
    const rec = mk('2026-10-10');
    const url = `/api/admin/attendance-records/${rec.id}/segments`;
    assert.equal((await hit('admin', 'POST', url, { checkInTime: '2026-10-10T10:00:00.000Z' })).status, 400); // بدون دلیل
    assert.equal((await hit('manager', 'POST', url, { checkInTime: '2026-10-10T10:00:00.000Z', reason: 'x' })).status, 403);
    assert.equal((await hit('admin', 'POST', url, { checkInTime: '2026-10-10T07:00:00.000Z', reason: 'هم‌پوشان' })).status, 409);
    const r = await hit('admin', 'POST', url, { checkInTime: '2026-10-10T10:00:00.000Z', checkOutTime: '2026-10-10T13:00:00.000Z', reason: 'فراموشی ثبت' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.deepEqual(r.json.segments.map((s) => s.seq), [1, 2]);
    const parent = repo.findById(rec.id);
    assert.equal(parent.check_in_time, '2026-10-10T04:30:00.000Z');
    assert.equal(parent.check_out_time, '2026-10-10T13:00:00.000Z');
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'attendance_segment_manually_created'").get());
  });

  test('نوبت دوم باز (بدون خروج) هم ممکن است و تا خروجِ نوبت قبلی نوبت سوم رد می‌شود', async () => {
    const rec = mk('2026-10-11');
    const url = `/api/admin/attendance-records/${rec.id}/segments`;
    assert.equal((await hit('admin', 'POST', url, { checkInTime: '2026-10-11T10:00:00.000Z', reason: 'باز' })).status, 201);
    assert.equal(repo.findById(rec.id).check_out_time, null);
    const again = await hit('admin', 'POST', url, { checkInTime: '2026-10-11T12:00:00.000Z', reason: 'سوم' });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'OPEN_SEGMENT');
  });

  test('ویرایش ساعت نوبت‌ها: اعتبارسنجی هم‌پوشانی و همگام‌سازی والد', async () => {
    const rec = mk('2026-10-12');
    await hit('admin', 'POST', `/api/admin/attendance-records/${rec.id}/segments`, { checkInTime: '2026-10-12T10:00:00.000Z', checkOutTime: '2026-10-12T12:00:00.000Z', reason: 'ایجاد' });
    const p = (seq, body) => hit('admin', 'PATCH', `/api/admin/attendance-records/${rec.id}/segments/${seq}`, { reason: 'اصلاح', ...body });
    assert.equal((await p(2, { checkInTime: '2026-10-12T08:00:00.000Z' })).status, 409); // قبل از خروج نوبت ۱
    assert.equal((await p(1, { checkOutTime: '2026-10-12T10:30:00.000Z' })).status, 409); // بعد از ورود نوبت ۲
    assert.equal((await p(2, { checkOutTime: '2026-10-12T09:00:00.000Z' })).status, 409); // خروج قبل از ورود
    assert.equal((await p(9, { checkInTime: '2026-10-12T10:00:00.000Z' })).status, 404);
    assert.equal((await p(2, {})).status, 400);
    const ok = await p(2, { checkOutTime: '2026-10-12T14:00:00.000Z' });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(repo.findById(rec.id).check_out_time, '2026-10-12T14:00:00.000Z');
    const first = await p(1, { checkInTime: '2026-10-12T04:00:00.000Z' });
    assert.equal(first.status, 200);
    assert.equal(repo.findById(rec.id).check_in_time, '2026-10-12T04:00:00.000Z');
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'attendance_segment_manually_edited'").get());
  });

  test('ویرایش نوبت ۱ در رکورد تک‌نوبتی (مدل قدیمی) روی خود رکورد اعمال می‌شود', async () => {
    const rec = mk('2026-10-13');
    const r = await hit('admin', 'PATCH', `/api/admin/attendance-records/${rec.id}/segments/1`, { checkOutTime: '2026-10-13T09:00:00.000Z', reason: 'تصحیح' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(repo.findById(rec.id).check_out_time, '2026-10-13T09:00:00.000Z');
  });
});
