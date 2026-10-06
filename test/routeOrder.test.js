// تضمین ساختاری برای تقسیم routeهای پنل (بخش ۱-ب): هیچ routeای نباید توسط route دیگری که زودتر ثبت شده «پنهان» شود
// (مثل مشکل قبلی /admin/users/export که باید قبل از /admin/users/:id می‌آمد) و requireAdminAuth فقط یک‌بار ثبت شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('ترتیب ثبت routeها', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let layers;
  before(() => {
    resetDb();
    const { createApp } = require('../src/server');
    const app = createApp();
    layers = [];
    const mws = [];
    (function walk(stack) {
      for (const l of stack) {
        if (l.route) layers.push(l);
        else if (l.name === 'router' && l.handle.stack) walk(l.handle.stack);
        else mws.push(l);
      }
    })(app._router.stack);
    layers.mws = mws;
  });
  after(cleanup);

  // الگوی route → یک URL نمونه
  const probe = (p) => p.replace(/:(\w+)\(([^)]*)\)/g, (_, n, alt) => alt.split('|')[0]).replace(/:\w+/g, '1');

  test('برای هر route، اولین routeِ منطبق با URL نمونه‌اش خودش است (بدون shadowing)', () => {
    for (const l of layers) {
      for (const method of Object.keys(l.route.methods)) {
        const url = probe(l.route.path);
        const hit = layers.find((x) => x.route.methods[method] && x.match(url));
        assert.equal(hit.route.path, l.route.path, `${method.toUpperCase()} ${url} توسط ${hit.route.path} پنهان شده است`);
      }
    }
  });

  test('/admin/users/export قبل از /admin/users/:id ثبت شده است', () => {
    const idx = (path) => layers.findIndex((l) => l.route.path === path && l.route.methods.get);
    assert.ok(idx('/admin/users/export') >= 0 && idx('/admin/users/:id') >= 0);
    assert.ok(idx('/admin/users/export') < idx('/admin/users/:id'));
  });

  test('requireAdminAuth روی /admin فقط یک‌بار ثبت شده است', () => {
    const n = layers.mws.filter((l) => l.name === 'requireAdminAuth' && /admin/.test(l.regexp.source)).length;
    assert.equal(n, 1);
  });

  test('هیچ route تکراری (متد + الگو) وجود ندارد', () => {
    const seen = new Set();
    for (const l of layers) for (const m of Object.keys(l.route.methods)) {
      const id = `${m} ${l.route.path}`;
      assert.ok(!seen.has(id), `route تکراری: ${id}`);
      seen.add(id);
    }
  });
});
