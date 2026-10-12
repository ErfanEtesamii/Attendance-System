// D8: پیام‌های تشویقی — ماژول خالص (src/content/encouragements.js)، ذخیره/اعمال در سرویس گزارش روزانه و نمایش در UI.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./helpers/factories');
const E = require('../src/content/encouragements');
const DR = require('../public/js/dailyReport.js');

const WEEK = '2026-08-01';
const MON = '2026-08-03';
const idxOf = (pool) => pool.map((t) => E.ALL.indexOf(t));
const SIMPLE = idxOf(E.TEMPLATES.simple);
const STREAK = idxOf(E.TEMPLATES.streak);
const PRIORITY = idxOf(E.TEMPLATES.high.priority);
const FULL_DAY = idxOf(E.TEMPLATES.high.fullDay);
const kind = (text) => { const i = E.templateIndexOf(text); return i < 0 ? null : [['simple', SIMPLE], ['streak', STREAK], ['priority', PRIORITY], ['fullDay', FULL_DAY]].find(([, p]) => p.includes(i))[0]; };

describe('ماژول پیام‌های تشویقی', () => {
  test('حداقل ۴۰ جمله در سه دسته؛ بدون تکراری؛ فقط {name} و {task}', () => {
    assert.ok(E.ALL.length >= 40, `تعداد: ${E.ALL.length}`);
    assert.ok(E.TEMPLATES.simple.length > 0 && E.TEMPLATES.streak.length > 0);
    assert.ok(E.TEMPLATES.high.priority.length > 0 && E.TEMPLATES.high.fullDay.length > 0);
    assert.equal(new Set(E.ALL).size, E.ALL.length);
    for (const pool of [E.TEMPLATES.simple, E.TEMPLATES.streak, E.TEMPLATES.high.priority, E.TEMPLATES.high.fullDay]) {
      assert.ok(pool.length > E.RECENT_WINDOW, 'هر استخر باید از پنجره‌ی تکرار بزرگ‌تر باشد'); // تا همیشه کاندیدا بماند
    }
    for (const t of E.ALL) {
      assert.ok(/\{name\}|\{task\}/.test(t), t);
      assert.ok(!/\{(?!name\}|task\})/.test(t), `متغیر ناشناخته: ${t}`);
      assert.ok(/[\u0600-\u06ff]/.test(t));
    }
  });

  test('render: جایگذاری {name}/{task} در یک گذر؛ نام کوچک؛ کوتاه‌کردن عنوان بلند', () => {
    assert.equal(E.render('{name}: «{task}»', { name: 'علی رضایی', task: 'گزارش' }), 'علی: «گزارش»');
    assert.equal(E.render('{name} {name}', { name: 'سارا احمدی' }), 'سارا سارا');
    // مقدارِ جایگذاری‌شده دوباره پردازش نمی‌شود
    assert.equal(E.render('«{task}» {name}', { name: 'رضا', task: '{name} تست' }), '«{name} تست» رضا');
    assert.equal(E.firstName('  '), 'همکار');
    assert.equal(E.firstName(null), 'همکار');
    assert.equal(E.firstName('مریم‌ السادات'), 'مریم‌');
    const long = E.render('{task}', { task: 'ب'.repeat(200) });
    assert.ok(long.length <= 60 && long.endsWith('…'));
    for (const t of E.ALL) assert.ok(!/[{}]/.test(E.render(t, { name: 'علی', task: 'کار' })), t);
  });

  test('templateIndexOf: متن رندرشده به قالب خودش برمی‌گردد؛ ناشناخته ⇒ -1', () => {
    E.ALL.forEach((t, i) => assert.equal(E.templateIndexOf(E.render(t, { name: 'نگار کریمی', task: 'تسک آزمایشی' })), i));
    assert.equal(E.templateIndexOf(E.NOT_DONE_THANKS), -1);
    assert.equal(E.templateIndexOf(null), -1);
    assert.equal(E.templateIndexOf('یک متن دلخواه'), -1);
  });

  test('عدم تکرار: هیچ قالبی در ۵ پیام اخیر دوباره نمی‌آید (همه‌ی دسته‌ها، rng تصادفی و بدترین‌حالت)', () => {
    const cats = [['simple'], ['streak'], ['high', 'priority'], ['high', 'fullDay']];
    for (const rng of [Math.random, () => 0, () => 0.999999]) {
      let recent = [];
      for (let i = 0; i < 1500; i += 1) {
        const [category, variant] = cats[i % cats.length];
        const text = E.pickEncouragement({ category, variant, name: 'سارا احمدی', task: `تسک ${i}`, recent, rng });
        const idx = E.templateIndexOf(text);
        assert.ok(idx >= 0);
        assert.ok(!recent.slice(0, 5).some((r) => E.templateIndexOf(r) === idx), `تکرار در دور ${i}`);
        recent = [text, ...recent];
      }
    }
  });

  test('انتخاب از دسته‌ی درخواستی؛ rng تزریقی قطعی است', () => {
    const args = { name: 'علی', task: 'کار' };
    assert.equal(kind(E.pickEncouragement({ category: 'simple', ...args })), 'simple');
    assert.equal(kind(E.pickEncouragement({ category: 'streak', ...args })), 'streak');
    assert.equal(kind(E.pickEncouragement({ category: 'high', variant: 'priority', ...args })), 'priority');
    assert.equal(kind(E.pickEncouragement({ category: 'high', variant: 'fullDay', ...args })), 'fullDay');
    assert.equal(E.pickEncouragement({ category: 'simple', ...args, rng: () => 0 }), E.render(E.TEMPLATES.simple[0], args));
    // ۵ پیام اخیرِ اولین قالب‌ها بسته‌اند ⇒ rng=0 قالب ششم را برمی‌دارد
    const recent = E.TEMPLATES.simple.slice(0, 5).map((t) => E.render(t, args)).reverse();
    assert.equal(E.pickEncouragement({ category: 'simple', ...args, recent, rng: () => 0 }), E.render(E.TEMPLATES.simple[5], args));
    // فقط ۵ پیام اخیر حساب می‌شود: ششمین قدیمی دوباره مجاز است
    const six = [...E.TEMPLATES.simple.slice(1, 6).reverse(), E.TEMPLATES.simple[0]].map((t) => E.render(t, args)); // جدیدترین اول؛ s0 ششمین (قدیمی‌ترین)
    assert.equal(E.pickEncouragement({ category: 'simple', ...args, recent: six, rng: () => 0 }), E.render(E.TEMPLATES.simple[0], args));
  });

  test('انجام‌نشده/نیمه‌کاره ⇒ فقط تشکرِ ثابت، بدون قضاوت؛ done ⇒ تشویق؛ وضعیت نامعتبر ⇒ null', () => {
    assert.equal(E.NOT_DONE_THANKS, 'ممنون که علتش را نوشتی.');
    assert.equal(E.encouragementFor({ status: 'not_done', name: 'علی', task: 'کار' }), E.NOT_DONE_THANKS);
    assert.equal(E.encouragementFor({ status: 'partial', category: 'high', variant: 'fullDay' }), E.NOT_DONE_THANKS);
    assert.ok(E.templateIndexOf(E.encouragementFor({ status: 'done', name: 'علی', task: 'کار' })) >= 0);
    assert.equal(E.encouragementFor({ status: 'x' }), null);
  });
});

