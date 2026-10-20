// M3 («وضعیت من»): تیک‌زدن تسک‌های «خودِ» کاربر از پنل — panelTasksService و مسیرهای /api/admin/me/tasks/*.
// همان منطق Mini App (taskReportService)؛ اینجا مالکیت، تسک سیستمی، تاریخ/ماه بسته، هماهنگی با Mini App و audit بررسی می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('وضعیت من (M3): سرویس panelTasksService', () => {
  let db; let svc; let report; let plans; let logs; let settings; let attendance; let cal; let addDays; let TODAY; let u; let other;
  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM break_records; DELETE FROM attendance_records; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM month_closures;');
    settings.setValue('dailyReportGateMode', 'soft');
    settings.setValue('reportBackfillDays', 2);
  };
  const mk = (user, title, extra = {}) => plans.addTask(plans.getOrCreate(user.id, cal.weekStartOf(TODAY, settings.getAll().weekStartDay)).id, { title, plannedDate: TODAY, ...extra });
  const ids = (list) => list.map((t) => t.title);
  const logRows = () => db.prepare('SELECT user_id, task_id, status, reason_code, answered_late, note FROM task_daily_logs ORDER BY id').all();

  before(() => {
    db = resetDb();
    svc = require('../src/services/panelTasksService');
    report = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    attendance = require('../src/repositories/attendanceRepository');
    cal = require('../src/engine/calendarService');
    ({ addDays } = require('../src/utils/shiftDay'));
    TODAY = require('../src/utils/serverTime').todayDateString();
    u = F.makeUser();
    other = F.makeUser();
  });
  after(cleanup);

  test('getToday: فقط تسک‌های خودِ کاربر', () => {
    reset();
    mk(u, 'مال من'); mk(other, 'مال دیگری');
    const r = svc.getToday(u, {});
    assert.equal(r.ok, true);
    assert.deepEqual(ids(r.tasks), ['مال من']);
    assert.deepEqual(ids(svc.getToday(other, {}).tasks), ['مال دیگری']);
  });

  test('answer done ⇒ ثبت برای خودِ کاربر؛ فهرست تازه و پیشرفت برمی‌گردد', () => {
    reset();
    const t = mk(u, 'الف'); mk(u, 'ب');
    const r = svc.answer(u, { taskId: t.id, status: 'done', date: TODAY });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.answered.map((a) => [a.taskId, a.status]), [[t.id, 'done']]);
    assert.deepEqual(ids(r.tasks), ['ب']);
    assert.equal(r.progress.done, 1); assert.equal(r.progress.total, 2);
    const rows = logRows();
    assert.equal(rows.length, 1); assert.equal(rows[0].user_id, u.id); assert.equal(rows[0].answered_late, 0);
  });

  test('partial/not_done: علت الزامی است؛ «سایر» حداقل ۵ نویسه؛ علت نامعتبر رد می‌شود', () => {
    reset();
    const t = mk(u, 'الف');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'partial' }).code, 'REASON_REQUIRED');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'not_done', reasonCode: 'bogus' }).code, 'REASON_REQUIRED');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'not_done', reasonCode: 'other', reasonText: 'کم' }).code, 'REASON_TEXT_REQUIRED');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'bogus' }).code, 'INVALID_STATUS');
    assert.equal(logRows().length, 0);
    const ok = svc.answer(u, { taskId: t.id, status: 'partial', reasonCode: 'no_time', reasonText: 'وقت کم بود' });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.answered.map((a) => [a.status, a.reasonCode, a.reasonText]), [['partial', 'no_time', 'وقت کم بود']]);
  });

  test('taskId نامعتبر ⇒ INVALID_TASK؛ بدنه‌ی غیرآبجکت بی‌خطر است', () => {
    reset();
    for (const bad of [undefined, null, 0, -1, 1.5, 'x', [], {}]) assert.equal(svc.answer(u, { taskId: bad, status: 'done' }).code, 'INVALID_TASK', String(bad));
    assert.equal(svc.answer(u, null).code, 'INVALID_TASK');
    assert.equal(svc.undo(u, 'x').code, 'INVALID_TASK');
    assert.equal(svc.note(u, undefined).code, 'INVALID_TASK');
  });

  test('فیلدهای اضافه نادیده گرفته می‌شوند: userId، extra، reschedule', () => {
    reset();
    const t = mk(u, 'الف');
    const r = svc.answer(u, { taskId: t.id, status: 'not_done', reasonCode: 'no_time', userId: other.id, user_id: other.id, extra: [{ title: 'خارج از برنامه' }], reschedule: { type: 'drop' }, answers: [{ taskId: 999, status: 'done' }] });
    assert.equal(r.ok, true, JSON.stringify(r));
    const rows = logRows();
    assert.equal(rows.length, 1); assert.equal(rows[0].user_id, u.id); assert.equal(rows[0].task_id, t.id);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM plan_tasks WHERE system_key = 'out_of_plan'").get().n, 0);
    assert.equal(db.prepare('SELECT reschedule_to FROM task_daily_logs').get().reschedule_to, null);
    assert.deepEqual(r.rescheduled, []);
  });

  test('مالکیت: تسک/پاسخ دیگری ⇒ TASK_NOT_FOUND برای answer/undo/note؛ چیزی تغییر نمی‌کند', () => {
    reset();
    const mine = mk(u, 'من');
    assert.equal(svc.answer(other, { taskId: mine.id, status: 'done' }).code, 'TASK_NOT_FOUND');
    svc.answer(u, { taskId: mine.id, status: 'done' });
    assert.equal(svc.undo(other, { taskId: mine.id }).code, 'TASK_NOT_FOUND');
    assert.equal(svc.note(other, { taskId: mine.id, note: 'هک' }).code, 'TASK_NOT_FOUND');
    const rows = logRows();
    assert.equal(rows.length, 1); assert.equal(rows[0].user_id, u.id); assert.equal(rows[0].status, 'done'); assert.equal(rows[0].note, null);
  });

  test('تسک سیستمی/واجب فقط‌خواندنی: answer، undo و note ⇒ SYSTEM_TASK_READONLY (و چیزی نوشته نمی‌شود)', () => {
    reset();
    const sys = mk(u, 'سیستمی', { isSystem: true, systemKey: 'some_system_task', priority: 'high' });
    assert.equal(svc.getToday(u, {}).tasks[0].isSystem, true);
    assert.equal(svc.answer(u, { taskId: sys.id, status: 'done' }).code, 'SYSTEM_TASK_READONLY');
    assert.equal(svc.answer(u, { taskId: sys.id, status: 'not_done', reasonCode: 'no_time' }).code, 'SYSTEM_TASK_READONLY');
    assert.equal(logRows().length, 0);
    logs.upsert({ taskId: sys.id, userId: u.id, logDate: TODAY, status: 'done' }); // مثل ثبت خودکار «مشاهده‌ی گزارش‌ها»
    assert.equal(svc.undo(u, { taskId: sys.id }).code, 'SYSTEM_TASK_READONLY');
    assert.equal(svc.note(u, { taskId: sys.id, note: 'x' }).code, 'SYSTEM_TASK_READONLY');
    assert.equal(logRows().length, 1);
    assert.equal(svc.undo(other, { taskId: sys.id }).code, 'TASK_NOT_FOUND'); // پاسخ سیستمیِ دیگران لو نمی‌رود
  });

  test('تسک واجب «بررسی گزارش تیم» (REVIEW_KEY) هم از پنل فقط‌خواندنی است', () => {
    reset();
    const rv = mk(u, 'بررسی گزارش‌ها', { isSystem: true, systemKey: 'review_team_reports' });
    assert.equal(svc.answer(u, { taskId: rv.id, status: 'not_done', reasonCode: 'no_time' }).code, 'SYSTEM_TASK_READONLY');
  });

  test('تاریخ: آینده/نامعتبر/روز بدون رکورد حضور رد می‌شود؛ ورودی غیرمتنی هم', () => {
    reset();
    const t = mk(u, 'الف');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'done', date: addDays(TODAY, 1) }).code, 'DATE_IN_FUTURE');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'done', date: '2026-02-31' }).code, 'INVALID_DATE');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'done', date: { $gt: '' } }).code, 'INVALID_DATE');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'done', date: addDays(TODAY, -1) }).code, 'NO_RECORD');
    assert.equal(svc.getToday(u, { date: ['a', 'b'] }).code, 'INVALID_DATE');
    assert.equal(svc.getToday(u, { date: addDays(TODAY, 1) }).code, 'DATE_IN_FUTURE');
    assert.equal(logRows().length, 0);
  });

  test('ماه بسته ⇒ MONTH_CLOSED برای answer/undo/note', () => {
    reset();
    const t = mk(u, 'الف');
    assert.equal(svc.answer(u, { taskId: t.id, status: 'done' }).ok, true);
    const mc = require('../src/repositories/monthClosuresRepository');
    const orig = mc.findClosedOverlapping;
    mc.findClosedOverlapping = () => [{ id: 1 }];
    try {
      assert.equal(svc.answer(u, { taskId: mk(u, 'ب').id, status: 'done' }).code, 'MONTH_CLOSED');
      assert.equal(svc.undo(u, { taskId: t.id }).code, 'MONTH_CLOSED');
      assert.equal(svc.note(u, { taskId: t.id, note: 'x' }).code, 'MONTH_CLOSED');
    } finally { mc.findClosedOverlapping = orig; }
    assert.equal(logRows().length, 1);
  });

  test('برداشتن تیک: تسک به فهرست برمی‌گردد؛ پاسخِ undo شامل previousStatus؛ دوباره‌ی آن TASK_NOT_FOUND', () => {
    reset();
    const t = mk(u, 'الف');
    svc.answer(u, { taskId: t.id, status: 'not_done', reasonCode: 'no_time' });
    const r = svc.undo(u, { taskId: t.id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.undone, { taskId: t.id, date: TODAY, outOfPlan: false, previousStatus: 'not_done' });
    assert.deepEqual(ids(r.tasks), ['الف']);
    assert.equal(logRows().length, 0);
    assert.equal(svc.undo(u, { taskId: t.id }).code, 'TASK_NOT_FOUND');
  });

  test('توضیح انجام: فقط برای done؛ ذخیره/پاک‌کردن؛ سقف ۵۰۰ نویسه', () => {
    reset();
    const a = mk(u, 'الف'); const b = mk(u, 'ب');
    svc.answer(u, { taskId: a.id, status: 'done', note: 'اولیه' });
    svc.answer(u, { taskId: b.id, status: 'not_done', reasonCode: 'no_time' });
    assert.equal(logRows()[0].note, 'اولیه');
    const r = svc.note(u, { taskId: a.id, note: 'ویرایش‌شده' });
    assert.equal(r.ok, true); assert.equal(r.note, 'ویرایش‌شده'); assert.equal(r.cleared, false);
    assert.equal(svc.note(u, { taskId: b.id, note: 'x' }).code, 'NOTE_ONLY_FOR_DONE');
    assert.equal(svc.note(u, { taskId: a.id, note: 'x'.repeat(501) }).code, 'NOTE_TOO_LONG');
    const c = svc.note(u, { taskId: a.id, note: '' });
    assert.equal(c.cleared, true); assert.equal(logRows()[0].note, null);
  });

  test('هماهنگی با Mini App: پاسخ پنل در taskReportService دیده می‌شود و برعکس؛ undo پنل روی پاسخ Mini App کار می‌کند', () => {
    reset();
    const a = mk(u, 'الف'); const b = mk(u, 'ب');
    svc.answer(u, { taskId: a.id, status: 'done' });
    const viaMini = report.getDailyTasks(u, { requestedDate: TODAY });
    assert.deepEqual(viaMini.answered.map((x) => [x.taskId, x.status]), [[a.id, 'done']]);
    assert.deepEqual(ids(viaMini.tasks), ['ب']);
    report.submitDailyReport(u, { answers: [{ taskId: b.id, status: 'not_done', reasonCode: 'no_time' }] }, { requestedDate: TODAY });
    const viaPanel = svc.getToday(u, {});
    assert.deepEqual(viaPanel.answered.map((x) => [x.taskId, x.status]).sort(), [[a.id, 'done'], [b.id, 'not_done']].sort());
    assert.equal(svc.undo(u, { taskId: b.id }).ok, true);
    assert.deepEqual(ids(report.getDailyTasks(u, { requestedDate: TODAY }).tasks), ['ب']);
    assert.equal(svc.answer(u, { taskId: a.id, status: 'done' }).code, 'ALREADY_ANSWERED');
  });

  test('گزارش دیرهنگام: بعد از ثبت خروج، پاسخ پنل با answered_late=1 و late=true ذخیره می‌شود', () => {
    reset();
    attendance.createManual({ userId: u.id, recordDate: TODAY, checkInTime: `${TODAY}T05:00:00.000Z`, checkOutTime: `${TODAY}T14:00:00.000Z`, status: 'normal' });
    const t = mk(u, 'الف');
    const r = svc.answer(u, { taskId: t.id, status: 'done' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.late, true); assert.equal(r.source, 'after_checkout');
    assert.equal(logRows()[0].answered_late, 1);
  });

  test('getBackfill: ساختار خروجی؛ حالت off ⇒ بدون روز', () => {
    reset();
    assert.equal(svc.getBackfill(u).ok, true);
    settings.setValue('dailyReportGateMode', 'off');
    assert.deepEqual(svc.getBackfill(u).days, []);
    settings.setValue('dailyReportGateMode', 'soft');
  });
});

