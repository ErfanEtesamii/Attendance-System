// E3 (فاز ۱۲): ثبت تسک فوری از بات (جریان چندمرحله‌ای) و دکمه‌ی پنل. منطق کسب‌وکار در urgentTaskService (E1) تست شده؛
// اینجا فقط لایه‌ی تعامل: اسکوپ فهرست، مراحل، بازگشت به مرحله‌ی تاریخ در خطای تاریخ، رد نقش، و وجود دکمه‌ی پنل.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('تسک فوری از بات و پنل (E3)', () => {
  let F; let session; let router; let flow; let menu; let ui; let svc;
  let admin; let mgr; let otherMgr; let emp; let outsider; let seq = 0;
  const TODAY = '2026-03-04'; // چهارشنبه
  const chat = () => 7000 + (seq += 1);

  const mockBot = () => ({
    sent: [], answers: [], edits: [],
    async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; },
    async answerCallbackQuery(id, o) { this.answers.push({ id, ...(o || {}) }); return true; },
    async editMessageReplyMarkup() { return true; },
    async editMessageText(text, o) { this.edits.push({ text, o }); return true; },
  });
  const last = (bot) => bot.sent[bot.sent.length - 1];
  const datas = (bot) => (last(bot).opts.reply_markup.inline_keyboard || []).flat().map((b) => b.callback_data);
  const msgOf = (user, c, text) => ({ chat: { id: c, type: 'private' }, from: { id: Number(user.telegram_user_id) }, text });
  const queryOf = (user, c, data) => ({ id: `q${(seq += 1)}`, data, from: { id: Number(user.telegram_user_id) }, message: { message_id: 5, chat: { id: c, type: 'private' } } });
  const say = (bot, user, c, text) => flow.handleUrgentTaskText(bot, msgOf(user, c, text), session.get(c));
  const press = (bot, user, c, data) => router.handlePickerCallback(bot, queryOf(user, c, data));

  before(() => {
    resetDb();
    mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T08:00:00Z`) });
    F = require('./helpers/factories');
    session = require('../src/bot/session');
    router = require('../src/bot/ui/pickerRouter');
    flow = require('../src/bot/commands/urgentTask');
    menu = require('../src/bot/menu/menuRouter');
    ui = require('../src/bot/ui/pickers');
    svc = require('../src/services/urgentTaskService');
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    otherMgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id, name: 'کارمند الف' });
    outsider = F.makeUser({ managerId: otherMgr.id, name: 'کارمند ب' });
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('فهرست کارمند: سرپرست فقط زیردستان مستقیمِ فعال؛ ادمین همه‌ی فعال‌ها به‌جز خودش', () => {
    const ids = (actor) => ui.candidateUsers('urgent_targets', { actorId: actor.id }).map((u) => u.id);
    assert.deepEqual(ids(mgr), [emp.id]);
    const a = ids(admin);
    assert.ok(a.includes(emp.id) && a.includes(outsider.id) && a.includes(mgr.id));
    assert.ok(!a.includes(admin.id));
    assert.deepEqual(ids({ id: 999999 }), []); // actor ناموجود ⇒ خالی
  });

  test('منو: دکمه‌ی «⚡ تسک فوری» فقط برای سرپرست/ادمین و به handler وصل است', async () => {
    const item = menu.ITEMS.find((i) => i.id === 'urgent_task');
    assert.deepEqual(item.roles, ['manager', 'admin', 'owner']);
    assert.equal(menu.defaultHandlers().urgentTask, flow.handleUrgentTaskCommand);
    const bot = mockBot(); const c = chat();
    await menu.routeMenuText(bot, msgOf(emp, c, '⚡ تسک فوری'), menu.defaultHandlers());
    assert.match(bot.sent[0].text, /در دسترس نیست/);
    assert.equal(session.get(c), null);
  });

  test('کارمند عادی با دستور مستقیم هم جریان را شروع نمی‌کند', async () => {
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(emp, c, '/urgent_task'));
    assert.equal(session.get(c), null);
    assert.match(last(bot).text, /فقط برای ادمین و سرپرست/);
  });

  test('مسیر کامل سرپرست: کارمند ← روز ← متن ⇒ بلافاصله ذخیره و در برنامه‌ی همان روز ثبت می‌شود (بدون مرحله‌ی تأیید/مهلت)', async () => {
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(mgr, c, '/urgent_task'));
    assert.equal(session.get(c).flow, 'urgent_task');
    assert.deepEqual(datas(bot).filter((d) => d.startsWith('ep:u:')), [`ep:u:${emp.id}`]); // فقط زیردست خودش

    await press(bot, mgr, c, `ep:u:${emp.id}`);
    assert.equal(session.get(c).step, 1);
    assert.match(last(bot).text, /کدام روز/); // اول روز پرسیده می‌شود
    assert.ok(datas(bot).includes(`dp:d:${TODAY}`)); // دکمه‌ی «امروز»
    await press(bot, mgr, c, `dp:d:${TODAY}`);
    assert.equal(session.get(c).step, 2);
    assert.match(last(bot).text, /متن تسک فوری/);

    await say(bot, mgr, c, 'ارسال پیش‌فاکتور');
    assert.equal(session.get(c), null); // ذخیره شد؛ مرحله‌ی تأیید ندارد
    assert.match(last(bot).text, /تسک فوری ثبت شد/);
    assert.match(last(bot).text, /ارسال پیش‌فاکتور/);
    const items = svc.list({ userId: emp.id });
    assert.equal(items.length, 1);
    assert.equal(items[0].title, 'ارسال پیش‌فاکتور');
    assert.equal(items[0].date, TODAY);
    assert.equal(items[0].deadlineTime, null);
    assert.equal(items[0].assignedBy, mgr.id);
  });

  test('تاریخ با تایپ هم قبول می‌شود و ادمین برای هر کارمندی تسک می‌دهد', async () => {
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(admin, c, '/urgent_task'));
    await press(bot, admin, c, `ep:u:${outsider.id}`);
    await say(bot, admin, c, TODAY);
    await say(bot, admin, c, 'کار دوم');
    assert.equal(session.get(c), null);
    assert.ok(svc.list({ userId: outsider.id }).some((t) => t.title === 'کار دوم' && t.date === TODAY));
  });

  test('متن خالی/بلند رد می‌شود و جریان در همان مرحله می‌ماند', async () => {
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(admin, c, '/urgent_task'));
    await press(bot, admin, c, `ep:u:${emp.id}`);
    await press(bot, admin, c, `dp:d:${TODAY}`);
    await say(bot, admin, c, 'x'.repeat(svc.TITLE_MAX + 1));
    assert.equal(session.get(c).step, 2);
    assert.match(last(bot).text, /حداکثر/);
    await say(bot, admin, c, '   ');
    assert.equal(session.get(c).step, 2);
    assert.match(last(bot).text, /الزامی/);
  });

  test('تاریخ تایپی نامعتبر در همان مرحله می‌ماند', async () => {
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(admin, c, '/urgent_task'));
    await press(bot, admin, c, `ep:u:${emp.id}`);
    await say(bot, admin, c, 'فردا');
    assert.equal(session.get(c).step, 1);
    assert.match(last(bot).text, /فرمت تاریخ/);
  });

  test('خطای تاریخ هنگام ذخیره (گذشته) ⇒ برگشت به مرحله‌ی روز؛ متن و کارمند حفظ می‌شود و با روز درست خودکار ذخیره می‌شود', async () => {
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(admin, c, '/urgent_task'));
    await press(bot, admin, c, `ep:u:${emp.id}`);
    await say(bot, admin, c, '2026-03-01'); // تایپ تاریخ گذشته
    const before = svc.list({ userId: emp.id }).length;
    await say(bot, admin, c, 'کار گذشته');
    const s = session.get(c);
    assert.equal(s.step, 1);
    assert.equal(s.data.title, 'کار گذشته');
    assert.equal(s.data.employeeId, emp.id);
    assert.ok(bot.sent.some((m) => /گذشته/.test(m.text)));
    assert.equal(svc.list({ userId: emp.id }).length, before); // چیزی ثبت نشده
    await press(bot, admin, c, `dp:d:${TODAY}`);
    assert.equal(session.get(c), null); // متن از قبل هست ⇒ مستقیم ذخیره
    assert.ok(svc.list({ userId: emp.id }).some((t) => t.title === 'کار گذشته' && t.date === TODAY));
  });

  test('نقش وسط مکالمه عوض شود ⇒ ثبت نمی‌شود', async () => {
    const usersRepo = require('../src/repositories/usersRepository');
    const m2 = F.makeUser({ role: 'manager' });
    const e2 = F.makeUser({ managerId: m2.id });
    const bot = mockBot(); const c = chat();
    await flow.handleUrgentTaskCommand(bot, msgOf(m2, c, '/urgent_task'));
    await press(bot, m2, c, `ep:u:${e2.id}`);
    await press(bot, m2, c, `dp:d:${TODAY}`);
    usersRepo.updateUser(m2.id, { role: 'employee' });
    await say(bot, m2, c, 'کار');
    assert.equal(session.get(c), null);
    assert.match(last(bot).text, /فقط برای ادمین و سرپرست/);
    assert.equal(svc.list({ userId: e2.id }).length, 0);
  });

  test('پنل: دکمه‌ی «⚡ تسک فوری» با مجوز tasks.assign_urgent، فرم به API E1 وصل است', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-teamreports.js'), 'utf8');
    assert.match(src, /AP\.can\('tasks\.assign_urgent'\)/);
    assert.match(src, /\/admin\/users\/\$\{userId\}\/urgent-tasks/);
    assert.match(src, /AP\.dates\.mount\(body\)/);
    assert.match(src, /data-act="urgent"/);
  });
});
