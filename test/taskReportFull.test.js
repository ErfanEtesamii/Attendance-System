// خروجی کامل تسک‌ها (Excel): وضعیت/توضیح/علت، «پاسخ داده نشده»، خلاصه‌ی افراد و تیم‌ها، کل مجموعه، اسکوپ نقش.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('گزارش کامل تسک‌ها', () => {
  let db; let svc; let plans; let logs; let xlsx; let boss; let a; let b; let other; let admin;
  const D = '2026-08-03';
  const wk = '2026-08-01';
  const range = { from: '2026-08-01', to: '2026-08-07' };
  const NOW = new Date('2026-08-10T08:00:00Z');
  const t = (u, title, status, extra = {}, tx = {}) => { const p = plans.getOrCreate(u.id, wk); const x = plans.addTask(p.id, { title, plannedDate: D, ...tx }); if (status) logs.upsert({ taskId: x.id, userId: u.id, logDate: D, status, ...extra }); return x; };

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskExportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    xlsx = require('../src/utils/xlsx');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    b = F.makeUser({ managerId: boss.id, name: 'بهزاد' });
    other = F.makeUser({ managerId: admin.id, name: 'دیگری' });
    db.exec('DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans;');
    t(a, 'الف', 'done', { note: 'تحویل شد' });
    t(a, 'ب', 'not_done', { reasonCode: 'no_time', reasonText: 'شلوغ بود', rescheduleTo: '2026-08-04' });
    t(a, 'بدون پاسخ', null);
    t(b, 'ج', 'partial', { reasonCode: 'blocked_by_others' });
    t(other, 'غیرتیم', 'done');
  });
  after(cleanup);

  // کارتکس: «ریز تسک‌ها» برای هر کارمند در شیت اختصاصی خودش (بدون ستون نام/دپارتمان)؛ خلاصه‌ها تخت‌اند
  const perPerson = (r) => r.sheets.filter((x) => x.tableTitle === 'ریز تسک‌ها');
  const detail = (r) => perPerson(r).flatMap((x) => x.rows);
  const byName = (r, n) => r.sheets.find((x) => x.name === n);

  test('ریز تسک‌ها: وضعیت، توضیح انجام، علت و پاسخ‌نداده‌ها', () => {
    const r = svc.buildTaskReportSheets(boss, range, { now: NOW });
    assert.ok(r.ok, JSON.stringify(r));
    assert.deepEqual(r.sheets.slice(0, 2).map((s) => s.name), ['خلاصه افراد', 'خلاصه تیم‌ها']);
    assert.ok(perPerson(r).length >= 2, 'یک شیت برای هر کارمند');
    assert.ok(!perPerson(r)[0].headers.includes('نام') && !perPerson(r)[0].headers.includes('دپارتمان'), 'بدون تکرار نام/دپارتمان');
    const rows = detail(r);
    const H = perPerson(r)[0].headers;
    const col = (n) => H.indexOf(n);
    assert.equal(rows.length, 4, 'سه تسک پاسخ‌داده + یک پاسخ‌نداده؛ فقط تیم سرپرست');
    const done = rows.find((x) => x[col('تسک')] === 'الف');
    assert.equal(done[col('وضعیت')], 'انجام شد');
    assert.equal(done[col('توضیح انجام')], 'تحویل شد');
    const nd = rows.find((x) => x[col('تسک')] === 'ب');
    assert.equal(nd[col('وضعیت')], 'انجام نشد');
    assert.equal(nd[col('علت انجام‌نشدن')], 'وقت نشد');
    assert.equal(nd[col('توضیح علت')], 'شلوغ بود');
    assert.equal(rows.find((x) => x[col('تسک')] === 'بدون پاسخ')[col('وضعیت')], 'پاسخ داده نشده');
    assert.ok(!JSON.stringify(r.sheets).includes('غیرتیم'));
  });

  test('خلاصه‌ی افراد و تیم‌ها + ردیف «کل مجموعه» برای ادمین', () => {
    const r = svc.buildTaskReportSheets(admin, range, { now: NOW });
    const teams = byName(r, 'خلاصه تیم‌ها').rows;
    const total = teams[teams.length - 1];
    assert.equal(total[0], 'کل مجموعه');
    assert.equal(total[2], 5, 'کل تسک‌ها');
    assert.equal(total[3], 2, 'انجام‌شده');
    assert.equal(total[6], 1, 'پاسخ داده نشده');
    const ali = byName(r, 'خلاصه افراد').rows.find((x) => x[0] === 'علی');
    assert.deepEqual(ali.slice(3, 9), [3, 1, 0, 1, 1, 33]);
    assert.ok(teams.some((x) => x[0] === 'تیم سرپرست' && x[1] === 2));
  });

  test('فیلتر تیم/فرد و اسکوپ', () => {
    const team = svc.buildTaskReportSheets(admin, { ...range, managerId: boss.id }, { now: NOW });
    assert.equal(detail(team).length, 4);
    const one = svc.buildTaskReportSheets(admin, { ...range, userId: b.id }, { now: NOW });
    assert.equal(detail(one).length, 1);
    assert.equal(svc.buildTaskReportSheets(boss, { ...range, managerId: admin.id }, { now: NOW }).ok, false, 'سرپرست تیم دیگری را نمی‌بیند');
    assert.equal(detail(svc.buildTaskReportSheets(a, range, { now: NOW })).length, 3, 'کارمند فقط خودش');
  });

  test('روزهای آینده «پاسخ داده نشده» نمی‌شوند و Excel ساخته می‌شود', () => {
    const early = svc.buildTaskReportSheets(admin, range, { now: new Date('2026-08-02T08:00:00Z') });
    assert.ok(!detail(early).some((x) => x.includes('پاسخ داده نشده')));
    if (!xlsx.isAvailable()) return; // exceljs نصب نیست ⇒ فقط ساخت داده بررسی می‌شود (route در این حالت CSV می‌دهد)
    assert.ok(xlsx.buildWorkbook({ sheets: svc.buildTaskReportSheets(admin, range, { now: NOW }).sheets }));
  });
});
