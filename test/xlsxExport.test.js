// S5-1a: هسته‌ی خروجی xlsx + fallback به CSV (src/utils/xlsx.js) و اتصال آن به routeهای خروجی (?format=xlsx).
// بخش خالص (fallback/نام شیت/format) بدون exceljs و بدون DB اجرا می‌شود؛
// «باز شدن واقعی فایل» فقط وقتی exceljs نصب است اجرا می‌شود (وگرنه skip)؛ بخش route فقط وقتی وابستگی‌های سرور نصب است.
const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const xlsx = require('../src/utils/xlsx');

let hasExcel = true;
try { require.resolve('exceljs'); } catch (_) { hasExcel = false; }
let hasServerDeps = true;
try { require.resolve('better-sqlite3'); require.resolve('express'); } catch (_) { hasServerDeps = false; }

// req/res ساختگی (فقط آنچه sendTable/sendCsv استفاده می‌کنند)
function fakeRes() {
  const res = {
    headers: {}, statusCode: 200, body: undefined, headersSent: false,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    status(c) { res.statusCode = c; return res; },
    json(o) { res.body = o; res.headersSent = true; return res; },
    send(b) { res.body = b; res.headersSent = true; return res; },
  };
  return res;
}
const reqOf = (format) => ({ query: format === undefined ? {} : { format } });
const HEADERS = ['نام', 'امتیاز', 'توضیح'];
const ROWS = [['الف', 5, 'سلام'], ['ب', 12.5, null]];

describe('xlsx: fallback به CSV وقتی exceljs در دسترس نیست (S5-1a)', () => {
  afterEach(() => xlsx._setLoaderForTest(null));

  test('بارگذاری ماژول هرگز نمی‌شکند؛ بدون exceljs: isAvailable=false و buildWorkbook با کد XLSX_UNAVAILABLE', () => {
    xlsx._setLoaderForTest(() => { const e = new Error("Cannot find module 'exceljs'"); e.code = 'MODULE_NOT_FOUND'; throw e; });
    assert.equal(xlsx.isAvailable(), false);
    assert.throws(() => xlsx.buildWorkbook({ sheets: [{ name: 'x', headers: ['a'], rows: [] }] }), (e) => e.code === 'XLSX_UNAVAILABLE' && e instanceof xlsx.XlsxUnavailableError);
  });

  test('?format=xlsx بدون exceljs ⇒ همان داده به‌صورت CSV (BOM، پسوند .csv) با هدر و پیام واضح؛ warning فقط یک‌بار', async () => {
    xlsx._setLoaderForTest(() => { throw new Error("Cannot find module 'exceljs'"); });
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    try {
      const r1 = fakeRes();
      await xlsx.sendTable(reqOf('xlsx'), r1, 'employees.csv', HEADERS, ROWS);
      const r2 = fakeRes();
      await xlsx.sendTable(reqOf('XLSX'), r2, 'employees', HEADERS, ROWS);

      assert.equal(r1.statusCode, 200);
      assert.match(r1.headers['content-type'], /^text\/csv/);
      assert.match(r1.headers['content-disposition'], /filename="employees\.csv"/);
      assert.equal(r1.headers['x-export-fallback'], 'csv');
      assert.equal(decodeURIComponent(r1.headers['x-export-notice']), xlsx.FALLBACK_NOTICE);
      assert.match(xlsx.FALLBACK_NOTICE, /exceljs/);
      assert.ok(r1.body.startsWith('\uFEFF'), 'BOM');
      assert.ok(r1.body.includes('نام,امتیاز,توضیح') && r1.body.includes('ب,12.5,'));
      assert.match(r2.headers['content-disposition'], /filename="employees\.csv"/, 'نام بدون پسوند هم .csv می‌شود');
      assert.equal(warns.length, 1, 'warning فقط یک‌بار در لاگ');
      assert.match(warns[0], /exceljs/);
    } finally {
      console.warn = orig;
    }
  });

  test('بدون format یا format=csv ⇒ CSV مثل قبل و بدون هدر fallback؛ format نامعتبر ⇒ ۴۰۰', async () => {
    xlsx._setLoaderForTest(() => { throw new Error('x'); });
    for (const f of [undefined, '', 'csv', 'CSV']) {
      const r = fakeRes();
      await xlsx.sendTable(reqOf(f), r, 'a.csv', HEADERS, ROWS);
      assert.match(r.headers['content-type'], /^text\/csv/, String(f));
      assert.equal(r.headers['x-export-fallback'], undefined, String(f));
    }
    const bad = fakeRes();
    await xlsx.sendTable(reqOf('pdf'), bad, 'a.csv', HEADERS, ROWS);
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.code, 'INVALID_FORMAT');
  });

  test('خطای غیرمنتظره‌ی ساخت xlsx (نه نبودن ماژول) ⇒ ۵۰۰ تمیز، نه CSV پنهانی و نه exception', async () => {
    xlsx._setLoaderForTest(() => ({ Workbook: function Workbook() { throw new Error('boom'); } }));
    const origErr = console.error;
    console.error = () => {};
    try {
      const r = fakeRes();
      await xlsx.sendTable(reqOf('xlsx'), r, 'a.csv', HEADERS, ROWS);
      assert.equal(r.statusCode, 500);
      assert.equal(r.body.code, 'XLSX_FAILED');
    } finally {
      console.error = origErr;
    }
  });
});

