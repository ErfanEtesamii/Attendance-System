// S5-1c: خنثی‌سازی formula injection (CSV و xlsx)، audit خروجی‌ها (callback onExport) و streaming.
// بخش‌های خالص بدون exceljs/DB اجرا می‌شوند (exceljs با یک ماژول ساختگیِ ثبت‌کننده جایگزین می‌شود)؛
// «فایل واقعی» فقط با exceljs نصب‌شده اجرا می‌شود (وگرنه skip).
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { neutralizeCell, neutralizeRow, isDangerousString } = require('../src/utils/exportSafety');
const { toCsv, sendCsv } = require('../src/utils/csv');
const xlsx = require('../src/utils/xlsx');

let hasExcel = true;
try { require.resolve('exceljs'); } catch (_) { hasExcel = false; }

function fakeRes() {
  const res = {
    headers: {}, statusCode: 200, body: undefined, headersSent: false, chunks: [], ended: false, destroyed: null,
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    removeHeader(k) { delete res.headers[k.toLowerCase()]; },
    status(c) { res.statusCode = c; return res; },
    json(o) { res.body = o; res.headersSent = true; return res; },
    send(b) { res.body = b; res.headersSent = true; return res; },
    write(c) { res.headersSent = true; res.chunks.push(c); return true; },
    end(c) { if (c) res.chunks.push(c); res.ended = true; },
    destroy(e) { res.destroyed = e || true; },
  };
  return res;
}
const reqOf = (format) => ({ query: format === undefined ? {} : { format } });

describe('exportSafety: neutralizeCell', () => {
  test('رشته‌هایی که با = + - @ (یا tab/CR) شروع شوند «\'» می‌گیرند', () => {
    for (const v of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(1)', '\t=1', '\r=1', '=HYPERLINK("http://x","y")', ' =1+1', '‏=1']) {
      assert.equal(neutralizeCell(v), `'${v}`, JSON.stringify(v));
      assert.equal(isDangerousString(v), true);
    }
  });

  test('متن عادی، فارسی، تاریخ، ساعت و رشته‌ی خالی دست‌نخورده‌اند', () => {
    for (const v of ['علی', 'ali=1', '1405/07/17', '08:30', '', 'a-b', "'x", '۱۲۳']) assert.equal(neutralizeCell(v), v, JSON.stringify(v));
  });

  test('عدد (حتی منفی)، بولی، Date، null و undefined تغییر نمی‌کنند', () => {
    const d = new Date();
    assert.equal(neutralizeCell(-5), -5);
    assert.equal(neutralizeCell(0), 0);
    assert.equal(neutralizeCell(true), true);
    assert.equal(neutralizeCell(d), d);
    assert.equal(neutralizeCell(null), null);
    assert.equal(neutralizeCell(undefined), undefined);
    assert.deepEqual(neutralizeRow(['=x', 1, null]), ["'=x", 1, null]);
  });
});

describe('CSV: injection و chunking', () => {
  test('toCsv سلول‌های خطرناک را خنثی می‌کند؛ سرستون هم؛ عدد منفی همان می‌ماند', () => {
    const csv = toCsv(['=h', 'b'], [['=cmd|x', -5], ['@a,b', 'ok'], ['+1', null]]);
    assert.equal(csv, "﻿'=h,b\r\n'=cmd|x,-5\r\n\"'@a,b\",ok\r\n'+1,");
  });

  test('خروجی تکه‌تکه (حجم بالا) بایت‌به‌بایت با حالت عادی یکسان است', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => [`n${i}`, i, i % 7 === 0 ? '=x' : 'متن, با ویرگول']);
    const normal = fakeRes();
    sendCsv(normal, 'a.csv', ['x', 'y', 'z'], rows);
    const prev = process.env.CSV_STREAM_ROWS;
    process.env.CSV_STREAM_ROWS = '100';
    try {
      const streamed = fakeRes();
      sendCsv(streamed, 'a.csv', ['x', 'y', 'z'], rows);
      assert.equal(streamed.ended, true);
      assert.ok(streamed.chunks.length > 2, 'چند تکه نوشته شده');
      assert.equal(streamed.chunks.join(''), normal.body);
      assert.equal(streamed.headers['content-type'], 'text/csv; charset=utf-8');
    } finally {
      if (prev === undefined) delete process.env.CSV_STREAM_ROWS; else process.env.CSV_STREAM_ROWS = prev;
    }
  });
});

