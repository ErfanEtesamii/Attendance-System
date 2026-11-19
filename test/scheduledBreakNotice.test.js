// پیام خودکار استراحت/ناهار سر ساعت (scheduledBreakNotice). سطح سرویس؛ ارسال تلگرام در تست failed می‌شود و به ثبت اعلان اثری ندارد.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('پیام خودکار استراحت و ناهار (scheduledBreakNotice)', () => {
  let db; let F; let settingsRepo; let run; let scheduler; let registry;
  // ۲۰۲۶-۱۰-۱۲ دوشنبه (روز کاری)؛ تهران UTC+3:30 ⇒ ۱۲:۰۰ تهران = ۰۸:۳۰ UTC
  const DATE = '2026-10-12';
  // ساعت دیواری تهران ⇒ UTC (۳:۳۰ کمتر)
  const tehran = (hh, mm) => new Date(Date.UTC(2026, 9, 12, 0, 0) + (hh * 60 + mm - 210) * 60000);
  const notes = (userId, type) => db.prepare('SELECT * FROM notifications WHERE user_id = ? AND type = ? ORDER BY id').all(userId, type);

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    settingsRepo = require('../src/repositories/settingsRepository');
    scheduler = require('../src/bot/scheduler');
    registry = require('../src/utils/settingsRegistry');
    ({ runScheduledBreakNotice: run } = require('../src/bot/scheduler/scheduledBreakNotice'));
  });
  after(() => cleanup());

  function present({ out = false } = {}) {
    const user = F.makeUser();
    db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, DATE, tehran(8, 0).toISOString(), out ? tehran(11, 0).toISOString() : null, 'normal');
    return user;
  }
  function enableAll() {
    ['scheduledBreakEnabled', 'scheduledLunchEnabled'].forEach((k) => settingsRepo.setValue(k, true));
  }

  test('پیش‌فرض خاموش ⇒ هیچ پیامی', async () => {
    const u = present();
    const r = await run({ now: tehran(12, 0) });
    assert.equal(r.skipped, true);
    assert.equal(notes(u.id, 'scheduled_break_start').length, 0);
  });

  test('۱۲:۰۰ شروع استراحت، ۱۲:۱۵ پایان استراحت و شروع ناهار، ۱۳:۰۰ پایان ناهار؛ هر پیام یک‌بار', async () => {
    enableAll();
    const u = present();
    await run({ now: tehran(12, 0) });
    assert.equal(notes(u.id, 'scheduled_break_start').length, 1);
    assert.match(notes(u.id, 'scheduled_break_start')[0].body, /۱۲:۱۵/);

    await run({ now: tehran(12, 1) }); // تیک دوباره در همان پنجره ⇒ تکراری نمی‌شود
    assert.equal(notes(u.id, 'scheduled_break_start').length, 1);

    await run({ now: tehran(12, 10) }); // ۵ دقیقه مانده به پایان استراحت
    assert.equal(notes(u.id, 'scheduled_break_warn').length, 1);
    assert.match(notes(u.id, 'scheduled_break_warn')[0].title, /۵ دقیقه/);

    await run({ now: tehran(12, 15) });
    assert.equal(notes(u.id, 'scheduled_break_end').length, 1);
    assert.equal(notes(u.id, 'scheduled_lunch_start').length, 1);
    assert.match(notes(u.id, 'scheduled_lunch_start')[0].body, /۱۳:۰۰/);

    await run({ now: tehran(12, 55) }); // ۵ دقیقه مانده به پایان ناهار
    assert.equal(notes(u.id, 'scheduled_lunch_warn').length, 1);

    await run({ now: tehran(13, 0) });
    assert.equal(notes(u.id, 'scheduled_lunch_end').length, 1);
  });

  test('بدون ورود، دارای خروج، ماموریت، غیرفعال یا خارج از ساعت ⇒ پیام ندارد', async () => {
    enableAll();
    const noIn = F.makeUser();
    const out = present({ out: true });
    const mission = present();
    F.makeApprovedMission(mission.id, DATE);
    await run({ now: tehran(12, 0) });
    assert.equal(notes(noIn.id, 'scheduled_break_start').length, 0);
    assert.equal(notes(out.id, 'scheduled_break_start').length, 0);
    assert.equal(notes(mission.id, 'scheduled_break_start').length, 0);

    const late = present();
    const r = await run({ now: tehran(12, 7) }); // نه سر ساعت و نه در پنجره‌ی تحمل
    assert.equal(r.skipped, true);
    assert.equal(notes(late.id, 'scheduled_break_start').length, 0);
  });

  test('ساعت و مدت دلخواه؛ شیفت مهم نیست و هر حاضرِ شرکت پیام می‌گیرد', async () => {
    enableAll();
    settingsRepo.setValue('scheduledBreakStart', '10:30');
    settingsRepo.setValue('scheduledBreakMinutes', 10);
    const u = present();
    await run({ now: tehran(10, 30) });
    assert.match(notes(u.id, 'scheduled_break_start')[0].body, /۱۰:۴۰/);

    settingsRepo.setValue('scheduledBreakStart', '06:00'); // حتی خارج از ساعت شیفت
    const v = present();
    await run({ now: tehran(6, 0) });
    assert.equal(notes(v.id, 'scheduled_break_start').length, 1);
    settingsRepo.resetValue('scheduledBreakStart');
    settingsRepo.resetValue('scheduledBreakMinutes');
  });

  test('Job و تنظیم‌ها در رجیستری معتبرند', () => {
    assert.ok(scheduler.jobNames().includes('scheduledBreakNotice'));
    assert.equal(registry.defaultOf('cronScheduledBreakNotice'), '* * * * *');
    assert.equal(registry.defaultOf('breakButtonsEnabled'), true);
    assert.deepEqual(registry.validate('scheduledBreakStart', '9:05'), { ok: true, value: '09:05' });
    assert.equal(registry.defaultOf('scheduledWarnMinutes'), 5);
    ['25:00', 'abc'].forEach((v) => assert.equal(registry.validate('scheduledBreakStart', v).ok, false, v));
    ['0', '121', 'x'].forEach((v) => assert.equal(registry.validate('scheduledBreakMinutes', v).ok, false, v));
  });
});
