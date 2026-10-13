// D2 (فاز ۱۱): API اعتراضِ کارمند در Mini App — کدهای وضعیت HTTP، مالکیت، ادامه/خاتمه و rate limit روی سرور واقعی.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/miniappClient');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('Mini App اعتراض و گفت‌وگو (D2) — سرور', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let S; let F; let repo; let db; let admin;

  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    repo = require('../src/repositories/disputeRepository');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    S = await startServer();
  });
  after(() => { if (S) S.close(); cleanup(); });

  const adminResolve = (id) => repo.setStatus(id, 'resolved');

  test('ثبت اعتراض ⇒ ۲۰۱ با ردیف اعتراض؛ پیام خالی ⇒ ۴۰۰؛ رکورد دیگران ⇒ ۴۰۴', async () => {
    const u = F.makeUser();
    const other = F.makeUser();
    const rec = (await S.call(other, 'POST', 'check-in', {})).json;
    assert.equal((await S.call(u, 'POST', 'dispute', { attendanceRecordId: rec.id, message: 'x' })).status, 404);
    assert.equal((await S.call(u, 'POST', 'dispute', { message: '   ' })).status, 400);
    const ok = await S.call(u, 'POST', 'dispute', { message: 'اعتراض من' });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.message, 'اعتراض من');
    assert.equal(ok.json.status, 'open');
    assert.equal(repo.listMessages(ok.json.id).length, 1);
  });

  test('فهرست و thread فقط برای مالک؛ دیگران ⇒ ۴۰۴', async () => {
    const u = F.makeUser();
    const other = F.makeUser();
    const d = (await S.call(u, 'POST', 'dispute', { message: 'الف' })).json;
    repo.addMessage({ disputeId: d.id, senderUserId: admin.id, senderRole: 'admin', message: 'پاسخ' });

    const list = await S.call(u, 'GET', 'dispute');
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 1);
    assert.deepEqual([list.json[0].message_count, list.json[0].phase], [2, 'answered']);
    assert.deepEqual((await S.call(other, 'GET', 'dispute')).json, []);

    const thread = await S.call(u, 'GET', `dispute/${d.id}`);
    assert.equal(thread.status, 200);
    assert.deepEqual(thread.json.messages.map((m) => m.sender_role), ['user', 'admin']);
    assert.equal((await S.call(other, 'GET', `dispute/${d.id}`)).status, 404);
    assert.equal((await S.call(other, 'POST', `dispute/${d.id}/messages`, { message: 'نفوذ' })).status, 404);
    assert.equal((await S.call(other, 'POST', `dispute/${d.id}/close`)).status, 404);
    assert.equal((await S.call(u, 'GET', 'dispute/abc')).status, 404);
  });

  test('پیام: ۲۰۱؛ خالی/طولانی ⇒ ۴۰۰؛ اعتراض بسته ⇒ ۴۰۹ DISPUTE_CLOSED', async () => {
    const u = F.makeUser();
    const d = (await S.call(u, 'POST', 'dispute', { message: 'الف' })).json;
    const ok = await S.call(u, 'POST', `dispute/${d.id}/messages`, { message: 'توضیح' });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.dispute.message_count, 2);
    assert.equal((await S.call(u, 'POST', `dispute/${d.id}/messages`, { message: '' })).status, 400);
    assert.equal((await S.call(u, 'POST', `dispute/${d.id}/messages`, { message: 'ا'.repeat(501) })).status, 400);
    adminResolve(d.id);
    const closed = await S.call(u, 'POST', `dispute/${d.id}/messages`, { message: 'هنوز' });
    assert.deepEqual([closed.status, closed.json.code], [409, 'DISPUTE_CLOSED']);
  });

  test('ادامه‌ی اعتراض با سقف و خاتمه توسط کارمند', async () => {
    const u = F.makeUser();
    const d = (await S.call(u, 'POST', 'dispute', { message: 'الف' })).json;
    assert.equal((await S.call(u, 'POST', `dispute/${d.id}/reopen`, { message: 'x' })).json.code, 'DISPUTE_NOT_CLOSED');
    for (let i = 1; i <= 3; i += 1) {
      adminResolve(d.id);
      const r = await S.call(u, 'POST', `dispute/${d.id}/reopen`, { message: `ادامه ${i}` });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      assert.equal(r.json.dispute.reopen_count, i);
    }
    adminResolve(d.id);
    const limit = await S.call(u, 'POST', `dispute/${d.id}/reopen`, { message: 'ادامه ۴' });
    assert.deepEqual([limit.status, limit.json.code], [409, 'REOPEN_LIMIT']);

    const e = (await S.call(u, 'POST', 'dispute', { message: 'دوم' })).json;
    const closed = await S.call(u, 'POST', `dispute/${e.id}/close`);
    assert.equal(closed.status, 200);
    assert.deepEqual([closed.json.dispute.status, closed.json.dispute.closed_by, closed.json.dispute.phase], ['resolved', 'user', 'closed_by_user']);
    const again = await S.call(u, 'POST', `dispute/${e.id}/close`);
    assert.deepEqual([again.status, again.json.code], [409, 'DISPUTE_ALREADY_CLOSED']);
  });

  test('ماه بسته ⇒ ۴۰۹ MONTH_CLOSED', async () => {
    const u = F.makeUser();
    const d = (await S.call(u, 'POST', 'dispute', { message: 'الف' })).json;
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, status, period_from, period_to) VALUES (1300, 1, 'closed', '2000-01-01', '2999-12-31')").run();
    const r = await S.call(u, 'POST', `dispute/${d.id}/messages`, { message: 'x' });
    assert.deepEqual([r.status, r.json.code], [409, 'MONTH_CLOSED']);
    assert.equal((await S.call(u, 'GET', `dispute/${d.id}`)).status, 200);
    db.prepare('DELETE FROM month_closures').run();
  });

  test('rate limit روی ارسال پیام: بیش از ۱۰ پیام در دقیقه ⇒ ۴۲۹ (ادامه‌ی اعتراض هم در همین سطل می‌شمارد)', async () => {
    const u = F.makeUser();
    const d = (await S.call(u, 'POST', 'dispute', { message: 'الف' })).json;
    const statuses = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await S.call(u, 'POST', `dispute/${d.id}/messages`, { message: `پیام ${i}` })).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
    assert.equal(statuses[10], 429);
    assert.equal((await S.call(u, 'POST', `dispute/${d.id}/reopen`, { message: 'x' })).status, 429);
    // خواندن و خاتمه محدود نیست و کاربر دیگر سطل جدا دارد
    assert.equal((await S.call(u, 'GET', `dispute/${d.id}`)).status, 200);
    const v = F.makeUser();
    assert.equal((await S.call(v, 'POST', 'dispute', { message: 'ب' })).status, 201);
  });
});
