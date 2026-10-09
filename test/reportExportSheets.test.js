// S5-1b: شیت‌های خروجی xlsx گزارش کارمندان (src/services/reportExportService.js) + route (S5-1b/S5-1c).
//  • بخش اول: سرویس با repository/موتورِ ساختگی (بدون DB و بدون exceljs) — شکل شیت‌ها، ستون‌ها، تاریخ شمسی، دقیقه + ساعت:دقیقه.
//  • بخش دوم: route واقعی روی DB تست (فقط با وابستگی‌های سرور): اسکوپ نقش، CSV قدیمی بدون تغییر، audit، injection.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let hasServerDeps = true;
try { require.resolve('better-sqlite3'); require.resolve('express'); } catch (_) { hasServerDeps = false; }
let hasExcel = true;
try { require.resolve('exceljs'); } catch (_) { hasExcel = false; }

function stub(rel, exports) {
  const file = require.resolve(path.join('..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

describe('reportExportService: شکل شیت‌ها (با موتور/مخزن ساختگی)', () => {
  let svc; let calls;
  before(() => {
    calls = { capCalls: [] };
    const U = (id, name, code, dept) => ({ id, full_name: name, personnel_code: code, department: dept });
    const records = [
      { id: 12, user_id: 1, record_date: '2026-08-04', check_in_time: '2026-08-04T05:00:00.000Z', check_out_time: '2026-08-04T13:30:00.000Z', status: 'present' },
      { id: 11, user_id: 1, record_date: '2026-08-03', check_in_time: null, check_out_time: null, status: 'leave' },
    ];
    stub('src/repositories/attendanceRepository.js', { listByUserIdsAndRange: (ids) => records.filter((r) => ids.includes(r.user_id)) });
    stub('src/repositories/breakRepository.js', { totalBreakMinutes: (id) => (id === 12 ? 30 : 0) });
    stub('src/repositories/leaveRepository.js', {
      listInRangeWithType: (ids) => [
        { user_id: 1, type_title: 'استحقاقی', kind: 'leave', status: 'approved', start_date: '2026-08-03', end_date: '2026-08-03', unit: 'day', duration_minutes: 480, reason: '=HYPERLINK("x")' },
        { user_id: 2, type_title: 'مأموریت', kind: 'mission', status: 'weird', start_date: '2026-08-05', end_date: '2026-08-06', unit: 'hour', duration_minutes: null, reason: null },
      ].filter((l) => ids.includes(l.user_id)),
    });
    stub('src/engine/dayService.js', {
      loadContext: () => ({ settings: {}, timezone: 'Asia/Tehran' }),
      computeMonthOvertime: (recs, o) => {
        calls.capCalls.push(o.capMinutes);
        if (!recs.length) return { days: [], totalEligible: 0 };
        return {
          totalEligible: 45,
          days: [
            { recordId: 12, recordDate: '2026-08-04', overtime: 90, overtimePayableDaily: 45, approvalStatus: 'pending', overtimePayableEligible: 0 },
            { recordId: 13, recordDate: '2026-08-05', overtime: 0, overtimePayableDaily: 0, approvalStatus: 'none', overtimePayableEligible: 0 },
            { recordId: 14, recordDate: '2026-08-06', overtime: 60, overtimePayableDaily: 60, approvalStatus: 'approved', overtimePayableEligible: 60 },
          ],
        };
      },
    });
    stub('src/utils/jalali.js', { isoDateToJalaliString: (iso) => `J(${iso})` });
    stub('src/api/routes/admin/common.js', {
      minutesToHHMM: (m) => `${String(Math.floor(Math.round(m) / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`,
      safeSummary: (r) => (r.id === 12 ? { effectiveMinutes: 450, lateMinutes: 10, earlyLeaveMinutes: 0, overtimeMinutes: 90 } : { effectiveMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 }),
      aggregateRecords: (recs) => ({ recordCount: recs.length, presentDays: 1, totalEffective: 450, lateCount: 1, totalLateMinutes: 10, earlyLeaveCount: 0, totalEarlyMinutes: 0, incompleteCount: 0, leaveDays: 1, holidayDays: 0, overtimeMinutes: 90 }),
    });
    delete require.cache[require.resolve('../src/services/reportExportService.js')];
    svc = require('../src/services/reportExportService.js');
  });

  const users = [{ id: 1, full_name: 'الف', personnel_code: 'P1', department: 'فنی' }, { id: 2, full_name: 'ب', personnel_code: null, department: null }];

  test('چهار شیت با نام ثابت و ترتیب مشخص؛ هر ردیف به‌اندازه‌ی سرستون', () => {
    const sheets = svc.buildEmployeeReportSheets({ users, from: '2026-08-01', to: '2026-08-31' });
    assert.deepEqual(sheets.map((s) => s.name), ['خلاصه کارمند', 'ریز روزانه', 'مرخصی و مأموریت', 'اضافه‌کاری']);
    for (const s of sheets) {
      assert.ok(s.headers.length > 3);
      for (const r of s.rows) assert.equal(r.length, s.headers.length, `${s.name}: ${JSON.stringify(r)}`);
    }
    assert.equal(sheets[0].rows.length, 2, 'یک ردیف خلاصه برای هر کارمند (حتی بدون رکورد)');
  });

  test('خلاصه: دقیقه عددی + ساعت:دقیقه؛ اضافه‌کاری قابل‌پرداخت بدون سقف ماهانه (capMinutes=0)', () => {
    const [summary] = svc.buildEmployeeReportSheets({ users, from: '2026-08-01', to: '2026-08-31' });
    const h = summary.headers;
    const row = summary.rows[0];
    const at = (title) => row[h.findIndex((x) => x.startsWith(title))];
    assert.equal(at('نام کارمند'), 'الف');
    assert.equal(at('مجموع دقیقه مفید'), 450);
    assert.equal(at('مجموع ساعت مفید'), '07:30');
    assert.equal(at('دقیقه اضافه‌کاری قابل‌پرداخت'), 45);
    assert.equal(at('قابل‌پرداخت (ساعت:دقیقه)'), '00:45');
    assert.ok(calls.capCalls.every((c) => c === 0));
  });

  test('ریز روزانه: ترتیب زمانی صعودی، تاریخ میلادی + شمسی، ساعت‌ها به وقت شرکت، دقیقه‌ی ناشناخته خالی', () => {
    const daily = svc.buildEmployeeReportSheets({ users, from: '2026-08-01', to: '2026-08-31' })[1];
    assert.deepEqual(daily.rows.map((r) => r[3]), ['2026-08-03', '2026-08-04']);
    const h = daily.headers; const r = daily.rows[1];
    const at = (t) => r[h.indexOf(t)];
    assert.equal(at('تاریخ شمسی'), 'J(2026-08-04)');
    assert.equal(at('ورود'), '08:30'); // 05:00Z = 08:30 تهران (UTC+3:30)
    assert.equal(at('خروج'), '17:00');
    assert.equal(at('دقیقه استراحت'), 30);
    assert.equal(at('دقیقه مفید'), 450);
    assert.equal(at('ساعت مفید (ساعت:دقیقه)'), '07:30');
    assert.equal(at('دقیقه تأخیر'), 10);
    const leaveDay = daily.rows[0];
    assert.equal(leaveDay[h.indexOf('ورود')], '');
    assert.equal(leaveDay[h.indexOf('دقیقه مفید')], '');
    assert.equal(leaveDay[h.indexOf('ساعت مفید (ساعت:دقیقه)')], '');
  });

  test('مرخصی و مأموریت: برچسب فارسی نوع/دسته/وضعیت/واحد، شمسی، مدت دقیقه + ساعت:دقیقه، وضعیت ناشناخته همان خام', () => {
    const leave = svc.buildEmployeeReportSheets({ users, from: '2026-08-01', to: '2026-08-31' })[2];
    const h = leave.headers;
    const a = leave.rows[0]; const b = leave.rows[1];
    assert.equal(a[h.indexOf('نوع')], 'استحقاقی');
    assert.equal(a[h.indexOf('دسته')], 'مرخصی');
    assert.equal(a[h.indexOf('وضعیت')], 'تأییدشده');
    assert.equal(a[h.indexOf('از تاریخ (شمسی)')], 'J(2026-08-03)');
    assert.equal(a[h.indexOf('واحد')], 'روز');
    assert.equal(a[h.indexOf('مدت (دقیقه)')], 480);
    assert.equal(a[h.indexOf('مدت (ساعت:دقیقه)')], '08:00');
    assert.equal(a[h.indexOf('دلیل')], '=HYPERLINK("x")', 'خنثی‌سازی در لایه‌ی نوشتن فایل است، نه سرویس');
    assert.equal(b[h.indexOf('دسته')], 'مأموریت');
    assert.equal(b[h.indexOf('وضعیت')], 'weird');
    assert.equal(b[h.indexOf('واحد')], 'ساعت');
    assert.equal(b[h.indexOf('مدت (دقیقه)')], '');
    assert.equal(b[h.indexOf('دلیل')], '');
    assert.equal(b[h.indexOf('کد پرسنلی')], '');
  });

  test('اضافه‌کاری: فقط روزهای دارای اضافه‌کاری/تصمیم؛ وضعیت تأیید فارسی؛ روز «none» حذف می‌شود', () => {
    const ot = svc.buildEmployeeReportSheets({ users, from: '2026-08-01', to: '2026-08-31' })[3];
    const h = ot.headers;
    const forUser1 = ot.rows.filter((r) => r[0] === 'الف');
    assert.deepEqual(forUser1.map((r) => r[h.indexOf('تاریخ')]), ['2026-08-04', '2026-08-06']);
    assert.equal(forUser1[0][h.indexOf('وضعیت تأیید')], 'معلق');
    assert.equal(forUser1[0][h.indexOf('قابل‌پرداخت پس از تأیید (دقیقه)')], 0);
    assert.equal(forUser1[1][h.indexOf('وضعیت تأیید')], 'تأییدشده');
    assert.equal(forUser1[1][h.indexOf('اضافه‌کاری (ساعت:دقیقه)')], '01:00');
  });

  test('بدون کارمند ⇒ چهار شیت خالی (فقط سرستون)', () => {
    const sheets = svc.buildEmployeeReportSheets({ users: [], from: '2026-08-01', to: '2026-08-31' });
    assert.equal(sheets.length, 4);
    assert.ok(sheets.every((s) => s.rows.length === 0));
  });
});

describe('route گزارش و خروجی‌ها: اسکوپ، CSV قدیمی، audit، injection (S5-1b/S5-1c)', { skip: hasServerDeps ? false : 'وابستگی‌های سرور نصب نیست' }, () => {
  let server; let base; let adminCookie; let managerCookie; let employeeCookie; let staff; let outsider;
  before(async () => {
    // سرویس بالا cacheهای ساختگی گذاشته؛ برای route واقعی باید پاک شوند
    for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
    const { resetDb } = require('./helpers/testEnv');
    resetDb();
    const { makeUser, sessionCookie, workdayDate } = require('./helpers/factories');
    const attendanceRepository = require('../src/repositories/attendanceRepository');
    const leaveRepository = require('../src/repositories/leaveRepository');
    const admin = makeUser({ role: 'admin' });
    const manager = makeUser({ role: 'manager', name: 'مدیر تیم' });
    staff = makeUser({ role: 'employee', managerId: manager.id, name: '=cmd|calc' });
    outsider = makeUser({ role: 'employee', name: 'بیرون از تیم' });
    const day = workdayDate(1);
    for (const u of [staff, outsider]) {
      attendanceRepository.createManual({ userId: u.id, recordDate: day, checkInTime: `${day}T05:00:00.000Z`, checkOutTime: `${day}T14:00:00.000Z`, status: 'present' });
    }
    leaveRepository.createLeaveRequest({ userId: staff.id, startDate: workdayDate(2), endDate: workdayDate(2), leaveType: 'leave', reason: '@evil' });
    adminCookie = sessionCookie(admin.id);
    managerCookie = sessionCookie(manager.id);
    employeeCookie = sessionCookie(staff.id);
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); require('./helpers/testEnv').cleanup(); });

  const get = (url, cookie) => fetch(base + url, { headers: { cookie } });
  const RANGE = 'from=2026-08-01&to=2026-08-31';
  const auditRows = (action) => require('../src/db/connection').getDb().prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action);

  test('CSV پیش‌فرض: ستون‌های قدیمی دست‌نخورده؛ نام شبیه فرمول در CSV خنثی', async () => {
    const res = await get(`/api/admin/reports/export?${RANGE}`, adminCookie);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.startsWith('﻿نام کارمند,کد پرسنلی,دپارتمان,تعداد روز رکورد,مجموع دقیقه مفید,تعداد تأخیر,تعداد خروج زودهنگام,تعداد روز ناقص'));
    assert.ok(text.includes("'=cmd|calc"), 'injection خنثی شد');
    assert.ok(!/\r\n=cmd/.test(text));
  });

  test('ادمین: هر دو کارمند؛ سرپرست: فقط تیم خودش؛ کارمند: ۴۰۳ — برای CSV و xlsx', async () => {
    const a = await (await get(`/api/admin/reports/export?${RANGE}`, adminCookie)).text();
    assert.ok(a.includes('بیرون از تیم'));
    const m = await (await get(`/api/admin/reports/export?${RANGE}`, managerCookie)).text();
    assert.ok(!m.includes('بیرون از تیم'));
    assert.ok(m.includes('cmd|calc'));
    assert.equal((await get(`/api/admin/reports/export?${RANGE}&format=xlsx`, employeeCookie)).status, 403);
  });

  test('?format=xlsx: چهار شیت (یا fallback CSV بدون exceljs) و audit با قالب واقعاً تحویل‌شده', async () => {
    const before = auditRows('report_exported').length;
    const res = await get(`/api/admin/reports/export?${RANGE}&format=xlsx`, managerCookie);
    assert.equal(res.status, 200);
    const rows = auditRows('report_exported');
    assert.equal(rows.length, before + 1);
    const details = JSON.parse(rows[rows.length - 1].details);
    assert.equal(details.requestedFormat, 'xlsx');
    if (hasExcel) {
      assert.equal(res.headers.get('content-type'), require('../src/utils/xlsx').XLSX_MIME);
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
      assert.deepEqual(wb.worksheets.map((s) => s.name), ['خلاصه کارمند', 'ریز روزانه', 'مرخصی و مأموریت', 'اضافه‌کاری']);
      const summary = wb.worksheets[0];
      assert.equal(summary.rowCount, 2, 'سرستون + فقط کارمند تیم سرپرست');
      assert.equal(summary.getCell(2, 1).value, "'=cmd|calc");
      assert.equal(wb.worksheets[2].getCell(2, wb.worksheets[2].columnCount).value, "'@evil");
      assert.equal(details.format, 'xlsx');
      assert.equal(details.sheets.length, 4);
    } else {
      assert.equal(res.headers.get('x-export-fallback'), 'csv');
      assert.equal(details.format, 'csv');
      assert.equal(details.fallback, true);
    }
    assert.equal(details.count, 1);
  });

  test('خروجی کارمندان و audit-log هم audit می‌شوند (users_exported / audit_log_exported)', async () => {
    assert.equal((await get('/api/admin/users/export', adminCookie)).status, 200);
    const u = auditRows('users_exported');
    assert.equal(u.length, 1);
    assert.equal(JSON.parse(u[0].details).format, 'csv');
    assert.equal((await get('/api/admin/audit-log/export', adminCookie)).status, 200);
    const a = auditRows('audit_log_exported');
    assert.equal(a.length, 1);
    assert.ok(JSON.parse(a[0].details).count >= 1);
  });

  test('format نامعتبر ⇒ ۴۰۰ و audit ثبت نمی‌شود', async () => {
    const n = auditRows('report_exported').length;
    assert.equal((await get(`/api/admin/reports/export?${RANGE}&format=pdf`, adminCookie)).status, 400);
    assert.equal(auditRows('report_exported').length, n);
  });
});
