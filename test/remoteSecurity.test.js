// R8 (فاز ۱۴): تست‌های امنیتی و قواعد UI دورکاری — ماتریس مجوز، اسکوپ، خودتأییدی، نشت داده، تزریق/رندر، قواعد پروژه (بدون alert/inline).
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('امنیت دورکاری (R8)', () => {
  let db; let repo; let svc; let U; let mk; let wsvc;
  const D = '2026-10-10';
  const now = new Date('2026-10-16T10:00:00Z');

  before(() => {
    db = resetDb();
    const F = require('./helpers/factories');
    repo = require('../src/repositories/remoteWorkRepository');
    svc = require('../src/services/remoteWorkAdminService');
    wsvc = require('../src/services/remoteWorkService');
    const mgr = F.makeUser({ role: 'manager' });
    U = {
      mgr, other: F.makeUser({ role: 'manager' }), admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }),
      emp: F.makeUser({ managerId: mgr.id }), stranger: F.makeUser({}),
    };
    mk = (u, d, s, e) => {
      const x = repo.insertSession({ userId: u.id, workDate: d, startAt: `${d}T${s}.000Z`, ip: '203.0.113.9' });
      if (e) repo.closeSession(x.id, `${d}T${e}.000Z`);
      return x.id;
    };
  });
  after(() => cleanup());

  test('ماتریس مجوز: کارمند هیچ مجوز دورکاری ادمینی ندارد؛ hr فقط read؛ manager/admin هر دو', () => {
    const { hasPermission } = require('../src/middleware/permissions');
    for (const p of ['remote_work.read', 'remote_work.review']) assert.equal(hasPermission('employee', p), false, p);
    assert.equal(hasPermission('hr', 'remote_work.read'), true);
    assert.equal(hasPermission('hr', 'remote_work.review'), false);
    for (const r of ['manager', 'admin']) for (const p of ['remote_work.read', 'remote_work.review']) assert.equal(hasPermission(r, p), true);
  });

  test('تمام routeهای ادمین با requirePermission محافظت شده‌اند', () => {
    const src = read('src/api/routes/admin/remoteWork.js');
    const routes = src.match(/router\.(get|post|put|patch|delete)\(/g) || [];
    const guarded = src.match(/router\.(get|post|put|patch|delete)\('[^']+',\s*requirePermission\('remote_work\.(read|review|create)'\)/g) || [];
    assert.ok(routes.length >= 5);
    assert.equal(guarded.length, routes.length);
    assert.equal((src.match(/post\([^)]*remote_work\.read/g) || []).length, 0, 'POST با مجوز read');
  });

  test('routeهای Mini App دورکاری زمان/تاریخ/کاربر را از بدنه نمی‌خوانند', () => {
    const src = read('src/api/routes/miniapp.js');
    const block = src.slice(src.indexOf('دورکاری: مسیرها'), src.indexOf('تاریخچه شخصی'));
    assert.ok(block.length > 200);
    assert.equal(/req\.body|req\.params/.test(block), false);
    assert.equal(/req\.query\.(?!days)/.test(block), false);
  });

  test('سرویس: FORBIDDEN / NOT_IN_SCOPE / SELF_NOT_ALLOWED و بدون اثر بر رکورد رسمی', () => {
    const a = mk(U.emp, D, '05:00:00', '09:00:00');
    const mine = mk(U.mgr, '2026-10-09', '05:00:00', '09:00:00');
    const adminOwn = mk(U.admin, '2026-10-08', '05:00:00', '09:00:00');
    const attempts = [
      [svc.approve(U.emp, a, {}, { now }), 'FORBIDDEN'],
      [svc.reject(U.emp, a, { reviewNote: 'x' }, { now }), 'FORBIDDEN'],
      [svc.approve(U.hr, a, {}, { now }), 'FORBIDDEN'],
      [svc.approve(U.other, a, {}, { now }), 'NOT_IN_SCOPE'],
      [svc.reject(U.other, a, { reviewNote: 'x' }, { now }), 'NOT_IN_SCOPE'],
      [svc.approve(U.mgr, mine, {}, { now }), 'SELF_NOT_ALLOWED'],
      [svc.approve(U.admin, adminOwn, {}, { now }), 'SELF_NOT_ALLOWED'],
    ];
    for (const [r, code] of attempts) assert.equal(r.code, code);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance_records').get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM remote_work_sessions WHERE status != 'pending'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'remote_work_%' AND action NOT LIKE '%start%' AND action NOT LIKE '%end%' AND action NOT LIKE '%break%'").get().n, 0);
  });

  test('صف: manager بیگانه چیزی نمی‌بیند؛ فیلتر کارمندِ خارج از اسکوپ ⇒ NOT_IN_SCOPE؛ کارمند عادی FORBIDDEN', () => {
    const q = svc.listQueue(U.other, {}, { now });
    assert.ok(q.ok !== false);
    assert.equal((q.items || []).length, 0);
    assert.equal(svc.listQueue(U.other, { userId: U.emp.id }, { now }).code, 'NOT_IN_SCOPE');
    assert.equal(svc.listQueue(U.emp, {}, { now }).code, 'FORBIDDEN');
  });

  test('تأیید دسته‌ای: اسکوپ و مجوز رعایت می‌شود', () => {
    assert.equal(svc.approveBatch(U.hr, { userId: U.emp.id }, { now }).code, 'FORBIDDEN');
    assert.equal(svc.approveBatch(U.other, { userId: U.emp.id }, { now }).code, 'NOT_IN_SCOPE');
  });

  test('تاریخچه‌ی کارمند فقط مال خودش است', () => {
    const h = wsvc.getHistory(U.stranger.id, { days: 30 });
    assert.equal(JSON.stringify(h).includes(String(U.emp.id) === String(U.stranger.id) ? 'x' : `"user_id":${U.emp.id}`), false);
  });

  test('رندر پنل: محتوای کاربر escape می‌شود و قواعد پروژه رعایت شده است', () => {
    const src = read('public-admin/js/views-remote.js');
    assert.equal(/\balert\(|\bconfirm\(|\bprompt\(/.test(src), false, 'alert/confirm/prompt');
    assert.equal(/\sstyle=|\sonclick=|\sonchange=|\sonsubmit=/.test(src), false, 'inline style/handler');
    for (const field of ['it.reviewNote', 'emp.fullName', 'emp.department']) {
      const uses = src.split('\n').filter((l) => l.includes(field) && !/esc\(/.test(l) && !/\?|&&/.test(l));
      assert.deepEqual(uses, [], `${field} بدون esc`);
    }
  });

  test('پیام‌های خطای سرویس فارسی‌اند', () => {
    const r = svc.approve(U.emp, 1, {}, { now });
    assert.match(r.message || r.error || '', /[؀-ۿ]/);
  });
});
