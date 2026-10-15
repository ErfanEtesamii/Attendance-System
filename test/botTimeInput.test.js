// H4 (بات): تایپ ساعت در «اصلاح رکورد» — «1530»/ارقام فارسی/«15.30»، پیام راهنمای force_reply (کیبورد سیستم)،
// و برگشت کیبورد «📂 منو» بعد از پایان/انصراف. ماک بات مثل botPickers.test.js؛ کیبورد واقعی گوشی فقط با بررسی دستی دیده می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('اصلاح رکورد در بات: تایپ ساعت و کیبورد (H4)', () => {
  let ui; let router; let session; let fix; let menu; let usersRepo; let attRepo; let F; let admin; let emp; let seq = 0; let TI;
  const chat = () => 9500 + (seq += 1);

  const mockBot = () => ({
    sent: [], answers: [],
    async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; },
    async answerCallbackQuery(id, o) { this.answers.push({ id, ...(o || {}) }); return true; },
    async editMessageReplyMarkup() { return true; },
    async editMessageText() { return true; },
  });
  const last = (bot) => bot.sent[bot.sent.length - 1];
  const markup = (m) => (m && m.opts && m.opts.reply_markup) || {};
  const forceReplies = (bot) => bot.sent.filter((m) => markup(m).force_reply);
  const query = (c, data) => ({ id: `q${(seq += 1)}`, data, from: { id: Number(admin.telegram_user_id) }, message: { message_id: 5, chat: { id: c, type: 'private' } } });
  const adminMsg = (c, text) => ({ chat: { id: c }, from: { id: Number(admin.telegram_user_id) }, text });
  const isMenuKeyboard = (m) => {
    const kb = markup(m).keyboard;
    return Array.isArray(kb) && kb.length === 1 && kb[0].length === 1 && kb[0][0].text === menu.MENU_LABEL;
  };
  const expectedIso = (date, hhmm) => new Date(`${date}T${hhmm}:00`).toISOString();

  /** جلسه‌ی اصلاح رکورد در مرحله‌ی دلخواه */
  function startAt(step, extra = {}) {
    const c = chat();
    session.start(c, 'fix_record', { adminId: admin.id });
    session.update(c, { step, data: { adminId: admin.id, employeeId: emp.id, employeeName: emp.full_name, recordId: 1, recordDate: '2027-01-04', field: 'check_in_time', ...extra } });
    return c;
  }

  before(() => {
    resetDb();
    F = require('./helpers/factories');
    ui = require('../src/bot/ui/pickers');
    router = require('../src/bot/ui/pickerRouter');
    session = require('../src/bot/session');
    fix = require('../src/bot/commands/fixRecord');
    menu = require('../src/bot/menu/menuRouter');
    usersRepo = require('../src/repositories/usersRepository');
    attRepo = require('../src/repositories/attendanceRepository');
    TI = require('../src/utils/timeInput');
    admin = F.makeUser({ role: 'admin' });
    emp = F.makeUser({});
  });
  after(() => cleanup());

  describe('ورودی تایپی ساعت (مرحله‌ی ۳)', () => {
    for (const [raw, hhmm] of [['1530', '15:30'], ['۱۵:۳۰', '15:30'], ['۱۵۳۰', '15:30'], ['15.30', '15:30'], ['15:3', '15:03'], ['9', '09:00'], ['٠٨٣٠', '08:30']]) {
      test(`«${raw}» ⇒ ${hhmm}؛ رفتن به مرحله‌ی دلیل با مقدار ISO درست`, async () => {
        const bot = mockBot(); const c = startAt(3);
        await fix.handleFixRecordText(bot, adminMsg(c, raw), session.get(c));
        assert.equal(session.get(c).step, 4);
        assert.equal(session.get(c).data.newValue, expectedIso('2027-01-04', hhmm));
        assert.match(last(bot).text, /دلیل/);
      });
    }

    test('مقدار نامعتبر ⇒ همان مرحله، پیام خطای فارسی مشخص (ساعت/دقیقه/قالب) و مقدار جدید ذخیره نمی‌شود', async () => {
      const cases = [['25:00', TI.parse('25:00').error], ['2400', TI.parse('2400').error], ['12:75', TI.parse('12:75').error], ['abc', TI.parse('abc').error], ['15:30:10', TI.parse('15:30:10').error]];
      for (const [raw, msg] of cases) {
        const bot = mockBot(); const c = startAt(3);
        await fix.handleFixRecordText(bot, adminMsg(c, raw), session.get(c));
        assert.equal(session.get(c).step, 3, raw);
        assert.equal(session.get(c).data.newValue, undefined, raw);
        assert.ok(last(bot).text.includes(msg), `${raw}: ${last(bot).text}`);
        assert.match(last(bot).text, /تایپ کنید/);
      }
    });

    test('تاریخ با ارقام فارسی (مرحله‌ی ۱) پذیرفته و به لاتین ذخیره می‌شود', async () => {
      const rec = attRepo.createManual({ userId: emp.id, recordDate: '2027-01-04', checkInTime: '2027-01-04T05:00:00.000Z', status: 'normal' });
      const bot = mockBot(); const c = startAt(1, { recordId: undefined, recordDate: undefined });
      await fix.handleFixRecordText(bot, adminMsg(c, '۲۰۲۷-۰۱-۰۴'), session.get(c));
      assert.equal(session.get(c).step, 2);
      assert.equal(session.get(c).data.recordDate, '2027-01-04');
      assert.equal(session.get(c).data.recordId, rec.id);
    });
  });

  describe('پیام راهنمای تایپ (force_reply)', () => {
    test('انتخاب فیلد ساعت ⇒ اول پیام «⌨️ یا ساعت را تایپ کنید، مثل 15:30» با force_reply و placeholder، بعد پیام انتخابگر با inline_keyboard (دو پیام جدا)', async () => {
      const bot = mockBot(); const c = startAt(2);
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:check_out_time'), session.get(c));
      const fr = forceReplies(bot);
      assert.equal(fr.length, 1);
      assert.equal(fr[0].text, '⌨️ یا ساعت را تایپ کنید، مثل 15:30');
      assert.equal(fr[0].opts.reply_markup.input_field_placeholder, '15:30');
      assert.equal(fr[0].opts.reply_markup.inline_keyboard, undefined, 'یک پیام فقط یک نوع reply_markup');
      const picker = last(bot);
      assert.ok(Array.isArray(markup(picker).inline_keyboard) && !markup(picker).force_reply, 'انتخابگر ساعت inline است');
      assert.ok(bot.sent.indexOf(fr[0]) < bot.sent.indexOf(picker), 'راهنما قبل از انتخابگر');
      assert.equal(session.get(c).data.kbHidden, true);
      assert.ok(markup(picker).inline_keyboard.flat().some((b) => b.callback_data === 'tp:t:0900'), 'انتخابگر دکمه‌ای سر جایش است');
    });

    test('شروع جریان (کارمند با آیدی تلگرام) ⇒ راهنمای تاریخ با force_reply و بعد تقویم', async () => {
      const bot = mockBot(); const c = chat();
      session.start(c, 'fix_record', { adminId: admin.id });
      await fix.handleFixRecordText(bot, adminMsg(c, String(emp.telegram_user_id)), session.get(c));
      assert.equal(session.get(c).step, 1);
      const fr = forceReplies(bot);
      assert.equal(fr.length, 1);
      assert.match(fr[0].text, /تاریخ را تایپ کنید/);
      assert.equal(fr[0].opts.reply_markup.input_field_placeholder, 'YYYY-MM-DD');
      assert.ok(markup(last(bot)).inline_keyboard.flat().some((b) => b.callback_data.startsWith('dp:d:')), 'تقویم');
    });

    test('مرحله‌ی دلیل ⇒ راهنمای «دلیل را همین‌جا تایپ کنید» با placeholder جدا', async () => {
      const bot = mockBot(); const c = startAt(3);
      await fix.handleFixRecordText(bot, adminMsg(c, '1530'), session.get(c));
      const fr = forceReplies(bot);
      assert.equal(fr.length, 1);
      assert.match(fr[0].text, /دلیل/);
      assert.equal(fr[0].opts.reply_markup.input_field_placeholder, 'دلیل اصلاح…');
    });

    test('بدون typeHint هیچ پیام force_reply نمی‌رود (جریان‌های دیگر دست‌نخورده)', async () => {
      const bot = mockBot(); const c = startAt(2);
      await ui.askTime(bot, c, { text: 'ساعت؟', label: 'ساعت' });
      await ui.askText(bot, c, 'متن؟');
      assert.equal(bot.sent.length, 2);
      assert.equal(forceReplies(bot).length, 0);
      assert.equal(session.get(c).data.kbHidden, undefined, 'کیبورد منو پنهان نشده');
    });

    test('شکست ارسال راهنما مرحله را نمی‌شکند (انتخابگر همچنان فرستاده می‌شود)', async (t) => {
      t.mock.method(console, 'error', () => {});
      const bot = mockBot();
      const orig = bot.sendMessage.bind(bot);
      bot.sendMessage = async (c, text, opts) => { if (opts && opts.reply_markup && opts.reply_markup.force_reply) throw new Error('boom'); return orig(c, text, opts); };
      const c = startAt(2);
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:check_in_time'), session.get(c));
      assert.equal(session.get(c).step, 3);
      assert.ok(markup(last(bot)).inline_keyboard, 'انتخابگر ساعت رسید');
    });
  });

  describe('برگشت کیبورد «📂 منو»', () => {
    test('menuKeyboardOpts: ادمین ⇒ کیبورد تک‌دکمه‌ای؛ کاربر ناموجود یا چت گروهی ⇒ {}', () => {
      assert.ok(isMenuKeyboard({ opts: ui.menuKeyboardOpts(admin) }));
      assert.deepEqual(ui.menuKeyboardOpts(null), {});
      assert.deepEqual(ui.menuKeyboardOpts(admin, 'supergroup'), {});
    });

    test('پایان موفق اصلاح (کامل با دکمه/تایپ) ⇒ پیام «✅ رکورد اصلاح شد» همراه کیبورد منو؛ رکورد با ساعت تایپی (ارقام فارسی) اصلاح می‌شود', async () => {
      const rec = attRepo.createManual({ userId: emp.id, recordDate: '2027-02-10', checkInTime: '2027-02-10T05:00:00.000Z', status: 'normal' });
      const bot = mockBot(); const c = chat();
      session.start(c, 'fix_record', { adminId: admin.id });
      await fix.handleFixRecordText(bot, adminMsg(c, String(emp.telegram_user_id)), session.get(c));
      await fix.handleFixRecordText(bot, adminMsg(c, '۲۰۲۷-۰۲-۱۰'), session.get(c));
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:check_out_time'), session.get(c));
      await fix.handleFixRecordText(bot, adminMsg(c, '۱۷۳۰'), session.get(c));
      assert.equal(session.get(c).step, 4);
      await fix.handleFixRecordText(bot, adminMsg(c, 'فراموشی خروج'), session.get(c));
      assert.equal(session.get(c), null);
      assert.match(last(bot).text, /رکورد اصلاح شد/);
      assert.ok(isMenuKeyboard(last(bot)), 'کیبورد منو با پیام پایانی برمی‌گردد');
      assert.equal(attRepo.findById(rec.id).check_out_time, expectedIso('2027-02-10', '17:30'));
    });

    test('انصراف با دکمه‌ی «انصراف» (fl:x) بعد از راهنمای تایپ ⇒ «انصراف داده شد.» همراه کیبورد منو', async () => {
      const bot = mockBot(); const c = startAt(2);
      await fix.handleFixRecordCallback(bot, query(c, 'fix_field:check_out_time'), session.get(c));
      await router.handlePickerCallback(bot, query(c, 'fl:x'));
      assert.equal(session.get(c), null);
      assert.equal(last(bot).text, 'انصراف داده شد.');
      assert.ok(isMenuKeyboard(last(bot)));
    });

    test('انصراف بدون هیچ force_reply ⇒ همان پیام قبلی بدون کیبورد اضافه', async () => {
      const bot = mockBot(); const c = startAt(2);
      await router.handlePickerCallback(bot, query(c, 'fl:x'));
      assert.equal(last(bot).text, 'انصراف داده شد.');
      assert.equal(markup(last(bot)).keyboard, undefined);
    });

    test('«لغو» خودِ اصلاح رکورد (fix_cancel) ⇒ «عملیات لغو شد.» همراه کیبورد منو', async () => {
      const bot = mockBot(); const c = startAt(3);
      await fix.handleFixRecordCallback(bot, query(c, 'fix_cancel'), session.get(c));
      assert.equal(session.get(c), null);
      assert.equal(last(bot).text, 'عملیات لغو شد.');
      assert.ok(isMenuKeyboard(last(bot)));
    });

    test('رکورد پیدا نشد ⇒ جریان لغو و کیبورد منو برمی‌گردد', async () => {
      const bot = mockBot(); const c = startAt(1, { recordId: undefined, recordDate: undefined });
      await fix.handleFixRecordText(bot, adminMsg(c, '2001-01-01'), session.get(c));
      assert.equal(session.get(c), null);
      assert.match(last(bot).text, /رکوردی.*یافت نشد/);
      assert.ok(isMenuKeyboard(last(bot)));
    });

    test('نقش ادمین بعد از شروع جریان گرفته شود ⇒ پیام ممنوع + کیبورد منو (کیبورد نقشِ جدید)', async () => {
      const temp = F.makeUser({ role: 'admin' });
      const bot = mockBot(); const c = chat();
      session.start(c, 'fix_record', { adminId: temp.id });
      session.update(c, { step: 4, data: { adminId: temp.id, employeeId: emp.id, recordId: 1, recordDate: '2027-01-04', field: 'check_in_time', newValue: '2027-01-04T10:00:00.000Z' } });
      usersRepo.updateUser(temp.id, { role: 'employee' });
      await fix.handleFixRecordText(bot, { chat: { id: c }, from: { id: Number(temp.telegram_user_id) }, text: 'دلیل' }, session.get(c));
      assert.equal(session.get(c), null);
      assert.match(last(bot).text, /فقط توسط ادمین/);
      assert.ok(isMenuKeyboard(last(bot)), 'کارمند هم کیبورد تک‌دکمه‌ای منو را دارد');
    });
  });
});
