// S2-6c: انتقال واقعی audit_log → audit_log_archive (تراکنش + batch) و پارامتر include_archive در endpointهای audit.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./helpers/factories');
const settings = require('../src/repositories/settingsRepository');
const auditRepository = require('../src/repositories/auditRepository');
const { runAuditArchive } = require('../src/bot/scheduler/auditArchive');
const { wrapJob } = require('../src/utils/jobRunner');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('انتقال واقعی آرشیو audit (S2-6c)', () => {
  let db;
  let user;
  const NOW = new Date('2026-10-06T12:30:45Z'); // آستانه‌ی ۲۴ ماه ⇒ 2024-10-06 12:30:45
  const silent = () => {};
  const total = () => ({
    main: db.prepare('SELECT COUNT(*) n FROM audit_log').get().n,
    archive: db.prepare('SELECT COUNT(*) n FROM audit_log_archive').get().n,
  });
  const sum = () => { const t = total(); return t.main + t.archive; };
  const insert = (date, action, userId = null, ip = null, details = null) =>
    db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, ip_address, details) VALUES (?, ?, ?, ?, ?)')
      .run(userId, action, date, ip, details).lastInsertRowid;

  before(() => {
    db = resetDb();
    user = F.makeUser();
  });
  after(() => cleanup());

  function reseed() {
    db.exec('DELETE FROM audit_log_archive; DELETE FROM audit_log;');
    return {
      old1: insert('2020-01-01 00:00:00', 'old_one', user.id, '10.0.0.1', '{"a":1}'),
      old2: insert('2022-05-05 05:05:05', 'old_two', null, null, null),
      old3: insert('2024-10-06 12:30:44', 'just_before', user.id, '10.0.0.2', 'متن آزاد'),
      edge: insert('2024-10-06 12:30:45', 'exactly_cutoff'), // مرز: «قدیمی‌تر از» ⇒ منتقل نمی‌شود
      recent: insert('2026-10-05 08:00:00', 'yesterday', user.id),
    };
  }

  test('آرشیو روشن: رکوردهای قدیمی با همان id و ستون‌ها منتقل می‌شوند، جمع اصلی+آرشیو قبل و بعد برابر است، دوباره اجرا چیزی نمی‌برد', () => {
    const ids = reseed();
    const originals = db.prepare('SELECT * FROM audit_log WHERE id IN (?, ?, ?)').all(ids.old1, ids.old2, ids.old3);
    const sumBefore = sum();
    assert.equal(sumBefore, 5);

    const logs = [];
    const r = runAuditArchive({ now: NOW, retentionMonths: 24, enabled: true, batchSize: 2, log: (m) => logs.push(m) });
    assert.equal(r.mode, 'archive');
    assert.equal(r.candidates, 3);
    assert.equal(r.moved, 3);
    assert.equal(r.batches, 2, 'batch=2 و ۳ رکورد ⇒ ۲ batch');

    // جمع قبل و بعد برابر؛ فقط یک رکورد audit_archived تازه اضافه شده (ثبت خود انتقال)
    const after = total();
    assert.equal(after.archive, 3);
    assert.equal(after.main, 2 + 1, 'edge و recent + رکورد audit_archived');
    assert.equal(after.main + after.archive, sumBefore + 1);

    // محتوای ردیف‌ها بدون تغییر (id، کاربر، زمان رویداد، IP، جزئیات)
    const archived = db.prepare('SELECT * FROM audit_log_archive ORDER BY id').all();
    assert.deepEqual(archived, originals.sort((a, b) => a.id - b.id));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE id IN (?, ?, ?)').get(ids.old1, ids.old2, ids.old3).n, 0);
    // رکورد مرزی و تازه دست‌نخورده در اصلی
    assert.deepEqual(db.prepare('SELECT id FROM audit_log WHERE id IN (?, ?)').all(ids.edge, ids.recent).map((x) => x.id).sort(), [ids.edge, ids.recent].sort());

    const ev = db.prepare("SELECT details FROM audit_log WHERE action = 'audit_archived'").get();
    assert.deepEqual({ moved: JSON.parse(ev.details).moved, batches: JSON.parse(ev.details).batches }, { moved: 3, batches: 2 });
    assert.ok(logs.some((m) => /انجام شد: 3 رکورد در 2 batch/.test(m)));

    // اجرای دوباره: چیزی برای انتقال نیست، رکورد audit_archived هم (چون moved=0) اضافه نمی‌شود
    const again = runAuditArchive({ now: NOW, retentionMonths: 24, enabled: true, log: silent });
    assert.equal(again.moved, 0);
    assert.deepEqual(total(), after);
  });

  test('آرشیو خاموش یا آستانه‌ی دورتر: هیچ رکوردی منتقل نمی‌شود', () => {
    reseed();
    const before = total();
    assert.equal(runAuditArchive({ now: NOW, retentionMonths: 24, enabled: false, log: silent }).moved, 0);
    assert.equal(runAuditArchive({ now: NOW, retentionMonths: 240, enabled: true, log: silent }).moved, 0, 'نگهداری ۲۴۰ ماه ⇒ همه‌چیز جدید است');
    assert.deepEqual(total(), before);
    // از مسیر تنظیمات واقعی (پیش‌فرض خاموش) هم چیزی نمی‌رود
    settings.update({ auditArchiveEnabled: false });
    assert.equal(runAuditArchive({ now: NOW, log: silent }).mode, 'dry-run');
    assert.deepEqual(total(), before);
    // و با روشن‌کردن تنظیم، همان Job (با wrapJob) واقعی می‌شود و در job_runs «success» می‌ماند
    settings.update({ auditArchiveEnabled: true });
    return wrapJob('auditArchive', () => runAuditArchive({ now: NOW, log: silent }))().then((res) => {
      assert.equal(res.ok, true);
      assert.equal(total().archive, 3);
      assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'auditArchive' ORDER BY id DESC").get().status, 'success');
      settings.update({ auditArchiveEnabled: false });
    });
  });

  test('تراکنش: خطا در وسط batch همه‌چیز را برمی‌گرداند (id تکراری در آرشیو)؛ batchهای قبلی سالم می‌مانند و Job «error» می‌شود؛ ورودی نامعتبر رد می‌شود', async () => {
    const ids = reseed();
    const cutoff = '2024-10-06 12:30:45';
    // تصادم: همان id رکورد old3 از قبل در آرشیو هست ⇒ batch دوم (old3) باید کامل برگردد
    db.prepare('INSERT INTO audit_log_archive (id, action, occurred_at) VALUES (?, ?, ?)').run(ids.old3, 'collision', '1999-01-01 00:00:00');
    const sumBefore = sum();

    // خودِ batch: تنها old3 قدیمی نمی‌ماند اگر batch بزرگ باشد؛ batch=3 همه را یک‌جا می‌خواهد ⇒ rollback کامل
    assert.throws(() => auditRepository.archiveBatch(cutoff, 3), /UNIQUE|PRIMARY|constraint/i);
    assert.equal(sum(), sumBefore, 'rollback: جمع تغییر نکرده');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE id IN (?, ?, ?)').get(ids.old1, ids.old2, ids.old3).n, 3, 'هیچ رکوردی از اصلی حذف نشده');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log_archive').get().n, 1, 'هیچ ردیفی به آرشیو اضافه نشده');

    // Job با batch=2: batch اول (old1, old2) commit می‌شود، batch دوم (old3) برمی‌گردد ⇒ error
    const origErr = console.error;
    console.error = silent;
    let res;
    try { res = await wrapJob('auditArchive', () => runAuditArchive({ now: NOW, retentionMonths: 24, enabled: true, batchSize: 2, log: silent }))(); } finally { console.error = origErr; }
    assert.equal(res.ok, false);
    assert.equal(db.prepare("SELECT status FROM job_runs WHERE job_name = 'auditArchive' ORDER BY id DESC").get().status, 'error');
    assert.equal(sum(), sumBefore, 'حتی با خطا جمع اصلی+آرشیو برابر است (چیزی گم نشد)');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE id IN (?, ?)').get(ids.old1, ids.old2).n, 0, 'batch اول سالم منتقل شده');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log WHERE id = ?').get(ids.old3).n, 1, 'رکورد batch ناموفق هنوز در اصلی است');

    assert.throws(() => auditRepository.archiveBatch("2024-10-06'; DROP TABLE audit_log; --", 10), /cutoff/);
    for (const bad of [0, -1, 1.5, 10001, '5', null]) assert.throws(() => auditRepository.archiveBatch(cutoff, bad), /batchSize/, `batchSize ${bad}`);
    assert.equal(sum(), sumBefore);
  });

  test('حجم بیشتر: ۲۵۰۰ رکورد قدیمی با batch=1000 ⇒ ۳ batch، جمع اصلی+آرشیو برابر و ترتیب زمانی حفظ می‌شود', () => {
    db.exec('DELETE FROM audit_log_archive; DELETE FROM audit_log;');
    const ins = db.prepare('INSERT INTO audit_log (action, occurred_at) VALUES (?, ?)');
    db.transaction(() => {
      for (let i = 0; i < 2500; i += 1) {
        const sec = String(i % 60).padStart(2, '0');
        const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
        ins.run('bulk', `2019-03-04 07:${min}:${sec}`);
      }
      ins.run('keep', '2026-10-01 00:00:00');
    })();
    const sumBefore = sum();
    const r = runAuditArchive({ now: NOW, retentionMonths: 24, enabled: true, batchSize: 1000, log: silent });
    assert.equal(r.moved, 2500);
    assert.equal(r.batches, 3);
    assert.equal(sum(), sumBefore + 1, 'جمع قبل + فقط رکورد audit_archived');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'bulk'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log_archive WHERE action = 'bulk'").get().n, 2500);
    // قدیمی‌ترین‌ها اول: آخرین batch شامل جدیدترین رکوردهای قدیمی است؛ کل آرشیو بدون حفره
    assert.equal(db.prepare('SELECT MIN(occurred_at) m FROM audit_log_archive').get().m, '2019-03-04 07:00:00');
    assert.equal(db.prepare('SELECT COUNT(DISTINCT id) n FROM audit_log_archive').get().n, 2500);
  });
});

