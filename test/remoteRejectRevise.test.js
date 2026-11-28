// ردِ دورکاری با دلیل ⇒ کارمند تسک‌ها را اصلاح (اضافه/کم) یا همان‌ها را دوباره می‌فرستد ⇒ دوباره در صف ادمین؛ ثبت در برنامه فقط پس از تأیید.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { resetDb, cleanup } = require('./helpers/testEnv');

describe('اصلاح و ارسال مجدد دورکاریِ ردشده', () => {
  let F; let svc; let remote; let repo; let admin; let sup; let db;
  before(() => {
    resetDb();
    F = require('./helpers/factories');
    svc = require('../src/services/remoteTaskReportService');
    remote = require('../src/services/remoteWorkService');
    repo = require('../src/repositories/remoteWorkRepository');
    admin = require('../src/services/remoteWorkAdminService');
    db = require('../src/db/connection').getDb();
    sup = F.makeUser({ role: 'manager', name: 'سرپرست' });
  });
  after(() => cleanup());
  const at = (h, m = 0) => new Date(Date.UTC(2026, 10, 25, h, m)); // ۴ ساعت خالص: ۰۸:۳۰ تا ۱۲:۳۰ تهران

  const rejected = (emp, tasks = [{ title: 'کار اول', minutes: 120 }, { title: 'کار دوم', minutes: 90 }]) => {
    assert.equal(remote.start(emp, { now: at(5, 0), source: 'bot' }).ok, true);
    const r = svc.endWithTasks(emp, tasks, { now: at(9, 0), source: 'bot' });
    assert.equal(r.ok, true, JSON.stringify(r));
    const rj = admin.reject(sup, r.session.id, { reviewNote: 'تسک‌ها با ساعتت نمی‌خواند' }, { now: at(10, 0) });
    assert.equal(rj.ok, true, JSON.stringify(rj));
    return r.session.id;
  };

  test('اصلاح تسک‌ها: خطای اعتبارسنجی نشست را عوض نمی‌کند؛ اصلاح معتبر ⇒ pending، تسک‌ها جایگزین، اعلان به ادمین، audit', () => {
    const emp = F.makeUser({ name: 'کارمند الف', managerId: sup.id });
    const id = rejected(emp);
    assert.equal(repo.findSessionFull(id).status, 'rejected');
    const bad = svc.reviseAfterReject(emp, id, [{ title: 'خیلی زیاد', minutes: 900 }]);
    assert.equal(bad.code, 'REMOTE_TASKS_OVER');
    assert.equal(repo.findSessionFull(id).status, 'rejected');
    const ok = svc.reviseAfterReject(emp, id, [{ title: 'کار اول', minutes: 120 }, { title: 'کار سوم', minutes: 100 }]);
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const s = repo.findSessionFull(id);
    assert.equal(s.status, 'pending'); assert.equal(s.review_note, null);
    assert.deepEqual(repo.listSessionTasks(id).map((t) => [t.title, t.minutes]), [['کار اول', 120], ['کار سوم', 100]]);
    const a = db.prepare("SELECT * FROM audit_log WHERE action = 'remote_work_resubmit' ORDER BY id DESC LIMIT 1").get();
    assert.match(JSON.stringify(a), /تسک‌ها با ساعتت نمی‌خواند/);
    const n = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'remote_work_submitted' ORDER BY id DESC").get(sup.id);
    assert.match(n.title, /اصلاح‌شده/); assert.match(n.body, /دلیل رد قبلی/);
  });

  test('ارسال مجدد بدون تغییر؛ تکرار و کاربر دیگر ⇒ خطا؛ تأیید بعدی تسک‌ها را در برنامه می‌نشاند', () => {
    const emp = F.makeUser({ name: 'کارمند ب', managerId: sup.id });
    const other = F.makeUser({ name: 'کارمند ج', managerId: sup.id });
    const id = rejected(emp);
    assert.equal(svc.reviseAfterReject(other, id, null).code, 'SESSION_NOT_FOUND');
    const r = svc.reviseAfterReject(emp, id, null);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(repo.listSessionTasks(id).length, 2);
    assert.equal(svc.reviseAfterReject(emp, id, null).code, 'NOT_REJECTED');
    assert.ok(repo.listSessionTasks(id).every((t) => !t.plan_task_id), 'تا تأیید در برنامه نیست');
    const ap = admin.approve(sup, id, {}, { now: at(12, 0) });
    assert.equal(ap.ok, true, JSON.stringify(ap));
    assert.ok(repo.listSessionTasks(id).every((t) => t.plan_task_id), 'پس از تأیید در برنامه می‌نشیند');
  });

  test('کم کردن ساعت مفید: پایان زودتر ثبت می‌شود تا ساعت خالص = جمع تسک‌ها؛ دوباره در صف؛ اگر چیزی برای کم‌کردن نباشد خطا', () => {
    const emp = F.makeUser({ name: 'کارمند د', managerId: sup.id });
    const id = rejected(emp, [{ title: 'الف', minutes: 120 }, { title: 'ب', minutes: 60 }]); // ۱۸۰ از ۲۴۰
    const p = svc.previewTrim(emp, id);
    assert.equal(p.ok, true, JSON.stringify(p)); assert.equal(p.fromNet, 240); assert.equal(p.toNet, 180);
    const r = svc.trimToTasks(emp, id);
    assert.equal(r.ok, true, JSON.stringify(r));
    const s = repo.findSessionFull(id);
    assert.equal(s.status, 'pending'); assert.equal(s.end_at, at(8, 0).toISOString());
    assert.equal(svc.previewTrim(emp, id).code, 'NOT_REJECTED');
    const emp2 = F.makeUser({ name: 'کارمند ه', managerId: sup.id });
    const id2 = rejected(emp2, [{ title: 'الف', minutes: 240 }]); // برابر ساعت؛ چیزی برای کم‌کردن نیست
    assert.equal(svc.previewTrim(emp2, id2).code, 'NOTHING_TO_TRIM');
  });

  test('پذیرفتن رد شدن: ردشده می‌ماند و دیگر نه ارسال مجدد نه کم‌کردن ممکن است', () => {
    const emp = F.makeUser({ name: 'کارمند و', managerId: sup.id });
    const id = rejected(emp);
    assert.equal(svc.acceptRejection(emp, id).ok, true);
    assert.equal(svc.acceptRejection(emp, id).already, true);
    assert.equal(repo.findSessionFull(id).status, 'rejected');
    assert.equal(svc.reviseAfterReject(emp, id, null).code, 'REJECT_ACCEPTED');
    assert.equal(svc.previewTrim(emp, id).code, 'REJECT_ACCEPTED');
  });

  test('بات: دکمه‌های «کم کردن» (حذف با شماره) و «اضافه» و «ارسال مجدد»', async () => {
    const bot = require('../src/bot/commands/remoteWork');
    const session = require('../src/bot/session');
    const emp = F.makeUser({ name: 'کارمند بات', managerId: sup.id });
    const tg = Number(emp.telegram_user_id);
    const sent = [];
    const fake = { sendMessage: async (c, t) => { sent.push(t); return {}; }, editMessageText: async (t) => { sent.push(t); return {}; }, answerCallbackQuery: async () => ({}) };
    const chat = { id: 777002, type: 'private' };
    const click = (data) => bot.handleRemoteWorkCallback(fake, { id: 'q', from: { id: tg }, message: { chat, message_id: 1 }, data });
    const say = (text) => bot.handleRemoteEndText(fake, { chat, from: { id: tg }, text }, session.get(chat.id));
    const id = rejected(emp, [{ title: 'کار اول', minutes: 120 }, { title: 'کار دوم', minutes: 120 }]);
    await click(`rw:rvd:${id}`);
    assert.equal(session.get(chat.id).flow, 'remote_revise');
    assert.match(sent.pop(), /دلیل ادمین/);
    await click('rw:td:1');
    assert.equal(session.get(chat.id).data.tasks.length, 1);
    await click('rw:ta'); await say('کار جدید'); await say('60');
    assert.equal(session.get(chat.id).data.tasks.length, 2);
    await click('rw:ef');
    assert.equal(repo.findSessionFull(id).status, 'pending');
    assert.deepEqual(repo.listSessionTasks(id).map((t) => [t.title, t.minutes]), [['کار اول', 120], ['کار جدید', 60]]);
    assert.equal(session.get(chat.id), null);
    // دکمه‌ی قدیمی پس از ارسال دوباره بی‌اثر است
    await click(`rw:rvs:${id}`);
    assert.match(sent.pop(), /دیگر در وضعیت/);
  });
});

