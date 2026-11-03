// قابلیت‌های جدید ایجنت: عملیات با تأیید انسان، یادداشت‌ها، اکسل، مقایسه، هشدارهای قانون‌محور.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { getDb } = require('../src/db/connection');
const { makeUser } = require('./helpers/factories');
const { runToolAsync, toolDefinitions } = require('../src/services/aiAgent/tools');
const actions = require('../src/services/aiAgent/actions');
const insights = require('../src/services/aiAgent/insights');
const { takeExport } = require('../src/services/aiAgent/moreTools');

const json = (r) => JSON.parse(r.text);

describe('ایجنت: عملیات با تأیید، یادداشت، اکسل، هشدار', () => {
  let admin; let admin2; let emp; let leaveId; let disputeId; let disputeRecId;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین' });
    admin2 = makeUser({ role: 'admin', name: 'ادمین دوم' });
    emp = makeUser({ role: 'employee', name: 'علی' });
    const db = getDb();
    const lt = db.prepare('SELECT id FROM leave_types ORDER BY id LIMIT 1').get();
    leaveId = Number(db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (?, '2099-01-01', '2099-01-01', 'leave', ?)").run(emp.id, lt && lt.id).lastInsertRowid);
    db.prepare("UPDATE leave_requests SET created_at = datetime('now','-3 day') WHERE id = ?").run(leaveId);
    disputeId = Number(db.prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'سلام')").run(emp.id).lastInsertRowid);
    const rec = Number(db.prepare("INSERT INTO attendance_records (user_id, record_date, status) VALUES (?, '2026-01-05', 'incomplete')").run(emp.id).lastInsertRowid);
    disputeRecId = Number(db.prepare('INSERT INTO record_disputes (user_id, attendance_record_id, message) VALUES (?, ?, ?)').run(emp.id, rec, 'خروج').lastInsertRowid);
  });
  after(() => cleanup());

  test('ابزارهای پیشنهادی ثبت شده‌اند و هیچ ابزار اجرایی مستقیم یا مالی ندارند', () => {
    const names = toolDefinitions().map((d) => d.name);
    for (const n of ['propose_leave_decision', 'propose_dispute_reply', 'propose_dispute_close', 'compare_periods', 'export_excel', 'remember_note']) assert.ok(names.includes(n), n);
    assert.ok(!names.some((n) => /^(approve|reject|delete|execute)/.test(n)));
  });

  test('پیشنهاد مرخصی اجرا نمی‌کند؛ فقط ردیف pending می‌سازد', async () => {
    const ctx = { adminUser: admin, pending: [] };
    const r = await runToolAsync(ctx, 'propose_leave_decision', { requestId: leaveId, decision: 'approve' });
    assert.equal(r.isError, false);
    assert.equal(ctx.pending.length, 1);
    assert.equal(getDb().prepare('SELECT status FROM leave_requests WHERE id=?').get(leaveId).status, 'pending');
  });

  test('رد بدون دلیل پذیرفته نمی‌شود', async () => {
    const r = await runToolAsync({ adminUser: admin }, 'propose_leave_decision', { requestId: leaveId, decision: 'reject' });
    assert.equal(r.isError, true);
  });

  test('فقط همان ادمین می‌تواند تأیید کند؛ تأیید دوباره رد می‌شود', () => {
    const p = actions.propose(admin, 'leave_decision', { requestId: leaveId, decision: 'approve' });
    assert.throws(() => actions.confirm(admin2, p.id), actions.ActionError);
    assert.equal(getDb().prepare('SELECT status FROM leave_requests WHERE id=?').get(leaveId).status, 'pending');
    assert.equal(actions.confirm(admin, p.id).ok, true);
    assert.equal(getDb().prepare('SELECT status FROM leave_requests WHERE id=?').get(leaveId).status, 'approved');
    assert.throws(() => actions.confirm(admin, p.id), actions.ActionError);
    assert.ok(getDb().prepare("SELECT 1 FROM audit_log WHERE action='ai_action_executed'").get());
  });

  test('عملیات منقضی یا لغوشده اجرا نمی‌شود', () => {
    const p = actions.propose(admin, 'dispute_reply', { disputeId, message: 'در حال بررسی' });
    getDb().prepare("UPDATE ai_pending_actions SET expires_at = datetime('now','-1 minute') WHERE id=?").run(p.id);
    assert.throws(() => actions.confirm(admin, p.id), /مهلت/);
    const q = actions.propose(admin, 'dispute_reply', { disputeId, message: 'سلام' });
    actions.cancel(admin, q.id);
    assert.throws(() => actions.confirm(admin, q.id), actions.ActionError);
  });

  test('پاسخ به اعتراض پس از تأیید ثبت می‌شود؛ بستن اعتراضِ وابسته به رکورد ممنوع است', () => {
    const p = actions.propose(admin, 'dispute_reply', { disputeId, message: 'بررسی شد' });
    actions.confirm(admin, p.id);
    assert.equal(getDb().prepare("SELECT COUNT(*) c FROM dispute_messages WHERE dispute_id=? AND message='بررسی شد'").get(disputeId).c, 1);
    assert.throws(() => actions.propose(admin, 'dispute_resolve', { disputeId: disputeRecId }), actions.ActionError);
    const c = actions.propose(admin, 'dispute_resolve', { disputeId, note: 'تمام' });
    actions.confirm(admin, c.id);
    assert.equal(getDb().prepare('SELECT status FROM record_disputes WHERE id=?').get(disputeId).status, 'resolved');
  });

  test('یادداشت‌ها: ذخیره، فهرست، حذف و جداسازی بین ادمین‌ها', async () => {
    const ctx = { adminUser: admin };
    const s = json(await runToolAsync(ctx, 'remember_note', { note: 'گزارش‌ها کوتاه باشد' }));
    assert.equal(s.saved, true);
    assert.equal(json(await runToolAsync({ adminUser: admin2 }, 'forget_note', { list: true })).notes.length, 0);
    assert.equal(json(await runToolAsync({ adminUser: admin2 }, 'forget_note', { id: s.id })).deleted, false);
    assert.equal(json(await runToolAsync(ctx, 'forget_note', { id: s.id })).deleted, true);
  });

  const hasExcel = (() => { try { require.resolve('exceljs'); return true; } catch (_) { return false; } })();
  test('اکسل: فایل ساخته می‌شود و فقط صاحبش دانلود می‌کند؛ ابزار مالی رد می‌شود', { skip: !hasExcel && 'exceljs نصب نیست' }, async () => {
    const ctx = { adminUser: admin, files: [] };
    const bad0 = await runToolAsync(ctx, 'export_excel', { tool: 'payroll_summary' });
    assert.equal(bad0.isError, true);
    const bad = await runToolAsync(ctx, 'export_excel', { tool: 'payroll_summary' });
    assert.equal(bad.isError, true);
    const r = await runToolAsync(ctx, 'export_excel', { tool: 'attendance_log', args: { from: '2026-01-01', to: '2026-01-31' }, title: 'تردد' });
    assert.equal(r.isError, false, r.text);
    assert.equal(ctx.files.length, 1);
    const e = takeExport(admin.id, ctx.files[0].token);
    assert.ok(e && fs.statSync(e.file).size > 100);
    assert.equal(takeExport(admin2.id, ctx.files[0].token), null);
  });

  test('هشدارهای قانون‌محور: مرخصی/اعتراض معطل و dedupe روزانه', () => {
    const db = getDb();
    const lt = db.prepare('SELECT id FROM leave_types ORDER BY id LIMIT 1').get();
    const id = Number(db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (?, '2099-02-01', '2099-02-01', 'leave', ?)").run(emp.id, lt && lt.id).lastInsertRowid);
    db.prepare("UPDATE leave_requests SET created_at = datetime('now','-3 day') WHERE id = ?").run(id);
    const found = insights.collect();
    assert.ok(found.some((f) => f.key.startsWith('leave_pending')));
    assert.ok(insights.takeNew(found).length >= 1);
    assert.equal(insights.takeNew(found).length, 0);
  });

  test('agent.chat: حلقه‌ی async ابزار، pending را برمی‌گرداند و چیزی اجرا نمی‌شود', async () => {
    const config = require('../src/config');
    const agent = require('../src/services/aiAgent/agent');
    Object.assign(config.ai, { provider: 'openai', apiKey: 'k', baseUrl: 'http://x/v1', model: 'm' });
    const db = getDb();
    const lt = db.prepare('SELECT id FROM leave_types ORDER BY id LIMIT 1').get();
    const id = Number(db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (?, '2099-03-01', '2099-03-01', 'leave', ?)").run(emp.id, lt && lt.id).lastInsertRowid);
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      const msg = n === 1
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'propose_leave_decision', arguments: JSON.stringify({ requestId: id, decision: 'approve', note: null }) } }] }
        : { role: 'assistant', content: 'منتظر تأیید شماست' };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: msg }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), text: async () => '' };
    };
    const out = await agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'تأیید کن' }], fetchImpl });
    assert.equal(out.pending.length, 1);
    assert.equal(db.prepare('SELECT status FROM leave_requests WHERE id=?').get(id).status, 'pending');
  });
});
