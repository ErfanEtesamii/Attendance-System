const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildWeekSheets, buildWeekText } = require('../src/services/weekExportService');

const week = {
  user: { id: 7, fullName: 'کارمند نمونه' },
  week: { start: '2026-10-17', jalaliStart: '۱۴۰۵/۰۷/۲۵', jalaliEnd: '۱۴۰۵/۰۸/۰۱' },
  days: [
    { date: '2026-10-17', jalali: '۱۴۰۵/۰۷/۲۵', weekday: 'شنبه', kindLabel: 'روز کاری', schedule: { start: '08:00', end: '16:00' }, attendance: { checkIn: '2026-10-17T04:30:00.000Z', checkOut: '2026-10-17T12:30:00.000Z', lateMinutes: 0, effectiveMinutes: 450, overtimeMinutes: 0 }, tasks: [{ title: '=خطرناک', priority: 'high', isUrgent: true, status: 'done', source: 'planned', note: 'انجام شد' }, { title: 'حذف‌شده', deleted: true }] },
    { date: '2026-10-18', jalali: '۱۴۰۵/۰۷/۲۶', weekday: 'یکشنبه', kindLabel: 'غیرکاری', schedule: {}, attendance: null, tasks: [] },
  ],
  summary: { tasks: { done: 1, partial: 0, notDone: 0, noAnswer: 0, completionPercent: 100 }, attendance: { usefulMinutes: 450, lateDays: 0, overtimeMinutes: 0, absentDays: 0 } },
};

describe('خروجی برنامه‌ی هفتگی', () => {
  test('کارتکس: یک شیت با کادر مشخصات، جدول روزها و بخش تسک‌ها؛ روز بی‌تسک می‌ماند و تسک حذف‌شده نمی‌آید', () => {
    const sheets = buildWeekSheets(week);
    assert.deepEqual(sheets.map((s) => s.name), ['کارمند نمونه']);
    const sheet = sheets[0];
    assert.equal(sheet.rows.length, 2, 'ردیف هر روز هفته');
    assert.equal(sheet.card.lines[0][0][0], 'کارمند:  کارمند نمونه');
    assert.ok(sheet.card.lines.flat().some((c) => /تکمیل تسک‌ها/.test(c[0])), 'خلاصه‌ی هفته در کادر بالا');
    const tasks = sheet.extra[0];
    assert.equal(tasks.title, 'تسک‌های هفته');
    assert.equal(tasks.rows.length, 2);
    assert.equal(tasks.rows[0][4], '=خطرناک', 'خنثی‌سازی فرمول وظیفه‌ی utils/xlsx است');
    assert.equal(tasks.rows[1][4], '');
    assert.ok(![sheet, tasks].some((t) => t.headers.includes('نام کارمند')), 'نام کارمند در ردیف‌ها تکرار نمی‌شود');
    assert.ok([sheet, tasks].every((s) => s.rows.every((r) => r.length === s.headers.length)));
    assert.equal(sheets.csv.rows.length, 2, 'CSV همان جدول تخت قبلی');
  });

  test('متن خوانا شامل نشان فوری، وضعیت و خلاصه است', () => {
    const text = buildWeekText(week);
    assert.match(text, /برنامه‌ی هفتگی کارمند نمونه/);
    assert.match(text, /⚡ =خطرناک \[✅ انجام شد\]/);
    assert.match(text, /تسکی ثبت نشده است/);
    assert.match(text, /خلاصه‌ی هفته/);
    assert.doesNotMatch(text, /حذف‌شده/);
  });
});