describe('include_archive در endpointهای audit (S2-6c)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, admin, mgr, user;

  before(async () => {
    db = resetDb();
    const { createApp } = require('../src/server');
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    user = F.makeUser({ name: 'کارمند آرشیوی' });
    db.exec('DELETE FROM audit_log');
    const ins = db.prepare('INSERT INTO audit_log (user_id, action, occurred_at, details) VALUES (?, ?, ?, ?)');
    ins.run(user.id, 'live_action', '2026-10-05 10:00:00', 'تازه');
    ins.run(user.id, 'old_action', '2020-02-02 02:02:02', 'قدیمی');
    ins.run(null, 'old_other', '2021-03-03 03:03:03', 'قدیمی دیگر');
    // دو رکورد قدیمی را واقعاً با همان Job منتقل می‌کنیم
    const r = runAuditArchive({ now: new Date('2026-10-06T00:00:00Z'), retentionMonths: 24, enabled: true, log: () => {} });
    assert.equal(r.moved, 2);
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); cleanup(); });

  const get = async (who, url) => {
    const res = await fetch(base + url, { headers: { 'x-requested-with': 'AttendancePanel', cookie: F.sessionCookie(who.id) } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* CSV یا بدنه‌ی غیر JSON */ }
    return { status: res.status, json, text };
  };
  const actions = (r) => r.json.map((x) => x.action);

  test('فهرست: بدون پارامتر فقط audit_log (بدون ستون archived)؛ با include_archive=1 آرشیو هم با پرچم archived؛ 0/false مثل نبودن', async () => {
    const plain = await get(admin, '/api/admin/audit-log?limit=100');
    assert.equal(plain.status, 200);
    assert.ok(actions(plain).includes('live_action'));
    assert.ok(!actions(plain).includes('old_action'), 'رکورد آرشیوشده بدون include_archive دیده نمی‌شود');
    assert.ok(plain.json.every((x) => !('archived' in x)), 'قالب پیش‌فرض بدون تغییر');

    for (const v of ['0', 'false', '']) {
      const r = await get(admin, `/api/admin/audit-log?include_archive=${v}`);
      assert.equal(r.status, 200, `include_archive=${v}`);
      assert.ok(!actions(r).includes('old_action'));
    }

    for (const v of ['1', 'true']) {
      const all = await get(admin, `/api/admin/audit-log?include_archive=${v}&limit=100`);
      assert.equal(all.status, 200);
      assert.equal(all.json.length, plain.json.length + 2, 'اصلی + آرشیو');
      const byAction = Object.fromEntries(all.json.map((x) => [x.action, x]));
      assert.equal(byAction.live_action.archived, false);
      assert.equal(byAction.old_action.archived, true);
      assert.equal(byAction.old_action.userFullName, 'کارمند آرشیوی');
      assert.equal(byAction.old_other.archived, true);
      // ترتیب: جدیدترین اول، آرشیو بین‌خودش هم مرتب
      assert.deepEqual(all.json.map((x) => x.occurred_at), [...all.json.map((x) => x.occurred_at)].sort().reverse());
    }
    // فیلترها روی آرشیو هم کار می‌کنند
    const filtered = await get(admin, `/api/admin/audit-log?include_archive=1&userId=${user.id}&from=2020-01-01&to=2020-12-31`);
    assert.deepEqual(actions(filtered), ['old_action']);
    assert.equal((await get(admin, '/api/admin/audit-log?action=old_action')).json.length, 0);
  });

  test('خروجی CSV: با include_archive ستون «منبع» و ردیف‌های آرشیو؛ بدون آن قالب قبلی؛ مقدار نامعتبر ۴۰۰؛ سرپرست ۴۰۳', async () => {
    const plain = await get(admin, '/api/admin/audit-log/export');
    assert.equal(plain.status, 200);
    assert.ok(!plain.text.includes('old_action'));
    assert.ok(!plain.text.includes('منبع'));

    const all = await get(admin, '/api/admin/audit-log/export?include_archive=1');
    assert.equal(all.status, 200);
    assert.ok(all.text.includes('old_action') && all.text.includes('old_other') && all.text.includes('live_action'));
    assert.ok(all.text.includes('منبع'));
    const line = all.text.split(/\r?\n/).find((l) => l.includes('old_action'));
    assert.ok(line.includes('آرشیو'));
    assert.ok(all.text.split(/\r?\n/).find((l) => l.includes('live_action')).includes('اصلی'));

    const byUser = await get(admin, `/api/admin/audit-log/export?include_archive=true&userId=${user.id}`);
    assert.ok(byUser.text.includes('old_action') && !byUser.text.includes('old_other'));

    for (const url of ['/api/admin/audit-log?include_archive=yes', '/api/admin/audit-log?include_archive=1&include_archive=0', '/api/admin/audit-log/export?include_archive=2']) {
      const r = await get(admin, url);
      assert.equal(r.status, 400, url);
    }
    assert.equal((await get(mgr, '/api/admin/audit-log?include_archive=1')).status, 403);
    assert.equal((await get(mgr, '/api/admin/audit-log/export?include_archive=1')).status, 403);
  });
});
