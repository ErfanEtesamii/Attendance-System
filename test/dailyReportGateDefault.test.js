// R1 (فاز ۱۵): پرسش وضعیت تسک‌های همان روز هنگام خروج به‌صورت پیش‌فرض روشن است (enforce).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

const WEEK = '2026-08-01'; // شنبه
const MON = '2026-08-03';

describe('گیت خروج — پیش‌فرض روشن (R1)', () => {
  let db; let svc; let plans; let settings; let u;
  before(() => {
    db = resetDb();
    svc = require('../src/services/taskReportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    settings = require('../src/repositories/settingsRepository');
    u = F.makeUser();
  });
  after(cleanup);

  test('DB تازه: dailyReportGateMode پیش‌فرض enforce و تسکِ بی‌پاسخ ⇒ block', () => {
    db.exec("DELETE FROM settings WHERE key IN ('daily_report_gate_mode', 'plan_gate_start_date')");
    assert.equal(settings.getAll().dailyReportGateMode, 'enforce');
    plans.addTask(plans.getOrCreate(u.id, WEEK).id, { title: 'الف', plannedDate: MON });
    const g = svc.checkoutGate(u, MON, {});
    assert.equal(g.action, 'block');
    assert.equal(g.pendingTasks.length, 1);
  });

  test('پیام ۴۰۹ صریح است: وضعیت را مشخص کن و علت انجام‌نشدن را بنویس', () => {
    const g = svc.checkoutGate(u, MON, {});
    const msg = svc.blockMessage(g.pendingTasks);
    assert.match(msg, /^برای ثبت خروج/);
    assert.match(msg, /وضعیت تسک‌های امروزتان را مشخص کنید/);
    assert.match(msg, /علت/);
    assert.match(svc.blockMessage([]), /علتش را بنویسید/);
  });

  test('قبل از planGateStartDate سؤالی پرسیده نمی‌شود؛ از آن تاریخ به بعد می‌پرسد', () => {
    settings.setValue('planGateStartDate', '2026-08-10');
    assert.equal(svc.checkoutGate(u, MON, {}).action, 'allow');
    settings.setValue('planGateStartDate', '2026-08-03');
    assert.equal(svc.checkoutGate(u, MON, {}).action, 'block');
    db.exec("DELETE FROM settings WHERE key = 'plan_gate_start_date'");
  });

  test('off ⇒ هیچ سؤالی؛ soft ⇒ remind', () => {
    settings.setValue('dailyReportGateMode', 'off');
    assert.equal(svc.checkoutGate(u, MON, {}).action, 'allow');
    settings.setValue('dailyReportGateMode', 'soft');
    assert.equal(svc.checkoutGate(u, MON, {}).action, 'remind');
    settings.setValue('dailyReportGateMode', 'enforce');
  });
});
