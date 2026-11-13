// بازطراحی منوی بات: «وضعیت و گزارش من»، «برنامه هفتگی» با انتخاب هفته، «گزارش تیم» با فایل متنی،
// «درخواست‌های منتظر» با تأیید/رد دورکاری از داخل بات. لایه‌ی تعامل است؛ منطق کسب‌وکار در سرویس‌ها تست شده.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('منوی بات: وضعیت و گزارش من / برنامه هفتگی / گزارش تیم / درخواست‌های منتظر', () => {
  let F; let session; let config; let prevUrl; let admin; let mgr; let other; let emp; let emp2; let outsider; let seq = 0;
  let myStatus; let plan; let team; let pendingLeaves; let pendingRemote; let remoteRepo; let remoteSvc;
  const chat = () => 6000 + (seq += 1);
  const mockBot = () => ({
    sent: [], answers: [], edits: [], docs: [],
    async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; },
    async answerCallbackQuery(id, o) { this.answers.push({ id, ...(o || {}) }); return true; },
    async editMessageText(text, o) { this.edits.push({ text, o }); return true; },
    async sendDocument(c, buf, o, f) { this.docs.push({ c, text: buf.toString('utf8'), o, f }); return true; },
  });
  const last = (bot) => bot.sent[bot.sent.length - 1];
  const msgOf = (user, c, text = '') => ({ chat: { id: c, type: 'private' }, from: { id: Number(user.telegram_user_id) }, text });
  const queryOf = (user, data, c = chat()) => ({ id: `q${(seq += 1)}`, data, from: { id: Number(user.telegram_user_id) }, message: { message_id: 9, text: 'کارت', chat: { id: c, type: 'private' } } });
  const flatBtns = (m) => (m.opts.reply_markup.inline_keyboard || []).flat();

  before(() => {
    resetDb();
    F = require('./helpers/factories');
    config = require('../src/config');
    prevUrl = config.miniAppUrl;
    config.miniAppUrl = 'https://attendance.example.com/app/';
    session = require('../src/bot/session');
    myStatus = require('../src/bot/commands/myStatus');
    plan = require('../src/bot/commands/weeklyPlan');
    team = require('../src/bot/commands/teamReport');
    pendingLeaves = require('../src/bot/commands/pendingLeaves');
    pendingRemote = require('../src/bot/commands/pendingRemote');
    remoteRepo = require('../src/repositories/remoteWorkRepository');
    remoteSvc = require('../src/services/remoteWorkAdminService');
    admin = F.makeUser({ role: 'admin', name: 'ادمین تست' });
    mgr = F.makeUser({ role: 'manager', name: 'سرپرست الف' });
    other = F.makeUser({ role: 'manager', name: 'سرپرست ب' });
    emp = F.makeUser({ managerId: mgr.id, name: 'کارمند یک' });
    emp2 = F.makeUser({ managerId: mgr.id, name: 'کارمند دو' });
    outsider = F.makeUser({ managerId: other.id, name: 'کارمند بیرونی' });
  });
  after(() => { config.miniAppUrl = prevUrl; cleanup(); });

  describe('📊 وضعیت و گزارش من', () => {
    test('یک پیام شامل وضعیت و گزارش، با دکمه‌ی به‌روزرسانی و منو', async () => {
      const bot = mockBot();
      await myStatus.handleMyStatus(bot, msgOf(emp, chat()));
      assert.equal(bot.sent.length, 1);
      assert.match(last(bot).text, /وضعیت شما/);
      assert.match(last(bot).text, /گزارش شخصی/);
      assert.match(last(bot).text, /هفت روز اخیر/);
      const datas = flatBtns(last(bot)).map((b) => b.callback_data);
      assert.deepEqual(datas.sort(), ['fl:h', 'st:r']);
    });

    test('به‌روزرسانی همان پیام را ویرایش می‌کند (پیام تازه نمی‌فرستد)', async () => {
      const bot = mockBot();
      await myStatus.handleMyStatusCallback(bot, queryOf(emp, 'st:r'));
      assert.equal(bot.edits.length, 1);
      assert.equal(bot.sent.length, 0);
      assert.equal(bot.answers.length, 1);
      assert.match(bot.edits[0].text, /وضعیت و گزارش من/);
    });

    test('کاربر ثبت‌نشده: پیام «ثبت نیستید»', async () => {
      const bot = mockBot();
      await myStatus.handleMyStatus(bot, { chat: { id: chat(), type: 'private' }, from: { id: 5550001 }, text: '' });
      assert.match(last(bot).text, /ثبت نیستید/);
    });
  });

  describe('📋 برنامه هفتگی', () => {
    test('انتخاب هفته: سه دکمه‌ی قبل/این/بعد + ویرایش در مینی‌اپ', async () => {
      const bot = mockBot();
      await plan.handleWeeklyPlan(bot, msgOf(emp, chat()));
      const btns = flatBtns(last(bot));
      assert.deepEqual(btns.filter((b) => b.callback_data && b.callback_data.startsWith('wp:')).map((b) => b.callback_data).sort(), ['wp:c', 'wp:n', 'wp:p']);
      assert.ok(btns.some((b) => b.web_app && new URL(b.web_app.url).searchParams.get('view') === 'plan'));
    });

    test('هفته‌ی قبل/این/بعد ⇒ برنامه‌ی همان هفته به‌صورت متن (با ۷ روز) و دکمه‌های انتخاب هفته زیرش', async () => {
      for (const which of ['p', 'c', 'n']) {
        const bot = mockBot();
        await plan.handleWeeklyPlanCallback(bot, queryOf(emp, `wp:${which}`));
        assert.equal(bot.answers.length, 1);
        assert.ok(bot.sent.length >= 1, which);
        const text = bot.sent.map((m) => m.text).join('\n');
        assert.match(text, /برنامه‌ی/);
        for (const day of ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه']) assert.ok(text.includes(day), `${which}: ${day}`);
        assert.ok(flatBtns(last(bot)).some((b) => b.text.startsWith('✅') && b.callback_data === `wp:${which}`), 'هفته‌ی فعلی علامت ✅ دارد');
      }
    });

    test('هفته‌ی انتخابی درست است: p = ۷ روز قبل، c = این هفته، n = ۷ روز بعد', () => {
      const { addDays } = require('../src/utils/shiftDay');
      const c = plan.weekStartFor('c');
      assert.equal(plan.weekStartFor('p'), addDays(c, -7));
      assert.equal(plan.weekStartFor('n'), addDays(c, 7));
    });

    test('callback نامعتبر ⇒ «منقضی» و چیزی فرستاده نمی‌شود', async () => {
      const bot = mockBot();
      await plan.handleWeeklyPlanCallback(bot, queryOf(emp, 'wp:zzz'));
      assert.equal(bot.answers[0].show_alert, true);
      assert.deepEqual(bot.sent, []);
    });

    test('تسک و وضعیتش در متن می‌آید', () => {
      const days = [{ date: '2026-11-01', jalali: '1405/08/10', weekday: 6, kind: 'working', kindLabel: 'روز کاری', isFuture: false, schedule: {}, tasks: [{ title: 'ارسال فاکتور', status: 'done' }, { title: 'تماس', status: 'no_answer', isUrgent: true }] }];
      const text = plan.formatWeek({ week: { jalaliStart: 'a', jalaliEnd: 'b' }, days, summary: { tasks: { done: 1, noAnswer: 1 } } }, 'این هفته').join('\n');
      assert.match(text, /شنبه/);
      assert.match(text, /✅ ارسال فاکتور — انجام شد/);
      assert.match(text, /⏳ ⚡ تماس — بدون پاسخ/);
    });

    test('formatWeek: پیام‌ها از سقف تلگرام کوتاه‌ترند حتی با تسک‌های زیاد', () => {
      const days = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-11-0${i + 1}`, jalali: `۱۴۰۵/۰۸/۱${i}`, weekday: 'شنبه', kind: 'working', kindLabel: 'روز کاری', schedule: { start: '08:00', end: '16:00' },
        tasks: Array.from({ length: 40 }, (_, j) => ({ title: `تسک شماره ${j} ${'الف'.repeat(60)}`, status: 'done' })),
      }));
      const parts = plan.formatWeek({ week: { jalaliStart: 'الف', jalaliEnd: 'ب' }, days, summary: { tasks: { done: 280 } } }, 'این هفته');
      assert.ok(parts.length > 1);
      assert.ok(parts.every((p) => p.length <= 4096));
    });
  });

  describe('👥 گزارش تیم', () => {
    test('سرپرست: مستقیم اعضای تیم خودش (بدون سرپرست دیگر)؛ «گزارش کل تیم» + یک دکمه برای هر عضو', async () => {
      const bot = mockBot();
      await team.handleTeamReport(bot, msgOf(mgr, chat()));
      const d = flatBtns(last(bot)).map((b) => b.callback_data);
      assert.ok(d.includes(`tr:u:${emp.id}`) && d.includes(`tr:u:${emp2.id}`));
      assert.ok(!d.includes(`tr:u:${outsider.id}`));
      assert.ok(d.includes(`tr:a:${mgr.id}`));
      assert.ok(!d.includes('tr:b'), 'سرپرست فقط یک تیم دارد؛ بازگشت لازم نیست');
    });

    test('ادمین: فهرست تیم‌ها (هر سرپرست یک تیم) ← اعضا ← فایل متنی', async () => {
      const bot = mockBot(); const c = chat();
      await team.handleTeamReport(bot, msgOf(admin, c));
      const d = flatBtns(last(bot)).map((b) => b.callback_data);
      assert.ok(d.includes(`tr:t:${mgr.id}`) && d.includes(`tr:t:${other.id}`));
      await team.handleTeamReportCallback(bot, queryOf(admin, `tr:t:${other.id}`, c));
      assert.match(bot.edits[0].text, /سرپرست ب/);
      const inner = bot.edits[0].o.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
      assert.ok(inner.includes(`tr:u:${outsider.id}`) && inner.includes('tr:b'));
    });

    test('انتخاب عضو ⇒ گزارش به‌صورت فایل .txt (UTF-8 با BOM) با نام عضو، حضور و تسک‌های هفته', async () => {
      const bot = mockBot();
      await team.handleTeamReportCallback(bot, queryOf(mgr, `tr:u:${emp.id}`));
      assert.equal(bot.docs.length, 1);
      assert.match(bot.docs[0].f.filename, /^report-\d+-\d{4}-\d{2}-\d{2}\.txt$/);
      assert.equal(bot.docs[0].f.contentType, 'text/plain');
      assert.ok(bot.docs[0].text.startsWith('\uFEFF'));
      assert.match(bot.docs[0].text, /گزارش کارمند یک/);
      assert.match(bot.docs[0].text, /هفت روز اخیر/);
      assert.match(bot.docs[0].text, /برنامه‌ی این هفته/);
    });

    test('گزارش کل تیم: یک فایل با بلوک هر عضو', async () => {
      const bot = mockBot();
      await team.handleTeamReportCallback(bot, queryOf(mgr, `tr:a:${mgr.id}`));
      assert.equal(bot.docs.length, 1);
      assert.match(bot.docs[0].text, /کارمند یک/);
      assert.match(bot.docs[0].text, /کارمند دو/);
      assert.ok(!bot.docs[0].text.includes('کارمند بیرونی'));
    });

    test('اسکوپ سمت سرور: سرپرست با callback دستیِ عضو/تیم دیگری فایل نمی‌گیرد؛ کارمند عادی رد می‌شود', async () => {
      const bot = mockBot();
      await team.handleTeamReportCallback(bot, queryOf(mgr, `tr:u:${outsider.id}`));
      await team.handleTeamReportCallback(bot, queryOf(mgr, `tr:a:${other.id}`));
      await team.handleTeamReportCallback(bot, queryOf(mgr, `tr:t:${other.id}`));
      assert.equal(bot.docs.length, 0);
      assert.ok(bot.answers.every((a) => a.show_alert === true));
      const b2 = mockBot();
      await team.handleTeamReportCallback(b2, queryOf(emp, `tr:u:${emp2.id}`));
      assert.equal(b2.docs.length, 0);
      assert.equal(b2.answers[0].show_alert, true);
    });
  });

  describe('📥 درخواست‌های منتظر (مرخصی/ماموریت + دورکاری)', () => {
    let rid; let rid2; let rid3;
    const mkRemote = (u, date) => {
      const x = remoteRepo.insertSession({ userId: u.id, workDate: date, startAt: `${date}T05:00:00.000Z`, ip: '203.0.113.9' });
      remoteRepo.closeSession(x.id, `${date}T09:00:00.000Z`);
      return x.id;
    };
    before(() => { rid = mkRemote(emp, '2026-10-05'); rid2 = mkRemote(emp2, '2026-10-06'); rid3 = mkRemote(outsider, '2026-10-07'); });

    test('خالی ⇒ پیام «درخواستی نیست»', async () => {
      const calm = F.makeUser({ role: 'manager' });
      const bot = mockBot();
      await pendingLeaves.handlePendingLeaves(bot, msgOf(calm, chat()));
      assert.match(last(bot).text, /هیچ درخواست در انتظاری/);
    });

    test('سرپرست: هر دورکاری یک کارت با ✅ تأیید و ❌ رد؛ دورکاری تیم دیگر نمی‌آید', async () => {
      const bot = mockBot();
      await pendingLeaves.handlePendingLeaves(bot, msgOf(mgr, chat()));
      assert.match(bot.sent[0].text, /درخواست‌های منتظر تأیید — ۲ مورد/);
      const cards = bot.sent.filter((m) => /^🏠 دورکاری #/.test(m.text));
      assert.equal(cards.length, 2);
      const d = cards.flatMap(flatBtns).map((b) => b.callback_data);
      assert.ok(d.includes(`rr:a:${rid}`) && d.includes(`rr:r:${rid}`) && d.includes(`rr:a:${rid2}`));
      assert.ok(!d.includes(`rr:a:${rid3}`));
    });

    test('تأیید با دکمه ⇒ در سرویس approved، رکورد رسمی ساخته و کارت بسته می‌شود', async () => {
      const bot = mockBot();
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(mgr, `rr:a:${rid}`));
      assert.equal(bot.answers.length, 1);
      assert.equal(remoteRepo.findSessionFull(rid).status, 'approved');
      assert.ok(remoteRepo.findSessionFull(rid).attendance_record_id, 'در پنل (رکورد حضور) ثبت شده');
      assert.match(bot.edits[0].text, /تأیید شد/);
      assert.deepEqual(bot.edits[0].o.reply_markup.inline_keyboard, []);
    });

    test('تأیید دوباره idempotent؛ خارج از اسکوپ، کارمند عادی و callback خراب ⇒ رد با alert و بدون تغییر', async () => {
      const bot = mockBot();
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(mgr, `rr:a:${rid}`));
      assert.equal(bot.answers[0].show_alert, undefined);
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(mgr, `rr:a:${rid3}`)); // تیم دیگر
      assert.equal(remoteRepo.findSessionFull(rid3).status, 'pending');
      assert.equal(bot.answers[1].show_alert, true);
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(emp, `rr:a:${rid2}`)); // کارمند عادی
      assert.equal(remoteRepo.findSessionFull(rid2).status, 'pending');
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(mgr, 'rr:a:abc'));
      assert.equal(bot.answers.at(-1).show_alert, true);
    });

    test('رد: علت اجباری (کوتاه ⇒ جریان باز می‌ماند)، سپس رد در سرویس و اطلاع‌رسانی', async () => {
      const bot = mockBot(); const c = chat();
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(mgr, `rr:r:${rid2}`, c));
      assert.equal(session.get(c).flow, 'remote_reject');
      assert.match(last(bot).text, /علت رد/);
      await pendingRemote.handleRemoteRejectText(bot, msgOf(mgr, c, 'ب'), session.get(c));
      assert.ok(session.get(c), 'علت کوتاه ⇒ جریان باز');
      assert.equal(remoteRepo.findSessionFull(rid2).status, 'pending');
      await pendingRemote.handleRemoteRejectText(bot, msgOf(mgr, c, 'ساعت‌ها با گزارش نمی‌خواند'), session.get(c));
      assert.equal(session.get(c), null);
      const row = remoteRepo.findSessionFull(rid2);
      assert.equal(row.status, 'rejected');
      assert.equal(row.review_note, 'ساعت‌ها با گزارش نمی‌خواند');
      assert.match(last(bot).text, /رد شد/);
    });

    test('انصراف از رد: دورکاری همچنان منتظر', async () => {
      const bot = mockBot(); const c = chat();
      await pendingRemote.handleRemoteDecisionCallback(bot, queryOf(admin, `rr:r:${rid3}`, c));
      await pendingRemote.handleRemoteRejectText(bot, msgOf(admin, c, 'انصراف'), session.get(c));
      assert.equal(session.get(c), null);
      assert.equal(remoteRepo.findSessionFull(rid3).status, 'pending');
    });

    test('نشانگر منو: شمار مرخصی/ماموریت + دورکاری؛ ادمین دورکاری منتظر را می‌بیند', () => {
      assert.equal(pendingRemote.pendingCount(admin), 1);
      assert.equal(pendingLeaves.pendingTotal(admin).total, 1);
      assert.equal(pendingLeaves.pendingTotal(mgr).total, 0);
      assert.equal(remoteSvc.pendingSummary(admin).total, 1);
    });

    test('مرخصی منتظر هم در همان فهرست می‌آید و تأیید/رد همان callbackهای قبلی است', async () => {
      const lv = require('../src/repositories/leaveRepository').createLeaveRequest({ userId: emp.id, startDate: '2026-12-01', endDate: '2026-12-01', leaveType: 'leave', reason: 'کار شخصی' });
      const bot = mockBot();
      await pendingLeaves.handlePendingLeaves(bot, msgOf(mgr, chat()));
      const card = bot.sent.find((m) => /^🏖 مرخصی #/.test(m.text));
      assert.ok(card);
      assert.match(card.text, /کار شخصی/);
      assert.deepEqual(flatBtns(card).map((b) => b.callback_data).sort(), [`leave_approve:${lv.id}`, `leave_reject:${lv.id}`]);
    });
  });
});
