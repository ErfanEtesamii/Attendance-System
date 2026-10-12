// C1: ثبت/لیست/لغو ماموریت، بازه‌ی ثبت، تداخل، مسیر تأیید و قاعده‌ی خودتأییدی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./helpers/factories');
const missionService = require('../src/services/missionService');
const approval = require('../src/services/leaveApprovalService');
const leaveRepo = require('../src/repositories/leaveRepository');
const settingsRepo = require('../src/repositories/settingsRepository');
const notificationEvents = require('../src/services/notificationEvents');

const NOW = new Date('2026-08-02T08:00:00Z'); // یکشنبه ۱۱ مرداد ۱۴۰۵ (امروز = ۲۰۲۶-۰۸-۰۲)
const D = (n) => F.workdayDate(n); // ۲۰۲۶-۰۸-۰۱ شنبه، ۰۲ یکشنبه، ۰۳ دوشنبه ...

describe('ماموریت (C1)', () => {
  let db; let admin; let admin2; let mgr; let upper; let emp; let lone;
  const mk = (user, extra = {}) => missionService.create({ userId: user.id, startDate: D(3), reason: 'جلسه با مشتری', ...extra }, { now: NOW });
  const codes = (r) => r.errors.map((e) => e.code);

  before(() => {
    db = resetDb();
    admin = F.makeUser({ role: 'admin' });
    upper = F.makeUser({ role: 'manager' });
    mgr = F.makeUser({ role: 'manager', managerId: upper.id });
    emp = F.makeUser({ managerId: mgr.id });
    lone = F.makeUser(); // بدون سرپرست
  });
  after(cleanup);

  test('migration ۰۲۳: ستون‌های source و destination روی leave_requests', () => {
    const cols = db.prepare('PRAGMA table_info(leave_requests)').all().map((c) => c.name);
    assert.ok(cols.includes('source') && cols.includes('destination'));
  });

  test('ثبت موفق: pending، kind=mission، source و مقصد ذخیره، زنجیره‌ی تأیید ساخته می‌شود', () => {
    const r = mk(emp, { destination: '  شعبه  اهواز ', reason: '  بازدید   از پروژه ' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const q = leaveRepo.findById(r.request.id);
    assert.deepEqual([q.status, q.kind, q.source, q.destination, q.reason, q.unit], ['pending', 'mission', 'miniapp_button', 'شعبه اهواز', 'بازدید از پروژه', 'day']);
    assert.ok(q.current_step === 1 && approval.getChain(q.id).length >= 1);
  });

  test('واحدها: نیم‌روز و ساعتی برای ماموریت مجازند (محدودیت واحد نوع اعمال نمی‌شود)', () => {
    const half = mk(emp, { unit: 'half_day', halfDayPart: 'morning', startDate: D(4) });
    assert.equal(half.ok, true, JSON.stringify(half.errors));
    const hour = mk(emp, { unit: 'hour', startTime: '10:00', endTime: '12:30', startDate: D(5) });
    assert.equal(hour.ok, true, JSON.stringify(hour.errors));
    assert.equal(hour.request.duration_minutes, 150);
    assert.deepEqual(codes(mk(emp, { unit: 'week', startDate: D(6) })), ['INVALID_UNIT']);
  });

  test('علت: ۵ تا ۳۰۰ نویسه؛ مقصد ≤ ۱۰۰؛ کنترل‌کاراکتر و توکن پاک‌سازی می‌شود', () => {
    assert.deepEqual(codes(mk(emp, { reason: '' })), ['REASON_TOO_SHORT']);
    assert.deepEqual(codes(mk(emp, { reason: 'abcd' })), ['REASON_TOO_SHORT']);
    assert.deepEqual(codes(mk(emp, { reason: 'x'.repeat(301) })), ['REASON_TOO_LONG']);
    assert.deepEqual(codes(mk(emp, { destination: 'y'.repeat(101) })), ['DESTINATION_TOO_LONG']);
    const ok = mk(lone, { startDate: D(7), reason: 'x'.repeat(300) });
    assert.equal(ok.ok, true, JSON.stringify(ok.errors));
    const t = mk(lone, { startDate: D(8), reason: 'خط اول\u0000\nخط دوم 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef012' }); // secret-scan:allow (توکن ساختگی تست)
    assert.equal(t.ok, true);
    assert.doesNotMatch(leaveRepo.findById(t.request.id).reason, /[\u0000\n]|ABCDEFGH/);
  });

  test('بازه‌ی ثبت: گذشته تا missionBackdateDays و آینده تا missionAdvanceDays (تنظیم‌پذیر)', () => {
    assert.equal(mk(admin, { startDate: '2026-07-30' }).ok, true, 'دو روز قبل مجاز');
    assert.deepEqual(codes(mk(admin, { startDate: '2026-07-29' })), ['MISSION_PAST_TOO_FAR']);
    assert.deepEqual(codes(mk(admin, { startDate: '2026-09-05' })), ['MISSION_FUTURE_TOO_FAR']);
    settingsRepo.setValue('missionBackdateDays', 0);
    try { assert.deepEqual(codes(mk(admin, { startDate: '2026-08-01' })), ['MISSION_PAST_TOO_FAR']); } finally { settingsRepo.setValue('missionBackdateDays', 3); }
    settingsRepo.setValue('missionAdvanceDays', 40);
    try { assert.equal(mk(admin, { startDate: '2026-09-05' }).ok, true); } finally { settingsRepo.setValue('missionAdvanceDays', 30); }
  });

  test('تداخل با مرخصی/ماموریت دیگر ⇒ OVERLAP و ردیفی ساخته نمی‌شود', () => {
    const user = F.makeUser({ managerId: mgr.id });
    assert.equal(mk(user, { startDate: D(10) }).ok, true);
    const n = db.prepare('SELECT COUNT(*) c FROM leave_requests WHERE user_id = ?').get(user.id).c;
    assert.deepEqual(codes(mk(user, { startDate: D(10) })), ['OVERLAP']);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM leave_requests WHERE user_id = ?').get(user.id).c, n);
    leaveRepo.createLeaveRequest({ userId: user.id, startDate: D(11), endDate: D(11), leaveType: 'leave', reason: 'مرخصی' });
    assert.deepEqual(codes(mk(user, { startDate: D(11) })), ['OVERLAP']);
  });

  test('لیست من: فقط ماموریت‌های خودم با وضعیت و یادداشت سرپرست؛ لغو فقط pending و فقط مال خودم', async () => {
    const u = F.makeUser({ managerId: mgr.id });
    const other = F.makeUser({ managerId: mgr.id });
    const a = mk(u, { startDate: D(12) }).request;
    const b = mk(u, { startDate: D(13) }).request;
    leaveRepo.createLeaveRequest({ userId: u.id, startDate: D(14), endDate: D(14), leaveType: 'leave', reason: 'مرخصی' });
    approval.decide({ requestId: b.id, actor: mgr, decision: 'reject', note: 'زمان مناسب نیست' });
    const list = missionService.listForUser(u.id);
    assert.equal(list.length, 2);
    const byId = Object.fromEntries(list.map((m) => [m.id, m]));
    assert.deepEqual([byId[a.id].status, byId[a.id].managerNote], ['pending', null]);
    assert.deepEqual([byId[b.id].status, byId[b.id].managerNote], ['rejected', 'زمان مناسب نیست']);
    assert.equal((await missionService.cancel({ userId: other.id, requestId: a.id })).code, 'NOT_FOUND');
    assert.equal((await missionService.cancel({ userId: u.id, requestId: b.id })).code, 'ALREADY_DECIDED');
    assert.equal((await missionService.cancel({ userId: u.id, requestId: a.id })).ok, true);
    assert.equal(leaveRepo.findById(a.id), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM leave_approvals WHERE leave_request_id = ?').get(a.id).c, 0);
    assert.equal((await missionService.cancel({ userId: u.id, requestId: a.id })).code, 'NOT_FOUND');
  });

  test('مسیر تأیید: کارمند⇒مدیر مستقیم؛ سرپرست⇒مدیر بالادست؛ سرپرستِ بدون مدیر⇒ادمین', () => {
    const forEmp = mk(F.makeUser({ managerId: mgr.id }), { startDate: D(15) }).request;
    assert.equal(approval.awaitingRole(forEmp), 'manager');
    assert.equal(approval.decide({ requestId: forEmp.id, actor: upper, decision: 'approve' }).code, 'FORBIDDEN', 'مدیر بالادست مدیر مستقیم نیست');
    assert.equal(approval.decide({ requestId: forEmp.id, actor: mgr, decision: 'approve' }).finalStatus, 'approved');

    const forMgr = mk(mgr, { startDate: D(16) }).request;
    assert.equal(approval.decide({ requestId: forMgr.id, actor: mgr, decision: 'approve' }).code, 'SELF_APPROVAL');
    assert.equal(approval.decide({ requestId: forMgr.id, actor: upper, decision: 'approve' }).finalStatus, 'approved');

    const forUpper = mk(upper, { startDate: D(17) }).request;
    assert.equal(approval.awaitingRole(forUpper), 'admin');
    assert.equal(approval.decide({ requestId: forUpper.id, actor: mgr, decision: 'approve' }).code, 'FORBIDDEN');
    assert.equal(approval.decide({ requestId: forUpper.id, actor: admin, decision: 'approve' }).finalStatus, 'approved');
  });

  test('ادمین: با وجود ادمین دیگر خودتأییدی ممنوع؛ ادمین دیگر تأیید می‌کند', () => {
    admin2 = F.makeUser({ role: 'admin' });
    const r = mk(admin, { startDate: D(18) }).request;
    assert.equal(approval.decide({ requestId: r.id, actor: admin, decision: 'approve' }).code, 'SELF_APPROVAL');
    assert.equal(approval.decide({ requestId: r.id, actor: admin2, decision: 'approve' }).finalStatus, 'approved');
    // مرخصی (نه ماموریت) رفتار قبلی را دارد
    const leave = leaveRepo.createLeaveRequest({ userId: admin.id, startDate: D(19), endDate: D(19), leaveType: 'leave', reason: 'x' });
    assert.notEqual(approval.decide({ requestId: leave.id, actor: admin, decision: 'approve' }).code, 'SELF_APPROVAL');
  });

  test('تنها ادمین فعال: خودتأییدی مجاز با audit ویژه', () => {
    db.prepare("UPDATE users SET is_active = 0 WHERE id = ?").run(admin2.id);
    const r = mk(admin, { startDate: D(20) }).request;
    const out = approval.decide({ requestId: r.id, actor: admin, decision: 'approve' });
    assert.equal(out.ok, true);
    assert.equal(out.finalStatus, 'approved');
    const row = db.prepare("SELECT * FROM audit_log WHERE action = 'mission_self_decided'").get();
    assert.equal(row.user_id, admin.id);
    assert.equal(JSON.parse(row.details).reason, 'sole_active_admin');
    db.prepare("UPDATE users SET is_active = 1 WHERE id = ?").run(admin2.id);
  });

  test('اعلان leaveRequested برای تأییدکننده‌ی درست (مدیر مستقیم / ادمینِ غیر از خود)', async () => {
    const r = mk(F.makeUser({ managerId: mgr.id }), { startDate: D(21) }).request;
    const n = await notificationEvents.leaveRequested(r);
    assert.deepEqual(n.map((x) => x.notification.user_id), [mgr.id]);
    const ra = mk(admin, { startDate: D(22) }).request;
    const na = await notificationEvents.leaveRequested(ra);
    assert.deepEqual(na.map((x) => x.notification.user_id), [admin2.id]);
  });

  test('پیوست اختیاری: ذخیره، جایگزینی (فایل قبلی پاک) و پاک‌شدن با لغو', async () => {
    const { Readable } = require('node:stream');
    const fs = require('node:fs');
    const path = require('node:path');
    const config = require('../src/config');
    const attachmentService = require('../src/services/attachmentService');
    config.attachmentsDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'att-'));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const u = F.makeUser({ managerId: mgr.id });
    const m = mk(u, { startDate: D(23) }).request;
    const save = () => attachmentService.saveStream(Readable.from([png]), { mime: 'image/png', size: png.length, originalName: 'x.png' });
    const a = await save();
    assert.equal(a.ok, true, JSON.stringify(a));
    leaveRepo.setAttachment(m.id, a.attachment);
    assert.equal(missionService.listForUser(u.id).find((x) => x.id === m.id).hasAttachment, true);
    const b = await save();
    const old = leaveRepo.findById(m.id).attachment_id;
    leaveRepo.setAttachment(m.id, b.attachment);
    await attachmentService.remove(old);
    assert.ok(!fs.existsSync(path.join(config.attachmentsDir, old)));
    assert.ok(fs.existsSync(path.join(config.attachmentsDir, b.attachment.id)));
    assert.equal((await missionService.cancel({ userId: u.id, requestId: m.id })).ok, true);
    assert.ok(!fs.existsSync(path.join(config.attachmentsDir, b.attachment.id)));
    fs.rmSync(config.attachmentsDir, { recursive: true, force: true });
  });
});
