// پیام‌های دورکاری: «ثبت برای بررسی» برای سرپرست/ادمین، «تأیید» (تکی و دسته‌ای) و «رد» برای کارمند. سطح سرویس (بدون HTTP و بدون شبکه:
// ردیف‌های notifications خوانده می‌شوند؛ ارسال تلگرام در تست به‌دلیل نبودن شبکه failed می‌شود و به ثبت ردیف اثری ندارد).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('پیام‌های دورکاری برای سرپرست و کارمند', () => {
  let db; let F; let work; let admin; let repo; let events; let U;
  const tick = () => new Promise((res) => setTimeout(res, 60));
  const rows = (userId, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(userId, type);
  // work date 2026-10-12؛ ساعت‌ها به وقت UTC (تهران +۳:۳۰ ⇒ ۰۵:۰۰Z = ۰۸:۳۰)
  const at = (hhmm, d = '2026-10-12') => new Date(`${d}T${hhmm}:00.000Z`);
  const now = new Date('2026-10-16T10:00:00Z');

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    work = require('../src/services/remoteWorkService');
    admin = require('../src/services/remoteWorkAdminService');
    repo = require('../src/repositories/remoteWorkRepository');
    events = require('../src/services/notificationEvents');
    const mgr = F.makeUser({ role: 'manager', name: 'سرپرست الف' });
    U = {
      mgr,
      adm: F.makeUser({ role: 'admin', name: 'ادمین' }),
      emp: F.makeUser({ managerId: mgr.id, name: 'علی رضایی' }),
      emp2: F.makeUser({ managerId: mgr.id, name: 'نگار کریمی' }),
      orphan: F.makeUser({ managerId: null, name: 'بدون سرپرست' }),
    };
  });
  after(() => cleanup());

  // یک نشست کامل از طریق خودِ سرویس (مسیر واقعی)؛ break = [شروع، پایان] اختیاری
  const submit = (user, { d = '2026-10-12', from = '05:00', to = '09:00', brk = null, source = 'miniapp' } = {}) => {
    assert.ok(work.start(user, { now: at(from, d), source }).ok);
    if (brk) { assert.ok(work.breakStart(user, { now: at(brk[0], d), source }).ok); assert.ok(work.breakEnd(user, { now: at(brk[1], d), source }).ok); }
    const r = work.end(user, { now: at(to, d), source });
    assert.ok(r.ok);
    return r.session.id;
  };

  test('پایان دورکاری ⇒ پیام «برای بررسی» فقط برای سرپرستِ مستقیم، با اطلاعات کامل', async () => {
    const id = submit(U.emp, { brk: ['06:00', '06:30'], source: 'bot' });
    await tick();
    const n = rows(U.mgr.id, 'remote_work_submitted');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, '🏠 دورکاری جدید برای بررسی');
    for (const part of ['علی رضایی', '۰۸:۳۰ تا ۱۲:۳۰', 'ساعت خالص: ۳ ساعت و ۳۰ دقیقه', 'استراحت: ۳۰ دقیقه', 'بات تلگرام', 'تا تأیید شما']) {
      assert.ok(n[0].body.includes(part), `باید شامل «${part}» باشد`);
    }
    assert.equal(n[0].link, '#/remote');
    assert.equal(rows(U.emp.id, 'remote_work_submitted').length, 0); // خودِ کارمند پیام «بررسی» نمی‌گیرد
    assert.equal(rows(U.adm.id, 'remote_work_submitted').length, 0); // سرپرست فعال هست ⇒ ادمین نه
    // dedupe: فراخوانی دوباره‌ی همان رویداد پیام تازه نمی‌سازد
    await events.remoteWorkSubmitted(id);
    assert.equal(rows(U.mgr.id, 'remote_work_submitted').length, 1);
  });

  test('منبع Mini App در پیام سرپرست و کارمندِ بدون سرپرست ⇒ ادمین‌ها', async () => {
    submit(U.orphan, { d: '2026-10-11', source: 'miniapp' });
    await tick();
    const n = rows(U.adm.id, 'remote_work_submitted');
    assert.equal(n.length, 1);
    assert.ok(n[0].body.includes('Mini App'));
    assert.ok(n[0].body.includes('بدون سرپرست'));
  });

  test('نشستِ بازِ فراموش‌شده را job شبانه می‌بندد ⇒ پیام با هشدار «بسته‌شده‌ی خودکار»', async () => {
    assert.ok(work.start(U.emp2, { now: at('05:00', '2026-10-10') }).ok);
    const closed = work.autoCloseStale({ now });
    assert.ok(closed >= 1);
    await tick();
    const n = rows(U.mgr.id, 'remote_work_submitted').filter((r) => r.body.includes('نگار کریمی'));
    assert.equal(n.length, 1);
    assert.ok(n[0].body.includes('⚠️'));
  });

  test('تأیید ⇒ پیام برای کارمند؛ ساعت اصلاح‌شده، یادداشت و تأییدکننده؛ idempotent', async () => {
    const id = submit(U.emp, { d: '2026-10-13', brk: ['06:00', '06:30'] });
    const r = admin.approve(U.mgr, id, { reviewNote: 'ممنون', approvedEndAt: '2026-10-13T08:30:00Z' }, { now });
    assert.ok(r.ok && !r.alreadyApproved);
    await tick();
    const n = rows(U.emp.id, 'remote_work_approved');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, '✅ دورکاری شما تأیید شد');
    for (const part of ['۰۸:۳۰ تا ۱۲:۰۰', 'اصلاح شد', 'ساعت لحاظ‌شده: ۳ ساعت', 'سرپرست الف', 'یادداشت سرپرست: ممنون']) {
      assert.ok(n[0].body.includes(part), `باید شامل «${part}» باشد`);
    }
    const again = admin.approve(U.mgr, id, {}, { now });
    assert.ok(again.ok && again.alreadyApproved);
    await tick();
    assert.equal(rows(U.emp.id, 'remote_work_approved').length, 1); // تأیید دوباره پیام تازه نمی‌سازد
  });

  test('تأیید دسته‌ای ⇒ «یک» پیام تجمیعی برای هر کارمند (نه یکی برای هر نشست)', async () => {
    const batchUser = F.makeUser({ managerId: U.mgr.id, name: 'سه‌نشست' });
    submit(batchUser, { d: '2026-10-10' });
    submit(batchUser, { d: '2026-10-11' });
    submit(batchUser, { d: '2026-10-12' });
    const res = admin.approveBatch(U.mgr, { userId: batchUser.id }, { now });
    assert.ok(res.ok);
    assert.equal(res.approved, 3);
    await tick();
    const n = rows(batchUser.id, 'remote_work_approved');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, '✅ ۳ دورکاری شما تأیید شد');
    assert.ok(n[0].body.includes('مجموع ساعت لحاظ‌شده: ۱۲ ساعت')); // ۳ × ۴ ساعت
    assert.ok(n[0].body.includes('سرپرست الف'));
  });

  test('تأیید دسته‌ایِ فقط یک نشست ⇒ همان پیام تکی', async () => {
    const solo = F.makeUser({ managerId: U.mgr.id, name: 'تک‌نشست' });
    submit(solo, { d: '2026-10-12' });
    assert.ok(admin.approveBatch(U.mgr, { userId: solo.id }, { now }).ok);
    await tick();
    const n = rows(solo.id, 'remote_work_approved');
    assert.equal(n.length, 1);
    assert.equal(n[0].title, '✅ دورکاری شما تأیید شد');
  });

  test('رد ⇒ پیام قالب‌بندی‌شده با دلیل و راهنما', async () => {
    const id = submit(U.emp, { d: '2026-10-11', from: '05:00', to: '06:00' });
    const r = admin.reject(U.mgr, id, { reviewNote: 'ساعت‌ها با تسک‌ها نمی‌خواند' }, { now });
    assert.ok(r.ok);
    await tick();
    const n = rows(U.emp.id, 'remote_work_rejected').pop();
    assert.equal(n.title, '❌ دورکاری شما رد شد');
    for (const part of ['۰۸:۳۰ تا ۰۹:۳۰', 'دلیل سرپرست: ساعت‌ها با تسک‌ها نمی‌خواند', 'در حضور و غیاب و حقوق حساب نمی‌شود']) {
      assert.ok(n.body.includes(part), `باید شامل «${part}» باشد`);
    }
  });

  test('رویدادها برای نشستِ نامربوط بی‌اثرند (نشست باز، نامعتبر، وضعیت اشتباه)', async () => {
    assert.ok(work.start(U.orphan, { now: at('05:00', '2026-10-09') }).ok);
    const open = repo.findOpenSession(U.orphan.id);
    const before = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
    assert.deepEqual(await events.remoteWorkSubmitted(open.id), []); // هنوز بسته نشده
    assert.deepEqual(await events.remoteWorkSubmitted(999999), []);
    assert.deepEqual(await events.remoteWorkApproved(open.id), []); // approved نیست
    assert.deepEqual(await events.remoteWorkBatchApproved(U.orphan.id, [open.id]), []);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, before);
  });
});