// exceljs ساختگی: فقط ثبت می‌کند چه چیزی نوشته شد (برای تست تصمیم‌ها بدون ماژول واقعی)
function makeFakeExcel({ failAt = null } = {}) {
  const rec = { buffered: [], streamed: [], streamOpts: null };
  const mkRow = (store, values) => { const r = { values, font: null, committed: false, eachCell() {}, commit() { r.committed = true; } }; store.push(r); return r; };
  class Workbook {
    constructor() { this.sheets = []; this.xlsx = { writeBuffer: async () => Buffer.from('PKfake') }; }
    addWorksheet(name, o) {
      if (failAt === 'buffered') throw new Error('boom-buffered');
      const rows = []; const ws = { name, views: o.views, rows, addRow: (v) => mkRow(rows, v), getColumn: () => ({}) };
      this.sheets.push(ws); rec.buffered.push(ws); return ws;
    }
  }
  class WorkbookWriter {
    constructor(opts) { this.opts = opts; rec.streamOpts = opts; }
    addWorksheet(name, o) {
      if (failAt === 'stream-start') throw new Error('boom-start');
      const rows = []; const ws = { name, views: o.views, rows, columns: null, addRow: (v) => mkRow(rows, v), commit: async () => {} };
      rec.streamed.push(ws); this.opts.stream.write(Buffer.from('PK')); return ws;
    }
    async commit() { if (failAt === 'stream-mid') throw new Error('boom-mid'); this.opts.stream.end(); }
  }
  return { mod: { Workbook, stream: { xlsx: { WorkbookWriter } } }, rec };
}

