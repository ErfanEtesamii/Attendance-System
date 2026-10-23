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
  test('سه شیت دارد، روز بی‌تسک را نگه می‌دارد و تسک حذف‌شده را نمی‌آورد', () => {
    const sheets = buildWeekSheets(week);
    assert.deepEqual(sheets.map((s) => s.name), ['برنامه‌ی هفته', 'خلاصه‌ی روزها', 'خلاصه‌ی هفته']);
    assert.equal(sheets[0].rows.length, 2);
    assert.equal(sheets[0].rows[0][6], '=خطرناک', 'خنثی‌سازی فرمول وظیفه‌ی utils/xlsx است');
    assert.equal(sheets[0].rows[1][6], '');
    assert.ok(sheets.every((s) => s.rows.every((r) => r.length === s.headers.length)));
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
