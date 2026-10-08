// S4-10b: جریان /leave بات روی leaveService — انتخاب نوع/واحد، روزانه/نیم‌روز/ساعتی، خلاصه با مدت و هشدار، رد قواعد، سازگاری با callback قدیمی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('بات /leave روی leaveService (S4-10b)', () => {
  let leave; let session; let leaveRepo; let typesRepo; let settingsRepo; let balanceSvc; let annual; let emp; let admin; let seq = 0;
  const chat = () => 7000 + (seq += 1);
  const mockBot = () => ({ sent: [], async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; }, async answerCallbackQuery() { return true; } });
  const last = (bot) => bot.sent[bot.sent.length - 1];
  const cbData = (bot) => last(bot).opts.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

  before(() => {
    resetDb();
    const F = require('./helpers/factories');
    leave = require('../src/bot/commands/leave');
    session = require('../src/bot/session');
    leaveRepo = require('../src/repositories/leaveRepository');
    typesRepo = require('../src/repositories/leaveTypesRepository');
    settingsRepo = require('../src/repositories/settingsRepository');
    balanceSvc = require('../src/services/leaveBalanceService');
    admin = F.makeUser({ role: 'admin' });
    emp = F.makeUser();
    annual = typesRepo.findByCode('annual');
    typesRepo.updateLeaveType(annual.id, { allowedUnits: ['day', 'half_day', 'hour'] });
    balanceSvc.setEntitlement({ userId: emp.id, leaveTypeId: annual.id, jalaliYear: 1405, entitledMinutes: 100000, actor: admin.id, reason: 'تست' });
  });
  after(() => cleanup());

  const cb = (c, data) => ({ id: 'q', data, message: { chat: { id: c } } });
  const say = async (bot, c, text) => leave.handleLeaveText(bot, { chat: { id: c }, text }, session.get(c));
  const press = async (bot, c, data) => leave.handleLeaveCallback(bot, cb(c, data), session.get(c));
  const begin = async (bot, c) => {
    session.start(c, 'leave', { userId: emp.id });
    // فرمان واقعی کاربر ثبت‌نام‌شده می‌خواهد؛ این‌جا مستقیم با session شروع می‌کنیم و دکمه‌ی نوع را می‌زنیم
  };

  test('/leave: فهرست انواع فعال (به‌جز غیرفعال) به‌صورت دکمه‌ی leave_type:<id>', async () => {
    const bot = mockBot();
    const c = chat();
    await leave.handleLeaveCommand(bot, { chat: { id: c }, from: { id: Number(emp.telegram_user_id) } });
    const data = cbData(bot);
    assert.ok(data.includes(`leave_type:${annual.id}`) && data.includes('leave_cancel'));
    const mission = typesRepo.findByCode('mission');
    assert.ok(data.includes(`leave_type:${mission.id}`));
    assert.equal(session.get(c).flow, 'leave');
  });

  test('روزانه (نوع تک‌واحدی ⇒ سؤال واحد پرسیده نمی‌شود): شروع → پایان → توضیح → خلاصه → ثبت با مدت', async () => {
    const mission = typesRepo.findByCode('mission');
    const bot = mockBot(); const c = chat();
    await begin(bot, c);
    await press(bot, c, `leave_type:${mission.id}`);
    assert.match(last(bot).text, /تاریخ شروع/);
    await say(bot, c, '2027-01-04'); // دوشنبه
    await say(bot, c, '2027-01-05');
    await say(bot, c, 'جلسه');
    assert.match(last(bot).text, /مدت: 2 روز/);
    assert.match(last(bot).text, /نوع: مأموریت/);
    await press(bot, c, 'leave_confirm:yes');
    const row = leaveRepo.listByUser(emp.id).find((r) => r.start_date === '2027-01-04');
    assert.deepEqual([row.unit, row.duration_minutes, row.status, row.reason], ['day', 1020, 'pending', 'جلسه']);
    assert.ok(bot.sent.some((m) => m.c === c && /ثبت شد/.test(m.text)));
    assert.equal(session.get(c), null);
  });

  test('نیم‌روز: نوع چندواحدی ⇒ سؤال واحد؛ تاریخ → صبح/عصر → توضیح', async () => {
    const bot = mockBot(); const c = chat();
    await begin(bot, c);
    await press(bot, c, `leave_type:${annual.id}`);
    assert.deepEqual(cbData(bot).filter((d) => d.startsWith('leave_unit:')).sort(), ['leave_unit:day', 'leave_unit:half_day', 'leave_unit:hour']);
    await press(bot, c, 'leave_unit:half_day');
    await say(bot, c, '2027-02-01');
    assert.deepEqual(cbData(bot).slice(0, 2), ['leave_part:morning', 'leave_part:afternoon']);
    await press(bot, c, 'leave_part:afternoon');
    await say(bot, c, '-');
    assert.match(last(bot).text, /بخش: عصر/);
    assert.match(last(bot).text, /مدت: 4 ساعت و 15 دقیقه/);
    await press(bot, c, 'leave_confirm:yes');
    const row = leaveRepo.listByUser(emp.id).find((r) => r.start_date === '2027-02-01');
    assert.deepEqual([row.unit, row.half_day_part, row.duration_minutes], ['half_day', 'afternoon', 255]);
  });

  test('ساعتی: ساعت نامعتبر/پایان قبل از شروع دوباره پرسیده می‌شود؛ ثبت با start/end_time', async () => {
    const bot = mockBot(); const c = chat();
    await begin(bot, c);
    await press(bot, c, `leave_type:${annual.id}`);
    await press(bot, c, 'leave_unit:hour');
    await say(bot, c, '2027-02-02');
    await say(bot, c, '25:00');
    assert.match(last(bot).text, /ساعت نامعتبر/);
    await say(bot, c, '9:30');
    await say(bot, c, '09:00');
    assert.match(last(bot).text, /قبل از ساعت شروع/);
    await say(bot, c, '11:30');
    await say(bot, c, 'کار شخصی');
    assert.match(last(bot).text, /از ساعت: 09:30/);
    assert.match(last(bot).text, /مدت: 2 ساعت/);
    await press(bot, c, 'leave_confirm:yes');
    const row = leaveRepo.listByUser(emp.id).find((r) => r.start_date === '2027-02-02');
    assert.deepEqual([row.unit, row.start_time, row.end_time, row.duration_minutes], ['hour', '09:30', '11:30', 120]);
  });

  test('قواعد سرویس در بات: تداخل ⇒ پیام خطا و پایان جریان؛ مانده‌ی کم + warn ⇒ هشدار؛ + block ⇒ رد', async () => {
    // تداخل با درخواست ساعتیِ قبلی
    let bot = mockBot(); let c = chat();
    await begin(bot, c);
    await press(bot, c, `leave_type:${annual.id}`);
    await press(bot, c, 'leave_unit:day');
    await say(bot, c, '2027-02-02');
    await say(bot, c, '2027-02-02');
    await say(bot, c, '-');
    assert.match(last(bot).text, /قابل ثبت نیست/);
    assert.match(last(bot).text, /تداخل/);
    assert.equal(session.get(c), null);

    // مانده‌ی کم
    const poor = require('./helpers/factories').makeUser();
    const run = async (policy) => {
      settingsRepo.setValue('leaveBalancePolicy', policy);
      const b = mockBot(); const cc = chat();
      session.start(cc, 'leave', { userId: poor.id });
      await leave.handleLeaveCallback(b, cb(cc, `leave_type:${annual.id}`), session.get(cc));
      await press(b, cc, 'leave_unit:day');
      await say(b, cc, '2027-03-01');
      await say(b, cc, '2027-03-01');
      await say(b, cc, '-');
      return b;
    };
    bot = await run('warn');
    assert.match(last(bot).text, /مانده‌ی مرخصی شما برای این درخواست کافی نیست/);
    assert.ok(last(bot).opts.reply_markup);
    bot = await run('block');
    assert.match(last(bot).text, /مانده‌ی مرخصی برای این درخواست کافی نیست/);
    assert.equal(last(bot).opts, undefined);
    settingsRepo.resetValue('leaveBalancePolicy');
  });

  test('سازگاری: callback قدیمی leave_type:leave و session بدون unit (روزانه) هنوز کار می‌کند؛ نوع غیرفعال رد می‌شود', async () => {
    let bot = mockBot(); let c = chat();
    await begin(bot, c);
    await press(bot, c, 'leave_type:leave');
    assert.match(last(bot).text, /تاریخ شروع/);
    await say(bot, c, '2027-04-05');
    await say(bot, c, '2027-04-05');
    await say(bot, c, '-');
    await press(bot, c, 'leave_confirm:yes');
    assert.ok(leaveRepo.listByUser(emp.id).some((r) => r.start_date === '2027-04-05' && r.unit === 'day'));

    bot = mockBot(); c = chat();
    session.start(c, 'leave', { userId: emp.id });
    await leave.handleLeaveCallback(bot, cb(c, 'leave_confirm:yes'), { data: { userId: emp.id, startDate: '2027-04-06', endDate: '2027-04-06', leaveType: 'leave', reason: null } });
    assert.ok(leaveRepo.listByUser(emp.id).some((r) => r.start_date === '2027-04-06'));

    const off = typesRepo.createLeaveType({ code: 'off_t', title: 'غیرفعال', kind: 'leave', isPaid: true, requiresAttachment: false, countsAgainstBalance: false, allowedUnits: ['day'], maxConsecutiveDays: null, isActive: false });
    bot = mockBot(); c = chat();
    await begin(bot, c);
    await press(bot, c, `leave_type:${off.id}`);
    assert.match(last(bot).text, /دیگر در دسترس نیست/);
    assert.equal(session.get(c), null);
  });
});
