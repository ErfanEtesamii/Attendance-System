// D2 (فاز ۱۲): اعمال گیتِ سقف تأخیر ماهانه روی POST /miniapp/check-in + endpointهای اجازه‌ی ورود.
// تنها مسیر ساخت ورود برای کارمند همین route است (بات فقط Mini App را باز می‌کند)؛ اصلاح دستی ادمین (fixRecord/createManual) و ماموریتِ در انتظار گیت نمی‌خورند.
// handlerها مستقیم از router.stack صدا زده می‌شوند (بدون HTTP)، «الان» با mock.timers ثابت است (شنبه ۲۰۲۶-۱۲-۱۲، آذر ۱۴۰۵).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

let router = null;
try { require('express'); router = require('../src/api/routes/miniapp'); } catch (_) { /* express نصب نیست ⇒ skip */ }

const settings = require('../src/repositories/settingsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const lateLimit = require('../src/services/lateLimitService');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const TZ = 'Asia/Tehran';
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, TZ);
const TODAY = '2026-12-12'; // شنبه (روز کاری)
const WORK = ['2026-12-01', '2026-12-02', '2026-12-05', '2026-12-06', '2026-12-07'];
const setNow = (hhmm) => { mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: at(TODAY, hhmm).getTime() }); };
const canMock = typeof mock.timers?.enable === 'function';

function handler(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `route ${method} ${path} پیدا نشد`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}
function call(method, path, user, { body = {}, extra = {} } = {}) {
  const out = { status: 200, body: undefined };
  const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
  handler(method, path)({ miniAppUser: user, body, query: {}, headers: {}, ip: '10.0.0.1', get: () => undefined, ...extra }, res, () => {});
  return out;
}

