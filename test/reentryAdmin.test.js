// فاز ۱۸ / U3 و U7: قرارداد repository و API مدیریت نوبت‌های ورود مجدد.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('مدیریت نوبت‌های ورود مجدد', () => {
  let db; let server; let base; let F; let repo; let record; let cookies;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/attendanceRepository');
    const admin = F.makeUser({ role: 'admin' });
    const manager = F.makeUser({ role: 'manager' });
    const employee = F.makeUser();
    record = repo.createManual({
      userId: employee.id,
      recordDate: '2026-10-01',
      checkInTime: '2026-10-01T04:30:00.000Z',
      checkOutTime: '2026-10-01T08:30:00.000Z',
      status: 'normal',
    });
    repo.startReEntry(record.id, '10.0.0.1', 2);
    repo.closeLastSegment(record.id, '10.0.0.1');
    repo.startReEntry(record.id, '10.0.0.2', 2);
    repo.closeLastSegment(record.id, '10.0.0.2');
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

  test('migration جدول، ایندکس، یکتایی و حذف آبشاری را می‌سازد', () => {
    const columns = db.prepare("PRAGMA table_info('attendance_segments')").all().map((c) => c.name);
    assert.deepEqual(columns, ['id', 'attendance_record_id', 'seq', 'check_in_time', 'check_in_ip', 'check_out_time', 'check_out_ip', 'created_at']);
    assert.ok(db.prepare("PRAGMA index_list('attendance_segments')").all().some((i) => i.name === 'idx_attendance_segments_record'));
    assert.throws(() => db.prepare(`INSERT INTO attendance_segments
      (attendance_record_id, seq, check_in_time) VALUES (?, 1, ?)`)
      .run(record.id, '2026-10-01T04:31:00.000Z'), /UNIQUE/);
  });

  test('جزئیات سه نوبت را می‌دهد و حذف نامعتبر/بدون دلیل/خارج از اسکوپ را رد می‌کند', async () => {
    const details = await hit('admin', 'GET', `/api/admin/attendance-records/${record.id}`);
    assert.equal(details.status, 200);
    assert.deepEqual(details.json.segments.map((s) => s.seq), [1, 2, 3]);
    assert.equal(details.json.segmentCount, 3);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/attendance-records/${record.id}/segments/2`, {})).status, 400);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/attendance-records/${record.id}/segments/1`, { reason: 'نامعتبر' })).status, 400);
    assert.equal((await hit('manager', 'DELETE', `/api/admin/attendance-records/${record.id}/segments/2`, { reason: 'خارج از تیم' })).status, 403);
  });

  test('حذف نوبت میانی بازشماره‌گذاری و parent را همگام و audit را ثبت می‌کند', async () => {
    const before = repo.listSegments(record.id);
    const lastOut = before[2].check_out_time;
    const removedId = before[1].id;
    const response = await hit('admin', 'DELETE', `/api/admin/attendance-records/${record.id}/segments/2`, { reason: 'ثبت تکراری اپراتور' });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.deepEqual(response.json.segments.map((s) => s.seq), [1, 2]);
    assert.equal(repo.findById(record.id).check_out_time, lastOut);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'attendance_segment_deleted' ORDER BY id DESC LIMIT 1").get();
    assert.ok(audit);
    const details = JSON.parse(audit.details);
    assert.equal(details.reason, 'ثبت تکراری اپراتور');
    assert.equal(details.segmentId, removedId);
  });

  test('حذف آخرین ورود مجدد به مدل قدیمیِ بدون ردیف segment برمی‌گردد', async () => {
    const firstOut = repo.listSegments(record.id)[0].check_out_time;
    const response = await hit('admin', 'DELETE', `/api/admin/attendance-records/${record.id}/segments/2`, { reason: 'حذف آخرین نوبت اضافی' });
    assert.equal(response.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_segments WHERE attendance_record_id = ?').get(record.id).n, 0);
    assert.deepEqual(repo.listSegments(record.id).map((s) => s.seq), [1]);
    assert.equal(repo.findById(record.id).check_out_time, firstOut);
  });
});