describe('اعلان ردِ دورکاری با دکمه‌های اصلاح', () => {
  test('ردِ نشستِ دارای گزارش ⇒ اعلان با توضیح چهار گزینه', async () => {
    resetDb();
    const F = require('./helpers/factories');
    const notifSvc = require('../src/services/notificationService');
    const sentOpts = [];
    const sup = F.makeUser({ role: 'manager', name: 'سرپرست' });
    const emp = F.makeUser({ name: 'کارمند', managerId: sup.id });
    const remote = require('../src/services/remoteWorkService');
    const svc = require('../src/services/remoteTaskReportService');
    const admin = require('../src/services/remoteWorkAdminService');
    const ev = require('../src/services/notificationEvents');
    const at = (h) => new Date(Date.UTC(2026, 10, 25, h, 0));
    remote.start(emp, { now: at(5), source: 'bot' });
    const r = svc.endWithTasks(emp, [{ title: 'الف', minutes: 200 }], { now: at(9), source: 'bot' });
    const rj = admin.reject(sup, r.session.id, { reviewNote: 'اصلاح کن' }, { now: at(10) });
    assert.equal(rj.ok, true);
    await new Promise((res) => setTimeout(res, 50));
    const row = require('../src/db/connection').getDb().prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'remote_work_rejected'").get(emp.id);
    assert.ok(row, 'اعلان رد ساخته شد');
    assert.match(row.body, /ساعت مفیدم را کم می‌کنم/); assert.match(row.body, /مفید نبوده/);
    void notifSvc; void sentOpts; void ev;
    cleanup();
  });
});

