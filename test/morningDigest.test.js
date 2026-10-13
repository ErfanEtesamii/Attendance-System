// D12: خلاصه‌ی صبحگاهی — دیرهنگام‌ها، مشاهده‌نشده‌ها، روز غیرکاری، ثبت در job_runs، cron.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('خلاصه‌ی صبحگاهی (D12)', () => {
  let db; let md; let plans; let logs; let rr; let boss; let a; let b; let wrapJob;
  const TUE = '2026-08-04'; const MON = '2026-08-03'; const FRI = '2026-08-07';
  const at = (d, h) => zonedTimeToUtc(d, h, 'Asia/Tehran');
  const wk = (d) => require('../src/engine/calendarService').weekStartOf(d, 6);
  const answer = (u, date, answeredAt) => {
    const p = plans.getOrCreate(u.id, wk(date));
    const t = plans.addTask(p.id, { title: 't', plannedDate: date });
    logs.upsert({ taskId: t.id, userId: u.id, logDate: date, status: 'done' });
    db.prepare('UPDATE task_daily_logs SET answered_at = ? WHERE task_id = ? AND log_date = ?').run(answeredAt.toISOString(), t.id, date);
  };
  const reset = () => db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM job_runs;');

  before(() => {
    db = resetDb();
    md = require('../src/bot/scheduler/morningDigest');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    rr = require('../src/repositories/reportReviewRepository');
    ({ wrapJob } = require('../src/utils/jobRunner'));
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    b = F.makeUser({ managerId: boss.id, name: 'بهزاد' });
  });
  after(cleanup);

  test('گزارش ثبت‌شده بعد از ساعت شبانه (۲۰:۰۰ دیروز) ⇒ در بخش دیرهنگام؛ قبل از آن نه', () => {
    reset();
    answer(a, MON, at(MON, '22:30'));
    answer(b, MON, at(MON, '18:00'));
    rr.upsert({ reviewerId: boss.id, subjectUserId: a.id, reportDate: MON });
    rr.upsert({ reviewerId: boss.id, subjectUserId: b.id, reportDate: MON });
    const d = md.buildMorningDigests({ now: at(TUE, '08:00') });
    assert.equal(d.length, 1);
    assert.match(d[0].text, /بعد از ارسال شبانه \(1 نفر\)/);
    assert.match(d[0].text, /علی/);
    assert.doesNotMatch(d[0].text, /• بهزاد/);
    assert.deepEqual(d[0].unreviewed, []);
  });

  test('مشاهده‌نشده‌های روز کاریِ قبل؛ با مشاهده‌ی همه و بدون دیرهنگام ⇒ پیامی نیست', () => {
    reset();
    answer(a, MON, at(MON, '17:00')); answer(b, MON, at(MON, '17:00'));
    let d = md.buildMorningDigests({ now: at(TUE, '08:00') });
    assert.equal(d.length, 1);
    assert.deepEqual(d[0].unreviewed.sort(), [a.id, b.id].sort());
    assert.match(d[0].text, /هنوز مشاهده نشده \(2 نفر\)/);
    rr.upsert({ reviewerId: boss.id, subjectUserId: a.id, reportDate: MON });
    rr.upsert({ reviewerId: boss.id, subjectUserId: b.id, reportDate: MON });
    d = md.buildMorningDigests({ now: at(TUE, '08:00') });
    assert.equal(d.length, 0);
  });

  test('روز غیرکاریِ سرپرست (جمعه) ⇒ پیامی نیست', () => {
    reset();
    answer(a, '2026-08-06', at('2026-08-06', '23:00'));
    assert.equal(md.buildMorningDigests({ now: at(FRI, '08:00') }).length, 0);
  });

  test('ارسال با بات ماک + دکمه؛ خطای ارسال شمرده نمی‌شود؛ ثبت در job_runs', async () => {
    reset();
    answer(a, MON, at(MON, '22:30'));
    const sent = [];
    const bot = { sendMessage: async (c, t, o) => sent.push({ c: String(c), t, o }) };
    const r = await wrapJob('morningDigest', () => md.sendMorningDigest(bot, { now: at(TUE, '08:00') }))();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].c, String(boss.telegram_user_id));
    assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'morningDigest'").get().status, 'success');
    const bad = { sendMessage: async () => { throw new Error('x'); } };
    assert.equal((await md.sendMorningDigest(bad, { now: at(TUE, '08:00') })).sent, 0);
    void r;
  });

  test('Job و cron ثبت‌شده‌اند (پیش‌فرض ۰۸:۰۰)', () => {
    const config = require('../src/config');
    assert.equal(config.cron.morningDigest, '0 8 * * *');
    assert.ok(require('../src/bot/scheduler').jobNames().includes('morningDigest'));
    assert.equal(md.nightlyHHMM(), '20:00');
  });
});
