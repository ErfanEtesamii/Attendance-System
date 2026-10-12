// D5: گیت خروج — الزام برنامه‌ی هفته‌ی بعد (سرویس + API Mini App + معافیت پنل).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

// هفته‌ی شنبه ۲۰۲۶-۰۸-۰۱؛ روز ثبتِ پیش‌فرض = پنجشنبه ۰۸-۰۶؛ هفته‌ی بعد از ۰۸-۰۸
describe('گیت برنامه‌ی هفتگی — سرویس (D5)', () => {
  let db; let gate; let plans; let planSvc; let settings; let u; let boss;
  const at = (d, h = '10:00') => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const reset = () => {
    db.exec('DELETE FROM plan_gate_exemptions; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM attendance_records; DELETE FROM audit_log;');
    settings.setValue('planGateMode', 'enforce');
    db.exec("DELETE FROM settings WHERE key IN ('plan_gate_start_date', 'plan_min_tasks')");
  };
  const submitPlan = (n = 1) => {
    planSvc.saveDraft(u, 'next', Array.from({ length: n }, (_, i) => ({ title: `تسک ${i + 1}` })), { now: at('2026-08-06') });
    assert.equal(planSvc.submit(u, 'next', { now: at('2026-08-06') }).ok, true);
  };

  before(() => {
    db = resetDb();
    gate = require('../src/services/planGateService');
    plans = require('../src/repositories/weeklyPlanRepository');
    planSvc = require('../src/services/weeklyPlanService');
    settings = require('../src/repositories/settingsRepository');
    boss = F.makeUser({ role: 'manager' });
    u = F.makeUser({ managerId: boss.id });
  });
  after(cleanup);

  test('حالت‌ها: off ⇒ allow؛ soft ⇒ remind؛ enforce ⇒ block (روز ثبت)', () => {
    reset();
    settings.setValue('planGateMode', 'off');
    assert.equal(gate.check(u, '2026-08-06').action, 'allow');
    settings.setValue('planGateMode', 'soft');
    assert.equal(gate.check(u, '2026-08-06').action, 'remind');
    settings.setValue('planGateMode', 'enforce');
    const g = gate.check(u, '2026-08-06');
    assert.equal(g.action, 'block');
    assert.equal(g.info.weekStart, '2026-08-08');
    assert.equal(g.info.planDay, '2026-08-06');
  });

  test('قبل از روز ثبت آزاد؛ بعد از آن (اولین خروجِ بعدی) در همان هفته گیت؛ هفته‌ی بعد دوباره آزاد', () => {
    reset();
    assert.equal(gate.check(u, '2026-08-05').action, 'allow'); // چهارشنبه
    assert.equal(gate.check(u, '2026-08-07').action, 'block'); // جمعه، بعد از روز ثبت
    assert.equal(gate.check(u, '2026-08-08').action, 'allow'); // شنبه‌ی هفته‌ی بعد
  });

  test('برنامه‌ی ثبت‌شده ⇒ allow؛ خالی‌کردن بعد از ثبت ⇒ دوباره block؛ پیش‌نویس کافی نیست', () => {
    reset();
    planSvc.saveDraft(u, 'next', [{ title: 'الف' }], { now: at('2026-08-06') });
    assert.equal(gate.check(u, '2026-08-06').action, 'block'); // هنوز draft
    assert.equal(planSvc.submit(u, 'next', { now: at('2026-08-06') }).ok, true);
    assert.equal(gate.check(u, '2026-08-06').action, 'allow');
    planSvc.saveDraft(u, 'next', [], { now: at('2026-08-06') }); // قبل از شروع هفته: حذف آزاد
    assert.equal(gate.check(u, '2026-08-06').action, 'block');
  });

  test('planMinTasks رعایت می‌شود', () => {
    reset();
    submitPlan(1);
    settings.setValue('planMinTasks', 2);
    assert.equal(gate.check(u, '2026-08-06').action, 'block');
    settings.setValue('planMinTasks', 1);
    assert.equal(gate.check(u, '2026-08-06').action, 'allow');
  });

  test('planGateStartDate: قبل از آن اعمال نمی‌شود', () => {
    reset();
    settings.setValue('planGateStartDate', '2026-08-10');
    assert.equal(gate.check(u, '2026-08-06').action, 'allow');
    settings.setValue('planGateStartDate', '2026-08-06');
    assert.equal(gate.check(u, '2026-08-06').action, 'block');
  });

  test('ماه بسته (ثبت برنامه ممکن نیست) ⇒ گیت اعمال نمی‌شود؛ خطای داخلی ⇒ fail-open', () => {
    reset();
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try { assert.equal(gate.check(u, '2026-08-06').action, 'allow'); } finally { mc.findClosedOverlapping = orig; }
    const origGet = settings.getAll;
    settings.getAll = () => { throw new Error('boom'); };
    const origErr = console.error; console.error = () => {};
    try { assert.equal(gate.check(u, '2026-08-06').action, 'allow'); } finally { settings.getAll = origGet; console.error = origErr; }
  });

  test('معافیت یک‌باره: allow + مصرف؛ بار دوم block؛ صدور تکراری ۴۰۹؛ audit', () => {
    reset();
    const r = gate.grantExemption({ user: u, grantedBy: boss, reason: 'مشکل فنی', today: '2026-08-06' });
    assert.equal(r.ok, true);
    assert.equal(r.exemption.week_start_date, '2026-08-08');
    assert.equal(gate.grantExemption({ user: u, grantedBy: boss, reason: 'دوباره', today: '2026-08-06' }).code, 'EXEMPTION_EXISTS');
    const g = gate.check(u, '2026-08-06');
    assert.equal(g.action, 'allow');
    assert.equal(g.exemptionId, r.exemption.id);
    const rec = db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time) VALUES (?, '2026-08-06', '2026-08-06T05:00:00Z')").run(u.id);
    assert.equal(gate.consumeExemption(u, g, { id: Number(rec.lastInsertRowid) }, '1.1.1.1'), true);
    assert.equal(gate.consumeExemption(u, g, { id: Number(rec.lastInsertRowid) }, '1.1.1.1'), false); // idempotent
    assert.equal(gate.check(u, '2026-08-06').action, 'block');
    assert.equal(gate.grantExemption({ user: u, grantedBy: boss, reason: 'باز هم', today: '2026-08-06' }).code, 'EXEMPTION_USED');
    const actions = db.prepare('SELECT action FROM audit_log').all().map((x) => x.action);
    assert.ok(actions.includes('plan_gate_exemption_granted') && actions.includes('plan_gate_exemption_used'));
  });

  test('بنر روز بعد: خروجِ روز ثبتِ هفته‌ی قبل باز مانده و برنامه ثبت نشده', () => {
    reset();
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status) VALUES (?, '2026-08-06', '2026-08-06T05:00:00Z', 'incomplete')").run(u.id);
    assert.equal(gate.status(u, '2026-08-08').banner, true);
    db.exec("DELETE FROM attendance_records");
    assert.equal(gate.status(u, '2026-08-08').banner, false); // خروج عادی ⇒ بنر ندارد
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status) VALUES (?, '2026-08-06', '2026-08-06T05:00:00Z', 'incomplete')").run(u.id);
    settings.setValue('planGateMode', 'off');
    assert.equal(gate.status(u, '2026-08-08').banner, false);
  });

  test('رجیستری ریست معافیت‌ها را می‌شمارد', () => {
    reset();
    gate.grantExemption({ user: u, grantedBy: boss, reason: 'تست ریست', today: '2026-08-06' });
    const { ENTRIES } = require('../src/repositories/resetRepository');
    assert.ok(ENTRIES.some((e) => e.table === 'plan_gate_exemptions'));
  });
});

