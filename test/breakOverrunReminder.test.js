// یادآوری استراحتِ فراموش‌شده: بعد از آستانه (پیش‌فرض ۱۵ دقیقه) فقط برای استراحتِ باز؛ هر استراحت یک‌بار؛ ناهار فقط با تنظیم؛ رکورد بسته/قدیمی بی‌اثر.
// سطح سرویس (بدون شبکه؛ ارسال تلگرام در تست failed می‌شود و به ثبت ردیف اعلان اثری ندارد). زمان با now تزریقی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('یادآوری استراحتِ فراموش‌شده (breakOverrunReminder)', () => {
  let db; let F; let settingsRepo; let run; let breakRepo; let scheduler; let registry;
  const MIN = 60000;
  const T0 = new Date('2026-10-12T06:00:00.000Z').getTime(); // شروع استراحت
  const at = (minutesAfterStart) => new Date(T0 + minutesAfterStart * MIN);
  const notes = (userId) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'break_overrun_reminder' ORDER BY id").all(userId);
  let n = 0;

  before(() => {
    db = resetDb();
    F = require('./helpers/factories');
    settingsRepo = require('../src/repositories/settingsRepository');
    breakRepo = require('../src/repositories/breakRepository');
    scheduler = require('../src/bot/scheduler');
    registry = require('../src/utils/settingsRegistry');
    ({ runBreakOverrunReminder: run } = require('../src/bot/scheduler/breakOverrunReminder'));
  });
  after(() => cleanup());

  // کاربر + رکورد حضورِ بدون خروج + یک استراحت که در T0 شروع شده (type: short_break | lunch)؛ end = دقیقه‌ی پایان (null = باز)
  function scenario({ type = 'short_break', end = null, checkedOut = false } = {}) {
    settingsRepo.resetValue('breakOverrunReminderMinutes');
    settingsRepo.resetValue('breakOverrunReminderLunch');
    n += 1;
    const user = F.makeUser();
    const date = new Date(Date.UTC(2026, 9, 12 + n)).toISOString().slice(0, 10);
    const recordId = db.prepare('INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, date, new Date(T0 - 120 * MIN).toISOString(), checkedOut ? new Date(T0 + 5 * MIN).toISOString() : null, 'normal').lastInsertRowid;
    const brk = breakRepo.createManual({ attendanceRecordId: recordId, breakType: type, startTime: new Date(T0).toISOString(), endTime: end === null ? null : new Date(T0 + end * MIN).toISOString() });
    return { user, recordId, brk };
  }

  test('پیش‌فرض: ۱۵ دقیقه؛ قبل از آن هیچ پیامی، بعد از آن یک پیام (با dedupe ⇒ اجرای دوباره پیام تکراری نمی‌سازد)', async () => {
    assert.equal(settingsRepo.getAll().breakOverrunReminderMinutes, 15);
    const { user, brk } = scenario();
    let r = await run({ now: at(14) });
    assert.equal(notes(user.id).length, 0);
    assert.equal(r.reminded, 0);

    r = await run({ now: at(15) });
    assert.equal(r.reminded, 1);
    const got = notes(user.id);
    assert.equal(got.length, 1);
    assert.match(got[0].title, /۱۵ دقیقه/);
    assert.match(got[0].body, /پایان استراحت/);
    assert.equal(got[0].dedupe_key, `break_overrun:${brk.id}`);

    r = await run({ now: at(16) });
    assert.equal(r.reminded, 0);
    assert.equal(notes(user.id).length, 1, 'یک استراحت فقط یک‌بار پیام می‌گیرد');
  });

  test('استراحتِ بسته‌شده (قبل از آستانه یا بعدش)، رکورد دارای خروج و استراحتِ بسیار قدیمی ⇒ پیام ندارد', async () => {
    const closed = scenario({ end: 10 });
    const out = scenario({ checkedOut: true });
    const stale = scenario();
    await run({ now: at(20) });
    assert.equal(notes(closed.user.id).length, 0);
    assert.equal(notes(out.user.id).length, 0);
    assert.equal(notes(stale.user.id).length, 1, 'کنترل: استراحتِ باز در پنجره پیام می‌گیرد');

    const old = scenario();
    await run({ now: at(15 + 181) }); // بیرون از پنجره‌ی «آستانه + ۳ ساعت»
    assert.equal(notes(old.user.id).length, 0);
  });

  test('ناهار پیش‌فرض یادآوری نمی‌گیرد؛ با breakOverrunReminderLunch می‌گیرد', async () => {
    const { user } = scenario({ type: 'lunch' });
    await run({ now: at(20) });
    assert.equal(notes(user.id).length, 0);
    settingsRepo.setValue('breakOverrunReminderLunch', true);
    await run({ now: at(20) });
    assert.equal(notes(user.id).length, 1);
  });

  test('آستانه‌ی دلخواه، خاموش (۰) و کاربر غیرفعال', async () => {
    const a = scenario();
    settingsRepo.setValue('breakOverrunReminderMinutes', 30);
    await run({ now: at(29) });
    assert.equal(notes(a.user.id).length, 0);
    const r = await run({ now: at(30) });
    assert.equal(r.reminded >= 1, true);
    const got = notes(a.user.id);
    assert.equal(got.length, 1);
    assert.match(got[0].title, /۳۰ دقیقه/);

    const b = scenario();
    settingsRepo.setValue('breakOverrunReminderMinutes', 0);
    assert.deepEqual(await run({ now: at(500) }), { checked: 0, reminded: 0, errors: 0, skipped: true });
    assert.equal(notes(b.user.id).length, 0);

    const c = scenario();
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(c.user.id);
    await run({ now: at(20) });
    assert.equal(notes(c.user.id).length, 0);
  });

  test('Job در scheduler ثبت است و تنظیم‌ها/cron در رجیستری معتبرند', () => {
    assert.ok(scheduler.jobNames().includes('breakOverrunReminder'));
    assert.equal(registry.defaultOf('cronBreakOverrunReminder'), '* * * * *');
    assert.equal(registry.getDef('breakOverrunReminderMinutes').group, 'reminders');
    assert.deepEqual(registry.validate('breakOverrunReminderMinutes', '15'), { ok: true, value: 15 });
    ['-1', '241', '1.5', 'abc'].forEach((v) => assert.equal(registry.validate('breakOverrunReminderMinutes', v).ok, false, v));
  });
});