describe('sendSheets: onExport (audit)، streaming، injection در xlsx (exceljs ساختگی)', () => {
  afterEach(() => { xlsx._setLoaderForTest(null); delete process.env.XLSX_STREAM_ROWS; });

  const SHEETS = [{ name: 'الف', headers: ['n', 'v'], rows: [['=1+1', 1], ['ok', -2]] }, { name: 'ب', headers: ['n'], rows: [['@x']] }];
  const CSV = { headers: ['n'], rows: [['x']] };

  test('csv پیش‌فرض: onExport با format=csv؛ sheets تابعی اصلاً صدا زده نمی‌شود', async () => {
    const infos = [];
    let built = 0;
    const res = fakeRes();
    await xlsx.sendSheets(reqOf(), res, 'r.csv', () => { built += 1; return SHEETS; }, { csv: CSV, onExport: (i) => infos.push(i) });
    assert.equal(built, 0);
    assert.equal(infos.length, 1);
    assert.equal(infos[0].format, 'csv');
    assert.equal(infos[0].fallback, false);
    assert.equal(infos[0].rowCount, 1);
    assert.deepEqual(xlsx.exportAuditFields(infos[0]), { format: 'csv', requestedFormat: 'csv' });
  });

  test('xlsx بدون exceljs: fallback ⇒ CSV، onExport با fallback=true، شیت‌ها ساخته نمی‌شوند', async () => {
    xlsx._setLoaderForTest(() => { throw new Error('no module'); });
    const infos = []; let built = 0;
    const res = fakeRes();
    const w = console.warn; console.warn = () => {};
    try { await xlsx.sendSheets(reqOf('xlsx'), res, 'r.csv', () => { built += 1; return SHEETS; }, { csv: CSV, onExport: (i) => infos.push(i) }); } finally { console.warn = w; }
    assert.equal(built, 0);
    assert.equal(res.headers['x-export-fallback'], 'csv');
    assert.equal(infos[0].format, 'csv');
    assert.equal(infos[0].fallback, true);
    assert.deepEqual(xlsx.exportAuditFields(infos[0]), { format: 'csv', requestedFormat: 'xlsx', fallback: true });
  });

  test('xlsx کوچک: buffer؛ سلول‌های خطرناک در سرستون و داده خنثی؛ عدد منفی دست‌نخورده؛ onExport پیش از ارسال', async () => {
    const { mod, rec } = makeFakeExcel();
    xlsx._setLoaderForTest(() => mod);
    const infos = []; const res = fakeRes();
    await xlsx.sendSheets(reqOf('xlsx'), res, 'r.csv', SHEETS, {
      csv: CSV, onExport: (i) => { infos.push(i); assert.equal(res.body, undefined, 'هنوز بدنه‌ای نرفته'); },
    });
    assert.equal(res.headers['content-type'], xlsx.XLSX_MIME);
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(infos[0].format, 'xlsx');
    assert.equal(infos[0].streamed, false);
    assert.equal(infos[0].rowCount, 3);
    assert.deepEqual(infos[0].sheets, ['الف', 'ب']);
    assert.deepEqual(rec.buffered[0].rows.map((r) => r.values), [['n', 'v'], ["'=1+1", 1], ['ok', -2]]);
    assert.deepEqual(rec.buffered[1].rows.map((r) => r.values), [['n'], ["'@x"]]);
  });

  test('بیشتر از آستانه (XLSX_STREAM_ROWS) ⇒ streaming: مستقیم روی پاسخ، ردیف‌ها commit، بدون res.send، injection خنثی', async () => {
    process.env.XLSX_STREAM_ROWS = '2';
    const { mod, rec } = makeFakeExcel();
    xlsx._setLoaderForTest(() => mod);
    const infos = []; const res = fakeRes();
    await xlsx.sendSheets(reqOf('xlsx'), res, 'r.csv', SHEETS, { csv: CSV, onExport: (i) => infos.push(i) });
    assert.equal(infos[0].streamed, true);
    assert.deepEqual(xlsx.exportAuditFields(infos[0]), { format: 'xlsx', requestedFormat: 'xlsx', streamed: true, sheets: ['الف', 'ب'] });
    assert.equal(res.body, undefined, 'buffer کامل ساخته نشد');
    assert.equal(rec.streamOpts.stream, res);
    assert.equal(res.ended, true);
    assert.equal(res.headers['content-type'], xlsx.XLSX_MIME);
    assert.ok(rec.streamed.every((s) => s.rows.every((r) => r.committed)), 'همه‌ی ردیف‌ها commit شده‌اند');
    assert.deepEqual(rec.streamed[0].rows.map((r) => r.values), [['n', 'v'], ["'=1+1", 1], ['ok', -2]]);
    assert.deepEqual(rec.streamed[0].views, [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 1 }]);
  });

  test('آستانه‌ی دقیق: برابر آستانه ⇒ buffer؛ یکی بیشتر ⇒ stream', async () => {
    const { mod, rec } = makeFakeExcel();
    xlsx._setLoaderForTest(() => mod);
    process.env.XLSX_STREAM_ROWS = '3';
    await xlsx.sendSheets(reqOf('xlsx'), fakeRes(), 'r.csv', SHEETS, { csv: CSV });
    assert.equal(rec.streamed.length, 0);
    process.env.XLSX_STREAM_ROWS = '2';
    await xlsx.sendSheets(reqOf('xlsx'), fakeRes(), 'r.csv', SHEETS, { csv: CSV });
    assert.ok(rec.streamed.length > 0);
  });

  test('خطا پیش از شروع جریان ⇒ ۵۰۰ تمیز XLSX_FAILED؛ خطا وسط جریان ⇒ اتصال قطع (فایل ناقص سالم به نظر نمی‌رسد)', async () => {
    process.env.XLSX_STREAM_ROWS = '1';
    const e = console.error; console.error = () => {};
    try {
      xlsx._setLoaderForTest(() => makeFakeExcel({ failAt: 'stream-start' }).mod);
      const r1 = fakeRes();
      await xlsx.sendSheets(reqOf('xlsx'), r1, 'r.csv', SHEETS, { csv: CSV });
      assert.equal(r1.statusCode, 500);
      assert.equal(r1.body.code, 'XLSX_FAILED');
      assert.equal(r1.destroyed, null);

      xlsx._setLoaderForTest(() => makeFakeExcel({ failAt: 'stream-mid' }).mod);
      const r2 = fakeRes();
      await xlsx.sendSheets(reqOf('xlsx'), r2, 'r.csv', SHEETS, { csv: CSV });
      assert.ok(r2.destroyed, 'res.destroy صدا زده شد');
      assert.equal(r2.body, undefined);
    } finally { console.error = e; }
  });

  test('خطای callback audit خروجی را نمی‌شکند', async () => {
    const e = console.error; console.error = () => {};
    try {
      const res = fakeRes();
      await xlsx.sendSheets(reqOf(), res, 'r.csv', [{ name: 'a', headers: ['n'], rows: [['x']] }], { onExport: () => { throw new Error('db down'); } });
      assert.match(res.body, /x/);
    } finally { console.error = e; }
  });

  test('format نامعتبر ⇒ ۴۰۰ و onExport صدا زده نمی‌شود (چیزی export نشده)', async () => {
    let called = 0; const res = fakeRes();
    await xlsx.sendSheets(reqOf('pdf'), res, 'r.csv', SHEETS, { csv: CSV, onExport: () => { called += 1; } });
    assert.equal(res.statusCode, 400);
    assert.equal(called, 0);
  });
});

