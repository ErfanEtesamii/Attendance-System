// S3-11c: ستون «تاریخ شمسی» کنار تاریخ میلادی در CSVهای تردد و audit؛ امضای routeها و ستون‌های دیگر بدون تغییر.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const J = require('../src/utils/jalali');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('کمک‌تابع‌های تاریخ شمسی سرور (S3-11c)', () => {
  test('isoDateToJalaliString: مرز کبیسه، نامعتبر و خالی', () => {
    assert.equal(J.isoDateToJalaliString('2025-03-20'), '1403/12/30');
    assert.equal(J.isoDateToJalaliString('2025-03-21'), '1404/01/01');
    assert.equal(J.isoDateToJalaliString('2026-10-07'), '1405/07/15');
    assert.equal(J.isoDateToJalaliString('2026-10-07 10:00:00'), '1405/07/15');
    for (const bad of ['', null, undefined, 'x', '2026-02-31', '2026-13-01']) assert.equal(J.isoDateToJalaliString(bad), '', String(bad));
  });

  test('instantToJalaliString: روز شمسیِ لحظه‌ی UTC به وقت شرکت (نه UTC)', () => {
    assert.equal(J.instantToJalaliString('2025-03-20 20:00:00', 'Asia/Tehran'), '1403/12/30', '23:30 تهران');
    assert.equal(J.instantToJalaliString('2025-03-20 21:00:00', 'Asia/Tehran'), '1404/01/01', '00:30 تهران');
    assert.equal(J.instantToJalaliString('2025-03-20T21:00:00.000Z', 'Asia/Tehran'), '1404/01/01');
    assert.equal(J.instantToJalaliString('2025-03-20 21:00:00', 'UTC'), '1403/12/30');
    assert.equal(J.instantToJalaliString('', 'Asia/Tehran'), '');
    assert.equal(J.instantToJalaliString('garbage', 'Asia/Tehran'), '');
  });
});

describe('CSVها با ستون شمسی (S3-11c)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, admin, user;
  const get = async (url) => {
    const res = await fetch(base + url, { headers: { 'x-requested-with': 'AttendancePanel', cookie: F.sessionCookie(admin.id) } });
    const text = await res.text();
    return { status: res.status, rows: text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(',')), text };
  };

  before(async () => {
    const db = resetDb();
    admin = F.makeUser({ role: 'admin' });
    user = F.makeUser({ name: 'کارمند شمسی' });
    const repo = require('../src/repositories/attendanceRepository');
    repo.createManual({ userId: user.id, recordDate: '2025-03-20', checkInTime: '2025-03-20T05:00:00.000Z', checkOutTime: '2025-03-20T13:00:00.000Z' });
    repo.createManual({ userId: user.id, recordDate: '2025-03-21', checkInTime: '2025-03-21T05:00:00.000Z', checkOutTime: '2025-03-21T13:00:00.000Z' });
    db.exec('DELETE FROM audit_log');
    db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)').run(user.id, 'late_night', '2025-03-20 20:00:00', 'a');
    db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)').run(user.id, 'after_midnight', '2025-03-20 21:00:00', 'b');
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  test('تردد: «تاریخ شمسی» دقیقاً بعد از «تاریخ»؛ بقیه‌ی ستون‌ها سر جای قبلی (ورود/خروج، وضعیت آخر)', async () => {
    const r = await get('/api/admin/attendance/export?from=2025-03-01&to=2025-04-01');
    assert.equal(r.status, 200);
    const head = r.rows[0];
    assert.deepEqual(head.slice(0, 6), ['نام', 'کد پرسنلی', 'دپارتمان', 'تاریخ', 'تاریخ شمسی', 'ورود']);
    assert.equal(head[head.length - 1], 'وضعیت');
    assert.equal(head.length, 15);
    const byDate = Object.fromEntries(r.rows.slice(1).map((c) => [c[3], c]));
    assert.equal(byDate['2025-03-20'][4], '1403/12/30');
    assert.equal(byDate['2025-03-21'][4], '1404/01/01');
    // (سلول‌های ورود/خروج کاما دارند و در پارس ساده‌ی تست شکسته می‌شوند؛ فقط ستون‌های قبل از آن‌ها بررسی می‌شود)
  });

  test('audit: «تاریخ شمسی» بعد از «زمان» با روز وقت شرکت؛ با include_archive ستون «منبع» آخر می‌ماند', async () => {
    const r = await get('/api/admin/audit-log/export');
    assert.equal(r.status, 200);
    assert.deepEqual(r.rows[0], ['ردیف', 'زمان', 'تاریخ شمسی', 'کارمند', 'عملیات', 'IP', 'جزئیات']);
    const by = Object.fromEntries(r.rows.slice(1).map((c) => [c[4], c]));
    assert.equal(by.late_night[2], '1403/12/30');
    assert.equal(by.after_midnight[2], '1404/01/01', '۰۰:۳۰ تهران = روز بعد');
    const arch = await get('/api/admin/audit-log/export?include_archive=1');
    assert.equal(arch.rows[0][arch.rows[0].length - 1], 'منبع');
    assert.equal(arch.rows[0][2], 'تاریخ شمسی');
  });

  test('بقیه‌ی CSVها (کارمندان، خلاصه‌ی گزارش) تاریخی ندارند ⇒ قالبشان بدون تغییر', async () => {
    const u = await get('/api/admin/users/export');
    assert.deepEqual(u.rows[0], ['نام کارمند', 'کد پرسنلی', 'دپارتمان', 'نقش', 'آیدی تلگرام', 'وضعیت']);
    const rep = await get('/api/admin/reports/export?from=2025-03-01&to=2025-04-01');
    assert.equal(rep.status, 200);
    assert.ok(!rep.rows[0].includes('تاریخ شمسی'));
  });
});
