// S5-4a: xlsx/CSV ماهانه — شیت‌ها (ساخت داده، خالص)، شیت راهنما، route (اسکوپ، snapshot، audit، fallback).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { getDb } = require('../src/db/connection');
const { computeMonthlyReport } = require('../src/services/monthlyReportService');
const { buildMonthlySheets, SHEET, MAIN_COLUMNS } = require('../src/services/monthlyExportService');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const usersRepo = require('../src/repositories/usersRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');

const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const NOW = at('2026-10-05', '10:00');
const Y = 1405;
const M = 6;
const rec = (userId, date, inn, out) => attendanceRepo.createManual({ userId, recordDate: date, checkInTime: at(date, inn), checkOutTime: out ? at(date, out) : null, status: 'normal' });

describe('شیت‌های xlsx ماهانه (S5-4a)', () => {
  let a; let b; let payload;
  before(() => {
    resetDb();
    a = makeUser({ name: 'الف', department: 'فنی' });
    b = makeUser({ name: 'ب' });
    for (const u of [a, b]) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    rec(a.id, '2026-08-24', '08:00', '16:30');
    rec(a.id, '2026-08-25', '09:00', '16:30');
    payload = { ...computeMonthlyReport({ users: usersRepo.listUsers({}), year: Y, month: M, now: NOW, includeDays: true }), source: 'live', closure: null };
  });
  after(cleanup);

  test('ترتیب و ساختار شیت‌ها؛ ردیف‌ها با سرستون هم‌طول؛ ردیف جمع', () => {
    const sheets = buildMonthlySheets(payload, { generatedAt: NOW });
    assert.deepEqual(sheets.map((s) => s.name), [SHEET.main, SHEET.leave, SHEET.balances, SHEET.daily, SHEET.meta, SHEET.guide]);
    for (const s of sheets) for (const r of s.rows) assert.equal(r.length, s.headers.length, s.name);
    const main = sheets[0];
    assert.equal(main.rows.length, 3, 'دو کارمند + جمع');
    const col = (h) => main.headers.indexOf(h);
    const rowA = main.rows.find((r) => r[0] === 'الف');
    assert.equal(rowA[col('روز حضور')], 2);
    assert.equal(rowA[col('روز تأخیر')], 1);
    assert.equal(rowA[col('دقیقه تأخیر')], 60);
    assert.equal(typeof rowA[col('دقیقه مفید')], 'number');
    assert.match(rowA[col('ساعت مفید (ساعت:دقیقه)')], /^\d+:\d{2}$/);
    const total = main.rows[main.rows.length - 1];
    assert.equal(total[0], 'جمع');
    assert.equal(total[col('روز حضور')], 2);
    assert.equal(total[col('دقیقه مفید')], payload.totals.time.effectiveMinutes);
    assert.equal(sheets[3].rows.length, 62, 'ریز روزانه: ۲ کاربر × ۳۱ روز');
    const day = sheets[3].rows.find((r) => r[2] === '2026-08-25' && r[0] === 'الف');
    assert.equal(day[3], '1405/06/03'.replace(/\//g, '/'), 'تاریخ شمسی');
    assert.equal(day[4], 'تأخیر');
  });

  test('«راهنما» همه‌ی ستون‌های همه‌ی شیت‌های داده را دقیقاً پوشش می‌دهد (بدون عقب‌افتادن)', () => {
    const sheets = buildMonthlySheets(payload);
    const guide = sheets.find((s) => s.name === SHEET.guide);
    assert.deepEqual(guide.headers, ['شیت', 'ستون', 'تعریف']);
    for (const s of sheets.filter((x) => [SHEET.main, SHEET.leave, SHEET.balances, SHEET.daily].includes(x.name))) {
      for (const h of s.headers) {
        const hit = guide.rows.find((g) => g[0] === s.name && g[1] === h);
        assert.ok(hit && hit[2].length > 5, `${s.name} / ${h}`);
      }
    }
    assert.ok(MAIN_COLUMNS.every((c) => typeof c[1] === 'string' && c[1]));
  });

  test('مشخصات: منبع snapshot و وضعیت ماه بسته؛ بدون کاربر ردیف جمع نمی‌آید', () => {
    const snap = buildMonthlySheets({ ...payload, source: 'snapshot', closure: { status: 'closed', closedAt: '2026-10-05T07:00:00Z' }, adjustments: [1, 2] }, { generatedAt: NOW });
    const meta = Object.fromEntries(snap.find((s) => s.name === SHEET.meta).rows);
    assert.match(meta['منبع ارقام'], /snapshot/);
    assert.equal(meta['وضعیت ماه'], 'بسته');
    assert.equal(meta['تعداد اصلاح پس از بستن'], 2);
    assert.equal(meta['ماه شمسی'], payload.label);
    const empty = buildMonthlySheets({ ...payload, users: [], totals: payload.totals });
    assert.equal(empty[0].rows.length, 0);
  });
});

let hasExpress = true;
try { require.resolve('express'); } catch (_) { hasExpress = false; }

describe('خروجی ماهانه — route (S5-4a)', { skip: hasExpress ? false : 'express نصب نیست (npm install)' }, () => {
  let server; let base; let cookies; let emp; let other; let auditRepo;
  before(async () => {
    resetDb();
    const { sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    auditRepo = require('../src/repositories/auditRepository');
    const admin = makeUser({ role: 'admin' });
    const mgr = makeUser({ role: 'manager' });
    emp = makeUser({ role: 'employee', managerId: mgr.id, name: 'کارمند' });
    other = makeUser({ role: 'employee', name: 'دیگری' });
    for (const u of [admin, mgr, emp, other]) getDb().prepare("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(u.id);
    rec(emp.id, '2026-08-24', '08:00', '16:30');
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(mgr.id), employee: sessionCookie(emp.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });
  const get = async (role, url) => {
    const res = await fetch(base + url, { headers: { cookie: cookies[role], 'x-requested-with': 'AttendancePanel' } });
    return { status: res.status, headers: res.headers, text: await res.text() };
  };

  test('CSV پیش‌فرض: سرستون ثابت، اسکوپ نقش، ردیف جمع، audit؛ فرمت نامعتبر ۴۰۰', async () => {
    const r = await get('admin', `/api/admin/reports/monthly/export?year=${Y}&month=${M}`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /csv/);
    assert.match(r.headers.get('content-disposition'), /monthly-report_1405-06\.csv/);
    const lines = r.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.ok(lines[0].startsWith('نام کارمند,'));
    assert.ok(lines[lines.length - 1].startsWith('جمع,'));
    assert.equal(lines.length, 1 + 4 + 1, 'سرستون + admin/mgr/emp/other + جمع');
    const e = await get('employee', `/api/admin/reports/monthly/export?year=${Y}&month=${M}`);
    assert.equal(e.text.replace(/^﻿/, '').trim().split(/\r?\n/).length, 3, 'فقط خودش + جمع');
    const m = await get('manager', `/api/admin/reports/monthly/export?year=${Y}&month=${M}`);
    assert.equal(m.text.replace(/^﻿/, '').trim().split(/\r?\n/).length, 3);
    assert.equal((await get('admin', `/api/admin/reports/monthly/export?year=${Y}&month=${M}&format=pdf`)).status, 400);
    assert.equal((await get('admin', `/api/admin/reports/monthly/export?year=${Y}&month=13`)).status, 400);
    assert.equal((await get('employee', `/api/admin/reports/monthly/export?year=${Y}&month=${M}&userId=${other.id}`)).status, 403);
    const log = auditRepo.search({ action: 'report_exported' });
    assert.ok(log.length >= 3);
    assert.match(log[0].details, /"kind":"monthly"/);
  });

  test('xlsx: با exceljs فایل ZIP/xlsx؛ بدون آن fallback CSV با هدر', async () => {
    const r = await get('admin', `/api/admin/reports/monthly/export?year=${Y}&month=${M}&format=xlsx`);
    assert.equal(r.status, 200);
    let hasExcel = true;
    try { require.resolve('exceljs'); } catch (_) { hasExcel = false; }
    if (hasExcel) assert.match(r.headers.get('content-type'), /spreadsheetml/);
    else assert.equal(r.headers.get('x-export-fallback'), 'csv');
  });

  test('ماه بسته: خروجی از snapshot (تغییر بعدی رکورد اثر ندارد)', async () => {
    assert.equal((await fetch(`${base}/api/admin/month-closures/${Y}/${M}/close`, { method: 'POST', headers: { cookie: cookies.admin, 'x-requested-with': 'AttendancePanel', 'content-type': 'application/json' }, body: '{}' })).status, 201);
    const before = await get('admin', `/api/admin/reports/monthly/export?year=${Y}&month=${M}`);
    rec(emp.id, '2026-08-25', '08:00', '16:30'); // رکورد تازه بعد از بستن (مستقیم در DB)
    const after2 = await get('admin', `/api/admin/reports/monthly/export?year=${Y}&month=${M}`);
    assert.equal(after2.text, before.text);
  });
});