describe('گیت سقف تأخیر روی ثبت ورود (D2)', { skip: !router ? 'express نصب نیست' : (canMock ? false : 'mock.timers نیست') }, () => {
  let db; let mgr; let emp; let n = 0;
  const audit = (action, userId) => db.prepare('SELECT details FROM audit_log WHERE action = ? AND user_id = ?').all(action, userId).map((r) => (typeof r.details === 'string' ? JSON.parse(r.details) : r.details));
  const lates = (u, count) => WORK.slice(0, count).forEach((d) => attendanceRepo.createManual({ userId: u.id, recordDate: d, checkInTime: at(d, '08:20').toISOString(), checkOutTime: at(d, '16:30').toISOString(), status: 'normal' }));
  const checkIn = (u, extra) => call('post', '/miniapp/check-in', u, { extra });

  before(() => { db = resetDb(); mgr = makeUser({ role: 'manager' }); });
  after(() => { mock.timers.reset(); cleanup(); });
  beforeEach(() => {
    n += 1;
    emp = makeUser({ managerId: mgr.id });
    settings.setValue('lateMonthlyLimit', 3);
    settings.setValue('lateLimitGateMode', 'enforce');
    setNow('09:00');
  });

  test('بالای سقف + ورودِ دیر + بدون اجازه ⇒ ۴۰۹ LATE_LIMIT_REACHED با { lateCount, limit, permission }؛ چیزی ثبت نمی‌شود', () => {
    lates(emp, 3);
    const r = checkIn(emp);
    assert.deepEqual([r.status, r.body.code, r.body.lateCount, r.body.limit, r.body.permission], [409, 'LATE_LIMIT_REACHED', 3, 3, null]);
    assert.match(r.body.error, /سرپرست/);
    assert.equal(attendanceRepo.findTodayRecord(emp.id), undefined, 'رکوردی ساخته نشد');
    assert.equal(audit('check_in_blocked', emp.id).length, 1);
  });

  test('ورودِ به‌موقع (یا قبل از شروع) حتی بالای سقف آزاد است؛ ورودِ داخل مهلت هم آزاد است', () => {
    lates(emp, 3);
    setNow('07:50');
    const r = checkIn(emp);
    assert.equal(r.status, 201);
    assert.equal(r.body.lateLimitWarning, undefined);
    const other = makeUser({ managerId: mgr.id });
    lates(other, 3);
    settings.setValue('lateGraceMinutes', 15);
    setNow('08:10');
    assert.equal(checkIn(other).status, 201, 'داخل مهلت تأخیر = دیر نیست');
    settings.resetValue('lateGraceMinutes');
  });

  test('زیر سقف: ورودِ دیر آزاد (تأخیر اول تا سوم)', () => {
    lates(emp, 2);
    assert.equal(checkIn(emp).status, 201);
  });

  test('درخواست ⇒ تأیید ⇒ ورود موفق با اجازه: used، ساعت ورود همان لحظه‌ی واقعی، audit «با اجازه»', () => {
    lates(emp, 3);
    assert.equal(checkIn(emp).status, 409);
    const req = call('post', '/miniapp/checkin-permission', emp, { body: { reason: 'ترافیک' } });
    assert.deepEqual([req.status, req.body.permission.status], [201, 'pending']);
    assert.equal(checkIn(emp).status, 409, 'pending هنوز باز نمی‌کند');
    assert.equal(lateLimit.decide(mgr, req.body.permission.id, true, 'باشه').ok, true);
    const g = call('get', '/miniapp/checkin-permission', emp).body.gate;
    assert.deepEqual([g.blocked, g.permission.status], [false, 'approved']);
    const ok = checkIn(emp);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.check_in_time, at(TODAY, '09:00').toISOString(), 'ساعت واقعی؛ تأخیر پنهان نشده');
    assert.equal(db.prepare('SELECT status FROM checkin_permissions WHERE id = ?').get(req.body.permission.id).status, 'used');
    const a = audit('check_in_with_permission', emp.id);
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].permissionId, a[0].approvedBy, a[0].lateMinutes], [req.body.permission.id, mgr.id, 60]);
    assert.equal(audit('checkin_permission_requested', emp.id).length, 1);
  });

  test('اجازه‌ی منقضی (بعد از TTL) یا ردشده ⇒ همچنان مسدود', () => {
    lates(emp, 3);
    const p = call('post', '/miniapp/checkin-permission', emp, { body: { reason: 'الف' } }).body.permission;
    lateLimit.decide(mgr, p.id, true, null);
    setNow('10:05'); // ۶۵ دقیقه بعد از تأیید (TTL ۶۰)
    const r = checkIn(emp);
    assert.deepEqual([r.status, r.body.permission.status], [409, 'expired']);
    const p2 = call('post', '/miniapp/checkin-permission', emp, { body: { reason: 'ب' } }).body.permission;
    lateLimit.decide(mgr, p2.id, false, 'نه');
    const r2 = checkIn(emp);
    assert.deepEqual([r2.status, r2.body.permission.status, r2.body.permission.decisionNote], [409, 'rejected', 'نه']);
  });

  test('soft: ثبت مجاز با هشدار در پاسخ و audit؛ off: بدون هیچ اثری', () => {
    lates(emp, 3);
    settings.setValue('lateLimitGateMode', 'soft');
    const r = checkIn(emp);
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.lateLimitWarning.code, r.body.lateLimitWarning.lateCount, r.body.lateLimitWarning.limit], ['LATE_LIMIT_SOFT', 3, 3]);
    assert.equal(audit('check_in_late_limit_warning', emp.id).length, 1);
    const o = makeUser({ managerId: mgr.id });
    lates(o, 3);
    settings.setValue('lateLimitGateMode', 'off');
    const r2 = checkIn(o);
    assert.equal(r2.status, 201);
    assert.equal(r2.body.lateLimitWarning, undefined);
    assert.equal(audit('check_in_late_limit_warning', o.id).length, 0);
  });

  test('ورود با ماموریتِ در انتظار مستثنی است؛ خطای داخلی گیت ⇒ fail-open', () => {
    lates(emp, 3);
    assert.equal(checkIn(emp, { viaPendingMission: 123 }).status, 201, 'viaPendingMission گیت نمی‌خورد');
    const e2 = makeUser({ managerId: mgr.id });
    lates(e2, 3);
    const orig = lateLimit.evaluateCheckIn;
    lateLimit.evaluateCheckIn = () => { throw new Error('boom'); };
    try { assert.equal(checkIn(e2).status, 201); } finally { lateLimit.evaluateCheckIn = orig; }
  });

  test('مسیر ساخت رکورد توسط ادمین (createManual/fixRecord) از گیت عبور نمی‌کند و رکورد دستیِ دیر به شمارش ماه اضافه می‌شود', () => {
    lates(emp, 3);
    const rec = attendanceRepo.createManual({ userId: emp.id, recordDate: TODAY, checkInTime: at(TODAY, '09:30').toISOString(), checkOutTime: null, status: 'normal' });
    assert.ok(rec.id, 'createManual (مسیر ادمین) بدون گیت رکورد می‌سازد');
    // فردا ماه شمسی همان است؛ رکورد دستیِ امروز (دیر) از فردا در شمارش می‌آید
    mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: at('2026-12-13', '08:00').getTime() });
    assert.equal(lateLimit.countLateInMonth(emp.id, { jy: 1405, jm: 9 }).count, 4);
  });

  test('POST /checkin-permission: زیر سقف ⇒ ۴۰۹ PERMISSION_NOT_REQUIRED؛ علت الزامی؛ درخواست تکراری ⇒ ۴۰۹ همراه درخواست فعال', () => {
    const calm = makeUser({ managerId: mgr.id });
    const r0 = call('post', '/miniapp/checkin-permission', calm, { body: { reason: 'الف' } });
    assert.deepEqual([r0.status, r0.body.code], [409, 'PERMISSION_NOT_REQUIRED']);
    lates(emp, 3);
    assert.deepEqual([call('post', '/miniapp/checkin-permission', emp, { body: { reason: '  ' } }).status, call('post', '/miniapp/checkin-permission', emp, { body: {} }).body.code], [400, 'REASON_REQUIRED']);
    const first = call('post', '/miniapp/checkin-permission', emp, { body: { reason: 'الف' } });
    const dup = call('post', '/miniapp/checkin-permission', emp, { body: { reason: 'ب' } });
    assert.deepEqual([dup.status, dup.body.code, dup.body.permission.id], [409, 'PERMISSION_ALREADY_ACTIVE', first.body.permission.id]);
    const off = call('get', '/miniapp/checkin-permission', calm).body.gate;
    assert.equal(off.blocked, false);
  });
});
