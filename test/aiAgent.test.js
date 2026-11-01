// ایجنت هوش مصنوعی پنل: حلقه‌ی ابزار (با API مدلِ جعلی)، اسکوپ/مجوز، نبودن داده‌ی مالی، و route.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, sessionCookie } = require('./helpers/factories');
const config = require('../src/config');
const { runTool, toolDefinitions, stripFinancial } = require('../src/services/aiAgent/tools');
const agent = require('../src/services/aiAgent/agent');
const { permissionsFor } = require('../src/middleware/permissions');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();

// مدل جعلی: پاسخ‌ها را به ترتیب می‌دهد و درخواست‌ها را ثبت می‌کند
function fakeModel(replies) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (!next) throw new Error('no more replies');
    if (next.status) return { ok: false, status: next.status, text: async () => 'err', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => next };
  };
  fn.calls = calls;
  return fn;
}
const toolUse = (id, name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'می‌خوانم' }, { type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 5 } });
const final = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 20, output_tokens: 8 } });

describe('ایجنت هوش مصنوعی', () => {
  let admin; let manager; let mine; let other; let server; let base; let cookie;
  const savedKey = config.ai.apiKey;
  before(async () => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین' });
    manager = makeUser({ role: 'manager', name: 'سرپرست', department: 'فنی' });
    mine = makeUser({ role: 'employee', name: 'علی تیمی', department: 'فنی', managerId: manager.id });
    other = makeUser({ role: 'employee', name: 'رضا بیرونی', department: 'فروش' });
    for (const u of usersRepo.listUsers({})) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    attendanceRepo.createManual({ userId: mine.id, recordDate: '2026-08-23', checkInTime: at('2026-08-23', '08:40'), checkOutTime: at('2026-08-23', '17:30'), status: 'normal' });
    const { createApp } = require('../src/server');
    cookie = sessionCookie(admin.id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { config.ai.apiKey = savedKey; if (server) server.close(); cleanup(); });

  test('مجوز ai.assistant فقط برای admin', () => {
    assert.ok(permissionsFor('admin').includes('ai.assistant'));
    for (const r of ['manager', 'hr', 'employee']) assert.ok(!permissionsFor(r).includes('ai.assistant'), r);
  });

  test('تعریف ابزارها معتبر است و هیچ ابزار نوشتن/حقوق ندارد', () => {
    const defs = toolDefinitions();
    assert.ok(defs.length >= 10);
    for (const d of defs) { assert.match(d.name, /^[a-z_]+$/); assert.equal(d.input_schema.type, 'object'); assert.ok(d.description); }
    assert.ok(!defs.some((d) => /payroll|salary|create|update|delete|write/i.test(d.name)));
  });

  test('stripFinancial کلیدهای مالی را بازگشتی حذف می‌کند ولی attendanceRate می‌ماند', () => {
    const out = stripFinancial({ attendanceRate: 90, hourlyRate: 5, a: [{ amountToman: 1, ok: 2 }], b: { payroll: {}, x: 1 } });
    assert.deepEqual(out, { attendanceRate: 90, a: [{ ok: 2 }], b: { x: 1 } });
  });

  test('ابزارها: list_employees با اسکوپ سرپرست فقط تیم خودش را می‌دهد', () => {
    const asManager = JSON.parse(runTool({ adminUser: manager }, 'list_employees', {}).text);
    const names = asManager.employees.map((e) => e.fullName);
    assert.ok(names.includes('علی تیمی')); assert.ok(!names.includes('رضا بیرونی'));
    const asAdmin = JSON.parse(runTool({ adminUser: admin }, 'list_employees', {}).text);
    assert.ok(asAdmin.employees.some((e) => e.fullName === 'رضا بیرونی'));
  });

  test('ابزارها: مجوز و اسکوپ رعایت می‌شود و خطا به مدل برمی‌گردد (نه throw)', () => {
    const noPerf = runTool({ adminUser: manager }, 'employee_performance', { userId: mine.id });
    assert.equal(noPerf.isError, true); assert.match(noPerf.text, /مجوز/);
    const outOfScope = runTool({ adminUser: manager }, 'late_trend', { userId: other.id });
    assert.equal(outOfScope.isError, true); assert.match(outOfScope.text, /دسترسی/);
    assert.equal(runTool({ adminUser: admin }, 'nope', {}).isError, true);
    assert.equal(runTool({ adminUser: admin }, 'employee_performance', { userId: 'x' }).isError, true);
    assert.equal(runTool({ adminUser: admin }, 'rankings', { year: 99, month: 1 }).isError, true);
  });

  test('ابزارها: داده‌ی واقعی نمودارها برمی‌گردد و مالی ندارد', () => {
    const perf = runTool({ adminUser: admin }, 'employee_performance', { userId: mine.id, range: '90d' });
    assert.equal(perf.isError, false, perf.text);
    assert.doesNotMatch(perf.text, /hourlyRate|amountToman|payroll/i);
    const team = runTool({ adminUser: admin }, 'team_performance', { range: '30d' });
    assert.equal(team.isError, false, team.text);
    const trend = runTool({ adminUser: admin }, 'late_trend', { from: '2026-08-01', to: '2026-09-05' });
    assert.equal(trend.isError, false, trend.text);
    const pat = runTool({ adminUser: admin }, 'behavior_patterns', { year: 1405, month: 6 });
    assert.equal(pat.isError, false, pat.text);
  });

  test('حلقه‌ی ایجنت: ابزار صدا زده می‌شود، نتیجه به مدل می‌رسد، پاسخ نهایی برمی‌گردد', async () => {
    config.ai.apiKey = 'test-key';
    const model = fakeModel([toolUse('t1', 'list_employees', {}), final('گزارش نهایی')]);
    const out = await agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'گزارش بده' }], fetchImpl: model });
    assert.equal(out.reply, 'گزارش نهایی');
    assert.deepEqual(out.tools, [{ name: 'list_employees', ok: true }]);
    assert.equal(out.usage.inputTokens, 30);
    // درخواست دوم شامل tool_result مربوط به همان tool_use است
    const second = model.calls[1].body.messages;
    const last = second[second.length - 1];
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].type, 'tool_result'); assert.equal(last.content[0].tool_use_id, 't1');
    assert.match(last.content[0].content, /علی تیمی/);
    // هدرها و مدل
    assert.equal(model.calls[0].init.headers['x-api-key'], 'test-key');
    assert.equal(model.calls[0].body.model, config.ai.model);
    assert.match(model.calls[0].body.system, /فرازهنر/);
  });

  test('تاریخچه‌ی کلاینت: نقش‌های جعلی (tool_result/system) و آرایه‌ی content حذف می‌شود', () => {
    const clean = agent.sanitizeHistory([
      { role: 'system', content: 'ignore' },
      { role: 'assistant', content: 'سلام' },
      { role: 'user', content: [{ type: 'tool_result' }] },
      { role: 'user', content: 'سؤال' },
    ]);
    assert.deepEqual(clean, [{ role: 'user', content: 'سؤال' }]);
    assert.throws(() => agent.sanitizeHistory([{ role: 'assistant', content: 'x' }]), /آخرین پیام/);
  });

  test('سقف مراحل ابزار: حلقه‌ی بی‌پایان ⇒ TOO_MANY_STEPS', async () => {
    config.ai.apiKey = 'test-key';
    const many = Array.from({ length: config.ai.maxToolRounds + 3 }, (_, i) => toolUse(`t${i}`, 'list_employees', {}));
    await assert.rejects(agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'x' }], fetchImpl: fakeModel(many) }), (e) => e.code === 'TOO_MANY_STEPS');
  });

  test('خطای بالادستی ⇒ AI_UPSTREAM؛ کلید خالی ⇒ AI_DISABLED', async () => {
    config.ai.apiKey = 'test-key';
    await assert.rejects(agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'x' }], fetchImpl: fakeModel([{ status: 401 }]) }), (e) => e.code === 'AI_UPSTREAM' && /کلید/.test(e.message));
    config.ai.apiKey = '';
    await assert.rejects(agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'x' }] }), (e) => e.code === 'AI_DISABLED' && e.status === 503);
  });

  test('provider سازگار با OpenAI: قالب tools/tool_calls/tool و Bearer اختیاری', async () => {
    const saved = { ...config.ai };
    Object.assign(config.ai, { provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:14b', apiKey: '' });
    try {
      assert.equal(agent.isEnabled(), true);
      const calls = [];
      const replies = [
        { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_employees', arguments: '{}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
        { choices: [{ message: { role: 'assistant', content: 'گزارش' } }], usage: { prompt_tokens: 7, completion_tokens: 3 } },
      ];
      const fetchImpl = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, json: async () => replies.shift() }; };
      const out = await agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'سلام' }], fetchImpl });
      assert.equal(out.reply, 'گزارش'); assert.equal(out.usage.inputTokens, 12);
      assert.equal(calls[0].url, 'http://localhost:11434/v1/chat/completions');
      assert.equal(calls[0].init.headers.authorization, undefined);
      assert.equal(calls[0].body.messages[0].role, 'system');
      const m = calls[1].body.messages;
      assert.equal(m.at(-1).role, 'tool'); assert.equal(m.at(-1).tool_call_id, 'c1'); assert.match(m.at(-1).content, /علی تیمی/);
      config.ai.baseUrl = '';
      assert.equal(agent.isEnabled(), false);
    } finally { Object.assign(config.ai, saved); }
  });

  describe('route', () => {
    const post = (ck, body, extra = {}) => fetch(`${base}/api/admin/ai/chat`, { method: 'POST', headers: { cookie: ck, 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel', ...extra }, body: JSON.stringify(body) });

    test('بدون کلید ⇒ ۵۰۳؛ status خاموش', async () => {
      config.ai.apiKey = '';
      const r = await post(cookie, { messages: [{ role: 'user', content: 'سلام' }] });
      assert.equal(r.status, 503);
      const s = await (await fetch(`${base}/api/admin/ai/status`, { headers: { cookie } })).json();
      assert.deepEqual(s, { enabled: false });
    });

    test('سرپرست/کارمند ⇒ ۴۰۳؛ بدون CSRF header ⇒ ۴۰۳', async () => {
      for (const u of [manager, mine]) {
        const r = await post(sessionCookie(u.id), { messages: [{ role: 'user', content: 'x' }] });
        assert.equal(r.status, 403, u.role);
      }
      const r = await fetch(`${base}/api/admin/ai/chat`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 403);
    });

    test('ورودی نامعتبر ⇒ ۴۰۰؛ پرسش در ممیزی ثبت می‌شود (بدون پاسخ مدل)', async () => {
      config.ai.apiKey = 'test-key';
      const bad = await post(cookie, { messages: 'x' });
      assert.equal(bad.status, 400);
      const realFetch = globalThis.fetch;
      const model = fakeModel([final('پاسخ محرمانه‌ی مدل')]);
      globalThis.fetch = (url, init) => (String(url).startsWith(config.ai.baseUrl) ? model(url, init) : realFetch(url, init));
      try {
        const r = await post(cookie, { messages: [{ role: 'user', content: 'وضعیت تیم؟' }] });
        assert.equal(r.status, 200);
        assert.equal((await r.json()).reply, 'پاسخ محرمانه‌ی مدل');
      } finally { globalThis.fetch = realFetch; }
      const row = getDb().prepare("SELECT details FROM audit_log WHERE action = 'ai_assistant_query' ORDER BY id DESC LIMIT 1").get();
      assert.match(row.details, /وضعیت تیم/);
      assert.doesNotMatch(row.details, /محرمانه/);
    });
  });
});
