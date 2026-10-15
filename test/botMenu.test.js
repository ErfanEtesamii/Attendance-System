// E1/E2: منوی دکمه‌ایِ نقش‌محور بات — نرمال‌سازی متن دکمه، ماتریس نقش × دکمه، اتصال به handlerها، چک نقش سمت سرور.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('منوی دکمه‌ایِ بات (E1/E2)', () => {
  let menu; let session; let panelLinks; let config; let F; let emp; let mgr; let admin; let seq = 0; let prevUrl;
  const chat = () => 8000 + (seq += 1);
  const mockBot = () => ({ sent: [], async sendMessage(c, text, opts) { this.sent.push({ c, text, opts }); return true; } });
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

  describe('buildMainKeyboard — ماتریس نقش × دکمه', () => {
    const EMP = ['🕒 ثبت تردد', '📊 وضعیت من', '📈 گزارش من', '🏖 مرخصی / 🚗 ماموریت', '📋 برنامه هفتگی', '🖥 پنل', '❓ راهنما'];
    const MGR = ['👥 گزارش تیم', '📥 درخواست‌های منتظر', '💬 اعتراض‌ها', '📝 گزارش‌های دیروز تیم', '👤 لیست اعضا', '⚡ تسک فوری'];
    const ADM = ['➕ افزودن کارمند', '🛠 اصلاح رکورد', '⚙️ پنل مدیریت'];

    test('کارمند: فقط ۷ دکمه‌ی پایه', () => assert.deepEqual(labelsOf(menu.buildMainKeyboard(emp)), EMP));
    test('سرپرست: پایه + ۶ دکمه‌ی تیم (بدون دکمه‌ی ادمین)', () => assert.deepEqual(labelsOf(menu.buildMainKeyboard(mgr)), [...EMP, ...MGR]));
    test('ادمین: همه‌ی ۱۶ دکمه', () => assert.deepEqual(labelsOf(menu.buildMainKeyboard(admin)), [...EMP, ...MGR, ...ADM]));

    test('چیدمان ۲ ستونه، resize و persistent', () => {
      const kb = menu.buildMainKeyboard(admin);
      assert.ok(kb.keyboard.every((row) => row.length <= 2));
      assert.deepEqual(kb.keyboard.map((r) => r.length), [2, 2, 2, 2, 2, 2, 2, 2]);
      assert.equal(kb.resize_keyboard, true);
      assert.equal(kb.is_persistent, true);
    });

    test('ثبت تردد/برنامه هفتگی/پنل مدیریت web_app‌اند؛ بقیه متنی', () => {
      const flat = menu.buildMainKeyboard(admin).keyboard.flat();
      const by = (t) => flat.find((b) => b.text === t);
      assert.equal(by('🕒 ثبت تردد').web_app.url, 'https://attendance.example.com/app/');
      assert.equal(by('📋 برنامه هفتگی').web_app.url, 'https://attendance.example.com/app/?view=plan');
      assert.equal(by('⚙️ پنل مدیریت').web_app.url, 'https://attendance.example.com/admin/');
      for (const t of ['📊 وضعیت من', '🖥 پنل', '❓ راهنما', '➕ افزودن کارمند']) assert.equal(by(t).web_app, undefined);
    });

    test('بدون https: دکمه‌های web_app حذف می‌شوند و بقیه می‌مانند', () => {
      config.miniAppUrl = 'http://192.168.1.5:3000/app/';
      try {
        const labels = labelsOf(menu.buildMainKeyboard(admin));
        assert.ok(!labels.includes('🕒 ثبت تردد') && !labels.includes('📋 برنامه هفتگی') && !labels.includes('⚙️ پنل مدیریت'));
        assert.ok(labels.includes('📊 وضعیت من') && labels.includes('🖥 پنل'));
        config.miniAppUrl = '';
        assert.ok(labelsOf(menu.buildMainKeyboard(emp)).includes('❓ راهنما'));
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('کاربر ثبت‌نشده و چت غیرخصوصی: بدون منو', () => {
      assert.equal(menu.buildMainKeyboard(null), null);
      assert.equal(menu.buildMainKeyboard(undefined), null);
      assert.equal(menu.buildMainKeyboard(emp, { chatType: 'group' }), null);
      assert.equal(menu.buildMainKeyboard(emp, { chatType: 'supergroup' }), null);
      assert.ok(menu.buildMainKeyboard(emp, { chatType: 'private' }));
    });

    test('persistentKeyboard(user) همان منو را می‌دهد', () => {
      assert.deepEqual(panelLinks.persistentKeyboard(mgr), menu.buildMainKeyboard(mgr));
      assert.equal(panelLinks.persistentKeyboard(), null);
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
          if (allowed[role]) { assert.deepEqual(calls, [handler]); assert.equal(bot.sent.length, 0); } else {
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
      assert.match(bot.sent[0].text, /آیدی عددی/);
      session.clear(c);
    });

    test('سرپرست با handler واقعی «👤 لیست اعضا»: فقط تیم خودش را می‌بیند', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(mgr, '👤 لیست اعضا'));
      assert.match(bot.sent[0].text, new RegExp(emp.full_name));
      assert.ok(!bot.sent[0].text.includes(admin.full_name));
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
      assert.equal(bot.sent[0].opts.reply_markup.inline_keyboard[0][0].web_app.url, 'https://attendance.example.com/app/?view=plan');
      config.miniAppUrl = 'http://x.local/app/';
      try {
        const b2 = mockBot();
        await menu.routeMenuText(b2, msgFrom(emp, '🕒 ثبت تردد'));
        assert.match(b2.sent[0].text, /https/);
        assert.equal(b2.sent[0].opts, undefined);
      } finally { config.miniAppUrl = 'https://attendance.example.com/app/'; }
    });

    test('«📝 گزارش‌های دیروز تیم» (handler واقعی): دکمه‌ی web_app به صفحه‌ی teamreports پنل', async () => {
      const bot = mockBot();
      await menu.routeMenuText(bot, msgFrom(mgr, '📝 گزارش‌های دیروز تیم'));
      const url = new URL(bot.sent[0].opts.reply_markup.inline_keyboard[0][0].web_app.url);
      assert.equal(url.pathname, '/admin/');
      assert.equal(url.searchParams.get('go'), 'teamreports');
    });
  });

  test('سیم‌کشی: bot/index.js منو را پیش از مسیر session صدا می‌زند', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'bot', 'index.js'), 'utf8');
    const iRoute = src.indexOf('await routeMenuText(bot, msg)');
    const iSess = src.indexOf('const sess = session.get(chatId);', src.indexOf("bot.on('message'"));
    assert.ok(iRoute > 0 && iSess > iRoute, 'routeMenuText باید قبل از session.get در handler پیام باشد');
  });
});
