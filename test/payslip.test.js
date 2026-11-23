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
  test('apiUrlFrom: همیشه فهرست کل؛ userId فقط پیش‌انتخاب است', () => {
    assert.equal(PS.apiUrlFrom('?year=1405&month=7&userId=5&x=1'), '/api/admin/payroll?year=1405&month=7');
    assert.equal(PS.apiUrlFrom('?year=1405&month=7&department=فنی'), `/api/admin/payroll?year=1405&month=7&department=${encodeURIComponent('فنی')}`);
    assert.equal(PS.userIdFrom('?userId=5'), 5);
    assert.equal(PS.userIdFrom('?userId=../x'), null);
  });
  test('بدون innerHTML و بدون inline script/style (CSP)', () => {
    assert.doesNotMatch(js, /\.innerHTML|insertAdjacentHTML|eval\(/);
    assert.doesNotMatch(html, /<style|\son\w+\s*=|<script(?![^>]*src)/);
    assert.match(html, /\/admin\/css\/payslip\.css/);
    assert.match(html, /\/js\/theme\.js/); // هم‌تم با پنل
    assert.match(html, /\/css\/tokens\.css/);
  });
  test('پنل لینک فیش را برای کل ماه و برای هر کارمند دارد', () => {
    const v = fs.readFileSync(path.join(root, 'js', 'views-performance.js'), 'utf8');
    assert.match(v, /payslip\.html\?\$\{q\(\{ year: pay\.year/);
    assert.match(v, /payslip\.html\?\$\{q\(\{ year: data\.year, month: data\.month, userId/);
  });
});

describe('عیدی و سنوات', () => {
  test('فرمول: مزد روزانه × ۶۰ ÷ ۳۶۵ × روز؛ سنوات نصف', () => {
    const e = PS.eidiOf(541850, 365);
    assert.equal(e, 32511000);
    assert.equal(PS.sanavatOf(e), 16255500);
    assert.equal(PS.eidiOf(541850, 0), 0);
    assert.equal(PS.eidiOf(541850, 100), Math.round(541850 * 60 / 365 * 100));
  });
  test('روز سال شمسی', () => {
    assert.equal(PS.dayOfYear(1, 1), 1);
    assert.equal(PS.dayOfYear(6, 31), 186);
    assert.equal(PS.dayOfYear(7, 1), 187);
    assert.equal(PS.dayOfYear(12, 29), 365);
  });
  test('buildSlip روز مبنای پیش‌فرض را از تاریخ پایان ماه می‌گیرد (حداکثر ۳۶۵)', () => {
    const s = PS.buildSlip(row(), { month: 7, to: '2026-10-22' }, { isoToJalali: () => ({ jy: 1405, jm: 7, jd: 30 }) });
    assert.equal(s.eidiDays, 216);
  });
  test('پنل لینک فیش با عیدی دارد', () => {
    assert.match(fs.readFileSync(path.join(root, 'js', 'views-performance.js'), 'utf8'), /eidi: 1/);
  });
});

test('recompute: خالص شامل مبالغ add و منهای sub', () => {
  const mk = (kind, text) => ({ dataset: { kind }, textContent: text });
  const els = { 'add': [mk('add', '۱,۰۰۰'), mk('add', '۵۰۰')], 'sub': [mk('sub', '۲۰۰')] };
  const roles = {}; ['subs', 'net', 'paid'].forEach((r) => { roles[r] = { textContent: '' }; });
  const slip = { dataset: { base: '10000' }, querySelectorAll: (sel) => els[/"(\w+)"/.exec(sel)[1]] || [], querySelector: (sel) => roles[/"(\w+)"/.exec(sel)[1]] || null };
  PS.recompute(slip, 541850, false);
  assert.equal(roles.net.textContent, PS.num(11300));
  assert.equal(roles.paid.textContent, PS.num(11300));
  assert.equal(roles.subs.textContent, PS.num(200));
});

describe('تنظیمات شخصی', () => {
  test('loadOpts: پیش‌فرض، مقدار نامعتبر نادیده، و ذخیره/خواندن', () => {
    const mem = {}; const st = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } };
    assert.deepEqual(PS.loadOpts(st), PS.DEFAULTS);
    PS.saveOpts(st, { ...PS.DEFAULTS, ins: false, perPage: 1, company: 'نمونه' });
    const o = PS.loadOpts(st);
    assert.equal(o.ins, false); assert.equal(o.perPage, 1); assert.equal(o.company, 'نمونه');
    st.setItem('payslip.opts.v1', JSON.stringify({ perPage: 7, wage: -5, ins: 'x' }));
    const bad = PS.loadOpts(st);
    assert.equal(bad.perPage, 2); assert.equal(bad.wage, PS.DEFAULT_DAILY_WAGE); assert.equal(bad.ins, true);
    assert.deepEqual(PS.loadOpts({ getItem: () => { throw new Error('x'); } }), PS.DEFAULTS);
  });
});