describe('API دورکاری‌های ردشده‌ی خودِ کاربر (وضعیت من)', () => {
  test('فقط ردشده‌های خودِ کاربر با دلیل و نام ردکننده؛ پذیرفته‌شده علامت می‌خورد؛ کاربر دیگر نمی‌بیند', async () => {
    resetDb();
    const F = require('./helpers/factories');
    const remote = require('../src/services/remoteWorkService');
    const svc = require('../src/services/remoteTaskReportService');
    const admin = require('../src/services/remoteWorkAdminService');
    const express = require('express');
    const sup = F.makeUser({ role: 'manager', name: 'سرپرست محترم' });
    const emp = F.makeUser({ name: 'کارمند', managerId: sup.id });
    const other = F.makeUser({ name: 'دیگری', managerId: sup.id });
    const d = new Date(); const day = (h) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0));
    remote.start(emp, { now: day(1), source: 'bot' });
    const r = svc.endWithTasks(emp, [{ title: 'الف', minutes: 200 }], { now: day(5), source: 'bot' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(admin.reject(sup, r.session.id, { reviewNote: 'با ساعت نمی‌خواند' }).ok, true);
    const router = require('../src/api/routes/admin/myRemote');
    const call = (user) => new Promise((resolve) => {
      const layer = router.stack.find((l) => l.route && l.route.path === '/admin/me/remote/rejected');
      const handler = layer.route.stack[layer.route.stack.length - 1].handle;
      handler({ adminUser: user, query: {} }, { json: resolve });
    });
    const mine = await call(emp);
    assert.equal(mine.items.length, 1);
    assert.equal(mine.items[0].reviewNote, 'با ساعت نمی‌خواند');
    assert.equal(mine.items[0].reviewerName, 'سرپرست محترم');
    assert.equal(mine.items[0].tasks.length, 1); assert.equal(mine.items[0].canRevise, true); assert.equal(mine.items[0].accepted, false);
    assert.equal((await call(other)).items.length, 0, 'کاربر دیگر نمی‌بیند');
    svc.acceptRejection(emp, r.session.id);
    const after = await call(emp);
    assert.equal(after.items[0].accepted, true); assert.equal(after.items[0].canRevise, false);
    void express;
  });
});
