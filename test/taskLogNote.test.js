// A1 (فاز ۱۵): migration ۰۳۹ (task_daily_logs.note) + توضیحِ انجام + برداشتن پاسخ (undo) — سرویس و route.
require('./helpers/testEnv');
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('./helpers/factories');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('migration ۰۳۹ — ستون note روی task_daily_logs', () => {
  const Database = require('better-sqlite3');
  const { migrate, MIGRATIONS_DIR } = require('../src/db/migrator');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tasklog-note-test-'));
  after(() => { try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) { /* ویندوز */ } });
  let counter = 0;
  const newDb = () => { counter += 1; const db = new Database(path.join(work, `db${counter}.db`)); db.pragma('foreign_keys = ON'); return db; };
  const upTo = (n) => {
    counter += 1;
    const dir = path.join(work, `m${counter}`);
    fs.mkdirSync(dir);
    for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
      const m = /^(\d{3,})_/.exec(f);
      if (m && parseInt(m[1], 10) <= n) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    }
    return dir;
  };

  test('ارتقا از ۰۳۸ روی دیتابیس پر: فقط ۰۳۹ اعمال می‌شود، پاسخ‌های قدیمی note = NULL و بقیه‌ی ستون‌ها دست‌نخورده؛ اجرای دوم کاری نمی‌کند', () => {
    const db = newDb();
    migrate(db, { dir: upTo(38) });
    db.exec(`
      INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES ('5001','کارمند','N1','فنی','employee');
      INSERT INTO weekly_plans (user_id, week_start_date) VALUES (1, '2026-08-01');
      INSERT INTO plan_tasks (plan_id, title, planned_date) VALUES (1, 'الف', '2026-08-03');
      INSERT INTO task_daily_logs (task_id, user_id, log_date, status, reason_code, reason_text) VALUES (1, 1, '2026-08-03', 'not_done', 'other', 'علت نمونه');
    `);
    const before = db.prepare('SELECT * FROM task_daily_logs').all();
    assert.ok(!('note' in before[0]));
    const res = migrate(db, { dir: upTo(39), backupDir: path.join(work, 'bk') });
    assert.deepEqual(res.applied, ['039_task_log_note']);
    const after = db.prepare('SELECT * FROM task_daily_logs').all();
    const { note, ...rest } = after[0];
    assert.equal(note, null);
    assert.deepEqual(rest, before[0]);
    assert.deepEqual(migrate(db, { dir: upTo(39), backupDir: path.join(work, 'bk') }).applied, []);
    assert.equal(db.pragma('foreign_key_check').length, 0);
  });

  test('قید CHECK: note تا ۵۰۰ نویسه می‌پذیرد، بیشتر رد می‌شود', () => {
    const db = newDb();
    migrate(db, { dir: upTo(39) });
    db.exec(`
      INSERT INTO users (telegram_user_id, full_name, personnel_code, department, role) VALUES ('5002','کارمند','N2','فنی','employee');
      INSERT INTO weekly_plans (user_id, week_start_date) VALUES (1, '2026-08-01');
      INSERT INTO plan_tasks (plan_id, title) VALUES (1, 'الف');
    `);
    const ins = (d, note) => db.prepare("INSERT INTO task_daily_logs (task_id, user_id, log_date, status, note) VALUES (1, 1, ?, 'done', ?)").run(d, note);
    ins('2026-08-03', 'ا'.repeat(500));
    assert.throws(() => ins('2026-08-04', 'ا'.repeat(501)), /CHECK/);
  });
});

