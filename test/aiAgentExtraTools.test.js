// ابزارهای تکمیلی ایجنت (extraTools): اسکوپ سرپرست، نبودن داده‌ی مالی، اعتبارسنجی ورودی، تبدیل null مدل، و تلاش دوباره روی 429.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const usersRepo = require('../src/repositories/usersRepository');
const { getDb } = require('../src/db/connection');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');
const config = require('../src/config');
const { runTool, toolDefinitions } = require('../src/services/aiAgent/tools');
const agent = require('../src/services/aiAgent/agent');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const json = (r) => JSON.parse(r.text);

describe('ابزارهای تکمیلی ایجنت', () => {
  let admin; let manager; let mine; let other;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین' });
    manager = makeUser({ role: 'manager', name: 'سرپرست', department: 'فنی' });
    mine = makeUser({ role: 'employee', name: 'علی تیمی', department: 'فنی', managerId: manager.id });
    other = makeUser({ role: 'employee', name: 'رضا بیرونی', department: 'فروش' });
    for (const u of usersRepo.listUsers({})) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    const ins = getDb().prepare("INSERT INTO attendance_records (user_id, record_date, check_in_time, check_out_time, status) VALUES (?, ?, ?, ?, 'normal')");
    ins.run(mine.id, '2026-08-23', at('2026-08-23', '08:40'), at('2026-08-23', '17:30'));
    ins.run(other.id, '2026-08-23', at('2026-08-23', '09:00'), at('2026-08-23', '17:00'));
    getDb().prepare('UPDATE users SET hourly_rate_kt = 99999 WHERE id = ?').run(mine.id);
    getDb().prepare("INSERT INTO record_disputes (user_id, message) VALUES (?, 'اعتراض خصوصی دیگران')").run(other.id);
  });
  after(() => cleanup());

  test('ابزارهای جدید ثبت شده‌اند و هیچ‌کدام نام نوشتن/حقوق ندارند', () => {
    const names = toolDefinitions().map((d) => d.name);
    for (const n of ['attendance_log', 'remote_work', 'tasks_overview', 'leave_requests', 'disputes', 'overtime_decisions', 'shifts_holidays', 'suspicious_events', 'org_overview', 'panel_settings', 'audit_trail', 'system_status', 'checkin_permissions', 'panel_guide']) assert.ok(names.includes(n), n);
    assert.ok(!names.some((n) => n !== 'payroll_summary' && /payroll|salary|create|update|delete|write/i.test(n)));
  });

  test('attendance_log: ریز روزانه با ساعت به وقت شرکت و بدون نرخ ساعتی', () => {
    const r = runTool({ adminUser: admin }, 'attendance_log', { userId: mine.id, from: '2026-08-20', to: '2026-08-25' });
    assert.equal(r.isError, false);
    const out = json(r);
    assert.equal(out.records.length, 1);
    assert.equal(out.records[0].in, '08:40');
    assert.equal(out.records[0].out, '17:30');
    assert.ok(!/hourly|99999/i.test(r.text));
  });

  test('اسکوپ سرپرست: فقط تیم خودش؛ کارمند بیرونی رد می‌شود', () => {
    const ctx = { adminUser: manager };
    // سرپرست مجوز performance.read ندارد ⇒ خطای مجوز (هیچ داده‌ای نشت نمی‌کند)
    const r = runTool(ctx, 'attendance_log', { userId: other.id, from: '2026-08-20', to: '2026-08-25' });
    assert.equal(r.isError, true);
    assert.ok(!r.text.includes('رضا'));
  });

  test('disputes و بقیه: خروجی فشرده و اعتبارسنجی بازه', () => {
    const d = runTool({ adminUser: admin }, 'disputes', { from: '2020-01-01', to: '2030-01-01' });
    assert.equal(d.isError, true); // بازه‌ی بیش از ۹۳ روز
    const today = new Date().toISOString().slice(0, 10);
    const ok = runTool({ adminUser: admin }, 'disputes', { from: today, to: today });
    assert.equal(ok.isError, false);
    assert.ok(ok.text.length < 9100);
    const bad = runTool({ adminUser: admin }, 'attendance_log', { from: 'x' });
    assert.equal(bad.isError, true);
  });

  test('payroll_summary: فقط با مجوز و سوییچ؛ نرخ فقط از همین ابزار می‌آید؛ هر بار audit ثبت می‌شود', () => {
    const saved = config.ai.allowPayroll;
    try {
      config.ai.allowPayroll = true;
      const r = runTool({ adminUser: admin }, 'payroll_summary', { year: 1405, month: 6, userId: mine.id });
      assert.equal(r.isError, false, r.text);
      const out = json(r);
      assert.equal(out.rows[0].rateKt, 99999);
      assert.ok('amountToman' in out.rows[0]);
      const n = getDb().prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payroll_viewed'").get().n;
      assert.ok(n >= 1);
      // سرپرست مجوز payroll.read ندارد
      assert.equal(runTool({ adminUser: manager }, 'payroll_summary', { year: 1405, month: 6 }).isError, true);
      // ابزارهای دیگر هنوز نرخ نمی‌دهند
      assert.ok(!/99999|rateKt/.test(runTool({ adminUser: admin }, 'org_overview', {}).text));
      assert.ok(!/99999/.test(runTool({ adminUser: admin }, 'attendance_log', { userId: mine.id, from: '2026-08-20', to: '2026-08-25' }).text));
      // خاموش‌کردن: ابزار از تعریف‌ها حذف و اجرا رد می‌شود
      config.ai.allowPayroll = false;
      assert.ok(!toolDefinitions().some((d) => d.name === 'payroll_summary'));
      assert.equal(runTool({ adminUser: admin }, 'payroll_summary', { year: 1405, month: 6 }).isError, true);
      config.ai.allowPayroll = true;
      assert.ok(toolDefinitions().some((d) => d.name === 'payroll_summary'));
    } finally { config.ai.allowPayroll = saved; }
  });

  test('ابزارهای پنل: org_overview, panel_settings, audit_trail, system_status, checkin_permissions', () => {
    const ctx = { adminUser: admin };
    const org = json(runTool(ctx, 'org_overview', {}));
    assert.ok(org.active >= 4 && org.byDepartment['فنی'] >= 2);
    const st = runTool(ctx, 'panel_settings', { group: 'workHours' });
    assert.equal(st.isError, false);
    assert.ok(json(st).count >= 1);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(runTool(ctx, 'audit_trail', { from: today, to: today }).isError, false);
    assert.equal(runTool(ctx, 'system_status', {}).isError, false);
    assert.equal(runTool(ctx, 'checkin_permissions', { from: today, to: today }).isError, false);
    assert.equal(runTool({ adminUser: manager }, 'audit_trail', {}).isError, true);
  });

  test('panel_guide: هر صفحه‌ی دارای منو در پنل راهنما دارد و جست‌وجو درست جواب می‌دهد', () => {
    const fs = require('fs'); const path = require('path');
    const dir = path.join(__dirname, '..', 'public-admin', 'js');
    const guideTitles = require('../src/services/aiAgent/panelGuide').ENTRIES.map((e) => `${e.title} ${e.path}`).join('\n');
    for (const f of fs.readdirSync(dir).filter((n) => /^views-.*\.js$/.test(n))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/nav:\s*\{[^}]*label:\s*'([^']+)'/g)) assert.ok(guideTitles.includes(m[1]), `راهنما برای صفحه‌ی «${m[1]}» (${f}) نیست`);
    }
    const g = (q) => json(runTool({ adminUser: admin }, 'panel_guide', { query: q }));
    assert.equal(g('حقوق کارمندان کجاست؟').matches[0].id, 'payroll');
    assert.deepEqual(g('حقوق و دستمزد').matches[0].who, ['ادمین']);
    assert.equal(g('چطور کارمند جدید اضافه کنم').matches[0].id, 'employees');
    assert.equal(g('نرخ ساعتی رو کجا عوض کنم').matches[0].id, 'profile');
    assert.equal(g('تعطیلات رو کجا ثبت کنم').matches[0].id, 'holidays');
    assert.equal(g('بستن ماه').matches[0].kind, 'فقط API (در پنل صفحه ندارد)');
    assert.deepEqual(g('xyzqq').matches, []);
    assert.ok(Object.keys(g('').menu).length >= 4);
    assert.ok(runTool({ adminUser: admin }, 'panel_guide', { query: 'تعطیلات' }).text.length < 3000);
  });

  test('مقدار null پارامتر اختیاری از مدل نادیده گرفته می‌شود و روی 429 صبر و تکرار می‌کند', async () => {
    const saved = { provider: config.ai.provider, baseUrl: config.ai.baseUrl, model: config.ai.model, apiKey: config.ai.apiKey };
    Object.assign(config.ai, { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'm', apiKey: 'k' });
    try {
      const replies = [
        { status: 429 },
        { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_employees', arguments: '{"department":null}' } }] } }], usage: {} },
        { choices: [{ message: { role: 'assistant', content: 'تمام' } }], usage: {} },
      ];
      const bodies = [];
      const fake = async (url, init) => {
        bodies.push(JSON.parse(init.body));
        const next = replies.shift();
        if (next.status) return { ok: false, status: 429, headers: { get: () => '0.01' }, text: async () => 'try again in 10ms', json: async () => ({}) };
        return { ok: true, status: 200, json: async () => next };
      };
      const r = await agent.chat({ adminUser: admin, messages: [{ role: 'user', content: 'سلام' }], fetchImpl: fake });
      assert.equal(r.reply, 'تمام');
      assert.equal(r.tools[0].name, 'list_employees');
      assert.equal(r.tools[0].ok, true);
      // پارامترهای اختیاری برای مدل nullable اعلام می‌شوند
      const dep = bodies[0].tools.find((t) => t.function.name === 'list_employees').function.parameters.properties.department;
      assert.deepEqual(dep.type, ['string', 'null']);
    } finally { Object.assign(config.ai, saved); }
  });
});
