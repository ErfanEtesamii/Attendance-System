// D11: بخش «📋 گزارش تسک‌های امروز» در مرور شبانه — محتوا، گیرنده‌ها/اسکوپ، تقسیم طول، دکمه‌های مشاهده/کامنت.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

const D = '2026-08-03'; // یکشنبه (کاری)
const THU = '2026-08-06'; // روز ثبت برنامه‌ی هفته‌ی ۰۸-۰۱ (آخرین روز کاری)

describe('گزارش شبانه‌ی تسک‌ها (D11)', () => {
  let db; let svc; let plans; let logs; let nightly; let review; let rr; let sessionMod;
  let boss; let boss2; let a; let b; let c; let admin; let solo;
  const wk = (d) => require('../src/engine/calendarService').weekStartOf(d, 6);
  const task = (u, date, title, status, extra = {}, taskExtra = {}) => {
    const p = plans.getOrCreate(u.id, wk(date));
    const t = plans.addTask(p.id, { title, plannedDate: date, ...taskExtra });
    if (status) logs.upsert({ taskId: t.id, userId: u.id, logDate: date, status, ...extra });
    return t;
  };
  const reset = () => db.exec('DELETE FROM settings; DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications;');
  const reportFor = (reviewer, date = D) => svc.buildNightlyTaskReports(date).find((r) => r.reviewer.id === reviewer.id);

  before(() => {
    db = resetDb();
    svc = require('../src/services/nightlyTaskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    nightly = require('../src/bot/scheduler/nightlyReview');
    review = require('../src/bot/commands/reportReview');
    rr = require('../src/repositories/reportReviewRepository');
    sessionMod = require('../src/bot/session');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    boss = F.makeUser({ role: 'manager', name: 'سرپرست‌الف', managerId: admin.id });
    boss2 = F.makeUser({ role: 'manager', name: 'سرپرست‌ب' });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    b = F.makeUser({ managerId: boss.id, name: 'بهزاد' });
    c = F.makeUser({ managerId: boss2.id, name: 'ناهید' });
    solo = F.makeUser({ name: 'بی‌سرپرست' });
  });
  after(cleanup);

  test('محتوا: «۴ از ۵ انجام شد (۸۰٪)»، انجام‌نشده با علت و انتقال، خارج از برنامه، گزارش‌نداده', () => {
    reset();
    for (let i = 0; i < 4; i += 1) task(a, D, `تسک ${i}`, 'done');
    task(a, D, 'کار ناتمام', 'not_done', { reasonCode: 'no_time', rescheduleTo: '2026-08-04' });
    task(a, D, 'کار بیرونی', 'done', {}, { systemKey: 'out_of_plan' });
    task(b, D, 'تسک بدون پاسخ', null);
    const r = reportFor(boss);
    const text = r.messages.join('\n');
    assert.match(text, /علی — 4 از 5 انجام شد \(80٪\)/);
    assert.match(text, /✗ کار ناتمام — وقت نشد \(منتقل به /);
    assert.match(text, /➕ 1 کار خارج از برنامه/);
    assert.match(text, /بهزاد — گزارش نداده ⚠️/);
    assert.match(text, /خلاصه‌ی تیم: 80٪/);
    assert.match(text, /وقت نشد \(1\)/);
    assert.deepEqual(r.commentTargets.map((t) => t.userId), [a.id]);
  });

  test('حذف‌شده (drop) و معطل‌مانده 🔴 و برنامه‌ی هفته‌ی بعد در روز ثبت', () => {
    reset();
    task(a, D, 'حذفی', 'not_done', { reasonCode: 'other', reasonText: 'نیاز نیست', rescheduleTo: 'drop' });
    const p = plans.getOrCreate(a.id, wk(D));
    const t = plans.addTask(p.id, { title: 'گیر کرده' });
    logs.upsert({ taskId: t.id, userId: a.id, logDate: '2026-08-02', status: 'not_done', reasonCode: 'no_time', rescheduleTo: '2026-08-03' });
    logs.upsert({ taskId: t.id, userId: a.id, logDate: D, status: 'not_done', reasonCode: 'no_time', rescheduleTo: '2026-08-04' });
    const text = reportFor(boss).messages.join('\n');
    assert.match(text, /\(حذف شد\)/);
    assert.match(text, /🔴 معطل‌مانده: گیر کرده \(2 بار منتقل شده\)/);
    assert.doesNotMatch(text, /برنامه‌ی هفته‌ی بعد ثبت نشده/, 'D روز ثبت برنامه نیست');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('plan_gate_mode', 'soft')").run();
    task(a, THU, 'x', 'done');
    assert.match(reportFor(boss, THU).messages.join('\n'), /علی[^]*⚠️ برنامه‌ی هفته‌ی بعد ثبت نشده/);
  });

  test('گیرنده‌ها: هر تیم فقط اعضای خودش؛ سرپرست ⇒ مدیر بالادست؛ بدون سرپرست ⇒ ادمین؛ خلاصه‌ی شرکت فقط ادمین', () => {
    reset();
    task(a, D, 't1', 'done'); task(c, D, 't2', 'done'); task(solo, D, 't3', 'done'); task(boss, D, 't4', 'done');
    const t1 = reportFor(boss).messages.join('\n');
    assert.match(t1, /علی/); assert.doesNotMatch(t1, /ناهید|بی‌سرپرست/);
    assert.doesNotMatch(t1, /خلاصه‌ی کل شرکت/);
    const t2 = reportFor(boss2).messages.join('\n');
    assert.match(t2, /ناهید/); assert.doesNotMatch(t2, /علی/);
    const ta = reportFor(admin).messages.join('\n');
    assert.match(ta, /سرپرست‌الف/, 'سرپرست به ادمین گزارش می‌شود');
    assert.match(ta, /بی‌سرپرست/);
    assert.match(ta, /خلاصه‌ی کل شرکت/);
    assert.match(ta, /تیم سرپرست‌الف: 100٪/);
    assert.doesNotMatch(ta, /ناهید/, 'ناهید زیر سرپرست‌ب است، ادمین مستقیم نیست');
  });

  test('تیم بدون هیچ عضوِ کاری ⇒ پیام ساخته نمی‌شود؛ تیم‌های بدون بررسی در خلاصه‌ی ادمین', () => {
    reset();
    assert.equal(reportFor(boss2, '2026-08-07'), undefined, 'جمعه غیرکاری');
    task(c, D, 't', 'done');
    assert.match(reportFor(admin).messages.join('\n'), /تیم‌های بدون بررسی: .*سرپرست‌ب/);
    rr.upsert({ reviewerId: boss2.id, subjectUserId: c.id, reportDate: D });
    assert.doesNotMatch(reportFor(admin).messages.join('\n'), /تیم‌های بدون بررسی: .*سرپرست‌ب/);
  });

  test('تقسیم طول: هیچ پیامی بیش از ۴۰۹۶؛ حداکثر ۳ پیام؛ باقی ⇒ خلاصه + پنل', () => {
    reset();
    const many = [];
    for (let i = 0; i < 40; i += 1) many.push(F.makeUser({ managerId: boss2.id, name: `عضو-${i}` }));
    many.forEach((u) => { for (let j = 0; j < 6; j += 1) task(u, D, `عنوان بلند تسک ${'ا'.repeat(100)} ${j}`, 'not_done', { reasonCode: 'no_time', rescheduleTo: '2026-08-04' }); });
    const r = reportFor(boss2);
    assert.ok(r.messages.length >= 2 && r.messages.length <= svc.MAX_PARTS);
    r.messages.forEach((m) => assert.ok(m.length <= svc.TG_LIMIT, `طول ${m.length}`));
    assert.ok(r.omitted > 0);
    assert.match(r.messages[r.messages.length - 1], /گزارش کامل در پنل/);
    assert.ok(r.commentTargets.length <= 8);
    db.exec('DELETE FROM users WHERE full_name LIKE \'عضو-%\'');
  });

  test('sendNightlyTaskReports با بات ماک: دکمه‌ها ≤ ۶۴ بایت؛ خطای یک گیرنده بقیه را نمی‌شکند', async () => {
    reset();
    task(a, D, 't', 'done'); task(c, D, 't', 'done');
    const sent = [];
    const bot = { sendMessage: async (chat, text, opts) => { if (String(chat) === String(boss2.telegram_user_id)) throw new Error('blocked'); sent.push({ chat: String(chat), text, opts }); } };
    const n = await nightly.sendNightlyTaskReports(bot, D);
    assert.ok(n >= 1);
    const m = sent.find((s) => s.chat === String(boss.telegram_user_id));
    assert.ok(m);
    const cbs = m.opts.reply_markup.inline_keyboard.flat().map((x) => x.callback_data).filter(Boolean);
    assert.deepEqual(cbs, [`rvs:${a.id}:${D}`, `rvc:${a.id}:${D}`]);
    cbs.forEach((x) => assert.ok(Buffer.byteLength(x) <= 64));
  });

  test('دکمه‌ی «مشاهده شد» و جریان کامنت؛ کارمند/منقضی ردّ می‌شود', async () => {
    reset();
    const RD = require('../src/utils/shiftDay').addDays(require('../src/utils/serverTime').todayDateString(), -2); // سقف ۶۰ روزه نسبت به «امروز» واقعی
    task(a, RD, 't', 'done');
    const answers = []; const msgs = [];
    const bot = { answerCallbackQuery: async (id, o) => answers.push(o || {}), sendMessage: async (chat, text) => msgs.push(text) };
    const q = (from, data) => ({ id: 'q', data, from: { id: Number(from.telegram_user_id) }, message: { chat: { id: Number(from.telegram_user_id) }, message_id: 1 } });
    await review.handleReportReviewCallback(bot, q(a, `rvs:${a.id}:${RD}`));
    assert.match(answers.pop().text, /دسترسی|اجازه|عضو|مجاز|سرپرست/);
    assert.equal(rr.find(boss.id, a.id, RD), null);
    await review.handleReportReviewCallback(bot, q(boss, 'rvs:abc'));
    assert.match(answers.pop().text, /منقضی/);
    await review.handleReportReviewCallback(bot, q(boss, `rvs:${a.id}:${RD}`));
    assert.match(answers.pop().text, /مشاهده شد/);
    assert.ok(rr.find(boss.id, a.id, RD));
    await review.handleReportReviewCallback(bot, q(boss, `rvc:${a.id}:${RD}`));
    const chat = Number(boss.telegram_user_id);
    const sess = sessionMod.get(chat);
    assert.equal(sess.flow, 'report_comment');
    await review.handleReportCommentText(bot, { chat: { id: chat }, from: { id: chat }, text: 'دمت گرم' }, sess);
    assert.equal(rr.find(boss.id, a.id, RD).comment, 'دمت گرم');
    assert.equal(sessionMod.get(chat), null);
    await review.handleReportReviewCallback(bot, q(boss, `rvc:${a.id}:${RD}`));
    await review.handleReportCommentText(bot, { chat: { id: chat }, from: { id: chat }, text: 'انصراف' }, sessionMod.get(chat));
    assert.equal(sessionMod.get(chat), null);
  });
});
