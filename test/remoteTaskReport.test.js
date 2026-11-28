// گزارش تسک‌ها هنگام پایان دورکاری: اعتبارسنجی (جمع ≤ ساعت خالص، حداقل پوشش)، ثبت در برنامه امروز با ساعت، دیده‌شدن برای سرپرست.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, cleanup } = require('./helpers/testEnv');

describe('گزارش تسک‌های پایان دورکاری', () => {
  let F; let svc; let remote; let plansRepo; let logsRepo; let repo; let sup; let emp;
  before(() => {
    resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/remoteTaskReportService');
    remote = require('../src/services/remoteWorkService');
    plansRepo = require('../src/repositories/weeklyPlanRepository');
    logsRepo = require('../src/repositories/taskLogRepository');
    repo = require('../src/repositories/remoteWorkRepository');
    sup = F.makeUser({ role: 'manager', name: 'سرپرست' });
    emp = F.makeUser({ name: 'کارمند', managerId: sup.id });
  });
  after(() => cleanup());

  const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 25, h, m)); // ۲۵ نوامبر ۲۰۲۶ (چهارشنبه)

  test('parseMinutes: عدد، ۱:۳۰، ساعت/دقیقه، ارقام فارسی؛ نامعتبر ⇒ null', () => {
    assert.equal(svc.parseMinutes('45'), 45);
    assert.equal(svc.parseMinutes('۴۵'), 45);
    assert.equal(svc.parseMinutes('1:30'), 90);
    assert.equal(svc.parseMinutes('۲ ساعت'), 120);
    assert.equal(svc.parseMinutes('1.5 ساعت'), 90);
    assert.equal(svc.parseMinutes('2 ساعت و 15 دقیقه'), 135);
    assert.equal(svc.parseMinutes('0'), null);
    assert.equal(svc.parseMinutes('abc'), null);
    assert.equal(svc.parseMinutes('5000'), null);
  });

  test('validate: خالی/بیش‌ازحد/عنوان/مدت/جمع بیشتر از ساعت خالص/پوشش کم', () => {
    const cfg = { remoteTaskCoveragePercent: 70 };
    assert.equal(svc.validate([], 240, cfg).code, 'REMOTE_TASKS_REQUIRED');
    assert.equal(svc.validate([{ title: ' ', minutes: 30 }], 240, cfg).code, 'REMOTE_TASK_TITLE');
    assert.equal(svc.validate([{ title: 'الف', minutes: 'x' }], 240, cfg).code, 'REMOTE_TASK_MINUTES');
    assert.equal(svc.validate([{ title: 'الف', minutes: 300 }], 240, cfg).code, 'REMOTE_TASKS_OVER');
    assert.equal(svc.validate([{ title: 'الف', minutes: 60 }], 240, cfg).code, 'REMOTE_TASKS_UNDER');
    const ok = svc.validate([{ title: 'الف', minutes: 120 }, { title: 'ب', minutes: '1:00' }], 240, cfg);
    assert.equal(ok.ok, true); assert.equal(ok.total, 180);
    assert.equal(svc.validate([{ title: 'الف', minutes: 10 }], 240, { remoteTaskCoveragePercent: 0 }).ok, true, 'پوشش ۰ = بدون الزام');
  });

  test('پایان با تسک: نشست بسته می‌شود، گزارش ذخیره، تسک‌ها با ساعت در برنامه امروز و «انجام‌شده»', () => {
    const start = remote.start(emp, { now: at(5, 0), source: 'bot' }); // ۰۸:۳۰ تهران
    assert.equal(start.ok, true, JSON.stringify(start));
    const noTasks = svc.endWithTasks(emp, [], { now: at(9, 0), source: 'bot' });
    assert.equal(noTasks.code, 'REMOTE_TASKS_REQUIRED');
    assert.ok(repo.findOpenSession(emp.id), 'با خطا نشست بسته نمی‌شود');
    const over = svc.endWithTasks(emp, [{ title: 'خیلی طولانی', minutes: 600 }], { now: at(9, 0), source: 'bot' });
    assert.equal(over.code, 'REMOTE_TASKS_OVER');
    const r = svc.endWithTasks(emp, [{ title: 'پاسخ به مشتری‌ها', minutes: '1:30' }, { title: 'تهیه‌ی گزارش', minutes: 120 }], { now: at(9, 0), source: 'bot' }); // ۴ ساعت = ۲۴۰ دقیقه
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.totalMinutes, 210);
    assert.equal(r.planSynced, false, 'پیش از تأیید در برنامه نمی‌نشیند');
    let saved = repo.listSessionTasks(r.session.id);
    assert.ok(saved.every((t) => !t.plan_task_id), 'پیش از تأیید ادمین، تسکی در برنامه ساخته نمی‌شود');
    const ap = require('../src/services/remoteWorkAdminService').approve(sup, r.session.id, {}, { now: at(12, 0) });
    assert.equal(ap.ok, true, JSON.stringify(ap));
    saved = repo.listSessionTasks(r.session.id);
    assert.deepEqual(saved.map((t) => [t.title, t.minutes]), [['پاسخ به مشتری‌ها', 90], ['تهیه‌ی گزارش', 120]]);
    assert.ok(saved.every((t) => t.plan_task_id));
    const t1 = plansRepo.findTask(saved[0].plan_task_id); const t2 = plansRepo.findTask(saved[1].plan_task_id);
    assert.equal(t1.scheduled_start_time, '08:30'); assert.equal(t1.urgent_deadline_time, '10:00');
    assert.equal(t2.scheduled_start_time, '10:00'); assert.equal(t2.urgent_deadline_time, '12:00');
    assert.equal(t1.planned_date, r.session.work_date);
    assert.equal(t1.system_key, 'remote_work', 'برچسب «دورکاری» (نه فوری) در UI');
    assert.equal(t1.is_system, 0);
    const log = logsRepo.findByTaskDate(t1.id, r.session.work_date);
    assert.equal(log.status, 'done');
    assert.match(log.note, /دورکاری/);
  });

  test('سرپرست در صف بررسی تسک‌ها را می‌بیند', () => {
    const adminSvc = require('../src/services/remoteWorkAdminService');
    const q = adminSvc.listQueue(sup, { status: 'all' });
    assert.equal(q.ok, true);
    const item = q.items.find((i) => i.employee && i.employee.id === emp.id);
    assert.ok(item, 'نشستِ کارمند در صف است');
    assert.equal(item.tasks.length, 2);
    assert.equal(item.tasksMinutes, 210);
  });

  test('مسیر قدیمی remote.end بدون گزارش سر جایش کار می‌کند؛ تنظیم remoteEndTasksRequired در دسترس است', () => {
    const e2 = F.makeUser({ name: 'کارمند دو', managerId: sup.id });
    assert.equal(remote.start(e2, { now: at(5, 0) }).ok, true);
    assert.equal(remote.end(e2, { now: at(6, 0) }).ok, true);
    const req = svc.requirements();
    assert.equal(req.required, true);
    assert.equal(req.coveragePercent, 70);
  });

  test('جریان بات: پایان ← عنوان ← مدت (متن و دکمه) ← ثبت و پایان؛ تسک‌ها در برنامه امروز', async () => {
    const bot = require('../src/bot/commands/remoteWork');
    const session = require('../src/bot/session');
    const e3 = F.makeUser({ name: 'کارمند بات', managerId: sup.id });
    const tg = Number(e3.telegram_user_id);
    const sent = [];
    const fake = { sendMessage: async (c, t) => { sent.push(t); return {}; }, editMessageText: async (t) => { sent.push(t); return {}; }, answerCallbackQuery: async () => ({}) };
    const chat = { id: 777001, type: 'private' };
    const click = (data) => bot.handleRemoteWorkCallback(fake, { id: 'q', from: { id: tg }, message: { chat, message_id: 1 }, data });
    const say = (text) => bot.handleRemoteEndText(fake, { chat, from: { id: tg }, text }, session.get(chat.id));
    const st = remote.start(e3, { now: new Date(Date.now() - 3 * 3600000), source: 'bot' }); // ۳ ساعت پیش
    assert.equal(st.ok, true);
    await click(`rw:e:${st.session.id}`);
    assert.equal(session.get(chat.id).flow, 'remote_end');
    await click('rw:ef'); // بدون تسک ⇒ دکمه‌ی ثبت وجود ندارد اما حتی با فشار هم سرور رد می‌کند
    assert.ok(repo.findOpenSession(e3.id), 'بدون تسک بسته نمی‌شود');
    await say('جلسه با مشتری');
    await say('90');
    await click('rw:ta');
    await say('پیگیری سفارش‌ها');
    await click('rw:t:60');
    assert.equal(session.get(chat.id).data.tasks.length, 2);
    await click('rw:ef');
    assert.equal(repo.findOpenSession(e3.id), null, 'نشست بسته شد');
    assert.equal(session.get(chat.id), null, 'مکالمه پاک شد');
    const rows = repo.listSessionTasks(st.session.id);
    assert.deepEqual(rows.map((t) => [t.title, t.minutes]), [['جلسه با مشتری', 90], ['پیگیری سفارش‌ها', 60]]);
    assert.ok(rows.every((t) => !t.plan_task_id), 'پیش از تأیید در برنامه نیست');
    assert.ok(sent.some((t) => /پس از تأیید سرپرست/.test(t)), 'پیام نهایی می‌گوید پس از تأیید ثبت می‌شود');
  });

  test('مالک دورکاریِ خودش را تأیید می‌کند (audit: selfReview)؛ ادمین و سرپرست نه', () => {
    const adminSvc = require('../src/services/remoteWorkAdminService');
    const owner = F.makeUser({ role: 'owner', name: 'مالک' });
    const adm = F.makeUser({ role: 'admin', name: 'ادمین خودتأیید' });
    const mk = (u, h) => { const st = remote.start(u, { now: at(h, 0) }); assert.equal(st.ok, true); const en = remote.end(u, { now: at(h + 1, 0) }); assert.equal(en.ok, true); return en.session.id; };
    const ownId = mk(owner, 5); const admId = mk(adm, 5);
    assert.equal(adminSvc.approve(adm, admId, {}, { now: at(12, 0) }).code, 'SELF_NOT_ALLOWED');
    assert.equal(adminSvc.reject(adm, admId, { reviewNote: 'x' }, { now: at(12, 0) }).code, 'SELF_NOT_ALLOWED');
    const r = adminSvc.approve(owner, ownId, {}, { now: at(12, 0) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(repo.findSessionFull(ownId).status, 'approved');
    const { getDb } = require('../src/db/connection');
    const row = getDb().prepare("SELECT * FROM audit_log WHERE action = 'remote_work_approve' ORDER BY id DESC LIMIT 1").get();
    assert.match(JSON.stringify(row), /selfReview/);
    assert.match(JSON.stringify(row), /true/);
  });
});
