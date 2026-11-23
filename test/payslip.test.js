// فیش حقوقی چاپی: مدل خالص، ساخت DOM بدون innerHTML، محاسبه‌ی خالص، و رعایت CSP پنل.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PS = require('../public-admin/js/payslip.js');

const root = path.join(__dirname, '..', 'public-admin');
const html = fs.readFileSync(path.join(root, 'payslip.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js', 'payslip.js'), 'utf8');
const J = { isoToJalali: () => ({ jy: 1405, jm: 7, jd: 30 }) };

const row = (over = {}) => ({ user: { id: 7, fullName: 'مهسا <b>x</b>', personnelCode: '12', department: 'تولید' }, rateKt: 100, usefulMinutes: 122 * 60, overtimeMinutes: 0, amountToman: 12200000, excludedDays: [], ...over });

describe('فیش حقوقی', () => {
  test('buildSlip: ساعت‌ها، نرخ (هزار تومان ⇒ تومان) و مبلغ', () => {
    const s = PS.buildSlip(row(), { month: 7, to: '2026-10-22' }, J);
    assert.equal(s.title, 'فیش حقوقی فراز هنر / مهر ماه');
    assert.equal(s.date, '۱۴۰۵/۰۷/۳۰');
    assert.equal(s.netHours, '۱۲۲:۰۰');
    assert.equal(s.workHours, '۱۲۲:۰۰');
    assert.equal(s.rate, '۱۰۰,۰۰۰');
    assert.equal(s.amount, 12200000);
  });
  test('اضافه‌کاری از ساعات عادی جدا می‌شود ولی خالص همان ساعت مفید است', () => {
    const s = PS.buildSlip(row({ usefulMinutes: 600, overtimeMinutes: 90 }), { month: 7, to: '2026-10-22' }, J);
    assert.equal(s.workHours, '۸:۳۰');
    assert.equal(s.overtime, '۱:۳۰');
    assert.equal(s.netHours, '۱۰:۰۰');
  });
  test('بدون نرخ: مبلغ تهی و هشدار', () => {
    const s = PS.buildSlip(row({ rateKt: null, amountToman: null }), { month: 7, to: '2026-10-22' }, J);
    assert.equal(s.amount, null); assert.equal(s.noRate, true); assert.equal(s.rate, '');
  });
  test('selectRows: پیش‌فرض فقط حقوق مثبت؛ all همه', () => {
    const p = { rows: [row(), row({ amountToman: 0 }), row({ amountToman: null })] };
    assert.equal(PS.selectRows(p).length, 1);
    assert.equal(PS.selectRows(p, { all: true }).length, 3);
    assert.equal(PS.selectRows(row()).length, 1); // پاسخ تک‌نفره
  });
  test('parseAmount: رقم فارسی/عربی و کاما', () => {
    assert.equal(PS.parseAmount('۱,۲۰۰,۰۰۰'), 1200000);
    assert.equal(PS.parseAmount('٣٠٠'), 300);
    assert.equal(PS.parseAmount(''), 0);
    assert.equal(PS.parseAmount('abc'), 0);
  });
  test('apiUrlFrom: تک‌نفره یا جمعی؛ فقط پارامترهای شناخته‌شده', () => {
    assert.equal(PS.apiUrlFrom('?year=1405&month=7&userId=5&x=1'), '/api/admin/payroll/5?year=1405&month=7');
    assert.equal(PS.apiUrlFrom('?year=1405&month=7&department=فنی'), `/api/admin/payroll?year=1405&month=7&department=${encodeURIComponent('فنی')}`);
    assert.equal(PS.apiUrlFrom('?userId=../x&year=1405&month=7'), '/api/admin/payroll?year=1405&month=7');
  });
  test('بدون innerHTML و بدون inline script/style (CSP)', () => {
    assert.doesNotMatch(js, /\.innerHTML|insertAdjacentHTML|eval\(/);
    assert.doesNotMatch(html, /<style|\son\w+\s*=|<script(?![^>]*src)/);
    assert.match(html, /\/admin\/css\/payslip\.css/);
  });
  test('پنل لینک فیش را برای کل ماه و برای هر کارمند دارد', () => {
    const v = fs.readFileSync(path.join(root, 'js', 'views-performance.js'), 'utf8');
    assert.match(v, /payslip\.html\?\$\{q\(\{ year: pay\.year/);
    assert.match(v, /payslip\.html\?\$\{q\(\{ year: data\.year, month: data\.month, userId/);
  });
});
