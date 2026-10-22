// Phase 20 — تطبیق نرخ ساعتی با کاربران: فقط دقیق، بدون حدس؛ مبهم/پیدانشده آپدیت نمی‌شود (منطق خالص؛ بدون DB).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, matchRates, validRate } = require('../src/scripts/seedHourlyRates');

const users = [
  { id: 1, full_name: 'عسل حیدری' },
  { id: 2, full_name: 'زهرا حیدریان' },
  { id: 3, full_name: 'معصومه صادقی' },
  { id: 4, full_name: 'عبداللهی' },
  { id: 5, full_name: 'عبداللهی' }, // دو کاربر هم‌نام
  { id: 6, full_name: 'مهتاب مایان' },
];

describe('seedHourlyRates', () => {
  test('نرمال‌سازی: ی/ک عربی، فاصله و نیم‌فاصله', () => {
    assert.equal(normalizeName('علي  كريمي'), normalizeName('علی‌کریمی'));
    assert.equal(normalizeName(' مهتاب‌مایان '), normalizeName('مهتاب مایان'));
    assert.equal(normalizeName(null), '');
  });

  test('تطبیق دقیق: فقط نام کامل برابر آپدیت می‌شود', () => {
    const r = matchRates(users, [{ name: 'معصومه صادقی', rate: 155 }, { name: 'مهتاب‌مایان', rate: 155 }]);
    assert.deepEqual(r.updates, [{ userId: 3, rate: 155 }, { userId: 6, rate: 155 }]);
    assert.deepEqual([r.unmatched, r.ambiguous, r.invalid], [[], [], []]);
  });

  test('«حیدری» با «حیدریان» (و نام ناقص) قاطی نمی‌شود؛ پیدانشده گزارش می‌شود', () => {
    const r = matchRates(users, [{ name: 'حیدری', rate: 70 }, { name: 'حیدریان', rate: 75 }, { name: 'صادقی', rate: 155 }]);
    assert.deepEqual(r.updates, []);
    assert.deepEqual(r.unmatched, ['حیدری', 'حیدریان', 'صادقی']);
  });

  test('مبهم: دو کاربر هم‌نام یا نام تکراری در فایل ⇒ آپدیت نمی‌شود', () => {
    const r = matchRates(users, [{ name: 'عبداللهی', rate: 110 }, { name: 'عسل حیدری', rate: 70 }, { name: 'عسل  حیدری', rate: 80 }]);
    assert.deepEqual(r.updates, []);
    assert.deepEqual(r.ambiguous, ['عبداللهی', 'عسل حیدری', 'عسل  حیدری']);
  });

  test('نامعتبر: نرخ غیرصحیح/منفی/رشته یا نام خالی', () => {
    const r = matchRates(users, [{ name: 'عسل حیدری', rate: '70' }, { name: 'زهرا حیدریان', rate: -1 }, { name: 'معصومه صادقی', rate: 1.5 }, { name: '', rate: 5 }]);
    assert.deepEqual(r.updates, []);
    assert.equal(r.invalid.length, 4);
    assert.equal(validRate(0), true);
    assert.equal(validRate(100001), false);
  });

  test('خروجی گزارش‌شده‌ی غیرآپدیتی شامل نرخ نیست', () => {
    const r = matchRates(users, [{ name: 'ناشناس', rate: 987654 }, { name: 'عبداللهی', rate: 987655 }]);
    assert.equal(JSON.stringify({ u: r.unmatched, a: r.ambiguous, i: r.invalid }).includes('98765'), false);
  });
});