describe('xlsx واقعی: injection و streaming (فقط با exceljs نصب‌شده)', { skip: hasExcel ? false : 'exceljs نصب نیست' }, () => {
  const ExcelJS = hasExcel ? require('exceljs') : null;
  const SHEETS = [
    { name: 'الف', headers: ['=h', 'عدد', 'متن'], rows: [['=SUM(1+1)', -5, '@x'], ['+1', 12.5, 'ok'], ['علی', 0, null]] },
    { name: 'ب', headers: ['n'], rows: [['-2+3']] },
  ];
  async function load(buf) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }

  test('سلول‌های خطرناک رشته‌ی خنثی هستند (نه فرمول)؛ عدد منفی عدد می‌ماند', async () => {
    const wb = await load(await xlsx.workbookToBuffer(xlsx.buildWorkbook({ sheets: SHEETS })));
    const ws = wb.worksheets[0];
    assert.equal(ws.getCell(1, 1).value, "'=h");
    assert.equal(ws.getCell(2, 1).value, "'=SUM(1+1)");
    assert.equal(ws.getCell(2, 2).value, -5);
    assert.equal(typeof ws.getCell(2, 2).value, 'number');
    assert.equal(ws.getCell(2, 3).value, "'@x");
    assert.equal(ws.getCell(3, 1).value, "'+1");
    assert.equal(wb.worksheets[1].getCell(2, 1).value, "'-2+3");
  });

  test('streaming: فایل معتبر؛ محتوا، RTL، فریز و فیلتر همان نسخه‌ی buffer', async () => {
    const { PassThrough } = require('node:stream');
    const out = new PassThrough();
    const chunks = [];
    out.on('data', (c) => chunks.push(c));
    const done = new Promise((r) => out.on('end', r));
    await xlsx.writeWorkbookStream(out, { sheets: SHEETS });
    await done;
    const wb = await load(Buffer.concat(chunks));
    const ref = await load(await xlsx.workbookToBuffer(xlsx.buildWorkbook({ sheets: SHEETS })));
    assert.deepEqual(wb.worksheets.map((s) => s.name), ['الف', 'ب']);
    for (let s = 0; s < 2; s += 1) {
      const a = wb.worksheets[s]; const b = ref.worksheets[s];
      assert.equal(a.rowCount, b.rowCount);
      for (let r = 1; r <= a.rowCount; r += 1) {
        for (let c = 1; c <= a.columnCount; c += 1) assert.equal(a.getCell(r, c).value, b.getCell(r, c).value, `s${s} r${r} c${c}`);
      }
      assert.equal(a.views[0].rightToLeft, true);
      assert.equal(a.views[0].state, 'frozen');
      assert.equal(a.views[0].ySplit, 1);
      assert.ok(a.autoFilter, 'autoFilter');
      assert.equal(a.getRow(1).font.bold, true);
    }
  });

  test('sendSheets با آستانه‌ی کم: پاسخ stream واقعی هم فایل سالم است', async () => {
    const { PassThrough } = require('node:stream');
    process.env.XLSX_STREAM_ROWS = '1';
    try {
      const res = new PassThrough();
      res.headers = {}; res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; }; res.headersSent = false;
      const chunks = []; res.on('data', (c) => { res.headersSent = true; chunks.push(c); });
      const done = new Promise((r) => res.on('end', r));
      await xlsx.sendSheets(reqOf('xlsx'), res, 'r.csv', SHEETS, { csv: { headers: ['n'], rows: [] } });
      await done;
      assert.equal(res.headers['content-type'], xlsx.XLSX_MIME);
      const wb = await load(Buffer.concat(chunks));
      assert.equal(wb.worksheets[0].getCell(2, 1).value, "'=SUM(1+1)");
    } finally { delete process.env.XLSX_STREAM_ROWS; }
  });
});
