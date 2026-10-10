// S5-4b: نمای چاپ A4 — مدل خالص، ساخت DOM بدون innerHTML، و رعایت CSP پنل (بدون inline).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PV = require('../public-admin/js/print.js');
const root = path.join(__dirname, '..', 'public-admin');
const html = fs.readFileSync(path.join(root, 'print.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'print.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js', 'print.js'), 'utf8');

const user = (name, extra = {}) => ({
  user: { fullName: name, personnelCode: 'P1', department: 'فنی' },
  calendar: { expectedWorkDays: 20 },
  attendance: { presentDays: 18, absentDays: 1, lateDays: 2, incompleteDays: 0 },
  leave: { leaveDays: 1, missionDays: 0 },
  time: { lateMinutes: 25, effectiveMinutes: 8 * 60 * 18 + 5, shortfallMinutes: 30 },
  overtime: { payableMinutes: 90 },
  ...extra,
});
const payload = (over = {}) => ({
  label: 'شهریور ۱۴۰۵', from: '2026-08-23', to: '2026-09-22', source: 'live',
  users: [user('علی <b>x</b>')],
  totals: { calendar: { expectedWorkDays: 20 }, attendance: { presentDays: 18, absentDays: 1, lateDays: 2, incompleteDays: 0 }, leave: { leaveDays: 1, missionDays: 0 }, time: { lateMinutes: 25, effectiveMinutes: 8645, shortfallMinutes: 30 }, overtime: { payableMinutes: 90 } },
  ...over,
});

// DOM مینیمال برای تست render
function fakeDoc() {
  const els = {};
  const make = (tag) => ({ tag, children: [], className: '', textContent: '', appendChild(c) { this.children.push(c); return c; } });
  return { els, getElementById(id) { return (els[id] ||= make('x')); }, createElement: make };
}

describe('نمای چاپ (S5-4b)', () => {
  test('hhmm و fa', () => {
    assert.equal(PV.hhmm(65), '1:05');
    assert.equal(PV.hhmm(null), '');
    assert.equal(PV.fa('12:05'), '۱۲:۰۵');
  });

  test('apiUrlFrom: فقط پارامترهای مجاز، days=0، encode', () => {
    const u = PV.apiUrlFrom('?year=1405&month=6&x=1&department=فنی&evil=<script>');
    assert.equal(u, '/api/admin/reports/monthly?year=1405&month=6&department=%D9%81%D9%86%DB%8C&days=0');
  });

  test('buildModel: ستون‌ها، ردیف جمع، یادداشت زنده/snapshot و اصلاح‌ها', () => {
    const m = PV.buildModel(payload(), { printedAt: 'x' });
    assert.equal(m.headers.length, PV.COLUMNS.length);
    assert.equal(m.rows[0].length, m.headers.length);
    assert.equal(m.totalRow[0], 'جمع');
    assert.equal(m.totalRow[1], '');
    assert.equal(m.closed, false);
    assert.match(m.notes[0], /زنده/);
    const c = PV.buildModel(payload({ source: 'snapshot', closedAt: 'T', adjustments: [{}, {}] }));
    assert.equal(c.closed, true);
    assert.match(c.notes[0], /snapshot/);
    assert.match(c.adjustmentsNote, /2 اصلاح/);
    assert.equal(PV.buildModel(payload({ users: [] })).totalRow, null);
  });

  test('render: متن فقط با textContent (HTML کارمند escape نمی‌شود چون هرگز parse نمی‌شود)', () => {
    const doc = fakeDoc();
    PV.render(doc, PV.buildModel(payload(), { printedAt: 'p' }));
    const tr = doc.els.tbody.children[0];
    assert.equal(tr.children[0].textContent, 'علی <b>x</b>');
    assert.equal(tr.children[3].textContent, '۲۰');
    assert.equal(doc.els.tfoot.children.length, 1);
    assert.equal(doc.els.thead.children[0].children.length, PV.COLUMNS.length);
    assert.doesNotMatch(js.replace(/^\s*\/\/.*$/gm, ''), /innerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });

  test('print.html مطابق CSP پنل: بدون <style>/style=/on*=/اسکریپت درون‌خطی، فقط فایل‌های همان‌مبدأ', () => {
    assert.doesNotMatch(html, /<style/i);
    assert.doesNotMatch(html, /\sstyle=/i);
    assert.doesNotMatch(html, /\son[a-z]+=/i);
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((x) => x[0]);
    assert.equal(scripts.length, 1);
    assert.match(scripts[0], /src="\/admin\/js\/print\.js"/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.match(html, /href="\/admin\/css\/print\.css"/);
    assert.match(html, /dir="rtl"/);
  });

  test('print.css: A4 افقی، سرستون تکرارشونده، پنهان‌شدن نوار ابزار در چاپ', () => {
    assert.match(css, /@page\s*\{[^}]*A4\s+landscape/i);
    assert.match(css, /@media print/);
    assert.match(css, /\.no-print/);
    assert.match(css, /table-header-group/);
    assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
  });
});
