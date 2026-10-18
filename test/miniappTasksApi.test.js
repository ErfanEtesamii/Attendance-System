// A4 (فاز ۱۵): APIهای Mini App برای تسک‌ها — my-urgent (POST/PATCH/DELETE)، undo/note با فهرست تازه، نگاشت خطا، مالکیت، ALREADY_ANSWERED و rate limit.
// سرور واقعی روی پورت تصادفی + initData امضاشده؛ ساعت با mock.timers ثابت است (یکشنبه ۲۰۲۶-۰۸-۰۲، هفته‌ی جاریِ شروع‌شده).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

const TODAY = '2026-08-02';
const MON = '2026-08-03';
const FRI = '2026-08-07';

describe('APIهای تسک Mini App (A4)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let db; let S; let settings; let urgent; let boss;
  const fresh = (over = {}) => F.makeUser({ managerId: boss.id, ...over });
  const enable = (max = 5) => { settings.setValue('selfUrgentEnabled', true); settings.setValue('selfUrgentMaxPerDay', max); };
  const clear = () => db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans; DELETE FROM notifications;');
  const mine = (u, over = {}) => S.call(u, 'POST', 'my-urgent', { title: 'کار فوری', date: TODAY, ...over });

  before(async () => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${TODAY}T08:00:00.000Z`) });
    db = resetDb();
    settings = require('../src/repositories/settingsRepository');
    urgent = require('../src/services/urgentTaskService');
    boss = F.makeUser({ role: 'manager' });
    settings.setValue('dailyReportGateMode', 'off');
    S = await startServer();
  });
  after(() => { if (S) S.close(); mock.timers.reset(); cleanup(); });

  const { startServer } = require('./helpers/miniappClient');

  test('بدون initData معتبر ⇒ ۴۰۱ برای همه‌ی مسیرهای تازه', async () => {
    for (const [method, p] of [['POST', 'my-urgent'], ['PATCH', 'my-urgent/1'], ['DELETE', 'my-urgent/1'], ['POST', 'daily-report/undo'], ['PATCH', 'daily-report/note']]) {
      const res = await fetch(`${S.base}/api/miniapp/${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' });
      assert.equal(res.status, 401, `${method} ${p}`);
    }
  });

  test('my-urgent: پیش‌فرض خاموش ⇒ ۴۰۳؛ روشن ⇒ ۲۰۱ با فوریِ خودش و فهرست تازه‌ی امروز', async () => {
    clear(); settings.setValue('selfUrgentEnabled', false);
    const u = fresh();
    const off = await mine(u);
    assert.deepEqual([off.status, off.json.code], [403, 'SELF_URGENT_DISABLED']);
    enable();
    const ok = await mine(u, { title: 'چاپگر', description: 'توضیح', deadlineTime: '23:00', ownerUserId: 9999 });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.task.selfAssigned, true);
    assert.ok(ok.json.daily.tasks.some((t) => t.title === 'چاپگر'));
    const row = db.prepare('SELECT p.user_id, t.assigned_by_user_id, t.urgent_deadline_time FROM plan_tasks t JOIN weekly_plans p ON p.id = t.plan_id WHERE t.id = ?').get(ok.json.task.id);
    assert.deepEqual([row.user_id, row.assigned_by_user_id, row.urgent_deadline_time], [u.id, u.id, null], 'مالکیت فقط از initData؛ مهلت نادیده');
  });

  test('my-urgent: نگاشت خطا (۴۰۰ اعتبارسنجی/روز غیرکاری، ۴۰۹ سقف)', async () => {
    clear(); enable(1);
    const u = fresh();
    assert.deepEqual((({ status, json }) => [status, json.code])(await mine(u, { title: ' ' })), [400, 'TITLE_REQUIRED']);
    assert.deepEqual((({ status, json }) => [status, json.code])(await mine(u, { date: FRI })), [400, 'NOT_WORKING_DAY']);
    assert.deepEqual((({ status, json }) => [status, json.code])(await mine(u, { date: '2026-08-01' })), [400, 'DATE_IN_PAST']);
    assert.equal((await mine(u)).status, 201);
    const lim = await mine(u);
    assert.deepEqual([lim.status, lim.json.code], [409, 'SELF_URGENT_LIMIT']);
    assert.ok(typeof lim.json.error === 'string' && lim.json.error.length > 0);
  });

  test('PATCH/DELETE my-urgent: مجاز برای خودش؛ تسک دیگران ۴۰۴؛ فوریِ سرپرست ۴۰۳؛ شناسه‌ی نامعتبر ۴۰۴؛ با پاسخ ۴۰۹', async () => {
    clear(); enable();
    const u = fresh(); const v = fresh();
    const id = (await mine(u)).json.task.id;
    const patched = await S.call(u, 'PATCH', `my-urgent/${id}`, { title: 'عنوان تازه', date: MON });
    assert.equal(patched.status, 200, JSON.stringify(patched.json));
    assert.equal(patched.json.task.title, 'عنوان تازه');
    assert.equal((await S.call(v, 'PATCH', `my-urgent/${id}`, { title: 'x' })).status, 404);
    assert.equal((await S.call(v, 'DELETE', `my-urgent/${id}`)).status, 404);
    assert.equal((await S.call(u, 'PATCH', `my-urgent/abc`, { title: 'x' })).status, 404);
    assert.equal((await S.call(u, 'DELETE', `my-urgent/0`)).status, 404);
    assert.equal((await S.call(u, 'PATCH', `my-urgent/${id}`, {})).status, 400);

    const m = urgent.assign(boss, u, { title: 'از سرپرست', date: TODAY }, { now: new Date() });
    assert.equal(m.ok, true, JSON.stringify(m));
    const denied = await S.call(u, 'DELETE', `my-urgent/${m.task.id}`);
    assert.deepEqual([denied.status, denied.json.code], [403, 'NOT_SELF_URGENT']);

    const id2 = (await mine(u, { title: 'دومی' })).json.task.id;
    assert.equal((await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: id2, status: 'done' }] })).status, 200);
    const answered = await S.call(u, 'DELETE', `my-urgent/${id2}`);
    assert.deepEqual([answered.status, answered.json.code], [409, 'HAS_ANSWERS']);

    const del = await S.call(u, 'DELETE', `my-urgent/${id}`);
    assert.equal(del.status, 200);
    assert.ok(!del.json.daily.tasks.some((t) => t.id === id));
  });

  test('tick → ALREADY_ANSWERED → note (فهرست تازه) → undo (بازگشت به فهرست)', async () => {
    clear(); enable();
    const u = fresh(); const v = fresh();
    const id = (await mine(u)).json.task.id;
    const done = await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: id, status: 'done', note: 'تمام شد' }] });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    const again = await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: id, status: 'done' }] });
    assert.deepEqual([again.status, again.json.code], [409, 'ALREADY_ANSWERED']);

    const note = await S.call(u, 'PATCH', 'daily-report/note', { taskId: id, note: 'توضیح تازه' });
    assert.equal(note.status, 200, JSON.stringify(note.json));
    assert.equal(note.json.note, 'توضیح تازه');
    assert.ok(Array.isArray(note.json.tasks) && Array.isArray(note.json.answered), 'فهرست تازه همراه پاسخ');
    assert.equal((await S.call(u, 'PATCH', 'daily-report/note', { taskId: id, note: 'ا'.repeat(501) })).status, 400);
    assert.equal((await S.call(v, 'PATCH', 'daily-report/note', { taskId: id, note: 'x' })).status, 404);
    assert.equal((await S.call(v, 'POST', 'daily-report/undo', { taskId: id })).status, 404);

    const undo = await S.call(u, 'POST', 'daily-report/undo', { taskId: id });
    assert.equal(undo.status, 200, JSON.stringify(undo.json));
    assert.ok(undo.json.tasks.some((t) => t.id === id), 'بعد از undo دوباره در «پاسخ‌نداده»');
    assert.equal((await S.call(u, 'POST', 'daily-report/undo', { taskId: id })).status, 404, 'بدون پاسخ ⇒ چیزی برای برداشتن نیست');

    const id2 = (await mine(u, { title: 'دیگر' })).json.task.id;
    await S.call(u, 'POST', 'daily-report', { answers: [{ taskId: id2, status: 'not_done', reasonCode: 'no_time' }] });
    const bad = await S.call(u, 'PATCH', 'daily-report/note', { taskId: id2, note: 'x' });
    assert.deepEqual([bad.status, bad.json.code], [409, 'NOTE_ONLY_FOR_DONE']);
  });

  test('GET /week-board: ۷ روز با تسک‌ها (فقط‌خواندنی)، هفته‌ی بعد، week نامعتبر ⇒ ۴۰۰، بدون initData ⇒ ۴۰۱', async () => {
    clear(); enable();
    const u = fresh();
    assert.equal((await mine(u, { title: 'امروزی' })).status, 201);
    const cur = await S.call(u, 'GET', 'week-board');
    assert.equal(cur.status, 200, JSON.stringify(cur.json));
    assert.deepEqual([cur.json.week, cur.json.days.length, cur.json.today], ['current', 7, TODAY]);
    const today = cur.json.days.find((d) => d.date === TODAY);
    assert.deepEqual([today.isToday, today.tasks[0].title, today.tasks[0].status, today.tasks[0].selfAssigned], [true, 'امروزی', 'pending', true]);
    const next = await S.call(u, 'GET', 'week-board?week=next');
    assert.deepEqual([next.status, next.json.hasPlan], [200, false]);
    const bad = await S.call(u, 'GET', 'week-board?week=prev');
    assert.deepEqual([bad.status, bad.json.code], [400, 'INVALID_WEEK']);
    const anon = await fetch(`${S.base}/api/miniapp/week-board`);
    assert.equal(anon.status, 401);
  });

  test('rate limit: my-urgent بعد از ۱۰ درخواست در دقیقه ⇒ ۴۲۹ (کلید = کاربر)؛ کاربر دیگر آزاد', async () => {
    clear(); enable();
    const u = fresh(); const v = fresh();
    const codes = [];
    for (let i = 0; i < 11; i += 1) codes.push((await S.call(u, 'POST', 'my-urgent', { title: ' ' })).status);
    assert.equal(codes.slice(0, 10).every((c) => c === 400), true, codes.join());
    assert.equal(codes[10], 429);
    assert.equal((await S.call(v, 'POST', 'my-urgent', { title: ' ' })).status, 400);
    assert.notEqual((await S.call(u, 'GET', 'today')).status, 429, 'limiter فقط روی مسیرهای تسک');
  });
});