describe('پیام تشویقی در گزارش روزانه (سرویس)', () => {
  let db; let svc; let plans; let logs; let settings; let u;
  const reset = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM leave_approvals; DELETE FROM leave_requests; DELETE FROM month_closures;');
  const mk = (title, extra = {}) => plans.addTask(plans.getOrCreate(u.id, WEEK).id, { title, ...extra });
  const report = (body, date = MON) => svc.submitDailyReport(u, body, { date });
  const mkOn = (date, title, extra = {}) => plans.addTask(plans.getOrCreate(u.id, require('../src/engine/calendarService').weekStartOf(date, 6)).id, { title, plannedDate: date, ...extra });
  const textOf = (taskId, date = MON) => (logs.findByTaskDate(taskId, date) || {}).encouragement_text;
  const done = (t) => ({ taskId: t.id, status: 'done' });

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    settings = require('../src/repositories/settingsRepository');
    u = F.makeUser({ name: 'پریسا نوروزی' });
    settings.setValue('encouragementsEnabled', true);
  });
  after(cleanup);

  test('done ⇒ پیامِ ذخیره‌شده با نام کوچک و عنوان؛ در پاسخ API هم برمی‌گردد', () => {
    reset();
    const t = mk('تهیه‌ی گزارش فروش', { plannedDate: MON });
    const r = report({ answers: [done(t)] });
    assert.ok(r.ok);
    const text = textOf(t.id);
    assert.equal(kind(text), 'simple'); // روزِ تک‌تسکی ⇒ «۱۰۰٪ روز» نمی‌شود
    assert.ok(!/[{}]/.test(text));
    assert.ok(/پریسا/.test(text) || !/\{name\}/.test(text));
    assert.ok(!/نوروزی/.test(text));
    assert.ok(text.includes('تهیه‌ی گزارش فروش') || !E.ALL[E.templateIndexOf(text)].includes('{task}'));
    assert.deepEqual(r.encouragements, [{ taskId: t.id, status: 'done', text }]);
  });

  test('not_done و partial ⇒ فقط «ممنون که علتش را نوشتی» (ذخیره و در پاسخ)', () => {
    reset();
    const a = mk('الف', { plannedDate: MON }); const b = mk('ب', { plannedDate: MON });
    const r = report({ answers: [
      { taskId: a.id, status: 'not_done', reasonCode: 'no_time' },
      { taskId: b.id, status: 'partial', reasonCode: 'needs_more_time' },
    ] });
    assert.ok(r.ok);
    assert.equal(textOf(a.id), E.NOT_DONE_THANKS);
    assert.equal(textOf(b.id), E.NOT_DONE_THANKS);
    assert.deepEqual(r.encouragements.map((e) => e.text), [E.NOT_DONE_THANKS, E.NOT_DONE_THANKS]);
  });

  test('تنظیم encouragementsEnabled خاموش ⇒ هیچ پیامی ذخیره یا برگردانده نمی‌شود', () => {
    reset();
    settings.setValue('encouragementsEnabled', false);
    try {
      const a = mk('الف', { plannedDate: MON }); const b = mk('ب', { plannedDate: MON });
      const r = report({ answers: [done(a), { taskId: b.id, status: 'not_done', reasonCode: 'no_time' }], extra: [{ title: 'کار اضافه' }] });
      assert.ok(r.ok);
      assert.equal(textOf(a.id), null);
      assert.equal(textOf(b.id), null);
      assert.deepEqual(r.encouragements, []);
      assert.ok(logs.listByUserDate(u.id, MON).every((l) => l.encouragement_text === null));
    } finally { settings.setValue('encouragementsEnabled', true); }
  });

  test('تسک با اولویت بالا ⇒ high/priority', () => {
    reset();
    const t = mk('مهم', { plannedDate: MON, priority: 'high' });
    assert.ok(report({ answers: [done(t)] }).ok);
    assert.equal(kind(textOf(t.id)), 'priority');
  });

  test('۱۰۰٪ روز: فقط آخرین done که روز را کامل می‌کند fullDay می‌گیرد؛ تک‌تسکی نه؛ پاسخ‌نداده یا not_done مانع است', () => {
    reset();
    const a = mk('الف', { plannedDate: MON }); const b = mk('ب', { plannedDate: MON });
    assert.ok(report({ answers: [done(a), done(b)] }).ok);
    assert.equal(kind(textOf(a.id)), 'simple');
    assert.equal(kind(textOf(b.id)), 'fullDay');

    reset(); // پاسخ جزئی: یک تسک بی‌پاسخ می‌ماند ⇒ روز کامل نیست
    const c = mk('ج', { plannedDate: MON }); mk('د', { plannedDate: MON });
    assert.ok(report({ answers: [done(c)] }).ok);
    assert.equal(kind(textOf(c.id)), 'simple');

    reset(); // یک not_done ⇒ روز ۱۰۰٪ نیست
    const e = mk('ه', { plannedDate: MON }); const f = mk('و', { plannedDate: MON });
    assert.ok(report({ answers: [done(e), { taskId: f.id, status: 'not_done', reasonCode: 'no_time' }] }).ok);
    assert.equal(kind(textOf(e.id)), 'simple');

    reset(); // ارسال دومینِ همان روز: پاسخ قبلیِ done حساب می‌شود
    const g = mk('ز', { plannedDate: MON }); const h = mk('ح', { plannedDate: MON });
    assert.ok(report({ answers: [done(g)] }).ok);
    assert.ok(report({ answers: [done(h)] }).ok);
    assert.equal(kind(textOf(h.id)), 'fullDay');

    reset(); // کار خارج از برنامه هم جزو روز است و آخرین done می‌شود
    const i = mk('ط', { plannedDate: MON });
    const r = report({ answers: [done(i)], extra: [{ title: 'جلسه‌ی فوری' }] });
    assert.ok(r.ok);
    assert.equal(kind(textOf(i.id)), 'simple');
    assert.equal(r.encouragements.length, 2);
    assert.equal(kind(r.encouragements[1].text), 'fullDay');
  });

  test('رگه: ≥ ۳ روز پیاپی done ⇒ streak؛ یک not_done رگه را می‌شکند؛ روزهای بدون پاسخ نمی‌شکنند', () => {
    reset();
    const past = (date, status, reasonCode) => logs.upsert({ taskId: mk(`گذشته ${date}`, { plannedDate: date }).id, userId: u.id, logDate: date, status, reasonCode: reasonCode || null });
    past('2026-07-28', 'done'); past('2026-07-29', 'done'); past('2026-07-30', 'done'); // جمعه ۰۷-۳۱ و شنبه بی‌پاسخ ⇒ رگه نمی‌شکند
    const t = mk('امروز', { plannedDate: MON });
    assert.ok(report({ answers: [done(t)] }).ok);
    assert.equal(kind(textOf(t.id)), 'streak');

    reset();
    past('2026-07-28', 'done'); past('2026-07-29', 'done'); past('2026-07-30', 'not_done', 'no_time');
    const t2 = mk('امروز', { plannedDate: MON });
    assert.ok(report({ answers: [done(t2)] }).ok);
    assert.equal(kind(textOf(t2.id)), 'simple');

    reset(); // دو روز قبل + امروزِ کامل = ۳ ⇒ streak
    past('2026-07-29', 'done'); past('2026-07-30', 'done');
    const t3 = mk('امروز', { plannedDate: MON });
    assert.ok(report({ answers: [done(t3)] }).ok);
    assert.equal(kind(textOf(t3.id)), 'streak');
  });

  test('اولویت دسته‌ها: fullDay ← priority ← streak ← simple', () => {
    reset();
    for (const d of ['2026-07-28', '2026-07-29', '2026-07-30']) logs.upsert({ taskId: mk(`گذشته ${d}`, { plannedDate: d }).id, userId: u.id, logDate: d, status: 'done' });
    const hi = mk('مهم', { plannedDate: MON, priority: 'high' }); const lo = mk('عادی', { plannedDate: MON });
    assert.ok(report({ answers: [done(hi), done(lo)] }).ok);
    assert.equal(kind(textOf(hi.id)), 'priority'); // اولویت بالا بر رگه می‌چربد
    assert.equal(kind(textOf(lo.id)), 'fullDay'); // آخرین done روز را کامل کرد
  });

  test('عدم تکرار در طول چند گزارش پیاپی و داخل یک گزارش', () => {
    reset();
    const texts = [];
    for (let i = 0; i < 14; i += 1) {
      const date = `2026-08-${String(10 + i).padStart(2, '0')}`;
      const t = mkOn(date, `کار ${i}`);
      const r = report({ answers: [done(t)] }, date);
      assert.ok(r.ok, r.error);
      texts.push(r.encouragements[0].text);
    }
    texts.forEach((text, i) => {
      const prev = texts.slice(Math.max(0, i - 5), i).map(E.templateIndexOf);
      assert.ok(!prev.includes(E.templateIndexOf(text)), `تکرار در گزارش ${i}`);
    });

    reset(); // یک گزارشِ ۱۰ تسکه
    const tasks = Array.from({ length: 10 }, (_, i) => mk(`تسک ${i}`, { plannedDate: MON }));
    const r = report({ answers: tasks.map(done) });
    assert.ok(r.ok);
    const idx = r.encouragements.map((e) => E.templateIndexOf(e.text));
    idx.forEach((v, i) => assert.ok(!idx.slice(Math.max(0, i - 5), i).includes(v), `تکرار داخل گزارش در ${i}`));
  });

  test('گیت خروج: پیام‌ها همراه ثبت اتمیک ذخیره و در gate.report برمی‌گردند', () => {
    reset();
    settings.setValue('dailyReportGateMode', 'enforce');
    try {
      const a = mk('الف', { plannedDate: MON }); const b = mk('ب', { plannedDate: MON });
      const gate = svc.checkoutGate(u, MON, { answers: [done(a), { taskId: b.id, status: 'not_done', reasonCode: 'no_time' }] });
      assert.equal(gate.action, 'allow');
      assert.equal(textOf(a.id), undefined); // قبل از commit چیزی ذخیره نشده
      svc.commitAtomic(u, gate, () => 'خروج');
      assert.equal(kind(textOf(a.id)), 'simple');
      assert.equal(textOf(b.id), E.NOT_DONE_THANKS);
      assert.deepEqual(gate.report.encouragements.map((e) => e.status), ['done', 'not_done']);
    } finally { settings.setValue('dailyReportGateMode', 'off'); }
  });

  test('خطا در ساخت پیام ⇒ گزارش بدون پیام ذخیره می‌شود (fail-open)', () => {
    reset();
    const t = mk('الف', { plannedDate: MON });
    const orig = logs.listRecentEncouragements;
    const origErr = console.error;
    logs.listRecentEncouragements = () => { throw new Error('boom'); };
    console.error = () => {};
    try {
      const r = report({ answers: [done(t)] });
      assert.ok(r.ok);
      assert.equal(logs.findByTaskDate(t.id, MON).status, 'done');
      assert.equal(textOf(t.id), null);
      assert.deepEqual(r.encouragements, []);
    } finally { logs.listRecentEncouragements = orig; console.error = origErr; }
  });

  test('repository: listRecentEncouragements جدیدترین اول، بدون null/خالی، با limit', () => {
    reset();
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const t = mk(`ر${i}`, { plannedDate: MON });
      logs.upsert({ taskId: t.id, userId: u.id, logDate: MON, status: 'done', encouragementText: i === 1 ? null : `متن ${i}` });
      out.push(t);
    }
    assert.deepEqual(logs.listRecentEncouragements(u.id, 10), ['متن 3', 'متن 2', 'متن 0']);
    assert.deepEqual(logs.listRecentEncouragements(u.id, 2), ['متن 3', 'متن 2']);
    assert.deepEqual(logs.listRecentEncouragements(999999), []);
  });

  test('تنظیم encouragementsEnabled در رجیستری: پیش‌فرض روشن', () => {
    const { REGISTRY } = require('../src/utils/settingsRegistry');
    const def = (REGISTRY || []).find((d) => d.key === 'encouragementsEnabled');
    if (def) assert.equal(def.default, true);
    assert.equal(settings.getAll().encouragementsEnabled, true);
  });
});

describe('نمایش پیام تشویقی در Mini App', () => {
  test('encouragementOf: آخرین done؛ وگرنه تشکر؛ خالی ⇒ ""', () => {
    assert.equal(DR.encouragementOf(null), '');
    assert.equal(DR.encouragementOf({}), '');
    assert.equal(DR.encouragementOf({ encouragements: [] }), '');
    assert.equal(DR.encouragementOf({ encouragements: [{ status: 'done', text: 'الف' }, { status: 'done', text: 'ب' }] }), 'ب');
    assert.equal(DR.encouragementOf({ encouragements: [{ status: 'not_done', text: 'ممنون' }, { status: 'done', text: 'ج' }, { status: 'partial', text: 'ممنون' }] }), 'ج');
    assert.equal(DR.encouragementOf({ encouragements: [{ status: 'not_done', text: 'ممنون' }] }), 'ممنون');
    assert.equal(DR.encouragementOf({ encouragements: [{ status: 'done', text: '' }, null, { status: 'done' }] }), '');
  });

  test('app.js پیام را هم در خروج و هم در گزارش دیرهنگام نشان می‌دهد', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/app.js'), 'utf8');
    assert.equal((src.match(/encouragementOf\(/g) || []).length, 2);
  });
});
