// R7 (فاز ۱۴): گزارش‌ها — pending/rejected هرگز در گزارش ماهانه/خروجی نمی‌آیند؛ پس از تأیید شمرده و «دورکاری» برچسب می‌خورند.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('گزارش‌ها و دورکاری (R7)', () => {
  let repo; let svc; let emp; let mgr; let rpt; let sheets;
  const dates = require('../src/utils/jalali').jalaliMonthDates(1405, 6); // شهریور ۱۴۰۵
  const D = dates[11]; const D2 = dates[12];
  const now = new Date('2026-09-20T10:00:00Z');
  const run = () => rpt.computeMonthlyReport({ users: [require('../src/repositories/usersRepository').findById(emp.id)], year: 1405, month: 6, now, includeDays: true });
  const mk = (d, s, e) => { const x = repo.insertSession({ userId: emp.id, workDate: d, startAt: `${d}T${s}.000Z`, ip: '203.0.113.9' }); repo.closeSession(x.id, `${d}T${e}.000Z`); return x.id; };
  const strip = (r) => JSON.stringify({ ...r.users[0], remote: undefined, days: r.users[0].days.map(({ viaRemote, remoteMinutes, ...d }) => d) });

  before(() => {
    resetDb();
    const F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    rpt = require('../src/services/monthlyReportService');
    sheets = require('../src/services/monthlyExportService');
    mgr = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
  });
  after(() => cleanup());

  test('pending و rejected هیچ اثری روی گزارش ندارند', () => {
    const before0 = run();
    const a = mk(D, '05:00:00', '09:00:00');
    const b = mk(D2, '05:00:00', '09:00:00');
    assert.equal(strip(run()), strip(before0));
    assert.equal(run().users[0].remote.approvedMinutes, 0);
    assert.ok(svc.reject(mgr, b, { reviewNote: 'نامعتبر' }, { now }).ok);
    const after0 = run();
    assert.equal(strip(after0), strip(before0));
    assert.equal(after0.totals.remote.approvedDays, 0);
    const main = sheets.buildMonthlySheets(after0)[0];
    const i = main.headers.indexOf('دقیقه دورکاری تأییدشده');
    assert.ok(i > 0);
    assert.equal(main.rows[0][i], 0);
    assert.equal(a > 0, true);
  });

  test('پس از تأیید: مثل رکورد عادی شمرده می‌شود و شمارنده/برچسب دورکاری دارد', () => {
    const s = repo.listApprovedInRange([emp.id], dates[0], dates[dates.length - 1]);
    assert.equal(s.length, 0);
    const pend = require('../src/db/connection').getDb().prepare("SELECT id FROM remote_work_sessions WHERE status='pending' AND user_id=?").get(emp.id).id;
    assert.ok(svc.approve(mgr, pend, {}, { now }).ok);
    const r = run();
    assert.deepEqual(r.users[0].remote, { approvedDays: 1, approvedMinutes: 240 });
    assert.equal(r.totals.remote.approvedMinutes, 240);
    assert.equal(r.users[0].attendance.presentDays + r.users[0].attendance.workedOnNonWorkingDays, 1);
    assert.equal(r.users[0].time.effectiveMinutes, 240);
    const day = r.users[0].days.find((d) => d.date === D);
    assert.equal(day.viaRemote, true);
    assert.equal(day.remoteMinutes, 240);
    assert.equal(r.users[0].days.filter((d) => d.viaRemote).length, 1);
    const sh = sheets.buildMonthlySheets(r);
    const daily = sh.find((x) => x.name === 'ریز روزانه');
    const ci = daily.headers.indexOf('دورکاری');
    assert.equal(daily.rows.filter((row) => row[ci] === 'دورکاری').length, 1);
    const main = sh[0];
    assert.equal(main.rows[1][main.headers.indexOf('دقیقه دورکاری تأییدشده')], 240); // ردیف جمع
  });

  test('snapshot قدیمی بدون remote ⇒ ستون‌ها خالی و خطا نمی‌دهد', () => {
    const r = run();
    const old = JSON.parse(JSON.stringify(r));
    delete old.users[0].remote; delete old.totals.remote;
    const main = sheets.buildMonthlySheets(old)[0];
    assert.equal(main.rows[0][main.headers.indexOf('دقیقه دورکاری تأییدشده')], '');
  });
});
