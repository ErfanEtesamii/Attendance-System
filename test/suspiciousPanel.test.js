// S2-5b: صفحه‌ی پنل «موارد مشکوک» و یادآوری در مرور شبانه. (تست دستی مرورگر در گزارش S2-5b آمده است.)
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const F = require('./helpers/factories');
const repo = require('../src/repositories/suspiciousRepository');

describe('موارد مشکوک در پنل و مرور شبانه (S2-5b)', () => {
  let mgrA, mgrB, a1, a2, b1;
  before(() => {
    resetDb();
    mgrA = F.makeUser({ role: 'manager' });
    mgrB = F.makeUser({ role: 'manager' });
    a1 = F.makeUser({ managerId: mgrA.id, name: '<img src=x onerror=alert(1)>' });
    a2 = F.makeUser({ managerId: mgrA.id });
    b1 = F.makeUser({ managerId: mgrB.id });
  });
  after(() => cleanup());

  test('مرور شبانه: سرپرست فقط تعداد بازِ مواردِ کاملاً درون تیم خودش را می‌بیند (نه تیم دیگر، نه بررسی‌شده)', () => {
    const { buildNightlyMessage } = require('../src/bot/scheduler/nightlyReview');
    const usersRepository = require('../src/repositories/usersRepository');
    const team = (m) => usersRepository.listUsers({ onlyActive: true, managerId: m.id });
    const mk = (type, ids, date) => repo.create({ eventType: type, userIds: ids, eventDate: date, details: {} }).event;

    assert.doesNotMatch(buildNightlyMessage(mgrA, team(mgrA), '2026-10-06'), /نشانه/, 'بدون مورد، خطی اضافه نمی‌شود');

    mk('device_change', [a1.id], '2026-10-01');
    mk('shared_device', [a1.id, a2.id], '2026-10-02');
    mk('shared_device', [a1.id, b1.id], '2026-10-03'); // مشترک با تیم دیگر
    mk('device_change', [b1.id], '2026-10-04');
    const done = mk('device_change', [a2.id], '2026-10-05');
    repo.markReviewed(done.id, { status: 'reviewed', reviewedBy: mgrA.id });

    const msgA = buildNightlyMessage(mgrA, team(mgrA), '2026-10-06');
    assert.match(msgA, /🔎 2 نشانه/);
    assert.match(msgA, /نه اتهام/);
    assert.match(buildNightlyMessage(mgrB, team(mgrB), '2026-10-06'), /🔎 1 نشانه/);
  });

  test('مرور شبانه: خرابی شمارش موارد مشکوک پیام را نمی‌شکند', () => {
    const { buildNightlyMessage } = require('../src/bot/scheduler/nightlyReview');
    const orig = repo.list;
    const origErr = console.error;
    console.error = () => {};
    repo.list = () => { throw new Error('boom'); };
    try {
      const msg = buildNightlyMessage(mgrA, [a1, a2], '2026-10-06');
      assert.match(msg, /مرور شبانه/);
      assert.doesNotMatch(msg, /🔎/);
    } finally {
      repo.list = orig;
      console.error = origErr;
    }
  });

  // اجرای واقعی views-ops.js با AP ساختگی (بدون مرورگر)
  async function renderPanel(items, status = 'open') {
    const AP = {
      views: {},
      // سرپرست: مجوزهای واقعی نقش (S4-4b)
      state: { perms: new Set(require('../src/middleware/permissions').permissionsFor('manager')) },
      can: (...p) => p.every((x) => AP.state.perms.has(x)),
      $: () => null,
      $$: () => [],
      esc: (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
      fmt: { num: (n) => String(n), dateLong: (d) => d, dateTime: (d) => d, date: (d) => d, clock: (d) => d },
      icon: () => '',
      badge: (cls, text) => `<span class="badge ${cls}">${AP.esc(text)}</span>`,
      view(id, def) { AP.views[id] = def; },
      api: async () => items,
    };
    const src = fs.readFileSync(path.join(__dirname, '..', 'public-admin', 'js', 'views-ops.js'), 'utf8');
    const sandbox = { window: { AP }, document: {}, console };
    vm.runInNewContext(src, sandbox);
    const def = AP.views.suspicious;
    assert.ok(def, 'view با شناسه‌ی suspicious ثبت شده است');
    assert.equal(def.perm, 'suspicious.read', 'با مجوز suspicious.read: سرپرست و ادمین می‌بینند، کارمند و hr نه');
    return def.render();
  }

  test('صفحه‌ی پنل: لیبل «نشانه»، توضیح قابل‌جعل‌بودن device_id، دکمه‌ی بررسی، و escape نام‌ها', async () => {
    const { html } = await renderPanel([{
      id: 7, eventType: 'shared_device', eventDate: '2026-10-02', status: 'open', recordIds: [3],
      details: { rule: 'A', deviceId: 'abcdef0123456789abcdef', userCount: 2 },
      users: [{ id: 1, fullName: '<img src=x onerror=alert(1)>' }, { id: 2, fullName: 'علی' }],
      reviewedBy: null, reviewedAt: null, createdAt: '2026-10-02T10:00:00Z',
    }]);
    assert.match(html, /نشانه/);
    assert.match(html, /قابل جعل/);
    assert.match(html, /data-review="7"/);
    assert.match(html, /data-to="reviewed"/);
    assert.doesNotMatch(html, /اتهام زده|متهم|مقصر/);
    assert.doesNotMatch(html, /<img src=x/, 'نام کاربر باید escape شود');
    assert.match(html, /&lt;img src=x/);
    assert.doesNotMatch(html, /abcdef0123456789abcdef/, 'شناسه‌ی کامل دستگاه نمایش داده نمی‌شود');
  });

  test('صفحه‌ی پنل: حالت خالی و مورد بررسی‌شده (بدون دکمه‌ی «بررسی شد»)', async () => {
    const empty = await renderPanel([]);
    assert.match(empty.html, /نشانه‌ی بررسی‌نشده‌ای وجود ندارد/);
    const { html } = await renderPanel([{
      id: 9, eventType: 'device_change', eventDate: '2026-10-03', status: 'reviewed', recordIds: [],
      details: { rule: 'C', historyDays: 4, lookbackDays: 7 }, users: [{ id: 2, fullName: 'علی' }],
      reviewedBy: { id: 5, fullName: 'سرپرست' }, reviewedAt: '2026-10-04T08:00:00Z', createdAt: '2026-10-03T10:00:00Z',
    }]);
    assert.match(html, /بررسی‌شده/);
    assert.match(html, /data-to="ignored"/);
    assert.doesNotMatch(html, /data-to="reviewed"/);
  });
});
