// E1/E2: منوی دکمه‌ایِ نقش‌محور بات — نرمال‌سازی متن دکمه، ماتریس نقش × دکمه، اتصال به handlerها، چک نقش سمت سرور.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('منوی دکمه‌ایِ بات (E1/E2)', () => {
  let menu; let session; let panelLinks; let config; let F; let emp; let mgr; let admin; let seq = 0; let prevUrl;
  const chat = () => 8000 + (seq += 1);
  const mockBot = () => ({
    sent: [], answers: [], deleted: [],
    async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; },
    async answerCallbackQuery(id, opts) { this.answers.push({ id, ...(opts || {}) }); return true; },
    async deleteMessage(c, m) { this.deleted.push({ c, m }); return true; },
  });
  const lastMsg = (bot) => bot.sent[bot.sent.length - 1];
  const msgFrom = (user, text, chatId, type = 'private') => ({ chat: { id: chatId || chat(), type }, from: { id: Number(user.telegram_user_id) }, text });
  const labelsOf = (kb) => kb.keyboard.flat().map((b) => b.text);

  // handlerهای جاسوس: هر کدام نام خودش را ثبت می‌کند
  const spies = () => {
    const calls = [];
    const h = {};
    for (const k of Object.keys(menu.defaultHandlers())) h[k] = async () => { calls.push(k); };
    return { calls, h };
  };

  before(() => {
    resetDb();
    F = require('./helpers/factories');
    config = require('../src/config');
    prevUrl = config.miniAppUrl;
    config.miniAppUrl = 'https://attendance.example.com/app/';
    menu = require('../src/bot/menu/menuRouter');
    session = require('../src/bot/session');
    panelLinks = require('../src/bot/panelLinks');
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
  });
  after(() => { config.miniAppUrl = prevUrl; cleanup(); });

  describe('normalizeLabel', () => {
    test('ایموجی، ی/ک عربی، همزه، نیم‌فاصله و فاصله‌ی اضافه حذف/یکسان می‌شوند', () => {
      const n = menu.normalizeLabel;
      assert.equal(n('📊 وضعیت من'), 'وضعیت من');
      assert.equal(n('  وضعيت   من  '), 'وضعیت من');
      assert.equal(n('⚙️ پنل مدیریت'), 'پنل مدیریت'); // ⚙ + FE0F
      assert.equal(n('🏖 مرخصی / 🚗 ماموریت'), 'مرخصی / ماموریت');
      assert.equal(n('مرخصی/مأموریت'), 'مرخصی / ماموریت');
      assert.equal(n('اعتراض\u200cها'), n('اعتراض ها'));
      assert.equal(n('گزارش كامل'), n('گزارش کامل')); // ك عربی
      assert.equal(n('👨\u200d👩\u200d👧 گزارش تیم'), 'گزارش تیم'); // دنباله‌ی ZWJ
      assert.equal(n('🙂'), '');
      assert.equal(n(null), '');
    });

    test('هر ۱۵ دکمه‌ی منو برچسب نرمال‌شده‌ی یکتا دارند', () => {
      const labels = menu.ITEMS.map((it) => menu.normalizeLabel(it.label));
      assert.equal(menu.ITEMS.length, 15);
      assert.equal(new Set(labels).size, labels.length);
      assert.ok(labels.every(Boolean));
    });
  });

  const EMP = ['🖥 ورود به پنل', '🕒 ثبت تردد', '🏠 ثبت دورکاری', '📊 وضعیت و گزارش من', '📋 برنامه هفتگی', '🏖 مرخصی / 🚗 ماموریت', '❓ راهنما'];
  const MGR = ['📥 درخواست‌های منتظر', '👥 گزارش تیم', '⚡ تسک فوری', '💬 اعتراض‌ها', '👤 لیست اعضا'];
  const ADM = ['➕ افزودن کارمند', '🛠 اصلاح رکورد', '🤖 تحلیلگر هوشمند'];
  const sorted = (a) => [...a].sort();

  describe('buildMainKeyboard — فقط «📂 منو» (H2)', () => {
    test('هر سه نقش: دقیقاً یک دکمه‌ی متنی «📂 منو» (بدون web_app)، resize و persistent', () => {
      for (const user of [emp, mgr, admin]) {
        const kb = menu.buildMainKeyboard(user);
        assert.deepEqual(kb.keyboard, [[{ text: '📂 منو' }]]);
        assert.equal(kb.resize_keyboard, true);
        assert.equal(kb.is_persistent, true);
      }
      assert.equal(menu.MENU_LABEL, '📂 منو');
    });

    test('بدون https هم کیبورد پایین همان یک دکمه است', () => {
      config.miniAppUrl = 'http://192.168.1.5/app/';
      try {
        assert.deepEqual(labelsOf(menu.buildMainKeyboard(admin)), ['📂 منو']);
        config.miniAppUrl = '';
        assert.deepEqual(labelsOf(menu.buildMainKeyboard(emp)), ['📂 منو']);
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('کاربر ثبت‌نشده و چت غیرخصوصی: بدون منو', () => {
      assert.equal(menu.buildMainKeyboard(null), null);
      assert.equal(menu.buildMainKeyboard(undefined), null);
      assert.equal(menu.buildMainKeyboard(emp, { chatType: 'group' }), null);
      assert.equal(menu.buildMainKeyboard(emp, { chatType: 'supergroup' }), null);
      assert.ok(menu.buildMainKeyboard(emp, { chatType: 'private' }));
    });

    test('persistentKeyboard(user) همان کیبورد را می‌دهد', () => {
      assert.deepEqual(panelLinks.persistentKeyboard(mgr), menu.buildMainKeyboard(mgr));
      assert.equal(panelLinks.persistentKeyboard(), null);
    });
  });

  describe('buildMenuInline — منوی inline نقش‌محور (H2)', () => {
    const btns = (kb) => kb.inline_keyboard.flat();
    const isMeta = (b) => b.callback_data === 'mn:_' || b.callback_data === 'mn:_close';
    const itemTexts = (kb) => btns(kb).filter((b) => !isMeta(b)).map((b) => b.text);
    const headerTexts = (kb) => btns(kb).filter((b) => b.callback_data === 'mn:_').map((b) => b.text);

    test('کارمند: ۷ آیتم پایه و بدون سرتیتر', () => {
      const kb = menu.buildMenuInline(emp);
      assert.deepEqual(sorted(itemTexts(kb)), sorted(EMP));
      assert.deepEqual(headerTexts(kb), []);
    });

    test('سرپرست: پایه + ۵ آیتم تیم (بدون آیتم ادمین) و بدون ردیف سرتیتر', () => {
      const kb = menu.buildMenuInline(mgr);
      assert.deepEqual(sorted(itemTexts(kb)), sorted([...EMP, ...MGR]));
      assert.deepEqual(headerTexts(kb), []);
    });

    test('ادمین: همه‌ی ۱۵ آیتم؛ ترتیب گروه‌ها: من ← تیم ← ادمین؛ بدون ردیف سرتیتر', () => {
      const kb = menu.buildMenuInline(admin);
      assert.deepEqual(sorted(itemTexts(kb)), sorted([...EMP, ...MGR, ...ADM]));
      assert.deepEqual(headerTexts(kb), []);
      const order = itemTexts(kb);
      const pos = (t) => order.indexOf(t);
      assert.ok(pos('🏖 مرخصی / 🚗 ماموریت') < pos('👥 گزارش تیم') && pos('👥 گزارش تیم') < pos('🛠 اصلاح رکورد'));
      assert.equal(order[order.length - 1], '❓ راهنما', 'راهنما آخرین دکمه است');
    });

    test('«🖥 ورود به پنل» اصلی‌ترین دکمه است: ردیف اولِ منو، تنها در ردیف (تمام‌عرض)، سبز و یکتا', () => {
      for (const user of [emp, mgr, admin]) {
        const first = menu.buildMenuInline(user).inline_keyboard[0];
        assert.equal(first.length, 1);
        assert.equal(first[0].text, '🖥 ورود به پنل');
        assert.equal(first[0].style, 'success');
        const greens = btns(menu.buildMenuInline(user)).filter((b) => b.style === 'success');
        assert.equal(greens.length, 1, 'رنگ سبز فقط برای پنل است');
      }
    });

    test('«درخواست‌های منتظر» و «تحلیلگر هوشمند» تمام‌عرضند و هیچ ردیفی با یک دکمه‌ی تنها (جز تمام‌عرض‌ها) نیست', () => {
      const rows = menu.buildMenuInline(admin).inline_keyboard;
      const singles = rows.filter((r) => r.length === 1).map((r) => r[0].text);
      assert.deepEqual(singles.sort(), ['✖️ بستن منو', '🖥 ورود به پنل', '🤖 تحلیلگر هوشمند', '📥 درخواست‌های منتظر', '🏖 مرخصی / 🚗 ماموریت', '❓ راهنما'].sort());
      assert.equal(rows[rows.length - 2][0].text, '❓ راهنما', 'راهنما درست قبل از «بستن منو»');
    });

    test('متن منو: خوش‌آمد با عنوان + فامیل، راهنمای رنگ بر اساس نقش، توضیح «اگر پنل باز نشد»؛ همیشه با «📂 منو» شروع می‌شود', () => {
      const t = (u) => menu.menuText(u);
      assert.ok(t(admin).startsWith('📂 منو') && t(emp).startsWith('📂 منو'));
      assert.match(t({ ...emp, full_name: 'آقای اعتصامی' }), /👋 آقای اعتصامی عزیز/);
      assert.match(t({ ...emp, full_name: 'خانم زهرا کریمی' }), /👋 خانم کریمی عزیز/);
      assert.match(t({ ...emp, full_name: 'علی رضایی' }), /👋 رضایی عزیز/);
      assert.match(t(emp), /🟢/); assert.match(t(emp), /🔵/); assert.doesNotMatch(t(emp), /🔴/);
      assert.match(t(admin), /🔴/);
      assert.match(t(emp), /اگر پنل به هر دلیلی برایتان باز نمی‌شود/);
      assert.ok(menu.isMenuMessage({ text: t(admin) }));
    });

    test('چیدمان: بقیه‌ی آیتم‌ها ۲ ستونه، سرتیتر تک‌دکمه‌ای و آخرین ردیف «✖️ بستن منو»', () => {
      for (const user of [emp, mgr, admin]) {
        const rows = menu.buildMenuInline(user).inline_keyboard;
        for (const row of rows) {
          assert.ok(row.length >= 1 && row.length <= 2);
          if (row.some((b) => b.callback_data === 'mn:_')) assert.equal(row.length, 1);
        }
        assert.deepEqual(rows[rows.length - 1], [{ text: '✖️ بستن منو', callback_data: 'mn:_close' }]);
      }
    });

    test('رنگ: پنل سبز (یکتا)؛ امکانات بات (کارمند و تیم) آبی؛ ابزار ادمین قرمز؛ راهنما، «بستن» و سرتیترها بی‌رنگ', () => {
      const kb = menu.buildMenuInline(admin);
      const by = (t) => btns(kb).find((b) => b.text === t);
      assert.equal(by('🖥 ورود به پنل').style, 'success');
      for (const t of ['🕒 ثبت تردد', '🏠 ثبت دورکاری', '📊 وضعیت و گزارش من', '📋 برنامه هفتگی', '🏖 مرخصی / 🚗 ماموریت', '📥 درخواست‌های منتظر', '👥 گزارش تیم', '⚡ تسک فوری', '💬 اعتراض‌ها', '👤 لیست اعضا']) assert.equal(by(t).style, 'primary', t);
      for (const t of ADM) assert.equal(by(t).style, 'danger', t);
      assert.equal(by('❓ راهنما').style, undefined);
      assert.equal(by('✖️ بستن منو').style, undefined);
    });

    test('ثبت تردد دکمه‌ی inline از نوع web_app است؛ «ورود به پنل» و بقیه callback به شکل mn:<id> (تا پیام ورود ارسال شود)', () => {
      const kb = menu.buildMenuInline(admin);
      const by = (t) => btns(kb).find((b) => b.text === t);
      assert.equal(by('🕒 ثبت تردد').web_app.url, 'https://attendance.example.com/app/');
      assert.equal(by('🕒 ثبت تردد').callback_data, undefined);
      assert.equal(by('🖥 ورود به پنل').callback_data, 'mn:panel');
      assert.equal(by('🖥 ورود به پنل').web_app, undefined);
      assert.equal(by('📊 وضعیت و گزارش من').callback_data, 'mn:status');
      assert.equal(by('📋 برنامه هفتگی').callback_data, 'mn:plan');
      assert.equal(by('➕ افزودن کارمند').callback_data, 'mn:add_employee');
      for (const t of ['📊 وضعیت و گزارش من', '📋 برنامه هفتگی', '➕ افزودن کارمند']) assert.equal(by(t).web_app, undefined);
    });

    test('حذف‌شده‌ها: «گزارش‌های دیروز تیم»، «پنل مدیریت» و «دورکاری‌های منتظر» (ادغام در درخواست‌های منتظر) در منو نیستند', () => {
      const texts = itemTexts(menu.buildMenuInline(admin)).join('|');
      for (const gone of ['گزارش‌های دیروز تیم', 'پنل مدیریت', 'دورکاری‌های منتظر', 'وضعیت من', 'گزارش من']) assert.ok(!texts.includes(gone) || gone === 'وضعیت من' || gone === 'گزارش من', gone);
      assert.ok(!texts.includes('گزارش‌های دیروز تیم') && !texts.includes('پنل مدیریت') && !texts.includes('دورکاری‌های منتظر'));
    });

    test('callback_data همه ≤ ۶۴ بایت و هر id یکی از آیتم‌ها یا _ / _close است', () => {
      for (const user of [emp, mgr, admin]) {
        for (const b of btns(menu.buildMenuInline(user))) {
          if (b.web_app) continue;
          assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
          const id = b.callback_data.slice(3);
          assert.ok(id === '_' || id === '_close' || menu.ITEMS.some((it) => it.id === id), b.callback_data);
        }
      }
    });

    test('بدون https (H3): آیتم‌ها می‌مانند ولی دکمه‌ی callback می‌شوند (نه web_app)', () => {
      const httpsTexts = itemTexts(menu.buildMenuInline(admin));
      config.miniAppUrl = 'http://192.168.1.5/app/';
      try {
        const kb = menu.buildMenuInline(admin);
        const texts = itemTexts(kb);
        assert.deepEqual(sorted(texts), sorted(httpsTexts), 'فهرست آیتم‌ها با http همان فهرست https است');
        assert.ok(!btns(kb).some((b) => b.web_app));
        const by = (t) => btns(kb).find((b) => b.text === t);
        assert.equal(by('🕒 ثبت تردد').callback_data, 'mn:checkin');
        assert.equal(by('🖥 ورود به پنل').callback_data, 'mn:panel');
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('کاربر ثبت‌نشده: null', () => {
      assert.equal(menu.buildMenuInline(null), null);
      assert.equal(menu.buildMenuInline(undefined), null);
    });
  });

  describe('routeMenuText — اتصال به handlerها و چک نقش سمت سرور', () => {
    const ROUTES = [
      ['📊 وضعیت و گزارش من', 'myStatus', null], ['📊 وضعیت من', 'myStatus', null], ['📈 گزارش من', 'myStatus', null],
      ['🏖 مرخصی / 🚗 ماموریت', 'leave', null], ['📋 برنامه هفتگی', 'weeklyPlan', null],
      ['🖥 ورود به پنل', 'panel', null], ['🖥 پنل', 'panel', null], ['❓ راهنما', 'help', null],
      ['👥 گزارش تیم', 'teamReport', 'manager'], ['📥 درخواست‌های منتظر', 'pendingLeaves', 'manager'], ['🏠 دورکاری‌های منتظر', 'pendingLeaves', 'manager'],
      ['💬 اعتراض‌ها', 'pendingDisputes', 'manager'], ['📝 گزارش‌های دیروز تیم', 'teamReport', 'manager'],
      ['👤 لیست اعضا', 'listEmployees', 'manager'], ['⚡ تسک فوری', 'urgentTask', 'manager'],
      ['➕ افزودن کارمند', 'addEmployee', 'admin'], ['🛠 اصلاح رکورد', 'fixRecord', 'admin'],
    ];

    for (const [label, handler, minRole] of ROUTES) {
      const allowed = { employee: !minRole, manager: minRole !== 'admin', admin: true };
      for (const role of ['employee', 'manager', 'admin']) {
        test(`${role} × «${label}» ⇒ ${allowed[role] ? `اجرای ${handler}` : 'رد، handler اجرا نمی‌شود'}`, async () => {
          const user = { employee: emp, manager: mgr, admin }[role];
          const bot = mockBot(); const { calls, h } = spies();
          const consumed = await menu.routeMenuText(bot, msgFrom(user, label), h);
          assert.equal(consumed, true);
          if (allowed[role]) { assert.deepEqual(calls, [handler]); assert.equal(bot.sent.length, 1); assert.match(bot.sent[0].text, /📂 منو/); } else { // H2: یک پیام کیبورد جدید (جایگزین کیبورد قدیمی)
            assert.deepEqual(calls, []);
            assert.match(bot.sent[0].text, /در دسترس نیست/);
          }
        });
      }
    }

    test('کارمند با ارسال دستیِ متن «➕ افزودن کارمند» اجرا نمی‌گیرد (handler واقعی؛ session شروع نمی‌شود)', async () => {
      const bot = mockBot(); const c = chat();
      assert.equal(await menu.routeMenuText(bot, msgFrom(emp, '➕ افزودن کارمند', c)), true);
      assert.equal(session.get(c), null);
      assert.match(bot.sent[0].text, /در دسترس نیست/);
      for (const t of ['🛠 اصلاح رکورد', 'اصلاح رکورد']) {
        await menu.routeMenuText(bot, msgFrom(emp, t, c));
        assert.equal(session.get(c), null);
      }
      assert.equal(bot.sent.length, 3);
    });

    test('ادمین با handler واقعی: «➕ افزودن کارمند» جریان add_employee را شروع می‌کند', async () => {
      const bot = mockBot(); const c = chat();
      await menu.routeMenuText(bot, msgFrom(admin, '➕ افزودن کارمند', c));
      assert.equal(session.get(c).flow, 'add_employee');
      assert.match(lastMsg(bot).text, /آیدی عددی/);
      session.clear(c);
    });

    test('سرپرست با handler واقعی «👤 لیست اعضا»: فقط تیم خودش را می‌بیند', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(mgr, '👤 لیست اعضا'));
      assert.match(lastMsg(bot).text, new RegExp(emp.full_name));
      assert.ok(!lastMsg(bot).text.includes(admin.full_name));
    });

    test('نقش از دیتابیس هر بار خوانده می‌شود: کارمندِ تازه‌ارتقایافته بلافاصله دسترسی می‌گیرد، غیرفعال‌شده نه', async () => {
      const usersRepo = require('../src/repositories/usersRepository');
      const u = F.makeUser({ role: 'employee' });
      let r = spies();
      await menu.routeMenuText(mockBot(), msgFrom(u, '👥 گزارش تیم'), r.h);
      assert.deepEqual(r.calls, []);
      usersRepo.updateUser(u.id, { role: 'manager' });
      r = spies();
      await menu.routeMenuText(mockBot(), msgFrom(u, '👥 گزارش تیم'), r.h);
      assert.deepEqual(r.calls, ['teamReport']);
      usersRepo.updateUser(u.id, { is_active: 0 });
      r = spies(); const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(u, '👥 گزارش تیم'), r.h);
      assert.deepEqual(r.calls, []);
      assert.match(bot.sent[0].text, /در سیستم ثبت نیستید/);
    });

    test('کاربر ثبت‌نشده: پیام «ثبت نیستید»، بدون اجرای handler', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      const stranger = { chat: { id: chat(), type: 'private' }, from: { id: 111222333 }, text: '📊 وضعیت من' };
      assert.equal(await menu.routeMenuText(bot, stranger, h), true);
      assert.deepEqual(calls, []);
      assert.match(bot.sent[0].text, /ثبت نیستید/);
    });

    test('تطبیق دقیق: متن نامرتبط/ناقص false می‌دهد و دستور slash نادیده است', async () => {
      const { calls, h } = spies(); const bot = mockBot();
      for (const t of ['سلام', 'وضعیت', 'وضعیت من امروز', '/status', '', '🙂']) {
        assert.equal(await menu.routeMenuText(bot, msgFrom(emp, t), h), false, t);
      }
      assert.deepEqual(calls, []);
      assert.equal(bot.sent.length, 0);
    });

    test('متن بدون ایموجی و حتی با ی/ک عربی و فاصله‌ی اضافه هم تطبیق می‌خورد', async () => {
      const { calls, h } = spies();
      await menu.routeMenuText(mockBot(), msgFrom(emp, 'وضعيت  من'), h);
      await menu.routeMenuText(mockBot(), msgFrom(emp, 'مرخصي/ماموريت'), h);
      assert.deepEqual(calls, ['myStatus', 'leave']);
    });

    test('فقط چت خصوصی: در گروه هیچ دکمه‌ای اجرا نمی‌شود', async () => {
      const { calls, h } = spies();
      assert.equal(await menu.routeMenuText(mockBot(), msgFrom(admin, '📊 وضعیت من', chat(), 'group'), h), false);
      assert.deepEqual(calls, []);
    });

    test('زدن دکمه‌ی منو مکالمه‌ی نیمه‌کاره را لغو می‌کند', async () => {
      const c = chat(); const { calls, h } = spies();
      session.start(c, 'leave', { userId: emp.id });
      await menu.routeMenuText(mockBot(), msgFrom(emp, '📊 وضعیت و گزارش من', c), h);
      assert.deepEqual(calls, ['myStatus']);
      assert.equal(session.get(c), null);
    });

    test('وسط مکالمه، متن آزادِ بی‌ایموجی (مثلاً علت «راهنما») ورودی مرحله است نه دکمه؛ دکمه‌ی ایموجی‌دار همچنان کار می‌کند', async () => {
      const c = chat(); const { calls, h } = spies();
      session.start(c, 'leave', { userId: emp.id });
      assert.equal(await menu.routeMenuText(mockBot(), msgFrom(emp, 'راهنما', c), h), false);
      assert.deepEqual(calls, []);
      assert.ok(session.get(c));
      assert.equal(await menu.routeMenuText(mockBot(), msgFrom(emp, '❓ راهنما', c), h), true);
      assert.deepEqual(calls, ['help']);
      assert.equal(session.get(c), null);
    });

    test('دکمه‌ی web_app اگر متنش تایپ شود: همان دکمه به‌صورت inline فرستاده می‌شود؛ بدون https پیام خطا', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(emp, '🕒 ثبت تردد'));
      assert.equal(lastMsg(bot).opts.reply_markup.inline_keyboard[0][0].web_app.url, 'https://attendance.example.com/app/');
      config.miniAppUrl = 'http://x.local/app/';
      try {
        const b2 = mockBot();
        await menu.routeMenuText(b2, msgFrom(emp, '🕒 ثبت تردد'));
        assert.match(lastMsg(b2).text, /https/);
        assert.equal(lastMsg(b2).opts, undefined);
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('«📝 گزارش‌های دیروز تیم» (کیبورد قدیمی) به «گزارش تیم» می‌رود و دیگر لینک پنل نمی‌فرستد', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.routeMenuText(bot, msgFrom(mgr, '📝 گزارش‌های دیروز تیم'), h);
      assert.deepEqual(calls, ['teamReport']);
    });
  });

  describe('H2: باز کردن منو با «📂 منو»', () => {
    const itemLabels = (kb) => kb.inline_keyboard.flat().filter((b) => b.callback_data !== 'mn:_' && b.callback_data !== 'mn:_close').map((b) => b.text);

    test('هر نقش پیام منوی inline همان نقش را می‌گیرد؛ handler اجرا نمی‌شود و پیام کیبورد قدیمی نمی‌رود', async () => {
      for (const [user, n] of [[emp, 7], [mgr, 12], [admin, 15]]) {
        const bot = mockBot(); const { calls, h } = spies();
        assert.equal(await menu.routeMenuText(bot, msgFrom(user, '📂 منو'), h), true);
        assert.deepEqual(calls, []);
        assert.equal(bot.sent.length, 1);
        assert.match(bot.sent[0].text, /^📂 منو/);
        assert.equal(itemLabels(bot.sent[0].opts.reply_markup).length, n);
      }
    });

    test('منوی کارمند هیچ آیتم تیم/ادمین ندارد و منوی سرپرست آیتم ادمین ندارد', async () => {
      const be = mockBot(); await menu.routeMenuText(be, msgFrom(emp, '📂 منو'));
      assert.ok(!itemLabels(be.sent[0].opts.reply_markup).some((t) => [...MGR, ...ADM].includes(t)));
      const bm = mockBot(); await menu.routeMenuText(bm, msgFrom(mgr, '📂 منو'));
      assert.ok(!itemLabels(bm.sent[0].opts.reply_markup).some((t) => ADM.includes(t)));
    });

    test('باز کردن منو مکالمه‌ی نیمه‌کاره را لغو نمی‌کند', async () => {
      const c = chat(); const bot = mockBot();
      session.start(c, 'leave', { userId: emp.id });
      assert.equal(await menu.routeMenuText(bot, msgFrom(emp, '📂 منو', c)), true);
      assert.ok(session.get(c));
      assert.equal(bot.sent.length, 1);
      session.clear(c);
    });

    test('وسط مکالمه، متن بی‌ایموجی «منو» ورودی مرحله است نه دکمه', async () => {
      const c = chat(); const bot = mockBot();
      session.start(c, 'leave', { userId: emp.id });
      assert.equal(await menu.routeMenuText(bot, msgFrom(emp, 'منو', c)), false);
      assert.equal(bot.sent.length, 0);
      session.clear(c);
    });

    test('کاربر ثبت‌نشده: پیام «ثبت نیستید» و بدون منو؛ چت گروه: نادیده', async () => {
      const bot = mockBot();
      const stranger = { chat: { id: chat(), type: 'private' }, from: { id: 111222333 }, text: '📂 منو' };
      assert.equal(await menu.routeMenuText(bot, stranger), true);
      assert.equal(bot.sent.length, 1);
      assert.match(bot.sent[0].text, /ثبت نیستید/);
      assert.equal(await menu.routeMenuText(mockBot(), msgFrom(emp, '📂 منو', chat(), 'group')), false);
    });
  });

  describe('H2: جایگزینی کیبورد قدیمی', () => {
    test('دکمه‌ی قدیمی: کیبورد جدید (فقط «📂 منو») پیش از handler می‌رود و handler اجرا می‌شود', async () => {
      const order = []; const bot = mockBot(); const origSend = bot.sendMessage.bind(bot);
      bot.sendMessage = async (c, t, o) => { order.push('send'); return origSend(c, t, o); };
      const h = { myStatus: async () => { order.push('handler'); } };
      assert.equal(await menu.routeMenuText(bot, msgFrom(emp, '📊 وضعیت من'), h), true);
      assert.deepEqual(order, ['send', 'handler']);
      assert.deepEqual(bot.sent[0].opts.reply_markup.keyboard, [[{ text: '📂 منو' }]]);
      assert.equal(bot.sent[0].opts.reply_markup.is_persistent, true);
    });

    test('دکمه‌ی web_app تایپ‌شده: اول پیام کیبورد جدید، بعد دکمه‌ی inline', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(emp, '🕒 ثبت تردد'));
      assert.equal(bot.sent.length, 2);
      assert.deepEqual(bot.sent[0].opts.reply_markup.keyboard, [[{ text: '📂 منو' }]]);
      assert.ok(bot.sent[1].opts.reply_markup.inline_keyboard[0][0].web_app);
    });

    test('نقش نامجاز: فقط پیام رد؛ کیبورد جایگزین نمی‌شود', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.routeMenuText(bot, msgFrom(emp, '🛠 اصلاح رکورد'), h);
      assert.deepEqual(calls, []);
      assert.equal(bot.sent.length, 1);
      assert.match(bot.sent[0].text, /در دسترس نیست/);
      assert.equal(bot.sent[0].opts, undefined);
    });

    test('خطا در ارسال پیام کیبورد اجرای handler را نمی‌شکند', async () => {
      const bot = mockBot(); bot.sendMessage = async () => { throw new Error('boom'); };
      const { calls, h } = spies(); const prev = console.error; console.error = () => {};
      try { assert.equal(await menu.routeMenuText(bot, msgFrom(emp, '📊 وضعیت من'), h), true); } finally { console.error = prev; }
      assert.deepEqual(calls, ['myStatus']);
    });
  });

  describe('H2: callbackهای منو (handleMenuCallback)', () => {
    const MENU_TEXT = '📂 منو — یکی از گزینه‌ها را انتخاب کنید:';
    const cbQuery = (user, data, o = {}) => ({
      id: `q${seq += 1}`, data, from: { id: Number(user.telegram_user_id) },
      message: { message_id: 77, text: o.text === undefined ? MENU_TEXT : o.text, chat: { id: chat(), type: o.chatType || 'private' } },
    });

    test('انتخاب آیتم handlerدار: یک‌بار answer، پیام منو پاک و handler اجرا می‌شود', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:status'), h);
      assert.deepEqual(calls, ['myStatus']);
      assert.equal(bot.answers.length, 1);
      assert.deepEqual(bot.deleted.map((d) => d.m), [77]);
    });

    test('کارمند با callback آیتم ادمین/تیم: رد با alert، handler اجرا نمی‌شود و منو پاک نمی‌شود', async () => {
      for (const id of ['add_employee', 'fix_record', 'team_report']) {
        const bot = mockBot(); const { calls, h } = spies();
        await menu.handleMenuCallback(bot, cbQuery(emp, `mn:${id}`), h);
        assert.deepEqual(calls, [], id);
        assert.equal(bot.answers.length, 1);
        assert.equal(bot.answers[0].show_alert, true);
        assert.deepEqual(bot.deleted, []);
      }
    });

    test('سرپرست آیتم تیم را اجرا می‌کند ولی آیتم ادمین نه؛ ادمین هر دو', async () => {
      let r = spies();
      await menu.handleMenuCallback(mockBot(), cbQuery(mgr, 'mn:team_report'), r.h);
      assert.deepEqual(r.calls, ['teamReport']);
      r = spies();
      await menu.handleMenuCallback(mockBot(), cbQuery(mgr, 'mn:fix_record'), r.h);
      assert.deepEqual(r.calls, []);
      r = spies();
      await menu.handleMenuCallback(mockBot(), cbQuery(admin, 'mn:fix_record'), r.h);
      assert.deepEqual(r.calls, ['fixRecord']);
    });

    test('«✖️ بستن منو»: یک‌بار answer و پیام پاک می‌شود؛ handler اجرا نمی‌شود', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:_close'), h);
      assert.deepEqual(calls, []);
      assert.equal(bot.answers.length, 1);
      assert.deepEqual(bot.deleted.map((d) => d.m), [77]);
    });

    test('سرتیتر گروه (mn:_): فقط answer، بدون عمل و بدون حذف', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(mgr, 'mn:_'), h);
      assert.deepEqual(calls, []);
      assert.equal(bot.answers.length, 1);
      assert.deepEqual(bot.deleted, []);
    });

    test('دکمه‌ی mn:<id> زیر اعلان (پیامی که منو نیست): handler اجرا می‌شود ولی پیام اعلان پاک نمی‌شود', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(mgr, 'mn:pending_leaves', { text: '📥 یک درخواست مرخصی جدید ثبت شد' }), h);
      assert.deepEqual(calls, ['pendingLeaves']);
      assert.deepEqual(bot.deleted, []);
    });

    test('خطا در deleteMessage (پیام قدیمی) اجرای handler را نمی‌شکند', async () => {
      const bot = mockBot(); bot.deleteMessage = async () => { throw new Error('message can\'t be deleted'); };
      const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:status'), h);
      assert.deepEqual(calls, ['myStatus']);
      assert.equal(bot.answers.length, 1);
    });

    test('دکمه‌ی ناشناخته، چت غیرخصوصی و کاربر ثبت‌نشده: منقضی/رد و handler اجرا نمی‌شود (mn:checkin دیگر منقضی نیست؛ H3)', async () => {
      for (const [user, data, o] of [[admin, 'mn:nope'], [mgr, 'mn:pending_leaves', { chatType: 'group' }]]) {
        const bot = mockBot(); const { calls, h } = spies();
        await menu.handleMenuCallback(bot, cbQuery(user, data, o), h);
        assert.deepEqual(calls, [], data);
        assert.equal(bot.answers.length, 1);
        assert.match(bot.answers[0].text, /منقضی/);
        assert.deepEqual(bot.deleted, []);
      }
      const bot = mockBot(); const { calls, h } = spies();
      const q = cbQuery(emp, 'mn:status'); q.from = { id: 111222333 };
      await menu.handleMenuCallback(bot, q, h);
      assert.deepEqual(calls, []);
      assert.equal(bot.answers[0].show_alert, true);
    });
  });

  describe('H3: بازکننده‌های Mini App/پنل فقط inline web_app (نه کیبورد پاسخ) و راهنمای ورود', () => {
    const { mock } = require('node:test');
    const HTTPS = 'https://attendance.example.com/app/';
    const MENU_TEXT = '📂 منو — یکی از گزینه‌ها را انتخاب کنید:';
    const cbQuery = (user, data) => ({
      id: `h3q${seq += 1}`, data, from: { id: Number(user.telegram_user_id) },
      message: { message_id: 88, text: MENU_TEXT, chat: { id: chat(), type: 'private' } },
    });
    const btns = (kb) => kb.inline_keyboard.flat();
    const withUrl = async (url, fn) => {
      config.miniAppUrl = url;
      const warn = mock.method(console, 'warn', () => {});
      try { await fn(warn); } finally { warn.mock.restore(); config.miniAppUrl = HTTPS; }
    };
    const readSrc = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const MSG = 'برای ورود، از دکمه‌ی 📂 منو در بات باز کنید';

    test('buildMainKeyboard برای هر سه نقش و با هر MINI_APP_URL (https، http، خالی) هیچ web_app ندارد', () => {
      for (const url of [HTTPS, 'http://192.168.1.5/app/', '']) {
        config.miniAppUrl = url;
        try {
          for (const user of [emp, mgr, admin]) {
            const kb = menu.buildMainKeyboard(user);
            assert.ok(!JSON.stringify(kb).includes('web_app'), `${user.role} @ ${url || '(خالی)'}`);
            assert.deepEqual(kb.keyboard, [[{ text: '📂 منو' }]]);
          }
        } finally { config.miniAppUrl = HTTPS; }
      }
    });

    test('https: پیام منو برای هر نقش دکمه‌ی callback «ورود به پنل» (mn:panel) و web_app «ثبت تردد» دارد', () => {
      const find = (kb, t) => btns(kb).find((b) => b.text === t);
      for (const user of [emp, mgr, admin]) {
        const kb = menu.buildMenuInline(user);
        assert.equal(find(kb, '🕒 ثبت تردد').web_app.url, HTTPS);
        assert.equal(find(kb, '🖥 ورود به پنل').callback_data, 'mn:panel');
        assert.equal(find(kb, '🖥 ورود به پنل').web_app, undefined);
        assert.equal(find(kb, '⚙️ پنل مدیریت'), undefined);
      }
    });

    test('panelWebAppButton مقصد go را حفظ می‌کند؛ بدون https دکمه ساخته نمی‌شود', async () => {
      const b = panelLinks.panelWebAppButton({ view: 'teamreports' });
      assert.equal(new URL(b.web_app.url).searchParams.get('go'), 'teamreports');
      await withUrl('http://192.168.1.5/app/', async () => {
        assert.equal(panelLinks.panelWebAppButton({ view: 'teamreports' }), null);
        assert.equal(panelLinks.canUseWebApp(panelLinks.miniAppLink({ view: 'plan' })), false);
      });
    });

    test('http: لمس «ثبت تردد» (mn:checkin) ⇒ یک‌بار answer، پیام منو پاک، پیام راهنمای ادمین (https/MINI_APP_URL)، بدون web_app، با هشدار لاگ', async () => {
      await withUrl('http://192.168.1.5/app/', async (warn) => {
        const bot = mockBot(); const { calls, h } = spies();
        const before = warn.mock.calls.length;
        await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:checkin'), h);
        assert.equal(bot.answers.length, 1);
        assert.equal(bot.answers[0].show_alert, undefined);
        assert.deepEqual(calls, []);
        assert.equal(bot.deleted.length, 1);
        assert.match(lastMsg(bot).text, /https/);
        assert.match(lastMsg(bot).text, /MINI_APP_URL/);
        assert.equal(lastMsg(bot).opts, undefined);
        assert.ok(warn.mock.calls.length > before, 'باید هشدار لاگ بیاید');
        assert.match(String(warn.mock.calls[warn.mock.calls.length - 1].arguments[0]), /MINI_APP_URL/);
      });
    });

    test('http: «ورود به پنل» (mn:panel) به handler ورود می‌رود (لینک مرورگر + کد)، نه به پیام خطای https', async () => {
      await withUrl('http://192.168.1.5/app/', async () => {
        const bot = mockBot(); const { calls, h } = spies();
        await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:panel'), h);
        assert.deepEqual(calls, ['panel']);
      });
    });

    test('https: لمس mn:checkin ⇒ دکمه‌ی inline web_app با آدرس درست؛ mn:panel و mn:admin_panel (قدیمی) ⇒ handler ورود به پنل', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:checkin'), h);
      assert.equal(bot.answers.length, 1);
      assert.deepEqual(calls, []);
      assert.equal(bot.deleted.length, 1);
      assert.equal(new URL(lastMsg(bot).opts.reply_markup.inline_keyboard[0][0].web_app.url).href, HTTPS);
      assert.equal(lastMsg(bot).opts.reply_markup.keyboard, undefined, 'هیچ دکمه‌ی web_app در کیبورد پاسخ نیست');
      for (const id of ['mn:panel', 'mn:admin_panel']) {
        const r = spies();
        await menu.handleMenuCallback(mockBot(), cbQuery(admin, id), r.h);
        assert.deepEqual(r.calls, ['panel'], id);
      }
    });

    test('نقش‌ها سمت سرور چک می‌شوند: کارمند با mn:add_employee رد می‌شود و پیامی نمی‌رود', async () => {
      const bot = mockBot(); const { calls, h } = spies();
      await menu.handleMenuCallback(bot, cbQuery(emp, 'mn:add_employee'), h);
      assert.equal(bot.answers.length, 1);
      assert.equal(bot.answers[0].show_alert, true);
      assert.deepEqual(bot.sent, []);
      assert.deepEqual(calls, []);
    });

    test('Mini App و پنل بدون initData پیام فارسی «از 📂 منو در بات باز کنید» نشان می‌دهند (بررسی ایستا)', () => {
      const app = readSrc('public', 'js', 'app.js');
      assert.ok(app.includes(MSG), 'Mini App');
      assert.ok(!app.includes('از طریق دکمه منوی بات'));
      const core = readSrc('public-admin', 'js', 'core.js');
      assert.match(core, new RegExp(`catch \\(_\\) \\{[\\s\\S]*?${MSG}[\\s\\S]*?setupLoginWidget\\(\\)`), 'پنل: پیام پیش از ویجت ورود');
    });

    test('خطاهای ۴۰۱ ورود پنل دیگر به /panel ارجاع نمی‌دهند و به «📂 منو» ارجاع می‌دهند', () => {
      const src = readSrc('src', 'api', 'routes', 'adminAuth.js');
      const msgs = src.split(/\r?\n/).filter((l) => l.includes('error:'));
      const loginMsgs = msgs.filter((x) => x.includes('لینک نامعتبر') || x.includes('کد نامعتبر'));
      assert.equal(loginMsgs.length, 2);
      for (const l of loginMsgs) {
        assert.ok(!l.includes('/panel'), l);
        assert.ok(l.includes('📂 منو'), l);
      }
    });
  });

  test('سیم‌کشی: bot/index.js منو را پیش از مسیر session صدا می‌زند', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'index.js'), 'utf8');
    const iRoute = src.indexOf('await routeMenuText(bot, msg)');
    const iSess = src.indexOf('const sess = session.get(chatId);', src.indexOf("bot.on('message'"));
    assert.ok(iRoute > 0 && iSess > iRoute, 'routeMenuText باید قبل از session.get در handler پیام باشد');
  });
});
