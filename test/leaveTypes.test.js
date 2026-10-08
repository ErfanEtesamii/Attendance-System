// S4-7a: انواع مرخصی/مأموریت — migration ۰۱۳ (ساختار + دو ردیف پیش‌فرض)، اعتبارسنجی خالص، repository، API CRUD (دسترسی، دلیل اجباری، audit).
// leave_requests را migration ۰۱۴ (S4-7b) به این جدول وصل می‌کند؛ API روی اپ واقعی و بدون express نصب‌شده skip می‌شود.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('انواع مرخصی — migration، اعتبارسنجی و repository (S4-7a)', () => {
  let db;
  before(() => { db = resetDb(); });
  after(cleanup);

  test('migration ۰۱۳: ستون‌ها، دو ردیف پیش‌فرض، اجرای دوباره ویرایش ادمین را بازنویسی نمی‌کند، CHECK/UNIQUE، و leave_requests دست‌نخورده', () => {
    const cols = db.prepare("PRAGMA table_info('leave_types')").all().map((c) => c.name);
    for (const c of ['code', 'title', 'kind', 'is_paid', 'requires_attachment', 'counts_against_balance', 'allowed_units', 'max_consecutive_days', 'is_active']) assert.ok(cols.includes(c), c);
    const seeded = db.prepare('SELECT code, title, kind, is_paid, counts_against_balance, allowed_units, max_consecutive_days, is_active FROM leave_types ORDER BY id').all();
    assert.deepEqual(seeded, [
      { code: 'annual', title: 'مرخصی استحقاقی', kind: 'leave', is_paid: 1, counts_against_balance: 1, allowed_units: '["day"]', max_consecutive_days: null, is_active: 1 },
      { code: 'mission', title: 'مأموریت', kind: 'mission', is_paid: 1, counts_against_balance: 0, allowed_units: '["day"]', max_consecutive_days: null, is_active: 1 },
    ]);

    // migration ۰۱۳ خودش leave_requests را عوض نمی‌کند؛ ستون‌های leave_type_id/rejected_reason از migration ۰۱۴ (S4-7b) هستند
    assert.deepEqual(db.prepare("PRAGMA table_info('leave_requests')").all().map((c) => c.name), ['id', 'user_id', 'start_date', 'end_date', 'leave_type', 'leave_type_id', 'status', 'approver_id', 'reason', 'rejected_reason', 'unit', 'half_day_part', 'start_time', 'end_time', 'duration_minutes', 'created_at', 'updated_at', 'current_step', 'substitute_user_id', 'attachment_id', 'attachment_mime', 'attachment_size', 'attachment_name']);

    db.prepare("UPDATE leave_types SET title = 'استحقاقی (ویرایش‌شده)' WHERE code = 'annual'").run();
    assert.doesNotThrow(() => require('../src/db/migrations/013_leave_types').up(db));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM leave_types').get().n, 2);
    assert.equal(db.prepare("SELECT title FROM leave_types WHERE code = 'annual'").get().title, 'استحقاقی (ویرایش‌شده)');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM schema_migrations WHERE name = '013_leave_types'").get().n, 1);

    const ins = (code, extra = '') => db.exec(`INSERT INTO leave_types (code, title${extra ? ', ' + extra.split('=')[0] : ''}) VALUES ('${code}', 'x'${extra ? ', ' + extra.split('=')[1] : ''})`);
    assert.throws(() => ins('annual'), /UNIQUE/);
    assert.throws(() => ins('t1', "kind='sick'"), /CHECK/);
    assert.throws(() => ins('t2', 'is_paid=2'), /CHECK/);
    assert.throws(() => ins('t3', 'max_consecutive_days=0'), /CHECK/);
    assert.doesNotThrow(() => ins('t4', 'max_consecutive_days=NULL'));
    db.prepare("DELETE FROM leave_types WHERE code IN ('t4')").run();
    db.prepare("UPDATE leave_types SET title = 'مرخصی استحقاقی' WHERE code = 'annual'").run();
  });

  test('اعتبارسنجی خالص: پیش‌فرض‌ها، نرمال‌سازی واحدها، و جدول موارد نامعتبر (code در ویرایش، kind، سقف، واحد، فیلد ناشناخته)', () => {
    const { validateLeaveTypeInput } = require('../src/utils/leaveTypeValidation');
    const ok = validateLeaveTypeInput({ code: ' sick ', title: '  استعلاجی ', allowedUnits: ['hour', 'day'], maxConsecutiveDays: '5', reason: 'نادیده' });
    assert.deepEqual(ok, { ok: true, value: { code: 'sick', title: 'استعلاجی', kind: 'leave', isPaid: true, requiresAttachment: false, countsAgainstBalance: true, allowedUnits: ['day', 'hour'], maxConsecutiveDays: 5, isActive: true } });
    assert.equal(validateLeaveTypeInput({ code: 'x1', title: 't', maxConsecutiveDays: null }).value.maxConsecutiveDays, null);

    const base = { code: 'abc', title: 'عنوان' };
    const invalid = [
      [{ title: 'x' }, 'code'], [{ code: 'x' }, 'title'],
      [{ ...base, code: 'A1' }, 'code'], [{ ...base, code: '1ab' }, 'code'], [{ ...base, code: 'a' }, 'code'], [{ ...base, code: 'a'.repeat(33) }, 'code'], [{ ...base, code: 'a b' }, 'code'],
      [{ ...base, title: '   ' }, 'title'], [{ ...base, title: 'a'.repeat(61) }, 'title'],
      [{ ...base, kind: 'sick' }, 'kind'],
      [{ ...base, isPaid: 'maybe' }, 'isPaid'], [{ ...base, isActive: 2 }, 'isActive'],
      [{ ...base, allowedUnits: [] }, 'allowedUnits'], [{ ...base, allowedUnits: 'day' }, 'allowedUnits'], [{ ...base, allowedUnits: ['week'] }, 'allowedUnits'], [{ ...base, allowedUnits: ['day', 'day'] }, 'allowedUnits'],
      [{ ...base, maxConsecutiveDays: 0 }, 'maxConsecutiveDays'], [{ ...base, maxConsecutiveDays: 367 }, 'maxConsecutiveDays'], [{ ...base, maxConsecutiveDays: 1.5 }, 'maxConsecutiveDays'], [{ ...base, maxConsecutiveDays: 'x' }, 'maxConsecutiveDays'],
      [{ ...base, foo: 1 }, 'foo'],
    ];
    for (const [input, field] of invalid) {
      const r = validateLeaveTypeInput(input);
      assert.equal(r.ok, false, JSON.stringify(input));
      assert.equal(r.field, field, JSON.stringify(input));
      assert.match(r.error, /[\u0600-\u06FF]/);
    }
    const noCode = validateLeaveTypeInput({ code: 'new_code' }, { partial: true });
    assert.equal(noCode.ok, false);
    assert.equal(noCode.field, 'code');
    assert.deepEqual(validateLeaveTypeInput({ isActive: false }, { partial: true }), { ok: true, value: { isActive: false } });
  });

  test('repository: ساخت/ویرایش/فهرست (activeOnly)/حذف؛ نوع ارجاع‌شده حذف نمی‌شود؛ allowed_units خراب ⇒ آرایه‌ی خالی', () => {
    const repo = require('../src/repositories/leaveTypesRepository');
    const t = repo.createLeaveType({ code: 'unpaid', title: 'بدون حقوق', kind: 'leave', isPaid: false, requiresAttachment: false, countsAgainstBalance: false, allowedUnits: ['day', 'half_day'], maxConsecutiveDays: 30, isActive: true });
    assert.deepEqual([t.code, t.isPaid, t.countsAgainstBalance, t.allowedUnits, t.maxConsecutiveDays, t.isActive], ['unpaid', false, false, ['day', 'half_day'], 30, true]);
    assert.equal(repo.findByCode('unpaid').id, t.id);

    const u = repo.updateLeaveType(t.id, { isActive: false, maxConsecutiveDays: null, allowedUnits: ['hour'] });
    assert.deepEqual([u.isActive, u.maxConsecutiveDays, u.allowedUnits], [false, null, ['hour']]);
    assert.deepEqual(repo.listLeaveTypes({ activeOnly: true }).map((x) => x.code), ['annual', 'mission']);
    assert.deepEqual(repo.listLeaveTypes().map((x) => x.code), ['annual', 'mission', 'unpaid']);

    db.prepare("UPDATE leave_types SET allowed_units = 'not json' WHERE id = ?").run(t.id);
    assert.deepEqual(repo.findById(t.id).allowedUnits, []);

    const { makeUser } = require('./helpers/factories');
    const user = makeUser();
    db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (?, '2026-10-01', '2026-10-01', 'leave', ?)").run(user.id, t.id);
    assert.equal(repo.countRequests(t.id), 1);
    assert.equal(repo.isReferenced(t.id), true);
    assert.equal(repo.deleteIfUnused(t.id), false);
    db.prepare('DELETE FROM leave_requests WHERE leave_type_id = ?').run(t.id);
    assert.equal(repo.deleteIfUnused(t.id), true);
    assert.equal(repo.findById(t.id), null);
  });
});