describe('توضیحِ انجام و برداشتن پاسخ — سرویس (A1)', () => {
  let db; let svc; let plans; let logs; let settings; let attendance; let cal; let addDays; let u; let other; let TODAY; let YEST;

  const reset = () => {
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM break_records; DELETE FROM attendance_records; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM month_closures;');
    settings.setValue('dailyReportGateMode', 'off');
    settings.setValue('reportBackfillDays', 2);
  };
  const mk = (date, title, extra = {}, user = u) => {
    const week = cal.weekStartOf(date, settings.getAll().weekStartDay);
    return plans.addTask(plans.getOrCreate(user.id, week).id, { title, plannedDate: date, ...extra });
  };
  const answer = (answers, body = {}, user = u) => svc.submitDailyReport(user, { answers, ...body });
  const listIds = (date, user = u) => svc.getDailyTasks(user, { requestedDate: date }).tasks.map((t) => t.id);
  const logRow = (taskId, date = TODAY) => logs.findByTaskDate(taskId, date);

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    attendance = require('../src/repositories/attendanceRepository');
    cal = require('../src/engine/calendarService');
    ({ addDays } = require('../src/utils/shiftDay'));
    TODAY = require('../src/utils/serverTime').todayDateString();
    YEST = addDays(TODAY, -1);
    u = F.makeUser();
    other = F.makeUser();
  });
  after(cleanup);

  test('done با و بدون note: ذخیره، پاک‌سازی فاصله‌ها، خالی ⇒ null', () => {
    reset();
    const a = mk(TODAY, 'الف'); const b = mk(TODAY, 'ب'); const c = mk(TODAY, 'ج');
    const r = answer([
      { taskId: a.id, status: 'done', note: '  گزارش   را\nارسال کردم  ' },
      { taskId: b.id, status: 'done' },
      { taskId: c.id, status: 'done', note: '   ' },
    ]);
    assert.equal(r.ok, true);
    assert.equal(logRow(a.id).note, 'گزارش را ارسال کردم');
    assert.equal(logRow(b.id).note, null);
    assert.equal(logRow(c.id).note, null);
  });

  test('note طولانی (۵۰۱) رد می‌شود و هیچ‌چیز ذخیره نمی‌شود؛ ۵۰۰ مجاز؛ غیرمتن INVALID_NOTE', () => {
    reset();
    const a = mk(TODAY, 'الف');
    let r = answer([{ taskId: a.id, status: 'done', note: 'ا'.repeat(501) }]);
    assert.deepEqual([r.ok, r.code], [false, 'NOTE_TOO_LONG']);
    r = answer([{ taskId: a.id, status: 'done', note: 123 }]);
    assert.deepEqual([r.ok, r.code], [false, 'INVALID_NOTE']);
    assert.equal(logRow(a.id), null);
    r = answer([{ taskId: a.id, status: 'done', note: 'ا'.repeat(500) }]);
    assert.equal(r.ok, true);
    assert.equal(logRow(a.id).note.length, 500);
  });

  test('note برای partial/not_done نادیده گرفته می‌شود (reasonText همان می‌ماند)', () => {
    reset();
    const a = mk(TODAY, 'الف'); const b = mk(TODAY, 'ب');
    const r = answer([
      { taskId: a.id, status: 'not_done', reasonCode: 'no_time', note: 'نباید ذخیره شود' },
      { taskId: b.id, status: 'partial', reasonCode: 'other', reasonText: 'علت نمونه', note: 'نادیده' },
    ]);
    assert.equal(r.ok, true);
    assert.equal(logRow(a.id).note, null);
    assert.equal(logRow(b.id).note, null);
    assert.equal(logRow(b.id).reason_text, 'علت نمونه');
  });

  test('updateNote: ویرایش و پاک‌کردن؛ answered_at/وضعیت دست نمی‌خورد؛ روی غیر-done رد؛ طولانی رد', () => {
    reset();
    const a = mk(TODAY, 'الف'); const b = mk(TODAY, 'ب');
    answer([{ taskId: a.id, status: 'done', note: 'اول' }, { taskId: b.id, status: 'not_done', reasonCode: 'no_time' }]);
    const beforeRow = logRow(a.id);
    let r = svc.updateNote(u, { taskId: a.id, note: 'دوم' });
    assert.deepEqual([r.ok, r.note, r.cleared], [true, 'دوم', false]);
    const afterRow = logRow(a.id);
    assert.deepEqual([afterRow.status, afterRow.answered_at, afterRow.note], [beforeRow.status, beforeRow.answered_at, 'دوم']);
    r = svc.updateNote(u, { taskId: a.id, note: '' });
    assert.deepEqual([r.ok, r.note, r.cleared], [true, null, true]);
    assert.equal(logRow(a.id).note, null);
    assert.equal(svc.updateNote(u, { taskId: b.id, note: 'x' }).code, 'NOTE_ONLY_FOR_DONE');
    assert.equal(svc.updateNote(u, { taskId: a.id, note: 'ا'.repeat(501) }).code, 'NOTE_TOO_LONG');
    assert.equal(svc.updateNote(u, { taskId: a.id, note: 5 }).code, 'INVALID_NOTE');
    assert.equal(svc.updateNote(u, { taskId: 'x', note: 'a' }).code, 'INVALID_TASK');
  });

  test('undo: پاسخ حذف می‌شود و تسک به فهرست برمی‌گردد؛ پاسخِ تازه‌شده‌ی fresh در خروجی است', () => {
    reset();
    const a = mk(TODAY, 'الف'); const b = mk(TODAY, 'ب');
    answer([{ taskId: a.id, status: 'done', note: 'توضیح' }]);
    assert.deepEqual(listIds(TODAY), [b.id]);
    const r = svc.undoAnswer(u, { taskId: a.id });
    assert.equal(r.ok, true);
    assert.deepEqual([r.undone.taskId, r.undone.outOfPlan, r.undone.previousStatus], [a.id, false, 'done']);
    assert.equal(logRow(a.id), null);
    assert.deepEqual(r.tasks.map((t) => t.id).sort(), [a.id, b.id].sort());
    assert.equal(r.answered.length, 0);
    assert.equal(svc.undoAnswer(u, { taskId: a.id }).code, 'TASK_NOT_FOUND', 'بار دوم پاسخی نیست');
  });

  test('undo تسکِ منتقل‌شده: از روز مقصد هم برمی‌خیزد و در روز اول برمی‌گردد', () => {
    reset();
    const a = mk(TODAY, 'الف');
    const dest = addDays(TODAY, 3);
    const r0 = answer([{ taskId: a.id, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date: dest } }]);
    assert.equal(r0.ok, true);
    assert.ok(logs.listRescheduledTo(u.id, dest).length === 1);
    const r = svc.undoAnswer(u, { taskId: a.id });
    assert.equal(r.ok, true);
    assert.equal(logs.listRescheduledTo(u.id, dest).length, 0);
    assert.ok(listIds(TODAY).includes(a.id));
  });

  test('undo تسک «خارج از برنامه»: خودِ تسک حذف نرم می‌شود و دوباره بی‌پاسخ ظاهر نمی‌شود', () => {
    reset();
    const r0 = answer([], { extra: [{ title: 'کار اضافه' }] });
    assert.equal(r0.ok, true);
    const t = db.prepare("SELECT id FROM plan_tasks WHERE system_key = 'out_of_plan'").get();
    const r = svc.undoAnswer(u, { taskId: t.id });
    assert.equal(r.ok, true);
    assert.equal(r.undone.outOfPlan, true);
    assert.ok(plans.findTask(t.id).deleted_at);
    assert.equal(logRow(t.id), null);
    assert.ok(!listIds(TODAY).includes(t.id));
    assert.equal(r.answered.some((x) => x.taskId === t.id), false);
  });

  test('undo تسک سیستمیِ «بررسی گزارش تیم» ⇒ REVIEW_TASK_LOCKED و پاسخ می‌ماند', () => {
    reset();
    const teamReview = require('../src/services/teamReviewService');
    const t = mk(TODAY, 'بررسی گزارش تیم', { systemKey: teamReview.REVIEW_KEY, isSystem: true });
    logs.upsert({ taskId: t.id, userId: u.id, logDate: TODAY, status: 'done' });
    const r = svc.undoAnswer(u, { taskId: t.id });
    assert.deepEqual([r.ok, r.code], [false, 'REVIEW_TASK_LOCKED']);
    assert.ok(logRow(t.id));
  });

  test('تسک/پاسخ دیگران ⇒ TASK_NOT_FOUND (برای undo و note)', () => {
    reset();
    const t = mk(TODAY, 'مالِ دیگری', {}, other);
    logs.upsert({ taskId: t.id, userId: other.id, logDate: TODAY, status: 'done', note: 'خصوصی' });
    assert.equal(svc.undoAnswer(u, { taskId: t.id }).code, 'TASK_NOT_FOUND');
    assert.equal(svc.updateNote(u, { taskId: t.id, note: 'هک' }).code, 'TASK_NOT_FOUND');
    assert.equal(svc.undoAnswer(u, { taskId: 999999 }).code, 'TASK_NOT_FOUND');
    assert.equal(logRow(t.id).note, 'خصوصی');
  });

  test('تاریخ فقط با resolveReportDate: آینده/قالب نامعتبر/بدون رکورد/ماه بسته/پنجره‌ی backfill', () => {
    reset();
    const a = mk(YEST, 'دیروز');
    assert.equal(svc.undoAnswer(u, { taskId: a.id, date: addDays(TODAY, 1) }).code, 'DATE_IN_FUTURE');
    assert.equal(svc.undoAnswer(u, { taskId: a.id, date: 'abc' }).code, 'INVALID_DATE');
    assert.equal(svc.undoAnswer(u, { taskId: a.id, date: YEST }).code, 'NO_RECORD');
    attendance.createManual({ userId: u.id, recordDate: YEST, checkInTime: `${YEST}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' });
    logs.upsert({ taskId: a.id, userId: u.id, logDate: YEST, status: 'done', note: 'قدیمی', answeredLate: true });
    let r = svc.updateNote(u, { taskId: a.id, date: YEST, note: 'جدید' });
    assert.deepEqual([r.ok, r.note], [true, 'جدید'], 'backfill داخل پنجره مجاز است');
    settings.setValue('reportBackfillDays', 0);
    assert.equal(svc.undoAnswer(u, { taskId: a.id, date: YEST }).code, 'BACKFILL_EXPIRED');
    settings.setValue('reportBackfillDays', 2);
  });

  test('ماه بسته ⇒ MONTH_CLOSED برای undo و note و هیچ‌چیز تغییر نمی‌کند', () => {
    reset();
    const a = mk(YEST, 'دیروز');
    attendance.createManual({ userId: u.id, recordDate: YEST, checkInTime: `${YEST}T05:00:00.000Z`, checkOutTime: null, status: 'incomplete' });
    logs.upsert({ taskId: a.id, userId: u.id, logDate: YEST, status: 'done', note: 'قدیمی', answeredLate: true });
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1405, 1, 'closed', ?, ?)").run(addDays(YEST, -5), addDays(YEST, 5));
    assert.equal(svc.undoAnswer(u, { taskId: a.id, date: YEST }).code, 'MONTH_CLOSED');
    assert.equal(svc.updateNote(u, { taskId: a.id, date: YEST, note: 'جدید' }).code, 'MONTH_CLOSED');
    assert.equal(logRow(a.id, YEST).note, 'قدیمی');
  });
});

describe('route — undo و note (A1)', { skip: !hasDeps && 'express نصب نیست' }, () => {
  let srv; let svc; let plans; let settings; let cal; let u; let other; let TODAY; let db;
  const mk = (title, user = u) => plans.addTask(plans.getOrCreate(user.id, cal.weekStartOf(TODAY, settings.getAll().weekStartDay)).id, { title, plannedDate: TODAY });

  before(async () => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    cal = require('../src/engine/calendarService');
    TODAY = require('../src/utils/serverTime').todayDateString();
    u = F.makeUser();
    other = F.makeUser();
    srv = await startServer();
  });
  after(() => { srv.close(); cleanup(); });

  test('POST /daily-report با note، PATCH /daily-report/note، POST /daily-report/undo و audit', async () => {
    const a = mk('الف');
    let r = await srv.call(u, 'POST', 'daily-report', { answers: [{ taskId: a.id, status: 'done', note: 'انجام شد' }] });
    assert.equal(r.status, 200);
    assert.equal(db.prepare('SELECT note FROM task_daily_logs WHERE task_id = ?').get(a.id).note, 'انجام شد');

    r = await srv.call(u, 'PATCH', 'daily-report/note', { taskId: a.id, note: 'ویرایش‌شده' });
    assert.deepEqual([r.status, r.json.note], [200, 'ویرایش‌شده']);
    r = await srv.call(u, 'PATCH', 'daily-report/note', { taskId: a.id, note: 'ا'.repeat(501) });
    assert.deepEqual([r.status, r.json.code], [400, 'NOTE_TOO_LONG']);

    r = await srv.call(u, 'POST', 'daily-report/undo', { taskId: a.id });
    assert.equal(r.status, 200);
    assert.equal(r.json.undone.taskId, a.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM task_daily_logs WHERE task_id = ?').get(a.id).n, 0);
    r = await srv.call(u, 'POST', 'daily-report/undo', { taskId: a.id });
    assert.deepEqual([r.status, r.json.code], [404, 'TASK_NOT_FOUND']);

    const actions = db.prepare("SELECT action FROM audit_log WHERE user_id = ? AND action IN ('task_answer_undone','task_done_note_edited') ORDER BY id").all(u.id).map((x) => x.action);
    assert.deepEqual(actions, ['task_done_note_edited', 'task_answer_undone']);
  });

  test('مالکیت فقط از req.miniAppUser: پاسخ دیگران ⇒ ۴۰۴؛ NOTE_ONLY_FOR_DONE و REVIEW_TASK_LOCKED ⇒ ۴۰۹', async () => {
    const t = mk('مالِ دیگری', other);
    require('../src/repositories/taskLogRepository').upsert({ taskId: t.id, userId: other.id, logDate: TODAY, status: 'done', note: 'x' });
    let r = await srv.call(u, 'POST', 'daily-report/undo', { taskId: t.id, userId: other.id });
    assert.deepEqual([r.status, r.json.code], [404, 'TASK_NOT_FOUND']);
    r = await srv.call(u, 'PATCH', 'daily-report/note', { taskId: t.id, note: 'y' });
    assert.equal(r.status, 404);

    const nd = mk('ب');
    await srv.call(u, 'POST', 'daily-report', { answers: [{ taskId: nd.id, status: 'not_done', reasonCode: 'no_time' }] });
    r = await srv.call(u, 'PATCH', 'daily-report/note', { taskId: nd.id, note: 'y' });
    assert.deepEqual([r.status, r.json.code], [409, 'NOTE_ONLY_FOR_DONE']);

    const teamReview = require('../src/services/teamReviewService');
    const rv = plans.addTask(plans.getOrCreate(u.id, cal.weekStartOf(TODAY, settings.getAll().weekStartDay)).id, { title: 'بررسی', plannedDate: TODAY, systemKey: teamReview.REVIEW_KEY, isSystem: true });
    require('../src/repositories/taskLogRepository').upsert({ taskId: rv.id, userId: u.id, logDate: TODAY, status: 'done' });
    r = await srv.call(u, 'POST', 'daily-report/undo', { taskId: rv.id });
    assert.deepEqual([r.status, r.json.code], [409, 'REVIEW_TASK_LOCKED']);
  });
});
