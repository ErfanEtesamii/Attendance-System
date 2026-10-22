// D13: خروجی XLSX/CSV برنامه و گزارش تسک‌ها + شاخص‌های مدیریتی — اسکوپ، محتوا، exportSafety.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const F = require('./helpers/factories');

describe('خروجی و شاخص‌های تسک (D13)', () => {
  let db; let svc; let plans; let logs; let rr; let xlsx; let boss; let a; let b; let other; let admin; let hr;
  const D = '2026-08-03';
  const wk = '2026-08-01';
  const reset = () => db.exec('DELETE FROM report_reviews; DELETE FROM task_daily_logs; DELETE FROM plan_tasks; DELETE FROM weekly_plans;');
  const t = (u, title, status, extra = {}, tx = {}) => { const p = plans.getOrCreate(u.id, wk); const x = plans.addTask(p.id, { title, plannedDate: D, ...tx }); if (status) logs.upsert({ taskId: x.id, userId: u.id, logDate: D, status, ...extra }); return x; };
  const range = { from: '2026-08-01', to: '2026-08-07' };

  before(() => {
    db = resetDb();
    svc = require('../src/services/taskExportService');
    plans = require('../src/repositories/weeklyPlanRepository');
    logs = require('../src/repositories/taskLogRepository');
    rr = require('../src/repositories/reportReviewRepository');
    xlsx = require('../src/utils/xlsx');
    admin = F.makeUser({ role: 'admin', name: 'ادمین' });
    hr = F.makeUser({ role: 'hr' });
    boss = F.makeUser({ role: 'manager', name: 'سرپرست' });
    a = F.makeUser({ managerId: boss.id, name: 'علی' });
    b = F.makeUser({ managerId: boss.id, name: 'بهزاد' });
    other = F.makeUser({ managerId: admin.id, name: 'دیگری' });
  });
  after(cleanup);

  test('شیت‌ها: خلاصه، برنامه، گزارش روزانه با علت/انتقال/مشاهده؛ اسکوپ تیم', () => {
    reset();
    t(a, 'الف', 'done'); t(a, 'ب', 'not_done', { reasonCode: 'no_time', reasonText: 'شلوغ', rescheduleTo: '2026-08-04' }); t(a, 'بیرون', 'done', {}, { systemKey: 'out_of_plan' });
    t(other, 'غیرتیم', 'done');
    plans.markSubmitted(plans.getOrCreate(a.id, wk).id);
    rr.upsert({ reviewerId: boss.id, subjectUserId: a.id, reportDate: D, comment: 'خوب' });
    const r = svc.buildTaskSheets(boss, range);
    assert.deepEqual(r.sheets.map((s) => s.name), ['خلاصه', 'برنامه هفتگی', 'گزارش روزانه']);
    const sum = r.sheets[0].rows.find((x) => x[0] === 'علی');
    assert.deepEqual([sum[3], sum[4], sum[5], sum[6]], [2, 1, 50, 1]);
    const daily = r.sheets[2].rows;
    assert.equal(daily.length, 3);
    const nd = daily.find((x) => x[4] === 'ب');
    assert.deepEqual([nd[6], nd[7], nd[8], nd[9], nd[11], nd[12]], ['انجام نشد', 'وقت نشد', 'شلوغ', '2026-08-04', 'بله', 'خوب']);
    assert.ok(!JSON.stringify(r.sheets).includes('غیرتیم'));
    assert.ok(r.sheets[1].rows.some((x) => x[4] === 'ثبت‌شده'));
    assert.ok(JSON.stringify(svc.buildTaskSheets(admin, range).sheets).includes('غیرتیم'));
    assert.equal(svc.buildTaskSheets(a, range).sheets[2].rows.length, 3, 'کارمند فقط خودش');
  });

  test('اعتبارسنجی بازه و فرد خارج از اسکوپ', () => {
    assert.equal(svc.buildTaskSheets(boss, { from: '2026-08-09', to: '2026-08-01' }).code, 'INVALID_RANGE');
    assert.equal(svc.buildTaskSheets(boss, { from: 'x', to: '2026-08-01' }).code, 'INVALID_DATE');
    assert.equal(svc.buildTaskSheets(boss, { from: '2026-01-01', to: '2026-08-01' }).code, 'RANGE_TOO_LONG');
    assert.equal(svc.buildTaskSheets(boss, { ...range, userId: other.id }).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal(svc.buildTaskSheets(a, { ...range, userId: b.id }).code, 'SUBJECT_NOT_IN_SCOPE');
    assert.equal(svc.buildTaskSheets(hr, range).ok, true);
  });

  test('exportSafety: عنوان/علت/کامنت با = یا + شروع شوند در فایل با «\'» خنثی می‌شوند', async () => {
    reset();
    t(a, '=HYPERLINK("http://x")', 'not_done', { reasonCode: 'other', reasonText: '+cmd' });
    const r = svc.buildTaskSheets(boss, range);
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, send(b2) { this.body = b2; return this; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; } };
    if (!xlsx.isAvailable()) { assert.ok(true, 'exceljs نیست: fallback CSV'); return; }
    await xlsx.sendSheets({ query: { format: 'xlsx' } }, res, 'task-reports.csv', r.sheets, {});
    assert.match(String(res.headers['Content-Type']), /spreadsheetml/);
    const wb = xlsx.buildWorkbook({ sheets: r.sheets });
    const ws = wb.getWorksheet('گزارش روزانه');
    const vals = ws.getRow(2).values.map(String);
    assert.ok(vals.some((v) => v.startsWith("'=HYPERLINK")));
    assert.ok(vals.some((v) => v === "'+cmd"));
  });

  test('KPI: نرخ انجام تیم، بررسی به‌موقع، برنامه‌ی ثبت‌نشده؛ اسکوپ نقش', () => {
    reset();
    t(a, 'الف', 'done'); t(a, 'ب', 'not_done', { reasonCode: 'no_time' }); t(b, 'ج', 'done');
    // علی: مشاهده‌ی به‌موقع (همان روز)؛ بهزاد: مشاهده‌نشده
    rr.upsert({ reviewerId: boss.id, subjectUserId: a.id, reportDate: D });
    db.prepare("UPDATE report_reviews SET reviewed_at = ? WHERE reviewer_id = ? AND subject_user_id = ?").run('2026-08-03T16:00:00.000Z', boss.id, a.id);
    const k = svc.taskKpis(admin, range);
    const team = k.teams.find((x) => x.managerId === boss.id);
    assert.deepEqual([team.planned, team.done, team.completionRate], [3, 2, 67]);
    const rv = k.reviewers.find((x) => x.reviewerId === boss.id);
    assert.deepEqual([rv.reports, rv.reviewed, rv.onTime, rv.onTimeRate], [2, 1, 1, 50]);
    assert.ok(k.unplanned.count >= 3);
    const kb = svc.taskKpis(boss, range);
    assert.deepEqual(kb.teams.map((x) => x.managerId), [boss.id]);
    assert.ok(!kb.unplanned.users.some((u) => u.userId === other.id));
  });

  test('KPI: پیش‌نویسِ تنظیم‌شده توسط سرپرست unplanned نیست و جداگانه گزارش می‌شود', () => {
    reset();
    const next = plans.getOrCreate(a.id, '2026-08-08');
    plans.addTask(next.id, { title: 'تسک سرپرست', managerLocked: true, editedByUserId: boss.id });
    const k = svc.taskKpis(admin, range);
    assert.ok(!k.unplanned.users.some((u) => u.userId === a.id));
    assert.ok(k.managerConfiguredNotSubmitted.users.some((u) => u.userId === a.id));
  });

  test('مسیرها: دسترسی در ماتریس مجوز (E/M/A) و hr فقط‌خواندنی', () => {
    const { hasPermission } = require('../src/middleware/permissions');
    assert.equal(hasPermission('employee', 'taskreports.read'), true);
    assert.equal(hasPermission('employee', 'analytics.read'), false);
    assert.equal(hasPermission('hr', 'analytics.read'), true);
  });
});
