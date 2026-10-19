// D11 + H1/H2/H3 (فاز ۱۵): بخش «📋 گزارش تسک‌های امروز» در مرور شبانه — محتوا، گیرنده‌ها/اسکوپ، تقسیم طول، دکمه‌های مشاهده/کامنت.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
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

  test('محتوا: «۴ از ۵ انجام شد (۸۰٪)»، انجام‌نشده با علت و انتقال، خارج از برنامه، بدون وضعیت (H1)', () => {
    reset();
    for (let i = 0; i < 4; i += 1) task(a, D, `تسک ${i}`, 'done');
    task(a, D, 'کار ناتمام', 'not_done', { reasonCode: 'no_time', rescheduleTo: '2026-08-04' });
    task(a, D, 'کار بیرونی', 'done', {}, { systemKey: 'out_of_plan' });
    task(b, D, 'تسک بدون پاسخ', null);
    const r = reportFor(boss);
    const text = r.messages.join('\n');
    assert.match(text, /علی — 4 از 5 انجام شد \(80٪\) · 1 نیمه\/انجام‌نشده/);
    assert.match(text, /✗ کار ناتمام — وقت نشد \(منتقل به /);
    assert.match(text, /➕ 1 کار خارج از برنامه/);
    assert.match(text, /بهزاد — 0 از 1 انجام شد · ⏳ 1 بدون وضعیت/);
    assert.doesNotMatch(text, /گزارش نداده/);
    assert.match(text, /⏳ تسک بدون پاسخ/);
    assert.match(text, /خلاصه‌ی تیم: 67٪ انجام \(4 از 6\)/);
    assert.match(text, /⏳ 1 تسک بدون وضعیت/);
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
    assert.match(ta, /ناهید/, 'H2: ادمین همه‌ی کاربران را می‌بیند');
    assert.match(ta, /👥 تیم سرپرست‌ب\n• ناهید/);
    assert.match(ta, /👥 بدون سرپرست\n• بی‌سرپرست/);
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
    assert.match(r.messages[r.messages.length - 1], /خلاصه‌ی تیم/, 'خلاصه همیشه در آخرین پیام');
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
    assert.ok(sent.some((x) => x.chat === String(admin.telegram_user_id)), 'خطای boss2 ادمین را نمی‌شکند');
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
  // ───────── H1: شمارش یکتا ─────────
  test('H1: تسک low/سیستمی/حذف‌شده در total نمی‌آید؛ پاسخ‌نداده‌ی الزامی می‌آید؛ ⚡/🔴 و 📝', () => {
    reset();
    task(a, D, 'انجام شد', 'done', { note: 'با ایمیل' });
    task(a, D, 'اختیاری', null, {}, { priority: 'low' });
    task(a, D, 'مهم', null, {}, { priority: 'high' });
    task(a, D, 'فوری', null, {}, { isUrgent: true, priority: 'high' });
    task(a, D, 'حذفی', 'not_done', { reasonCode: 'other', rescheduleTo: 'drop' });
    task(a, D, 'نیمه', 'partial', { reasonCode: 'no_time', rescheduleTo: '2026-08-04' });
    const r = svc.memberReport(a, D, require('../src/repositories/settingsRepository').getAll());
    assert.equal(r.total, 4, 'done + partial + 2 پاسخ‌نداده‌ی الزامی');
    assert.equal(r.done, 1);
    assert.equal(r.pendingCount, 2);
    const text = svc.memberBlock(r, []);
    assert.match(text, /1 از 4 انجام شد \(25٪\) · 1 نیمه\/انجام‌نشده · 2 بدون وضعیت/);
    assert.match(text, /⏳ 🔴 مهم/);
    assert.match(text, /⏳ ⚡ فوری/);
    assert.doesNotMatch(text, /اختیاری/);
    assert.match(text, /📝 1 توضیح انجام/);
    assert.ok(text.indexOf('✗ نیمه') < text.indexOf('⏳'), '✗ قبل از ⏳');
  });

  test('H1: عدد پنل (teamReports.dailyRow) برابر عدد تلگرام است؛ روز غیرکاری ⇒ بدون پیام', () => {
    reset();
    task(a, D, 'x', 'done'); task(a, D, 'y', null, {}, { priority: 'high' }); task(a, D, 'z', 'not_done', { reasonCode: 'other' });
    const text = reportFor(boss).messages.join('\n');
    const row = require('../src/services/teamReportsService').getReports(boss, { date: D }).members.find((m) => m.userId === a.id);
    assert.deepEqual([row.summary.total, row.summary.done, row.summary.pending, row.summary.percent], [3, 1, 1, 33]);
    assert.match(text, /علی — 1 از 3 انجام شد \(33٪\)/);
    assert.equal(svc.memberReport(a, '2026-08-07', require('../src/repositories/settingsRepository').getAll()), null, 'جمعه');
  });

  test('H1: سقف ۵ خط برای هر عضو با «… و N مورد دیگر»', () => {
    reset();
    for (let i = 0; i < 8; i += 1) task(a, D, `کار ${i}`, null);
    const text = reportFor(boss).messages.join('\n');
    assert.match(text, /0 از 8 انجام شد · ⏳ 8 بدون وضعیت/);
    assert.match(text, /… و 3 مورد دیگر/);
  });

  // ───────── H2: گیرنده‌ها ─────────
  test('H2: سرپرست A هرگز عضو تیم B را نمی‌بیند؛ سرپرستِ بی‌عضو پیام نمی‌گیرد؛ scopeUsers قفل است', () => {
    reset();
    task(a, D, 't', 'done'); task(c, D, 't', 'done');
    const ta = reportFor(boss).messages.join('\n');
    assert.doesNotMatch(ta, /ناهید/);
    const lone = F.makeUser({ role: 'manager', name: 'بی‌عضو' });
    assert.equal(reportFor(lone), undefined);
    const scope = require('../src/services/teamReportsService').scopeUsers;
    assert.deepEqual(scope(boss).map((u) => u.id).sort(), [a.id, b.id].sort());
    assert.ok(!scope(boss).some((u) => u.id === c.id));
    assert.ok(scope(admin).some((u) => u.id === c.id));
  });

  test('H2: دو ادمین هر دو گزارش کامل می‌گیرند؛ everyReport یکتا؛ دکمه فقط برای زیردست مستقیم', async () => {
    reset();
    const admin2 = F.makeUser({ role: 'admin', name: 'ادمین۲' });
    const direct = F.makeUser({ managerId: admin.id, name: 'مستقیم‌ادمین' });
    task(a, D, 't', 'done'); task(c, D, 't', 'done'); task(direct, D, 't', 'done');
    const reps = svc.buildNightlyTaskReports(D);
    const ids = reps.everyReport.map((r) => r.member.id);
    assert.equal(new Set(ids).size, ids.length, 'یکتا');
    [admin, admin2].forEach((ad) => {
      const t = reps.find((r) => r.reviewer.id === ad.id).messages.join('\n');
      assert.match(t, /علی/); assert.match(t, /ناهید/); assert.match(t, /مستقیم‌ادمین/);
    });
    const ra = reps.find((r) => r.reviewer.id === admin.id);
    assert.deepEqual(ra.commentTargets.map((t) => t.userId), [direct.id], 'فقط زیردست مستقیم');
    assert.deepEqual(reps.find((r) => r.reviewer.id === admin2.id).commentTargets, []);
    db.exec(`DELETE FROM users WHERE id IN (${admin2.id}, ${direct.id})`);
  });

  test('H2: ۱۰۰ عضو ⇒ پیام‌ها ≤ taskReportAdminMaxParts و هرکدام ≤ ۴۰۹۶؛ خلاصه‌ی تیم در آخرین پیام', () => {
    reset();
    const many = [];
    for (let i = 0; i < 100; i += 1) many.push(F.makeUser({ managerId: i % 2 ? boss.id : boss2.id, name: `عضو-${i}` }));
    many.forEach((u) => { for (let j = 0; j < 3; j += 1) task(u, D, `عنوان تسک ${'ا'.repeat(60)} ${j}`, j ? 'not_done' : null, { reasonCode: 'no_time', rescheduleTo: '2026-08-04' }); });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('task_report_admin_max_parts', '3')").run();
    const r = reportFor(admin);
    assert.ok(r.messages.length <= 3, `parts ${r.messages.length}`);
    r.messages.forEach((m) => assert.ok(m.length <= svc.TG_LIMIT, `طول ${m.length}`));
    assert.match(r.messages[r.messages.length - 1], /خلاصه‌ی کل شرکت[^]*تیم سرپرست‌الف/);
    assert.match(r.messages[r.messages.length - 1], /و \d+ نفر دیگر — جزئیات در «🖥 گزارش کامل در پنل»/);
    assert.ok(r.omitted > 0);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('task_report_admin_max_parts', '6')").run();
    assert.ok(reportFor(admin).messages.length <= 6);
    reportFor(admin).messages.forEach((m) => assert.ok(m.length <= svc.TG_LIMIT));
    assert.ok(reportFor(boss).messages.length <= svc.MAX_PARTS, 'سرپرست همیشه ≤ ۳');
    db.exec("DELETE FROM users WHERE full_name LIKE 'عضو-%'");
    db.exec("DELETE FROM settings WHERE key = 'task_report_admin_max_parts'");
  });

  test('H2: خطای ارسال به یک ادمین بقیه را نمی‌شکند؛ ممیزی task_report_sent برای موفق‌ها', async () => {
    reset();
    const admin2 = F.makeUser({ role: 'admin', name: 'ادمین۲' });
    task(a, D, 't', 'done');
    const sent = [];
    const bot = { sendMessage: async (chat, text) => { if (String(chat) === String(admin.telegram_user_id)) throw new Error('blocked'); sent.push(String(chat)); } };
    db.exec("DELETE FROM audit_log WHERE action = 'task_report_sent'");
    await nightly.sendNightlyTaskReports(bot, D);
    assert.ok(sent.includes(String(admin2.telegram_user_id)));
    assert.ok(sent.includes(String(boss.telegram_user_id)));
    const rows = db.prepare("SELECT user_id, details FROM audit_log WHERE action = 'task_report_sent'").all();
    assert.ok(rows.some((x) => x.user_id === admin2.id && JSON.parse(x.details).date === D && JSON.parse(x.details).parts >= 1));
    assert.ok(!rows.some((x) => x.user_id === admin.id), 'ارسال ناموفق ممیزی ندارد');
    db.exec(`DELETE FROM users WHERE id = ${admin2.id}`);
  });

  // ───────── H3: زمان ─────────
  test('H3: تاریخ پیش‌فرض ارسال = «امروزِ منطقه‌ی شرکت» نه UTC؛ «هنوز خروج نزده»', async () => {
    reset();
    task(a, '2026-08-04', 't', null);
    const attendance = require('../src/repositories/attendanceRepository');
    db.prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, status) VALUES (?, '2026-08-04', '2026-08-03T21:00:00.000Z', 'normal')").run(a.id);
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-08-03T21:00:00Z') }); // ۰۰:۳۰ تهران، ۰۴ مرداد
    try {
      const sent = [];
      db.exec("DELETE FROM audit_log WHERE action = 'task_report_sent'");
      await nightly.sendNightlyTaskReports({ sendMessage: async (chat, text) => sent.push({ chat: String(chat), text }) });
      const d = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'task_report_sent' ORDER BY id DESC").get().details);
      assert.equal(d.date, '2026-08-04');
      assert.match(sent.find((x) => x.chat === String(boss.telegram_user_id)).text, /علی[^]*⏳ هنوز خروج نزده — وضعیت لحظه‌ای/);
      void attendance;
    } finally { mock.timers.reset(); }
    db.exec("DELETE FROM attendance_records WHERE record_date = '2026-08-04'");
  });
});
