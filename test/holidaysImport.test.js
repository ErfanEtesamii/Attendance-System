// S3-9c: ورود گروهی تعطیلات (preview / commit) — تحلیلگر خالص و API
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { parseImport, parseDateText } = require('../src/utils/holidayInput');

describe('تحلیل ورودی گروهی تعطیلات (S3-9c)', () => {
  test('تاریخ: شمسی با ارقام فارسی/جداکننده‌های مختلف، میلادی، کبیسه و نامعتبر', () => {
    assert.deepEqual(parseDateText('1405/01/01'), { date: '2026-03-21', jalali: '1405/01/01' });
    assert.equal(parseDateText('۱۴۰۵-۱-۱').date, '2026-03-21');
    assert.equal(parseDateText('1403/12/30').date, '2025-03-20', '۳۰ اسفند سال کبیسه');
    assert.match(parseDateText('1404/12/30').error, /نامعتبر/, '۳۰ اسفند سال غیرکبیسه');
    assert.match(parseDateText('1405/13/01').error, /نامعتبر/);
    assert.match(parseDateText('1405/07/31').error, /نامعتبر/, 'مهر ۳۰ روزه است');
    assert.equal(parseDateText('1405/06/31').date, '2026-09-22', 'شهریور ۳۱ روزه است');
    assert.deepEqual(parseDateText('2026-03-21'), { date: '2026-03-21', jalali: '1405/01/01' });
    assert.match(parseDateText('2026-02-30').error, /نامعتبر/);
    assert.match(parseDateText('نوروز').error, /نامعتبر/);
  });

  test('قالب‌ها: فاصله، کاما، ; ، Tab، نقل‌قول، سرستون، توضیح #، ستون‌های اختیاری', () => {
    const text = [
      'تاریخ,عنوان',
      '# توضیح',
      '1405/01/01 نوروز',
      '',
      '۱۴۰۵/۰۱/۰۲,"عید، دوم"',
      '1405/01/03;سوم;نیم‌روز;۱۱:۰۰',
      '1405/01/04\tچهارم\tکامل\t\tمالی',
    ].join('\r\n');
    const { rows } = parseImport({ text });
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.ok), JSON.stringify(rows));
    assert.deepEqual(rows.map((r) => r.value.title), ['نوروز', 'عید، دوم', 'سوم', 'چهارم']);
    assert.equal(rows[2].value.kind, 'half');
    assert.equal(rows[2].value.halfEndTime, '11:00');
    assert.equal(rows[3].value.scope, 'department');
    assert.equal(rows[3].value.department, 'مالی');
    assert.equal(rows[0].line, 3, 'شماره‌ی خط اصلی حفظ می‌شود');
  });

  test('خط اول با ارقام فارسی سرستون حساب نمی‌شود (باگ: فقط ارقام ASCII دیده می‌شد)', () => {
    const { rows } = parseImport({ text: '۱۴۰۵/۰۱/۰۱ نوروز\n۱۴۰۵/۰۱/۰۲ دوم' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].value.date, '2026-03-21');
  });

  test('ردیف نامعتبر دلیل دارد: نوع ناشناخته، نیم‌روز بدون ساعت، عنوان خالی، عنوان طولانی', () => {
    const { rows } = parseImport({ text: ['1405/01/01,x,سه‌ربع', '1405/01/02,x,نیم‌روز', '1405/01/03', `1405/01/04,${'ع'.repeat(101)}`].join('\n') });
    assert.deepEqual(rows.map((r) => r.ok), [false, false, false, false]);
    assert.match(rows[0].error, /نوع/);
    assert.match(rows[1].error, /ساعت پایان/);
    assert.match(rows[2].error, /عنوان/);
    assert.match(rows[3].error, /۱۰۰/);
  });

  test('ورودی خالی یا بیش از سقف ردیف ⇒ خطا', () => {
    assert.ok(parseImport({ text: '  \n# فقط توضیح' }).error);
    assert.ok(parseImport({}).error);
    const many = Array.from({ length: 401 }, (_, i) => `1405/01/01 ${i}`).join('\n');
    assert.match(parseImport({ text: many }).error, /400/);
  });
});

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('API ورود گروهی تعطیلات (S3-9c)', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, db, cookies;

  before(async () => {
    db = resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    const admin = makeUser({ role: 'admin' });
    const manager = makeUser({ role: 'manager' });
    makeUser({ role: 'employee', department: 'مالی' });
    cookies = { admin: sessionCookie(admin.id), manager: sessionCookie(manager.id) };
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    cleanup();
  });

  async function hit(role, body, { csrf = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-requested-with'] = 'AttendancePanel';
    if (cookies[role]) headers.cookie = cookies[role];
    const res = await fetch(`${base}/api/admin/holidays/import`, { method: 'POST', headers, body: JSON.stringify(body) });
    let json = null;
    try { json = await res.json(); } catch (_) { /* بدنه خالی */ }
    return { status: res.status, json };
  }
  const count = () => db.prepare('SELECT COUNT(*) c FROM holidays').get().c;
  const audits = () => db.prepare("SELECT * FROM audit_log WHERE action = 'holidays_imported'").all();

  const TEXT = ['1405/01/01 نوروز', '1405/01/02,دوم', '1405/01/03;نیمه;نیم‌روز;11:30', '1405/01/04,تعطیلی مالی,کامل,,مالی'].join('\n');

  test('preview: هیچ چیز ذخیره نمی‌شود؛ خلاصه و تاریخ میلادی/شمسی هر ردیف', async () => {
    const r = await hit('admin', { text: TEXT });
    assert.equal(r.status, 200);
    assert.equal(r.json.committed, false);
    assert.deepEqual(r.json.summary, { total: 4, new: 4, duplicate: 0, duplicateInInput: 0, invalid: 0 });
    assert.equal(r.json.rows[0].date, '2026-03-21');
    assert.equal(r.json.rows[0].jalali, '1405/01/01');
    assert.equal(r.json.rows[2].kind, 'half');
    assert.equal(r.json.rows[3].scope, 'department');
    assert.equal(r.json.rows[3].warning, undefined, 'دپارتمان مالی کاربر دارد');
    assert.equal(count(), 0);
    assert.equal(audits().length, 0);
  });

  test('commit: ردیف‌ها ذخیره می‌شوند + یک audit؛ commit دوباره ⇒ همه تکراری و بدون تغییر', async () => {
    const r = await hit('admin', { text: TEXT, commit: true, reason: 'تقویم ۱۴۰۵' });
    assert.equal(r.status, 200);
    assert.equal(r.json.committed, true);
    assert.equal(r.json.summary.added, 4);
    assert.equal(count(), 4);
    const half = db.prepare("SELECT * FROM holidays WHERE holiday_date = '2026-03-23'").get();
    assert.equal(half.kind, 'half');
    assert.equal(half.half_end_time, '11:30');
    const rows = audits();
    assert.equal(rows.length, 1);
    const d = JSON.parse(rows[0].details);
    assert.equal(d.changes.added.before, null);
    assert.equal(d.changes.added.after.length, 4);
    assert.equal(d.summary.new, 4);
    assert.equal(d.reason, 'تقویم ۱۴۰۵');

    const again = await hit('admin', { text: TEXT, commit: true });
    assert.equal(again.status, 200);
    assert.deepEqual(again.json.summary, { total: 4, new: 0, duplicate: 4, duplicateInInput: 0, invalid: 0, added: 0 });
    assert.equal(count(), 4);
  });

  test('تکراری: با DB و داخل خودِ ورودی؛ فقط ردیف‌های جدید ذخیره می‌شوند', async () => {
    const text = ['1405/01/01 نوروز دوباره', '1405/02/01 روز جدید', '1405/02/01 همان روز جدید', '1405/02/01,مخصوص مالی,کامل,,مالی'].join('\n');
    const p = await hit('admin', { text });
    assert.deepEqual(p.json.rows.map((x) => x.status), ['duplicate', 'new', 'duplicate_in_input', 'new']);
    const c = await hit('admin', { text, commit: true });
    assert.equal(c.json.summary.added, 2);
    assert.equal(count(), 6);
    assert.equal(db.prepare("SELECT title FROM holidays WHERE holiday_date = '2026-04-21' AND scope = 'all'").get().title, 'روز جدید', 'اولی می‌ماند');
  });

  test('نامعتبر: preview خطای هر خط را می‌دهد؛ commit ⇒ ۴۲۲ و هیچ ردیفی (حتی معتبرها) ذخیره نمی‌شود', async () => {
    const before = count();
    const text = ['1405/03/01 معتبر', '1405/13/40 خراب', '1405/03/03,x,نیم‌روز'].join('\n');
    const p = await hit('admin', { text });
    assert.equal(p.status, 200);
    assert.equal(p.json.summary.invalid, 2);
    assert.equal(p.json.rows[1].line, 2);
    assert.match(p.json.rows[1].error, /نامعتبر/);
    const c = await hit('admin', { text, commit: true });
    assert.equal(c.status, 422);
    assert.equal(c.json.committed, false);
    assert.equal(count(), before);
  });

  test('دپارتمان ناشناس ⇒ هشدار (نه خطا)؛ items به‌جای text؛ ورودی خالی ۴۰۰', async () => {
    const r = await hit('admin', { items: [{ date: '1405/04/01', title: 'بایگانی', department: 'بایگانی' }, { date: '1405/04/02', title: 'کامل' }] });
    assert.equal(r.status, 200);
    assert.match(r.json.rows[0].warning, /هیچ کاربری/);
    assert.equal(r.json.rows[1].warning, undefined);
    assert.equal((await hit('admin', { text: '' })).status, 400);
    assert.equal((await hit('admin', {})).status, 400);
  });

  test('دسترسی: سرپرست ۴۰۳، بدون سشن ۴۰۱، بدون هدر CSRF ۴۰۳', async () => {
    assert.equal((await hit('manager', { text: TEXT })).status, 403);
    assert.equal((await hit('anon', { text: TEXT })).status, 401);
    assert.equal((await hit('admin', { text: TEXT }, { csrf: false })).status, 403);
  });
});