describe('گیت برنامه‌ی هفتگی — API (D5)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let settings; let db; let admin; let boss; let team; let other; let hr;
  const { todayDateString } = require('../src/utils/serverTime');
  const cal = require('../src/engine/calendarService');
  const admCall = async (user, method, p, body) => {
    const res = await fetch(`${S.base}/api/admin/${p}`, {
      method, headers: { 'content-type': 'application/json', cookie: F.sessionCookie(user.id), ...F.CSRF_HEADERS }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const setup = (mode) => {
    settings.setValue('planGateMode', mode);
    db.exec("DELETE FROM settings WHERE key = 'plan_gate_start_date'");
    settings.setValue('planSubmissionWeekday', String(cal.weekdayOf(todayDateString()))); // روز ثبت = امروز (یا آخرین روز کاریِ قبل از آن)
  };
  const planBody = { week: 'next', tasks: [{ title: 'کار هفته' }] };

  before(async () => {
    db = resetDb();
    settings = require('../src/repositories/settingsRepository');
    admin = F.makeUser({ role: 'admin' });
    boss = F.makeUser({ role: 'manager' });
    team = F.makeUser({ managerId: boss.id });
    other = F.makeUser({});
    hr = F.makeUser({ role: 'hr' });
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('enforce: بدون برنامه ۴۰۹ و خروج ثبت نمی‌شود؛ با ثبت برنامه خروج می‌شود؛ دبل‌کلیک ۴۰۰', async () => {
    setup('enforce');
    const u = F.makeUser();
    assert.equal((await S.call(u, 'POST', 'check-in', {})).status, 201);
    const gate = await S.call(u, 'GET', 'plan-gate');
    assert.equal(gate.json.blocked, true);
    const r = await S.call(u, 'POST', 'check-out', {});
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'weekly_plan_required');
    assert.equal(db.prepare('SELECT check_out_time FROM attendance_records WHERE user_id = ?').get(u.id).check_out_time, null);
    assert.equal((await S.call(u, 'PUT', 'plan', planBody)).status, 200);
    assert.equal((await S.call(u, 'POST', 'plan/submit', { week: 'next' })).status, 200);
    const ok = await S.call(u, 'POST', 'check-out', {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(ok.json.check_out_time);
    assert.equal(ok.json.planReminder, undefined);
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 400); // دبل‌کلیک
  });

  test('گیت برای سرپرست هم اعمال می‌شود', async () => {
    setup('enforce');
    const m = F.makeUser({ role: 'manager' });
    await S.call(m, 'POST', 'check-in', {});
    assert.equal((await S.call(m, 'POST', 'check-out', {})).json.code, 'weekly_plan_required');
  });

  test('soft: خروج ثبت می‌شود و planReminder برمی‌گردد؛ off: بدون تغییر', async () => {
    setup('soft');
    const u = F.makeUser();
    await S.call(u, 'POST', 'check-in', {});
    const r = await S.call(u, 'POST', 'check-out', {});
    assert.equal(r.status, 200);
    assert.ok(r.json.planReminder && r.json.planReminder.weekStart);
    setup('off');
    const v = F.makeUser();
    await S.call(v, 'POST', 'check-in', {});
    const r2 = await S.call(v, 'POST', 'check-out', {});
    assert.equal(r2.status, 200);
    assert.equal(r2.json.planReminder, undefined);
  });

  test('معافیت: اسکوپ نقش‌ها، علت اجباری، یک‌باره', async () => {
    setup('enforce');
    const u = F.makeUser({ managerId: boss.id });
    await S.call(u, 'POST', 'check-in', {});
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 409);
    const body = { userId: u.id, reason: 'سیستم برنامه‌ریزی خراب بود' };
    assert.equal((await admCall(u, 'POST', 'plan-gate/exemptions', body)).status, 403); // کارمند
    assert.equal((await admCall(hr, 'POST', 'plan-gate/exemptions', body)).status, 403); // hr
    assert.equal((await admCall(other, 'POST', 'plan-gate/exemptions', body)).status, 403); // کارمند دیگر
    assert.equal((await admCall(F.makeUser({ role: 'manager' }), 'POST', 'plan-gate/exemptions', body)).status, 403); // سرپرستِ تیم دیگر
    assert.equal((await admCall(boss, 'POST', 'plan-gate/exemptions', { userId: u.id, reason: ' ' })).status, 400);
    assert.equal((await admCall(boss, 'POST', 'plan-gate/exemptions', { userId: boss.id, reason: 'خودم' })).status, 403);
    assert.equal((await admCall(boss, 'POST', 'plan-gate/exemptions', body)).status, 201);
    assert.equal((await admCall(admin, 'POST', 'plan-gate/exemptions', body)).status, 409); // تکراری
    const ok = await S.call(u, 'POST', 'check-out', {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(db.prepare("SELECT used_at FROM plan_gate_exemptions WHERE user_id = ?").get(u.id).used_at);
    assert.equal((await admCall(admin, 'POST', 'plan-gate/exemptions', body)).json.code, 'EXEMPTION_USED');
  });

  test('ادمین می‌تواند برای هر کارمندی معافیت بدهد', async () => {
    setup('enforce');
    const u = F.makeUser();
    await S.call(u, 'POST', 'check-in', {});
    assert.equal((await admCall(admin, 'POST', 'plan-gate/exemptions', { userId: u.id, reason: 'مأموریت اضطراری' })).status, 201);
    assert.equal((await S.call(u, 'POST', 'check-out', {})).status, 200);
  });
});
