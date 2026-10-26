const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('UX v2 enhancement assets are shared by both panels', () => {
  const employee = read('public/index.html');
  const admin = read('public-admin/index.html');
  for (const html of [employee, admin]) {
    assert.match(html, /href="\/css\/reveal\.css"/);
    assert.match(html, /href="\/css\/collapse\.css"/);
    assert.match(html, /src="\/js\/reveal\.js"/);
    assert.match(html, /src="\/js\/collapse\.js"/);
    assert.match(html, /id="ux-back-to-top"[^>]*aria-label="[^"]+"[^>]*hidden/);
  }
});

test('reveal enhancement is progressive, reduced-motion safe, and does not target tables or forms', () => {
  const css = read('public/css/reveal.css');
  const js = read('public/js/reveal.js');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /MutationObserver/);
  assert.match(js, /form, \[role="alert"\], \.sheet, \.modal, \.table-wrap/);
  assert.match(js, /try \{/);
});

test('secondary guidance uses native disclosure and preserves its state safely', () => {
  const employee = read('public/index.html');
  const calendar = read('public-admin/js/views-calendar.js');
  const css = read('public/css/collapse.css');
  const js = read('public/js/collapse.js');
  assert.match(employee, /<details id="earnings-help"[^>]*data-ux-collapse="earnings-help"/);
  assert.match(calendar, /<details id="calendar-legend"[^>]*data-ux-collapse="calendar-legend"/);
  assert.match(css, /@media print/);
  assert.match(js, /sessionStorage/);
  assert.match(js, /MutationObserver/);
});

test('busy actions give visible feedback while existing request locks remain intact', () => {
  const employeeCss = read('public/css/style.css');
  const employeeJs = read('public/js/app.js');
  const adminJs = read('public-admin/js/core.js');
  assert.match(employeeCss, /\.btn\[aria-busy="true"\]::after/);
  assert.match(employeeJs, /async function withBusy[\s\S]*btn\.disabled = true[\s\S]*btn\.disabled = false/);
  assert.match(adminJs, /AP\.attempt[\s\S]*b\.disabled = true[\s\S]*b\.disabled = false/);
});