describe('API انواع مرخصی (S4-7a)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies, admin, user;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    admin = makeUser({ role: 'admin' });
    const mgr = makeUser({ role: 'manager' });
    const hr = makeUser({ role: 'hr' });
    user = makeUser({ role: 'employee', managerId: mgr.id });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(mgr.id), hr: sessionCookie(hr.id), employee: sessionCookie(user.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  async function hit(role, method, url, body, { csrf = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(base + url, { method, headers, body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const auditRows = (action) => db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action).map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const good = { code: 'sick', title: 'مرخصی استعلاجی', requiresAttachment: true, countsAgainstBalance: false, allowedUnits: ['day', 'hour'], reason: 'نوع جدید' };

  test('دسترسی: بدون سشن ۴۰۱، کارمند ۴۰۳، سرپرست و hr فقط خواندن، بدون هدر CSRF ۴۰۳؛ هیچ ردشده‌ای چیزی ننوشته است', async () => {
    assert.equal((await hit('none', 'GET', '/api/admin/leave-types')).status, 401);
    assert.equal((await hit('employee', 'GET', '/api/admin/leave-types')).status, 403);
    for (const role of ['manager', 'hr', 'admin']) assert.equal((await hit(role, 'GET', '/api/admin/leave-types')).status, 200, role);
    for (const role of ['employee', 'manager', 'hr']) {
      for (const [m, u, b] of [['POST', '/api/admin/leave-types', good], ['PATCH', '/api/admin/leave-types/1', { title: 'x', reason: 'r' }], ['DELETE', '/api/admin/leave-types/1', { reason: 'r' }]]) {
        assert.equal((await hit(role, m, u, b)).status, 403, `${role} ${m}`);
      }
    }
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-types', good, { csrf: false })).status, 403);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM leave_types').get().n, 2);
    assert.equal(auditRows('leave_type_created').length, 0);
  });

  test('ایجاد/خواندن: دلیل اجباری، ۴۰۰، کد تکراری ۴۰۹، فهرست و active=1؛ audit با after و دلیل', async () => {
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-types', { ...good, reason: '  ' })).status, 400);
    const bad = await hit('admin', 'POST', '/api/admin/leave-types', { ...good, kind: 'sick' });
    assert.deepEqual([bad.status, bad.json.field], [400, 'kind']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM leave_types').get().n, 2);

    const created = await hit('admin', 'POST', '/api/admin/leave-types', good);
    assert.equal(created.status, 201);
    assert.deepEqual([created.json.code, created.json.kind, created.json.requiresAttachment, created.json.countsAgainstBalance, created.json.allowedUnits, created.json.isActive, created.json.requestCount], ['sick', 'leave', true, false, ['day', 'hour'], true, 0]);
    assert.equal((await hit('admin', 'POST', '/api/admin/leave-types', good)).status, 409);

    const rows = auditRows('leave_type_created');
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].user_id, rows[0].details.entityType, rows[0].details.entityId, rows[0].details.reason, rows[0].details.source], [admin.id, 'leave_type', created.json.id, 'نوع جدید', 'admin_panel']);
    assert.equal(rows[0].details.changes.code.after, 'sick');

    const list = await hit('manager', 'GET', '/api/admin/leave-types');
    assert.deepEqual(list.json.map((t) => t.code), ['annual', 'mission', 'sick']);
    await hit('admin', 'PATCH', `/api/admin/leave-types/${created.json.id}`, { isActive: false, reason: 'فعلاً استفاده نمی‌شود' });
    assert.deepEqual((await hit('manager', 'GET', '/api/admin/leave-types?active=1')).json.map((t) => t.code), ['annual', 'mission']);
    assert.equal((await hit('hr', 'GET', `/api/admin/leave-types/${created.json.id}`)).json.code, 'sick');
    assert.equal((await hit('admin', 'GET', '/api/admin/leave-types/999999')).status, 404);
    assert.equal((await hit('admin', 'GET', '/api/admin/leave-types/abc')).status, 404);
  });

  test('ویرایش: no-op، code قابل تغییر نیست، audit قبل/بعد؛ kind نوع ارجاع‌شده ممنوع (۴۰۹)؛ حذف: ۴۰۹ IN_USE یا موفق با audit', async () => {
    const annual = db.prepare("SELECT id FROM leave_types WHERE code = 'annual'").get().id;
    const noop = await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { title: 'مرخصی استحقاقی', reason: 'بدون تغییر' });
    assert.deepEqual([noop.status, noop.json.changed], [200, false]);
    assert.equal(auditRows('leave_type_updated').length, 1, 'فقط ویرایش isActive قبلی'); // از تست قبل
    const codeTry = await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { code: 'other', reason: 'r' });
    assert.deepEqual([codeTry.status, codeTry.json.field], [400, 'code']);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { title: 'x' })).status, 400, 'دلیل اجباری');
    assert.equal((await hit('admin', 'PATCH', '/api/admin/leave-types/999999', { title: 'x', reason: 'r' })).status, 404);

    const upd = await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { maxConsecutiveDays: 15, allowedUnits: ['day', 'half_day'], reason: 'سقف شرکت' });
    assert.deepEqual([upd.status, upd.json.changed, upd.json.leaveType.maxConsecutiveDays, upd.json.leaveType.allowedUnits], [200, true, 15, ['day', 'half_day']]);
    const row = auditRows('leave_type_updated').pop();
    assert.deepEqual(row.details.changes.maxConsecutiveDays, { before: null, after: 15 });
    assert.equal(row.details.changes.title, undefined, 'فیلد بدون تغییر در diff نیست');
    assert.equal(row.details.reason, 'سقف شرکت');

    // ارجاع‌شده: kind قفل، حذف ممنوع، ولی غیرفعال‌سازی/ویرایش بقیه آزاد
    db.prepare("INSERT INTO leave_requests (user_id, start_date, end_date, leave_type, leave_type_id) VALUES (?, '2026-10-01', '2026-10-01', 'leave', ?)").run(user.id, annual);
    const kind = await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { kind: 'mission', reason: 'r' });
    assert.deepEqual([kind.status, kind.json.code], [409, 'IN_USE']);
    assert.equal(db.prepare('SELECT kind FROM leave_types WHERE id = ?').get(annual).kind, 'leave');
    const del = await hit('admin', 'DELETE', `/api/admin/leave-types/${annual}`, { reason: 'r' });
    assert.deepEqual([del.status, del.json.code, del.json.requestCount], [409, 'IN_USE', 1]);
    assert.equal(auditRows('leave_type_deleted').length, 0);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { isActive: false, reason: 'غیرفعال' })).json.changed, true);
    assert.equal((await hit('admin', 'PATCH', `/api/admin/leave-types/${annual}`, { isActive: true, reason: 'فعال' })).json.changed, true);

    // بدون ارجاع: حذف موفق، دلیل اجباری (query هم قبول)، audit با before
    const sick = db.prepare("SELECT id FROM leave_types WHERE code = 'sick'").get().id;
    assert.equal((await hit('admin', 'DELETE', `/api/admin/leave-types/${sick}`)).status, 400);
    assert.deepEqual((await hit('admin', 'DELETE', `/api/admin/leave-types/${sick}?reason=${encodeURIComponent('اشتباه ساخته شد')}`)).json, { ok: true });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM leave_types WHERE id = ?').get(sick).n, 0);
    const delRow = auditRows('leave_type_deleted');
    assert.equal(delRow.length, 1);
    assert.deepEqual([delRow[0].details.entityId, delRow[0].details.changes.code.before, delRow[0].details.reason], [sick, 'sick', 'اشتباه ساخته شد']);
    assert.equal((await hit('admin', 'DELETE', `/api/admin/leave-types/${sick}`, { reason: 'r' })).status, 404);
  });
});
