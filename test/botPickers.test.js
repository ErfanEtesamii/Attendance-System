// E3/E4/E5: انتخابگرهای دکمه‌ای بات (تقویم شمسی، ساعت ۳۰ دقیقه‌ای، فهرست کارمند)، ناوبری انصراف/منوی اصلی،
// دکمه‌ی منقضی، جریان‌های addEmployee / fixRecord / اعتراض‌ها با دکمه، دکمه‌ی mn:<id>، و حذف ارجاع به /دستور.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('انتخابگرهای دکمه‌ای بات و حذف ارجاع به دستور (E3/E4/E5)', () => {
  let ui; let router; let session; let leave; let addEmp; let fix; let disputes; let menu; let help; let start;
  let usersRepo; let attRepo; let disputeRepo; let leaveRepo; let typesRepo; let F; let admin; let mgr; let emp; let seq = 0; let todayStr;
  const chat = () => 9000 + (seq += 1);

  const mockBot = () => ({
    sent: [], answers: [], edits: [],
    async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; },
    async answerCallbackQuery(id, o) { this.answers.push({ id, ...(o || {}) }); return true; },
    async editMessageReplyMarkup(kb, o) { this.edits.push({ kind: 'markup', kb, o }); return true; },
    async editMessageText(text, o) { this.edits.push({ kind: 'text', text, o }); return true; },
  });
  const last = (bot) => bot.sent[bot.sent.length - 1];
  const buttons = (bot) => last(bot).opts.reply_markup.inline_keyboard.flat();
  const datas = (bot) => buttons(bot).map((b) => b.callback_data);
  const query = (c, data, from) => ({ id: `q${(seq += 1)}`, data, from: from || { id: Number(admin.telegram_user_id) }, message: { message_id: 5, chat: { id: c, type: 'private' } } });
  const press = (bot, c, data, from) => router.handlePickerCallback(bot, query(c, data, from));
  const say = async (bot, c, text, handler, flow) => handler(bot, { chat: { id: c }, from: { id: Number(admin.telegram_user_id) }, text }, session.get(c) || { flow });

  before(() => {
    resetDb();
    F = require('./helpers/factories');
    ui = require('../src/bot/ui/pickers');
    router = require('../src/bot/ui/pickerRouter');
    session = require('../src/bot/session');
    leave = require('../src/bot/commands/leave');
    addEmp = require('../src/bot/commands/addEmployee');
    fix = require('../src/bot/commands/fixRecord');
    disputes = require('../src/bot/commands/pendingDisputes');
    menu = require('../src/bot/menu/menuRouter');
    help = require('../src/bot/commands/help');
    start = require('../src/bot/commands/start');
    usersRepo = require('../src/repositories/usersRepository');
    attRepo = require('../src/repositories/attendanceRepository');
    disputeRepo = require('../src/repositories/disputeRepository');
    leaveRepo = require('../src/repositories/leaveRepository');
    typesRepo = require('../src/repositories/leaveTypesRepository');
    todayStr = require('../src/utils/serverTime').todayDateString();
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
  });
  after(() => cleanup());

  describe('قطعه‌های UI', () => {
    test('همه‌ی callback_dataها ≤ ۶۴ بایت (تقویم، ساعت، کارمند، ناوبری)', () => {
      const all = [
        ...ui.dateKeyboard({ kind: 'date', jy: 1405, jm: 10, min: null, max: null, quick: ui.quickDates([0, 1, 2]) }).inline_keyboard,
        ...ui.timeKeyboard({ kind: 'time', page: 1 }).inline_keyboard,
        ...ui.employeeKeyboard({ kind: 'emp', page: 0, filter: 'any', allowNone: true }).inline_keyboard,
      ].flat();
      assert.ok(all.length > 40);
      for (const b of all) assert.ok(Buffer.byteLength(b.callback_data, 'utf8') <= 64, b.callback_data);
      assert.throws(() => ui.cb('x'.repeat(65)), /۶۴ بایت/);
    });

    test('تقویم: ماه شمسی درست، دکمه‌ی روز = تاریخ میلادی، خارج از بازه غیرفعال', () => {
      const rows = ui.calendarRows({ jy: 1405, jm: 10, min: '2027-01-04', max: '2027-01-10', quick: [] }, '2027-01-04');
      const flat = rows.flat();
      assert.ok(flat.some((b) => b.callback_data === 'dp:d:2027-01-04' && b.text === '•۱۴')); // امروز نشانه‌دار
      assert.ok(flat.some((b) => b.callback_data === 'dp:d:2027-01-10'));
      assert.ok(!flat.some((b) => b.callback_data === 'dp:d:2027-01-03'));
      assert.ok(!flat.some((b) => b.callback_data === 'dp:d:2027-01-11'));
    });

    test('ساعت: اسلات ۳۰ دقیقه‌ای؛ با after فقط ساعت‌های بعدی', () => {
      assert.equal(ui.timeSlots(1).length, 12);
      assert.deepEqual(ui.timeSlots(1).slice(0, 3), ['06:00', '06:30', '07:00']);
      assert.ok(ui.timeSlots(1, '09:30').every((t) => t > '09:30'));
      assert.equal(ui.defaultTimePage('20:00'), 3);
    });

    test('کارمند: صفحه‌بندی ۸تایی و «بدون سرپرست»', () => {
      for (let i = 0; i < 10; i += 1) F.makeUser();
      const rows = ui.employeeRows({ page: 0, filter: 'any', allowNone: true, noneText: 'بدون سرپرست' });
      assert.equal(rows.filter((r) => r[0].callback_data.startsWith('ep:u:')).length, ui.EMP_PAGE_SIZE);
      assert.ok(rows.flat().some((b) => b.callback_data === 'ep:p:1'));
      assert.ok(rows.flat().some((b) => b.callback_data === 'ep:none'));
      const managers = ui.candidateUsers('managers');
      assert.ok(managers.every((u) => ['manager', 'admin'].includes(u.role)));
    });
  });

  describe('جریان مرخصی با تقویم/ساعت', () => {
    test('انتخاب تاریخ از تقویم ⇒ مرحله‌ی بعد؛ پیام تقویم جمع می‌شود؛ هر callback یک‌بار answer', async () => {
      const typ = typesRepo.findByCode('mission');
      const bot = mockBot(); const c = chat();
      session.start(c, 'leave', { userId: emp.id });
      await leave.handleLeaveCallback(bot, query(c, `leave_type:${typ.id}`), session.get(c));
      assert.ok(datas(bot).some((d) => d.startsWith('dp:d:')), 'تقویم نمایش داده شود');
      assert.ok(datas(bot).includes('leave_cancel') && datas(bot).includes('fl:h'));

      await press(bot, c, 'dp:d:2027-01-04');
      assert.equal(session.get(c).data.startDate, '2027-01-04');
      assert.match(last(bot).text, /تاریخ پایان/);
      assert.equal(bot.edits.filter((e) => e.kind === 'text').length, 1);
      assert.match(bot.edits[0].text, /دوشنبه ۱۴ دی ۱۴۰۵/);
      assert.equal(bot.answers.length, 2); // ۱ برای leave_type + ۱ برای dp:d
      assert.equal(bot.answers[1].text, undefined);
    });

    test('تاریخ پایان قبل از شروع انتخاب نمی‌شود (alert)؛ ماه بعد/قبل فقط کیبورد را ویرایش می‌کند', async () => {
      const typ = typesRepo.findByCode('mission');
      const bot = mockBot(); const c = chat();
      session.start(c, 'leave', { userId: emp.id });
      await leave.handleLeaveCallback(bot, query(c, `leave_type:${typ.id}`), session.get(c));
      await press(bot, c, 'dp:d:2027-01-10');
      const before = bot.sent.length;
      await press(bot, c, 'dp:d:2027-01-05');
      assert.equal(bot.answers[bot.answers.length - 1].show_alert, true);
      assert.equal(session.get(c).step, 2);
      await press(bot, c, 'dp:m:1405:11');
      assert.equal(bot.sent.length, before, 'ماه عوض شد؛ پیام جدید نمی‌آید');
      assert.equal(bot.edits[bot.edits.length - 1].kind, 'markup');
    });

    test('ساعتی: انتخاب ساعت شروع/پایان با دکمه؛ پایان فقط بعد از شروع؛ سپس «رد شدن» برای توضیح', async () => {
      const annual = typesRepo.findByCode('annual');
      typesRepo.updateLeaveType(annual.id, { allowedUnits: ['day', 'half_day', 'hour'] });
      const bot = mockBot(); const c = chat();
      session.start(c, 'leave', { userId: emp.id });
      await leave.handleLeaveCallback(bot, query(c, `leave_type:${annual.id}`), session.get(c));
      await leave.handleLeaveCallback(bot, query(c, 'leave_unit:hour'), session.get(c));
      await press(bot, c, 'dp:d:2027-06-01');
      assert.ok(datas(bot).includes('tp:t:0900'));
      await press(bot, c, 'tp:t:0900');
      assert.equal(session.get(c).data.startTime, '09:00');
      assert.ok(!datas(bot).includes('tp:t:0830') && !datas(bot).includes('tp:t:0900'));
      await press(bot, c, 'tp:t:1030');
      assert.equal(session.get(c).step, 3);
      assert.ok(datas(bot).includes('fl:s'), 'توضیح اختیاری ⇒ رد شدن');
      await press(bot, c, 'fl:s');
      assert.match(last(bot).text, /خلاصه درخواست/);
      assert.match(last(bot).text, /از ساعت: 09:00/);
      assert.match(last(bot).text, /تا ساعت: 10:30/);
    });
  });

  describe('انقضا و ناوبری', () => {
    test('بدون session ⇒ «این دکمه منقضی شده، منو را باز کنید» (alert)', async () => {
      const bot = mockBot(); const c = chat();
      for (const d of ['dp:d:2027-01-04', 'tp:t:0900', 'ep:u:1', 'fl:s', 'fl:x']) await press(bot, c, d);
      assert.equal(bot.answers.length, 5);
      assert.ok(bot.answers.every((a) => a.text === ui.EXPIRED_TEXT && a.show_alert === true));
    });

    test('دکمه‌ی مرحله‌ی قدیمی (session در مرحله‌ی دیگری) ⇒ منقضی؛ session دست‌نخورده می‌ماند', async () => {
      const typ = typesRepo.findByCode('mission');
      const bot = mockBot(); const c = chat();
      session.start(c, 'leave', { userId: emp.id });
      await leave.handleLeaveCallback(bot, query(c, `leave_type:${typ.id}`), session.get(c));
      await press(bot, c, 'dp:d:2027-01-04'); // اکنون مرحله‌ی ۲
      const stale = query(c, 'dp:d:2027-01-08');
      const oldPick = { ...session.get(c).data.pick, step: 1 };
      session.update(c, { data: { ...session.get(c).data, pick: oldPick } });
      await router.handlePickerCallback(bot, stale);
      assert.equal(bot.answers[bot.answers.length - 1].text, ui.EXPIRED_TEXT);
      assert.equal(session.get(c).step, 2);
    });

    test('دکمه‌ی مرحله‌ی قدیمی مرخصی (leave_confirm در مرحله‌ی دیگر) ⇒ منقضی؛ ثبتی انجام نمی‌شود', async () => {
      const bot = mockBot(); const c = chat();
      const before = leaveRepo.listByUser(emp.id).length;
      session.start(c, 'leave', { userId: emp.id });
      await leave.handleLeaveCallback(bot, query(c, 'leave_confirm:yes'), session.get(c));
      assert.equal(bot.answers[0].text, ui.EXPIRED_TEXT);
      assert.equal(leaveRepo.listByUser(emp.id).length, before);
      await leave.handleLeaveCallback(bot, query(c, 'leave_confirm:yes'), null);
      assert.equal(bot.answers[1].text, ui.EXPIRED_TEXT);
    });

    test('«❌ انصراف»: session پاک و پیام «انصراف داده شد»؛ «🏠 منوی اصلی»: session پاک و کیبورد منو', async () => {
      let bot = mockBot(); let c = chat();
      session.start(c, 'fix_record', { adminId: admin.id });
      await press(bot, c, 'fl:x');
      assert.equal(session.get(c), null);
      assert.match(last(bot).text, /انصراف داده شد/);

      bot = mockBot(); c = chat();
      session.start(c, 'leave', { userId: emp.id });
      await press(bot, c, 'fl:h');
      assert.equal(session.get(c), null);
      assert.match(last(bot).text, /منوی اصلی/);
      assert.ok(last(bot).opts.reply_markup.keyboard, 'کیبورد ثابت منو');
      assert.equal(bot.answers.length, 1);
    });
  });

  describe('افزودن کارمند با دکمه', () => {
    test('جریان کامل: آیدی/نام تایپ، کد و دپارتمان با «رد شدن»، نقش و سرپرست با دکمه', async () => {
      const bot = mockBot(); const c = chat();
      await addEmp.handleAddEmployeeCommand(bot, { chat: { id: c }, from: { id: Number(admin.telegram_user_id) } });
      assert.doesNotMatch(last(bot).text, /\/start/);
      assert.deepEqual(datas(bot), ['fl:x', 'fl:h']);
      await say(bot, c, '77001122', addEmp.handleAddEmployeeText);
      await say(bot, c, 'علی رضایی', addEmp.handleAddEmployeeText);
      assert.ok(datas(bot).includes('fl:s'));
      await press(bot, c, 'fl:s'); // کد پرسنلی رد
      assert.match(last(bot).text, /دپارتمان/);
      await press(bot, c, 'fl:s'); // دپارتمان رد
      assert.ok(datas(bot).includes('add_emp_role:manager') && datas(bot).includes('fl:x'));
      await addEmp.handleAddEmployeeCallback(bot, query(c, 'add_emp_role:employee'), session.get(c));
      assert.match(last(bot).text, /سرپرست/);
      assert.ok(datas(bot).some((d) => d === `ep:u:${mgr.id}`));
      assert.ok(datas(bot).includes('ep:none'));
      assert.ok(!datas(bot).includes(`ep:u:${emp.id}`), 'کارمند عادی در فهرست سرپرست نیست');
      await press(bot, c, `ep:u:${mgr.id}`);
      const created = usersRepo.findByTelegramId('77001122');
      assert.equal(created.full_name, 'علی رضایی');
      assert.equal(created.manager_id, mgr.id);
      assert.equal(created.personnel_code, null);
      assert.equal(session.get(c), null);
      const welcome = bot.sent.find((m) => String(m.c) === '77001122');
      assert.ok(welcome && !/\/\w+/.test(welcome.text), 'پیام خوش‌آمد بدون ارجاع به /دستور');
    });

    test('«بدون سرپرست» ⇒ manager_id خالی؛ نقش ادمین مرحله‌ی سرپرست ندارد', async () => {
      const bot = mockBot(); const c = chat();
      await addEmp.handleAddEmployeeCommand(bot, { chat: { id: c }, from: { id: Number(admin.telegram_user_id) } });
      await say(bot, c, '77001123', addEmp.handleAddEmployeeText);
      await say(bot, c, 'سارا', addEmp.handleAddEmployeeText);
      await press(bot, c, 'fl:s'); await press(bot, c, 'fl:s');
      await addEmp.handleAddEmployeeCallback(bot, query(c, 'add_emp_role:employee'), session.get(c));
      await press(bot, c, 'ep:none');
      assert.equal(usersRepo.findByTelegramId('77001123').manager_id, null);

      const c2 = chat();
      await addEmp.handleAddEmployeeCommand(bot, { chat: { id: c2 }, from: { id: Number(admin.telegram_user_id) } });
      await say(bot, c2, '77001124', addEmp.handleAddEmployeeText);
      await say(bot, c2, 'ادمین دوم', addEmp.handleAddEmployeeText);
      await press(bot, c2, 'fl:s'); await press(bot, c2, 'fl:s');
      await addEmp.handleAddEmployeeCallback(bot, query(c2, 'add_emp_role:admin'), session.get(c2));
      assert.equal(usersRepo.findByTelegramId('77001124').role, 'admin');
    });

    test('نقش: کارمند/سرپرست اجرا نمی‌کند؛ دکمه‌ی نقش در مرحله‌ی دیگر ⇒ منقضی؛ انتخاب سرپرستِ غیرمجاز رد می‌شود', async () => {
      const bot = mockBot(); const c = chat();
      await addEmp.handleAddEmployeeCommand(bot, { chat: { id: c }, from: { id: Number(emp.telegram_user_id) } });
      assert.equal(session.get(c), null);
      assert.match(last(bot).text, /ادمین/);

      const c2 = chat();
      session.start(c2, 'add_employee', { adminId: admin.id }); // مرحله‌ی ۰
      await addEmp.handleAddEmployeeCallback(bot, query(c2, 'add_emp_role:admin'), session.get(c2));
      assert.equal(bot.answers[bot.answers.length - 1].text, ui.EXPIRED_TEXT);
      assert.equal(usersRepo.findByTelegramId('x'), undefined);

      // adminId سپس تنزل نقش ⇒ pick اجرا نمی‌شود
      const c3 = chat();
      const temp = F.makeUser({ role: 'admin' });
      session.start(c3, 'add_employee', { adminId: temp.id, telegramUserId: '77009999', fullName: 'نفر', role: 'employee' });
      session.update(c3, { step: 5 });
      await ui.askEmployee(bot, c3, { text: 'سرپرست', label: 'سرپرست', filter: 'managers', allowNone: true });
      usersRepo.updateUser(temp.id, { role: 'employee' });
      await press(bot, c3, 'ep:none', { id: Number(temp.telegram_user_id) });
      assert.equal(usersRepo.findByTelegramId('77009999'), undefined);
      assert.equal(session.get(c3), null);
    });
  });

  describe('اصلاح رکورد با دکمه', () => {
    test('کارمند از فهرست ⇒ تاریخ از تقویم ⇒ فیلد ⇒ ساعت از اسلات ⇒ دلیل تایپ ⇒ اصلاح + audit', async () => {
      const rec = attRepo.createManual({ userId: emp.id, recordDate: '2027-01-04', checkInTime: '2027-01-04T05:00:00.000Z', status: 'normal' });
      const bot = mockBot(); const c = chat();
      await fix.handleFixRecordCommand(bot, { chat: { id: c }, from: { id: Number(admin.telegram_user_id) } });
      const shown = () => (bot.edits.length ? bot.edits[bot.edits.length - 1].kb.inline_keyboard : last(bot).opts.reply_markup.inline_keyboard).flat().map((x) => x.callback_data);
      for (let page = 1; !shown().includes(`ep:u:${emp.id}`) && page < 10; page += 1) await press(bot, c, `ep:p:${page}`); // صفحه‌بندی ۸تایی
      assert.ok(shown().includes(`ep:u:${emp.id}`));
      await press(bot, c, `ep:u:${emp.id}`);
      assert.equal(session.get(c).step, 1);
      assert.ok(datas(bot).some((d) => d.startsWith('dp:d:')), 'تقویم');
      // تاریخ آینده انتخاب‌شدنی نیست (max=امروز)
      assert.ok(!datas(bot).includes('dp:d:2099-01-01'));
      await fix.handleFixRecordText(bot, { chat: { id: c }, text: '2027-01-04' }, session.get(c)); // تایپ هم کار می‌کند
      assert.equal(session.get(c).step, 2);
      assert.deepEqual(datas(bot).slice(-2), ['fix_cancel', 'fl:h']);
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:check_out_time'), session.get(c));
      assert.ok(datas(bot).includes('tp:t:0900'), 'صفحه‌ی پیش‌فرض ۰۶–۱۲');
      await press(bot, c, 'tp:p:2'); // صفحه‌ی ۱۲–۱۸
      await press(bot, c, 'tp:t:1700');
      assert.equal(session.get(c).step, 4);
      assert.deepEqual(datas(bot), ['fl:x', 'fl:h'], 'دلیل: بدون «رد شدن»');
      await fix.handleFixRecordText(bot, { chat: { id: c }, text: 'فراموشی خروج' }, session.get(c));
      assert.equal(session.get(c), null);
      assert.ok(attRepo.findById(rec.id).check_out_time);
      assert.match(last(bot).text, /رکورد اصلاح شد/);
    });

    test('دکمه‌ی فیلد/وضعیت در مرحله‌ی دیگر ⇒ منقضی؛ دلیل خالی پذیرفته نمی‌شود؛ وضعیت با دکمه', async () => {
      const bot = mockBot(); const c = chat();
      session.start(c, 'fix_record', { adminId: admin.id });
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:status'), session.get(c));
      assert.equal(bot.answers[0].text, ui.EXPIRED_TEXT);
      await fix.handleFixStatusCallback(bot, query(c, 'fix_status:late'), session.get(c));
      assert.equal(bot.answers[1].text, ui.EXPIRED_TEXT);
      session.update(c, { step: 2, data: { ...session.get(c).data, employeeId: emp.id, recordId: 1, recordDate: '2027-01-04' } });
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:status'), session.get(c));
      assert.ok(datas(bot).includes('fix_status:late'));
      await fix.handleFixStatusCallback(bot, query(c, 'fix_status:late'), session.get(c));
      assert.equal(session.get(c).step, 4);
      await fix.handleFixRecordText(bot, { chat: { id: c }, text: '   ' }, session.get(c));
      assert.match(last(bot).text, /اجباری/);
      assert.equal(session.get(c).step, 4);
    });

    test('نقش: غیرادمین شروع نمی‌کند؛ انتخاب کارمند بعد از تنزل نقش اجرا نمی‌شود', async () => {
      const bot = mockBot(); const c = chat();
      await fix.handleFixRecordCommand(bot, { chat: { id: c }, from: { id: Number(mgr.telegram_user_id) } });
      assert.equal(session.get(c), null);
      const temp = F.makeUser({ role: 'admin' });
      await fix.handleFixRecordCommand(bot, { chat: { id: c }, from: { id: Number(temp.telegram_user_id) } });
      usersRepo.updateUser(temp.id, { role: 'employee' });
      await press(bot, c, `ep:u:${emp.id}`, { id: Number(temp.telegram_user_id) });
      assert.equal(session.get(c), null);
    });
  });

  describe('اعتراض‌ها', () => {
    test('پاسخ: دکمه‌های انصراف/منوی اصلی/«بستن بدون پاسخ»؛ رد شدن اعتراض را بدون پاسخ می‌بندد', async () => {
      const d = disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'ورود ثبت نشد' });
      const bot = mockBot(); const c = chat();
      await disputes.handleDisputeCallback(bot, query(c, `dispute_reply:${d.id}`, { id: Number(mgr.telegram_user_id) }));
      assert.deepEqual(datas(bot), ['fl:s', 'fl:x', 'fl:h']);
      assert.ok(buttons(bot).some((b) => /بستن بدون پاسخ/.test(b.text)));
      assert.doesNotMatch(last(bot).text, /انصراف»/);
      await press(bot, c, 'fl:s', { id: Number(mgr.telegram_user_id) });
      assert.equal(disputeRepo.findById(d.id).status, 'resolved');
      assert.equal(session.get(c), null);
    });

    test('پاسخ متنی و انصراف با دکمه (اعتراض باز می‌ماند)', async () => {
      const d1 = disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'الف' });
      const d2 = disputeRepo.createDispute({ userId: emp.id, attendanceRecordId: null, message: 'ب' });
      const bot = mockBot(); const c = chat(); const from = { id: Number(mgr.telegram_user_id) };
      await disputes.handleDisputeCallback(bot, query(c, `dispute_reply:${d1.id}`, from));
      await disputes.handleDisputeReplyText(bot, { chat: { id: c }, from, text: 'بررسی شد' }, session.get(c));
      assert.equal(disputeRepo.findById(d1.id).status, 'resolved');
      await disputes.handleDisputeCallback(bot, query(c, `dispute_reply:${d2.id}`, from));
      await press(bot, c, 'fl:x', from);
      assert.equal(disputeRepo.findById(d2.id).status, 'open');
      assert.equal(session.get(c), null);
    });
  });

  describe('E4: دکمه‌ی mn:<id> و حذف ارجاع به دستور', () => {
    const run = async (data, user, chatType = 'private') => {
      const bot = mockBot(); const c = chat(); const calls = [];
      const handlers = {};
      for (const k of Object.keys(menu.defaultHandlers())) handlers[k] = async () => { calls.push(k); };
      await menu.handleMenuCallback(bot, { id: 'q', data, from: { id: Number(user.telegram_user_id) }, message: { chat: { id: c, type: chatType } } }, handlers);
      return { bot, calls, c };
    };

    test('mn:pending_leaves: سرپرست/ادمین اجرا می‌شود؛ کارمند رد (alert)؛ دکمه‌ی ناشناخته/web_app منقضی', async () => {
      assert.deepEqual((await run('mn:pending_leaves', mgr)).calls, ['pendingLeaves']);
      assert.deepEqual((await run('mn:pending_leaves', admin)).calls, ['pendingLeaves']);
      const denied = await run('mn:pending_leaves', emp);
      assert.deepEqual(denied.calls, []);
      assert.equal(denied.bot.answers[0].show_alert, true);
      const unknown = await run('mn:nope', admin);
      assert.deepEqual(unknown.calls, []);
      assert.equal(unknown.bot.answers[0].text, ui.EXPIRED_TEXT);
      assert.deepEqual((await run('mn:checkin', emp)).calls, []);
      assert.deepEqual((await run('mn:pending_leaves', mgr, 'group')).calls, []);
    });

    test('اعلان درخواست مرخصی به تأییدکننده دکمه‌ی «📥 درخواست‌های منتظر» دارد و ارجاع به دستور ندارد', async () => {
      const typ = typesRepo.findByCode('mission');
      const bot = mockBot(); const c = chat();
      session.start(c, 'leave', { userId: emp.id, leaveTypeId: typ.id, leaveType: 'mission', unit: 'day', startDate: '2027-07-01', endDate: '2027-07-01', reason: null });
      session.update(c, { step: 4 }); // مرحله‌ی تأیید
      await leave.handleLeaveCallback(bot, query(c, 'leave_confirm:yes'), session.get(c));
      assert.ok(bot.sent.some((m) => /ثبت شد/.test(m.text)), `ثبت نشد: ${JSON.stringify(bot.sent.map((m) => m.text))}`);
      const note = bot.sent.find((m) => String(m.c) === String(mgr.telegram_user_id));
      assert.ok(note, 'اعلان به سرپرست');
      assert.doesNotMatch(note.text, /\/\w+/);
      assert.equal(note.opts.reply_markup.inline_keyboard[0][0].callback_data, 'mn:pending_leaves');
      assert.ok(Buffer.byteLength('mn:pending_leaves') <= 64);
    });

    test('راهنما و شروع: بدون هیچ /دستور؛ راهنما دکمه‌های هر نقش را می‌گوید', async () => {
      const texts = {};
      for (const [name, user] of Object.entries({ emp, mgr, admin })) {
        const bot = mockBot();
        await help.handleHelp(bot, { chat: { id: chat(), type: 'private' }, from: { id: Number(user.telegram_user_id) } });
        texts[name] = last(bot).text;
        const b2 = mockBot();
        await start.handleStart(b2, { chat: { id: chat(), type: 'private' }, from: { id: Number(user.telegram_user_id) } });
        assert.doesNotMatch(last(b2).text, /\/\w+/, `start/${name}`);
      }
      for (const t of Object.values(texts)) assert.doesNotMatch(t, /(^|\s)\/[a-z_]+/);
      assert.match(texts.emp, /وضعیت من/);
      assert.doesNotMatch(texts.emp, /افزودن کارمند|اعتراض‌ها/);
      assert.match(texts.mgr, /اعتراض‌ها/);
      assert.doesNotMatch(texts.mgr, /افزودن کارمند/);
      assert.match(texts.admin, /افزودن کارمند/);
      assert.match(texts.admin, /اصلاح رکورد/);
    });

    test('هیچ پیام کاربری در src/bot و صفحه‌ی ورود پنل به /دستور ارجاع نمی‌دهد', () => {
      const root = path.join(__dirname, '..');
      const files = [];
      const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.js')) files.push(f); } };
      walk(path.join(root, 'src', 'bot'));
      const re = /(?<![#\w])\/(start|help|status|report|leave|panel|add_employee|list_employees|team_report|pending_leaves|pending_disputes|fix_record)\b/;
      const offenders = [];
      for (const f of files) {
        fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (re.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line) && !/onText|require\(|\.js['"]/.test(line)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
        });
      }
      assert.deepEqual(offenders, []);
      assert.doesNotMatch(fs.readFileSync(path.join(root, 'public-admin', 'index.html'), 'utf8'), /<code>\/panel<\/code>/);
    });
  });

  describe('E5: سیم‌کشی index.js', () => {
    const src = () => fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'index.js'), 'utf8');

    test('setMyCommands با آرایه‌ی خالی صدا زده می‌شود (منوی «/» خالی)', () => {
      assert.match(src(), /setMyCommands\(\[\]\)/);
      assert.doesNotMatch(src(), /setMyCommands\(\[\s*\{/);
    });

    test('روتر انتخابگر و mn: پیش از callbackهای جریان‌ها در callback_query وصل است', () => {
      const s = src();
      const body = s.slice(s.indexOf("bot.on('callback_query'"));
      const iPick = body.indexOf('handlePickerCallback(bot, query)');
      const iMn = body.indexOf('handleMenuCallback(bot, query)');
      const iLeave = body.indexOf("data.startsWith('leave_type:')");
      assert.ok(iPick > 0 && iMn > iPick && iLeave > iMn);
    });

    test('بات واقعی با polling مقصد جعلی: callback منقضی answer می‌شود (تست یکپارچه‌ی کوچک)', async () => {
      const bot = mockBot(); const c = chat();
      await router.handlePickerCallback(bot, { id: 'z', data: 'tp:p:9', from: { id: 1 }, message: { chat: { id: c, type: 'private' }, message_id: 1 } });
      assert.equal(bot.answers.length, 1);
      assert.equal(bot.answers[0].text, ui.EXPIRED_TEXT);
    });
  });
});
