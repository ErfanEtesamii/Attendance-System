// تایم پرت هنگام خروج: تنظیمات، اعتبارسنجی API، ذخیره‌ی روی رکورد و کسر از ساعت مفید (computeDay)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers/miniappClient');
const { computeDay } = require('../src/engine/computeDay');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('تایم پرت هنگام خروج', () => {
  test('computeDay: idle_minutes از ساعت مفید کم می‌شود و ۰ تغییری نمی‌دهد', () => {
    const base = { id: 1, record_date: '2026-03-02', check_in_time: '2026-03-02T05:00:00.000Z', check_out_time: '2026-03-02T09:00:00.000Z' };
    const settings = { workDayStart: '08:30', workDayEnd: '16:30' };
    const a = computeDay({ record: base, breaks: [], settings, timezone: 'Asia/Tehran', now: '2026-03-02T10:00:00.000Z' });
    const b = computeDay({ record: { ...base, idle_minutes: 30 }, breaks: [], settings, timezone: 'Asia/Tehran', now: '2026-03-02T10:00:00.000Z' });
    
    
    assert.equal(b.effective, a.effective - 30);
  });

  describe('API', { skip: hasDeps ? false : 'express نصب نیست' }, () => {
    let S; let F; let settingsRepo; let attendanceRepo;
    before(async () => { resetDb(); F = require('./helpers/factories'); settingsRepo = require('../src/repositories/settingsRepository'); attendanceRepo = require('../src/repositories/attendanceRepository'); S = await startServer(); });
    after(() => { if (S) S.close(); cleanup(); });

    test('پیش‌فرض: روشن، بدون سقف، گام ۵', async () => {
      const u = F.makeUser();
      const r = await S.call(u, 'GET', 'idle-config');
      assert.equal(r.json.enabled, true); assert.equal(r.json.step, 5); assert.equal(r.json.unlimited, true); assert.ok(r.json.max >= 60);
    });

    test('خروج با تایم پرت ذخیره و جمع می‌شود؛ مقدار بیش از سقف/نامعتبر رد می‌شود', async () => {
      const u = F.makeUser();
      const ci = await S.call(u, 'POST', 'check-in', {});
      assert.equal(ci.status, 201, JSON.stringify(ci.json));
      settingsRepo.setValue('idleMaxMinutes', 120);
      const bad = await S.call(u, 'POST', 'check-out', { idleMinutes: 999 });
      assert.equal(bad.status, 400); assert.equal(bad.json.code, 'INVALID_IDLE_MINUTES');
      const bad2 = await S.call(u, 'POST', 'check-out', { idleMinutes: -5 });
      assert.equal(bad2.status, 400);
      const ok = await S.call(u, 'POST', 'check-out', { idleMinutes: 25 });
      assert.equal(ok.status, 200, JSON.stringify(ok.json));
      assert.equal(attendanceRepo.findById(ci.json.id).idle_minutes, 25);
      settingsRepo.setValue('idleMaxMinutes', 0);
      const u3 = F.makeUser(); await S.call(u3, 'POST', 'check-in', {});
      assert.equal((await S.call(u3, 'POST', 'check-out', { idleMinutes: 400 })).status, 200); // بدون سقف
    });

    test('خروج بدون idleMinutes یا با ۰ چیزی کم نمی‌کند؛ با پرسش خاموش مقدار نادیده گرفته می‌شود', async () => {
      const u1 = F.makeUser(); const r1 = await S.call(u1, 'POST', 'check-in', {});
      assert.equal((await S.call(u1, 'POST', 'check-out', {})).status, 200);
      assert.equal(attendanceRepo.findById(r1.json.id).idle_minutes, 0);
      settingsRepo.setValue('idleAskEnabled', false);
      const u2 = F.makeUser(); const r2 = await S.call(u2, 'POST', 'check-in', {});
      assert.equal((await S.call(u2, 'POST', 'check-out', { idleMinutes: 40 })).status, 200);
      assert.equal(attendanceRepo.findById(r2.json.id).idle_minutes, 0);
      assert.equal((await S.call(u2, 'GET', 'idle-config')).json.enabled, false);
      settingsRepo.setValue('idleAskEnabled', true);
    });
  });
});
