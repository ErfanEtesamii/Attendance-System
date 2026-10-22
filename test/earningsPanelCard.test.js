// Phase 20 — کارت «کارکرد این ماه» در «وضعیت من» پنل: route فقط برای خود کاربر نشست، و UI با null رندر نمی‌شود (بررسی ایستا؛ بدون DB).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

test('route /admin/me/earnings: مجوز me.read، هویت فقط req.adminUser، بدون خواندن شناسه از query/body', () => {
  const src = read('src', 'api', 'routes', 'admin', 'employeeWeek.js');
  const m = /router\.get\('\/admin\/me\/earnings'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(m, 'route وجود ندارد');
  assert.match(m[0], /requirePermission\('me\.read'\)/);
  assert.match(m[0], /earningsForUser\(req\.adminUser/);
  assert.doesNotMatch(m[0], /req\.(query|body|params)/);
});

test('UI وضعیت من: با null کارت رندر نمی‌شود؛ مبلغ/ماه/ساعت مفید و prefers-reduced-motion', () => {
  const js = read('public-admin', 'js', 'views-mystatus.js');
  assert.match(js, /function earningsCard\(e\) \{\s*if \(!e\) return '';/);
  assert.match(js, /\/admin\/me\/earnings/);
  assert.match(js, /💰 کارکرد این ماه/);
  assert.match(js, /تا امروز در \$\{esc\(e\.monthLabel\)\} کار کرده‌ای/);
  assert.match(js, /fmt\.num\(amount\)/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  const css = read('public-admin', 'css', 'style.css');
  assert.match(css, /\.earn-card/);
  assert.doesNotMatch(css.slice(css.indexOf('.earn-card')), /#[0-9a-fA-F]{3,6}\b/, 'رنگ ثابت نباید باشد؛ فقط توکن تم');
});