describe('xlsx: نام شیت اکسل', () => {
  test('نویسه‌های ممنوع، طول ۳۱، خالی، یکتایی بدون توجه به حروف', () => {
    assert.equal(xlsx.sanitizeSheetName('a/b\\c*d?e:f[g]h'), 'a_b_c_d_e_f_g_h');
    assert.equal(xlsx.sanitizeSheetName('x'.repeat(40)).length, 31);
    assert.equal(xlsx.sanitizeSheetName(''), 'Sheet');
    assert.equal(xlsx.sanitizeSheetName(null), 'Sheet');
    assert.equal(xlsx.sanitizeSheetName("'quoted'"), 'quoted');
    assert.equal(xlsx.sanitizeSheetName('Report', ['report']), 'Report (2)');
    const long = 'y'.repeat(31);
    const second = xlsx.sanitizeSheetName(long, [long]);
    assert.equal(second.length, 31);
    assert.ok(second.endsWith(' (2)'));
  });
});

describe('xlsx: فایل واقعی (فقط با exceljs نصب‌شده)', { skip: hasExcel ? false : 'exceljs نصب نیست' }, () => {
  async function roundTrip(spec) {
    const ExcelJS = require('exceljs');
    const buf = await xlsx.workbookToBuffer(xlsx.buildWorkbook(spec));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return { wb, buf };
  }

  test('فایل معتبر zip/xlsx است و دوباره باز می‌شود؛ داده‌ی فارسی و نوع عدد سالم می‌ماند', async () => {
    const { wb, buf } = await roundTrip({ sheets: [{ name: 'کارمندان', headers: HEADERS, rows: [...ROWS, ['=SUM(1+1)', 0, '@x']] }] });
    assert.equal(buf.slice(0, 2).toString(), 'PK');
    assert.equal(wb.worksheets.length, 1);
    const ws = wb.worksheets[0];
    assert.equal(ws.name, 'کارمندان');
    assert.deepEqual([1, 2, 3].map((c) => ws.getCell(1, c).value), HEADERS);
    assert.equal(ws.getCell(2, 1).value, 'الف');
    assert.equal(typeof ws.getCell(3, 2).value, 'number');
    assert.equal(ws.getCell(3, 2).value, 12.5);
    assert.ok(ws.getCell(3, 3).value === null || ws.getCell(3, 3).value === '', 'null ⇒ سلول خالی');
    // رشته‌ی شبیه فرمول فرمول نمی‌شود و (S5-1c) با «'» خنثی است
    assert.equal(typeof ws.getCell(4, 1).value, 'string');
    assert.equal(ws.getCell(4, 1).value, "'=SUM(1+1)");
  });

  test('RTL، فریز سرستون و فیلتر خودکار روی ردیف ۱', async () => {
    const { wb } = await roundTrip({ sheets: [{ name: 'a', headers: HEADERS, rows: ROWS }] });
    const ws = wb.worksheets[0];
    const v = ws.views[0];
    assert.equal(v.rightToLeft, true);
    assert.equal(v.state, 'frozen');
    assert.equal(v.ySplit, 1);
    const af = ws.autoFilter;
    const ref = typeof af === 'string' ? af : `${af.from.row}:${af.from.column}-${af.to.row}:${af.to.column}`;
    assert.ok(ref === 'A1:C1' || ref === '1:1-1:3', `autoFilter: ${ref}`);
    assert.equal(ws.getRow(1).font.bold, true);
  });

  test('چند شیت با نام تکراری/ممنوع یکتا و معتبر می‌شوند؛ شیت بدون ردیف هم فقط سرستون دارد', async () => {
    const { wb } = await roundTrip({ sheets: [
      { name: 'گزارش', headers: ['a'], rows: [] },
      { name: 'گزارش', headers: ['a'], rows: [[1]] },
      { name: 'x/y', headers: ['a', 'b'], rows: [[1, 2]] },
    ] });
    assert.deepEqual(wb.worksheets.map((s) => s.name), ['گزارش', 'گزارش (2)', 'x_y']);
    assert.equal(wb.worksheets[0].rowCount, 1);
  });

  test('sendTable با ?format=xlsx: Content-Type/پسوند درست و بدنه‌ی باینری قابل‌خواندن، بدون هدر fallback', async () => {
    const ExcelJS = require('exceljs');
    const r = fakeRes();
    await xlsx.sendTable(reqOf('xlsx'), r, 'employees.csv', HEADERS, ROWS, { sheetName: 'کارمندان' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['content-type'], xlsx.XLSX_MIME);
    assert.match(r.headers['content-disposition'], /filename="employees\.xlsx"/);
    assert.equal(r.headers['x-export-fallback'], undefined);
    assert.ok(Buffer.isBuffer(r.body));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    assert.equal(wb.worksheets[0].name, 'کارمندان');
  });

  test('ورودی نامعتبر: بدون شیت/بدون سرستون ⇒ TypeError', () => {
    assert.throws(() => xlsx.buildWorkbook({ sheets: [] }), TypeError);
    assert.throws(() => xlsx.buildWorkbook({ sheets: [{ name: 'a', headers: [], rows: [] }] }), TypeError);
  });
});

describe('route خروجی با ?format=xlsx (S5-1a)', { skip: hasServerDeps ? false : 'وابستگی‌های سرور نصب نیست' }, () => {
  let server; let base; let cookie;
  before(async () => {
    const { resetDb } = require('./helpers/testEnv');
    resetDb();
    const { makeUser, sessionCookie } = require('./helpers/factories');
    const { createApp } = require('../src/server');
    cookie = sessionCookie(makeUser({ role: 'admin' }).id);
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); require('./helpers/testEnv').cleanup(); });

  const get = (url) => fetch(base + url, { headers: { cookie } });

  test('پیش‌فرض (بدون format) همچنان CSV با BOM و بدون هدر fallback', async () => {
    const res = await get('/api/admin/users/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /employees\.csv/);
    assert.equal(res.headers.get('x-export-fallback'), null);
    assert.ok((await res.text()).startsWith('\uFEFF'));
  });

  test('?format=xlsx: با exceljs ⇒ xlsx؛ بدون آن ⇒ CSV با هدر fallback (هر دو حالت سالم)', async () => {
    const res = await get('/api/admin/users/export?format=xlsx');
    assert.equal(res.status, 200);
    if (xlsx.isAvailable()) {
      assert.equal(res.headers.get('content-type'), xlsx.XLSX_MIME);
      assert.match(res.headers.get('content-disposition'), /employees\.xlsx/);
      assert.equal(Buffer.from(await res.arrayBuffer()).slice(0, 2).toString(), 'PK');
    } else {
      assert.match(res.headers.get('content-type'), /text\/csv/);
      assert.equal(res.headers.get('x-export-fallback'), 'csv');
      assert.ok(decodeURIComponent(res.headers.get('x-export-notice')).includes('exceljs'));
    }
  });

  test('format نامعتبر ⇒ ۴۰۰ و اسکوپ/مجوز همان قبل (بدون ورود ⇒ ۴۰۱)', async () => {
    assert.equal((await get('/api/admin/users/export?format=pdf')).status, 400);
    assert.equal((await fetch(`${base}/api/admin/users/export?format=xlsx`)).status, 401);
  });
});
