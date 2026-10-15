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

    test('هر ۱۶ دکمه‌ی منو برچسب نرمال‌شده‌ی یکتا دارند', () => {
      const labels = menu.ITEMS.map((it) => menu.normalizeLabel(it.label));
      assert.equal(menu.ITEMS.length, 16);
      assert.equal(new Set(labels).size, labels.length);
      assert.ok(labels.every(Boolean));
    });
  });

  const EMP = ['🕒 ثبت تردد', '📊 وضعیت من', '📈 گزارش من', '🏖 مرخصی / 🚗 ماموریت', '📋 برنامه هفتگی', '🖥 پنل', '❓ راهنما'];
  const MGR = ['👥 گزارش تیم', '📥 درخواست‌های منتظر', '💬 اعتراض‌ها', '📝 گزارش‌های دیروز تیم', '👤 لیست اعضا', '⚡ تسک فوری'];
  const ADM = ['➕ افزودن کارمند', '🛠 اصلاح رکورد', '⚙️ پنل مدیریت'];

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
      config.miniAppUrl = 'http://192.168.1.5:3000/app/';
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
      assert.deepEqual(itemTexts(kb), EMP);
      assert.deepEqual(headerTexts(kb), []);
    });

    test('سرپرست: پایه + ۶ آیتم تیم (بدون آیتم ادمین) با دو سرتیتر', () => {
      const kb = menu.buildMenuInline(mgr);
      assert.deepEqual(itemTexts(kb), [...EMP, ...MGR]);
      assert.deepEqual(headerTexts(kb), ['— کارهای من —', '— تیم —']);
    });

    test('ادمین: همه‌ی ۱۶ آیتم به ترتیب با سه سرتیتر', () => {
      const kb = menu.buildMenuInline(admin);
      assert.deepEqual(itemTexts(kb), [...EMP, ...MGR, ...ADM]);
      assert.deepEqual(headerTexts(kb), ['— کارهای من —', '— تیم —', '— مدیریت —']);
    });

    test('چیدمان: آیتم‌ها ۲ ستونه، سرتیتر تک‌دکمه‌ای و آخرین ردیف «✖️ بستن منو»', () => {
      for (const user of [emp, mgr, admin]) {
        const rows = menu.buildMenuInline(user).inline_keyboard;
        for (const row of rows) {
          assert.ok(row.length >= 1 && row.length <= 2);
          if (row.some((b) => b.callback_data === 'mn:_')) assert.equal(row.length, 1);
        }
        assert.deepEqual(rows[rows.length - 1], [{ text: '✖️ بستن منو', callback_data: 'mn:_close' }]);
      }
    });

    test('ثبت تردد/برنامه هفتگی/پنل مدیریت دکمه‌ی inline از نوع web_app‌اند؛ بقیه callback به شکل mn:<id>', () => {
      const kb = menu.buildMenuInline(admin);
      const by = (t) => btns(kb).find((b) => b.text === t);
      assert.equal(by('🕒 ثبت تردد').web_app.url, 'https://attendance.example.com/app/');
      assert.equal(by('📋 برنامه هفتگی').web_app.url, 'https://attendance.example.com/app/?view=plan');
      assert.equal(by('⚙️ پنل مدیریت').web_app.url, 'https://attendance.example.com/admin/');
      for (const t of ['🕒 ثبت تردد', '📋 برنامه هفتگی', '⚙️ پنل مدیریت']) assert.equal(by(t).callback_data, undefined);
      assert.equal(by('📊 وضعیت من').callback_data, 'mn:status');
      assert.equal(by('🖥 پنل').callback_data, 'mn:panel');
      assert.equal(by('➕ افزودن کارمند').callback_data, 'mn:add_employee');
      for (const t of ['📊 وضعیت من', '🖥 پنل', '➕ افزودن کارمند']) assert.equal(by(t).web_app, undefined);
    });

    test('callback_data همه ≤ ۶۴ بایت و هر id یکی از آیتم‌های handlerدار یا _ / _close است', () => {
      for (const user of [emp, mgr, admin]) {
        for (const b of btns(menu.buildMenuInline(user))) {
          if (b.web_app) continue;
          assert.ok(Buffer.byteLength(b.callback_data) <= 64, b.callback_data);
          const id = b.callback_data.slice(3);
          assert.ok(id === '_' || id === '_close' || menu.ITEMS.some((it) => it.id === id && !it.url), b.callback_data);
        }
      }
    });

    test('بدون https: آیتم‌های web_app حذف می‌شوند و بقیه می‌مانند', () => {
      config.miniAppUrl = 'http://192.168.1.5:3000/app/';
      try {
        const texts = itemTexts(menu.buildMenuInline(admin));
        assert.ok(!texts.includes('🕒 ثبت تردد') && !texts.includes('📋 برنامه هفتگی') && !texts.includes('⚙️ پنل مدیریت'));
        assert.ok(texts.includes('📊 وضعیت من') && texts.includes('🖥 پنل'));
        assert.ok(!btns(menu.buildMenuInline(admin)).some((b) => b.web_app));
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('کاربر ثبت‌نشده: null', () => {
      assert.equal(menu.buildMenuInline(null), null);
      assert.equal(menu.buildMenuInline(undefined), null);
    });
  });

  describe('routeMenuText — اتصال به handlerها و چک نقش سمت سرور', () => {
    const ROUTES = [
      ['📊 وضعیت من', 'status', null], ['📈 گزارش من', 'report', null], ['🏖 مرخصی / 🚗 ماموریت', 'leave', null],
      ['🖥 پنل', 'panel', null], ['❓ راهنما', 'help', null],
      ['👥 گزارش تیم', 'teamReport', 'manager'], ['📥 درخواست‌های منتظر', 'pendingLeaves', 'manager'],
      ['💬 اعتراض‌ها', 'pendingDisputes', 'manager'], ['📝 گزارش‌های دیروز تیم', 'yesterdayReports', 'manager'],
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
      for (const t of ['🛠 اصلاح رکورد', 'اصلاح رکورد', '⚙️ پنل مدیریت']) {
        await menu.routeMenuText(bot, msgFrom(emp, t, c));
        assert.equal(session.get(c), null);
      }
      assert.equal(bot.sent.length, 4);
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
      assert.deepEqual(calls, ['status', 'leave']);
    });

    test('فقط چت خصوصی: در گروه هیچ دکمه‌ای اجرا نمی‌شود', async () => {
      const { calls, h } = spies();
      assert.equal(await menu.routeMenuText(mockBot(), msgFrom(admin, '📊 وضعیت من', chat(), 'group'), h), false);
      assert.deepEqual(calls, []);
    });

    test('زدن دکمه‌ی منو مکالمه‌ی نیمه‌کاره را لغو می‌کند', async () => {
      const c = chat(); const { calls, h } = spies();
      session.start(c, 'leave', { userId: emp.id });
      await menu.routeMenuText(mockBot(), msgFrom(emp, '📊 وضعیت من', c), h);
      assert.deepEqual(calls, ['status']);
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
      await menu.routeMenuText(bot, msgFrom(emp, '📋 برنامه هفتگی'));
      assert.equal(lastMsg(bot).opts.reply_markup.inline_keyboard[0][0].web_app.url, 'https://attendance.example.com/app/?view=plan');
      config.miniAppUrl = 'http://x.local/app/';
      try {
        const b2 = mockBot();
        await menu.routeMenuText(b2, msgFrom(emp, '🕒 ثبت تردد'));
        assert.match(lastMsg(b2).text, /https/);
        assert.equal(lastMsg(b2).opts, undefined);
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('«📝 گزارش‌های دیروز تیم» (handler واقعی): دکمه‌ی web_app به صفحه‌ی teamreports پنل', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(mgr, '📝 گزارش‌های دیروز تیم'));
      const url = new URL(lastMsg(bot).opts.reply_markup.inline_keyboard[0][0].web_app.url);
      assert.equal(url.pathname, '/admin/');
      assert.equal(url.searchParams.get('go'), 'teamreports');
    });
  });

  describe('H2: باز کردن منو با «📂 منو»', () => {
    const itemLabels = (kb) => kb.inline_keyboard.flat().filter((b) => b.callback_data !== 'mn:_' && b.callback_data !== 'mn:_close').map((b) => b.text);

    test('هر نقش پیام منوی inline همان نقش را می‌گیرد؛ handler اجرا نمی‌شود و پیام کیبورد قدیمی نمی‌رود', async () => {
      for (const [user, n] of [[emp, 7], [mgr, 13], [admin, 16]]) {
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
      const h = { status: async () => { order.push('handler'); } };
      assert.equal(await menu.routeMenuText(bot, msgFrom(emp, '📊 وضعیت من'), h), true);
      assert.deepEqual(order, ['send', 'handler']);
      assert.deepEqual(bot.sent[0].opts.reply_markup.keyboard, [[{ text: '📂 منو' }]]);
      assert.equal(bot.sent[0].opts.reply_markup.is_persistent, true);
    });

    test('دکمه‌ی web_app تایپ‌شده: اول پیام کیبورد جدید، بعد دکمه‌ی inline', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(emp, '📋 برنامه هفتگی'));
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
      assert.deepEqual(calls, ['status']);
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
      assert.deepEqual(calls, ['status']);
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
      assert.deepEqual(calls, ['status']);
      assert.equal(bot.answers.length, 1);
    });

    test('دکمه‌ی ناشناخته، آیتم web_app، چت غیرخصوصی و کاربر ثبت‌نشده: منقضی/رد و handler اجرا نمی‌شود', async () => {
      for (const [user, data, o] of [[admin, 'mn:nope'], [emp, 'mn:checkin'], [mgr, 'mn:pending_leaves', { chatType: 'group' }]]) {
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

  test('سیم‌کشی: bot/index.js منو را پیش از مسیر session صدا می‌زند', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'index.js'), 'utf8');
    const iRoute = src.indexOf('await routeMenuText(bot, msg)');
    const iSess = src.indexOf('const sess = session.get(chatId);', src.indexOf("bot.on('message'"));
    assert.ok(iRoute > 0 && iSess > iRoute, 'routeMenuText باید قبل از session.get در handler پیام باشد');
  });
});
