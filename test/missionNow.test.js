// C6: «ماموریت همین حالا» — شروع/پایان دستی، پایان خودکار با برچسب، نمایش در مرور شبانه.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');
const { zonedTimeToUtc } = require('../src/utils/time');

describe('ماموریت همین حالا (C6)', () => {
  let db; let svc; let leaveRepo; let missionService; let decisions; let mgr; let day;
  const at = (hhmm, d = day) => zonedTimeToUtc(d, hhmm, 'Asia/Tehran');
  const fresh = () => { db.exec('DELETE FROM leave_approvals; DELETE FROM leave_requests;'); return F.makeUser({ managerId: mgr.id }); };

  before(() => {
    db = resetDb();
    svc = require('../src/services/missionNowService');
    leaveRepo = require('../src/repositories/leaveRepository');
    missionService = require('../src/services/missionService');
    decisions = require('../src/services/missionDecisionService');
    mgr = F.makeUser({ role: 'manager' });
    day = F.workdayDate(1);
  });
  after(cleanup);

  test('شروع: ماموریت ساعتی pending از اکنون تا پایان شیفت، باز', () => {
    const u = fresh();
    const r = svc.startNow({ userId: u.id, now: at('10:15') });
    assert.equal(r.ok, true, JSON.stringify(r));
    const q = leaveRepo.findById(r.request.id);
    assert.deepEqual([q.unit, q.start_time, q.status, q.source, q.kind], ['hour', '10:15', 'pending', 'miniapp_now_open', 'mission']);
    assert.ok(q.end_time > '10:15');
    assert.equal(missionService.presentMission(q).openNow, true);
  });

  test('شروع دوباره با ماموریت باز ⇒ ALREADY_OPEN؛ بدون ماموریت باز، پایان ⇒ NOT_OPEN', () => {
    const u = fresh();
    assert.equal(svc.endNow({ userId: u.id, now: at('11:00') }).code, 'NOT_OPEN');
    assert.equal(svc.startNow({ userId: u.id, now: at('10:00') }).ok, true);
    assert.equal(svc.startNow({ userId: u.id, now: at('10:30') }).code, 'ALREADY_OPEN');
  });

  test('پایان دستی: ساعت پایان = اکنون، مدت دوباره‌محاسبه، برچسب بسته', () => {
    const u = fresh();
    const r = svc.startNow({ userId: u.id, now: at('10:00') });
    const e = svc.endNow({ userId: u.id, now: at('12:30') });
    assert.equal(e.ok, true, JSON.stringify(e));
    const q = leaveRepo.findById(r.request.id);
    assert.deepEqual([q.end_time, q.duration_minutes, q.source], ['12:30', 150, 'miniapp_now']);
    assert.equal(svc.autoCloseOpen({ now: at('23:00') }), 0);
    assert.equal(svc.startNow({ userId: u.id, now: at('13:00') }).ok, true, 'بعد از پایان می‌شود دوباره شروع کرد');
  });

  test('پایان در همان دقیقه ⇒ حداقل ۱ دقیقه؛ پایان یک ماموریتِ تأییدشده هم ممکن است', () => {
    const u = fresh();
    const r = svc.startNow({ userId: u.id, now: at('10:00') });
    require('../src/services/leaveApprovalService').decide({ requestId: r.request.id, actor: mgr, decision: 'approve' });
    assert.equal(leaveRepo.findById(r.request.id).status, 'approved');
    const e = svc.endNow({ userId: u.id, now: at('10:00') });
    assert.equal(e.ok, true);
    assert.equal(leaveRepo.findById(r.request.id).end_time, '10:01');
  });

  test('پایان خودکار: پیش از پایان شیفت دست‌نخورده؛ بعد از آن ⇒ برچسب auto و audit؛ idempotent', () => {
    const u = fresh();
    const r = svc.startNow({ userId: u.id, now: at('10:00') });
    assert.equal(svc.autoCloseOpen({ now: at('15:00') }), 0);
    assert.equal(svc.autoCloseOpen({ now: at('18:00') }), 1);
    const q = leaveRepo.findById(r.request.id);
    assert.equal(q.source, 'miniapp_now_auto');
    assert.equal(missionService.presentMission(q).autoEnded, true);
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'mission_auto_ended'").get());
    assert.equal(svc.autoCloseOpen({ now: at('18:30') }), 0);
    assert.match(decisions.describeMission(q, u), /پایان خودکار/);
    assert.equal(svc.endNow({ userId: u.id, now: at('18:30') }).code, 'NOT_OPEN');
  });

  test('ماموریت باز روزهای قبل با job روز بعد خودکار بسته می‌شود', () => {
    const u = fresh();
    svc.startNow({ userId: u.id, now: at('10:00') });
    assert.equal(svc.autoCloseOpen({ now: at('06:00', F.workdayDate(2)) }), 1);
  });

  test('بعد از پایان ساعت کاری یا روز غیرکاری ⇒ خطا', () => {
    const u = fresh();
    assert.equal(svc.startNow({ userId: u.id, now: at('23:00') }).code, 'NO_TIME_LEFT');
    assert.equal(svc.startNow({ userId: u.id, now: zonedTimeToUtc('2026-08-07', '10:00', 'Asia/Tehran') }).code, 'NOT_WORKING_DAY'); // جمعه
  });
});

describe('ماموریت همین حالا — UI/مسیر (C6)', () => {
  const fs = require('node:fs');
  const read = (f) => fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
  test('دکمه‌های شروع/پایان در HTML و اتصال به API در app.js', () => {
    const html = read('public/index.html');
    assert.match(html, /id="mission-now-start"[^>]*>شروع ماموریت الان</);
    assert.match(html, /id="mission-now-end"[^>]*hidden>پایان ماموریت</);
    const app = read('public/js/app.js');
    assert.match(app, /api\('\/mission\/now', \{ method: 'POST'/);
    assert.match(app, /api\('\/mission\/now\/end', \{ method: 'POST'/);
    assert.match(app, /syncMissionNow\(items\)/);
  });
  test('routeها در miniapp.js ثبت شده‌اند', () => {
    const src = read('src/api/routes/miniapp.js');
    assert.match(src, /router\.post\('\/miniapp\/mission\/now',/);
    assert.match(src, /router\.post\('\/miniapp\/mission\/now\/end',/);
  });
});