describe('وضعیت من (M3): API /api/admin/me/tasks/*', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  const { startServer } = require('./helpers/miniappClient');
  let S; let db; let plans; let cal; let settings; let TODAY; let users; let cookies; let emp; let mgr;
  const mk = (user, title, extra = {}) => plans.addTask(plans.getOrCreate(user.id, cal.weekStartOf(TODAY, settings.getAll().weekStartDay)).id, { title, plannedDate: TODAY, ...extra });
  const req = (role, method, path, body, headers = {}) => fetch(`${S.base}/api/admin/me/tasks/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', cookie: cookies[role], ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: await res.json().catch(() => ({})) }));
  const audit = (action) => db.prepare('SELECT user_id, details FROM audit_log WHERE action = ? ORDER BY id DESC').all(action).map((r) => ({ userId: r.user_id, d: JSON.parse(r.details) }));

  before(async () => {
    db = resetDb();
    plans = require('../src/repositories/weeklyPlanRepository');
    cal = require('../src/engine/calendarService');
    settings = require('../src/repositories/settingsRepository');
    TODAY = require('../src/utils/serverTime').todayDateString();
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ role: 'employee', managerId: mgr.id });
    users = { employee: emp, manager: mgr, hr: F.makeUser({ role: 'hr' }), admin: F.makeUser({ role: 'admin' }) };
    cookies = Object.fromEntries(Object.entries(users).map(([k, v]) => [k, F.sessionCookie(v.id)]));
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  test('همه‌ی نقش‌ها: GET /today فقط تسک‌های خودشان؛ date و userId در query روی هویت اثر ندارند', async () => {
    const mine = mk(emp, 'کار کارمند');
    mk(mgr, 'کار سرپرست');
    for (const role of ['employee', 'manager', 'hr', 'admin']) assert.equal((await req(role, 'GET', 'today')).status, 200, role);
    assert.deepEqual((await req('employee', 'GET', `today?userId=${mgr.id}&id=${mgr.id}`)).json.tasks.map((t) => t.title), ['کار کارمند']);
    assert.deepEqual((await req('manager', 'GET', 'today')).json.tasks.map((t) => t.title).filter((x) => x === 'کار سرپرست'), ['کار سرپرست']);
    assert.equal((await req('employee', 'GET', 'today')).json.tasks[0].id, mine.id);
    assert.equal((await req('employee', 'GET', 'backfill')).status, 200);
  });

  test('POST /answer: ۲۰۰ و ثبت؛ تکراری ۴۰۹؛ تسک دیگری ۴۰۴؛ علت‌نداشته ۴۰۰؛ تاریخ آینده ۴۰۰', async () => {
    const t = mk(emp, 'تیک');
    const ok = await req('employee', 'POST', 'answer', { taskId: t.id, status: 'done', date: TODAY });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(ok.json.answered.some((a) => a.taskId === t.id && a.status === 'done'));
    assert.equal((await req('employee', 'POST', 'answer', { taskId: t.id, status: 'done' })).status, 409);
    const mt = mk(mgr, 'مال سرپرست');
    assert.equal((await req('employee', 'POST', 'answer', { taskId: mt.id, status: 'done', userId: mgr.id })).status, 404);
    const t2 = mk(emp, 'بی‌علت');
    assert.equal((await req('employee', 'POST', 'answer', { taskId: t2.id, status: 'not_done' })).status, 400);
    const future = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10);
    assert.equal((await req('employee', 'POST', 'answer', { taskId: t2.id, status: 'done', date: future })).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM task_daily_logs WHERE task_id = ?').get(mt.id).n, 0);
  });

  test('تسک سیستمی ⇒ ۴۰۳ SYSTEM_TASK_READONLY', async () => {
    const sys = mk(emp, 'سیستمی', { isSystem: true, systemKey: 'some_system_task' });
    const r = await req('employee', 'POST', 'answer', { taskId: sys.id, status: 'done' });
    assert.equal(r.status, 403); assert.equal(r.json.code, 'SYSTEM_TASK_READONLY');
  });

  test('undo و note: ۲۰۰ برای خودِ کاربر؛ ۴۰۴ برای دیگران؛ audit با source=panel', async () => {
    const t = mk(emp, 'ویرایش');
    await req('employee', 'POST', 'answer', { taskId: t.id, status: 'done' });
    assert.equal((await req('manager', 'PATCH', 'note', { taskId: t.id, note: 'نه' })).status, 404);
    assert.equal((await req('manager', 'POST', 'undo', { taskId: t.id })).status, 404);
    const n = await req('employee', 'PATCH', 'note', { taskId: t.id, note: 'یادداشت' });
    assert.equal(n.status, 200); assert.equal(n.json.note, 'یادداشت');
    const u = await req('employee', 'POST', 'undo', { taskId: t.id });
    assert.equal(u.status, 200); assert.equal(u.json.undone.previousStatus, 'done');
    const aNote = audit('task_done_note_edited')[0]; const aUndo = audit('task_answer_undone')[0];
    assert.equal(aNote.userId, emp.id); assert.equal(aNote.d.source, 'panel'); assert.equal(aNote.d.taskId, t.id);
    assert.equal(aUndo.userId, emp.id); assert.equal(aUndo.d.source, 'panel'); assert.equal(aUndo.d.previousStatus, 'done');
    assert.equal(JSON.stringify(aNote.d).includes('یادداشت'), false, 'متن توضیح در audit نیست');
  });

  test('دسترسی: بدون نشست ۴۰۱؛ POST بدون هدر CSRF ۴۰۳؛ متد/مسیر خارج از لیست سفید کارمند ۴۰۳', async () => {
    const t = mk(emp, 'امن');
    const noSession = await fetch(`${S.base}/api/admin/me/tasks/today`);
    assert.equal(noSession.status, 401);
    const noCsrf = await fetch(`${S.base}/api/admin/me/tasks/answer`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies.employee }, body: JSON.stringify({ taskId: t.id, status: 'done' }) });
    assert.equal(noCsrf.status, 403);
    assert.equal((await req('employee', 'DELETE', 'answer')).status, 403);
    assert.equal((await req('employee', 'GET', 'answer')).status, 403);
    assert.equal((await req('employee', 'POST', 'today', {})).status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM task_daily_logs WHERE task_id = ?').get(t.id).n, 0);
  });

  test('هماهنگی با Mini App: پاسخ پنل در GET /miniapp/daily-tasks دیده می‌شود و Mini App می‌تواند آن را واگرد کند', async () => {
    const t = mk(emp, 'هم‌خوانی');
    assert.equal((await req('employee', 'POST', 'answer', { taskId: t.id, status: 'not_done', reasonCode: 'no_time' })).status, 200);
    const g = await S.call(emp, 'GET', 'daily-tasks');
    assert.equal(g.status, 200);
    const a = g.json.answered.find((x) => x.taskId === t.id);
    assert.ok(a); assert.equal(a.status, 'not_done'); assert.equal(a.reasonCode, 'no_time');
    assert.equal((await S.call(emp, 'POST', 'daily-report/undo', { taskId: t.id })).status, 200);
    assert.ok((await req('employee', 'GET', 'today')).json.tasks.some((x) => x.id === t.id));
  });

  test('پاسخ دیرهنگام از پنل در audit با source=panel ثبت می‌شود', async () => {
    const attendance = require('../src/repositories/attendanceRepository');
    const late = F.makeUser({ role: 'employee' });
    cookies.late = F.sessionCookie(late.id);
    attendance.createManual({ userId: late.id, recordDate: TODAY, checkInTime: `${TODAY}T05:00:00.000Z`, checkOutTime: `${TODAY}T14:00:00.000Z`, status: 'normal' });
    const t = mk(late, 'دیرهنگام');
    const r = await req('late', 'POST', 'answer', { taskId: t.id, status: 'done' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.late, true);
    const e = audit('daily_report_submitted').find((x) => x.userId === late.id);
    assert.ok(e); assert.equal(e.d.source, 'panel'); assert.equal(e.d.late, true); assert.equal(e.d.date, TODAY);
  });
});

describe('وضعیت من (M3): اتصال ایستا', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
  test('لیست سفید کارمند فقط همین مسیرها/متدها را دارد و روتر ثبت شده است', () => {
    const { EMPLOYEE_ALLOWED } = require('../src/middleware/adminAuth');
    const ok = (m, p) => EMPLOYEE_ALLOWED.some(([mm, re]) => mm === m && re.test(p));
    for (const [m, p] of [['GET', '/admin/me/tasks/today'], ['GET', '/admin/me/tasks/backfill'], ['POST', '/admin/me/tasks/answer'], ['POST', '/admin/me/tasks/undo'], ['PATCH', '/admin/me/tasks/note']]) assert.equal(ok(m, p), true, `${m} ${p}`);
    for (const [m, p] of [['DELETE', '/admin/me/tasks/answer'], ['GET', '/admin/me/tasks/answer'], ['POST', '/admin/me/tasks/today'], ['POST', '/admin/me/tasks/x'], ['GET', '/admin/me/tasks'], ['GET', '/admin/me/tasks/today/1']]) assert.equal(ok(m, p), false, `${m} ${p}`);
    assert.match(read('src/api/routes/admin/index.js'), /require\('\.\/myTasks'\)/);
  });
  test('مسیر و سرویس: هیچ userId از کلاینت خوانده نمی‌شود؛ نگاشت خطا مشترک با Mini App', () => {
    const route = read('src/api/routes/admin/myTasks.js'); const svc = read('src/services/panelTasksService.js');
    assert.doesNotMatch(route + svc, /req\.(body|query|params)\.(userId|user_id|id)\b|b\.userId|b\.user_id/);
    assert.match(route, /requirePermission\('me\.read'\)/);
    assert.match(read('src/api/routes/miniapp.js'), /require\('\.\.\/\.\.\/utils\/reportErrors'\)/);
    const { REPORT_ERROR_STATUS, statusOfReportError } = require('../src/utils/reportErrors');
    assert.equal(REPORT_ERROR_STATUS.SYSTEM_TASK_READONLY, 403);
    assert.equal(statusOfReportError('MONTH_CLOSED'), 409); assert.equal(statusOfReportError('UNKNOWN'), 400);
  });
});
