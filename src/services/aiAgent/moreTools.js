// ابزارهای قابلیت‌های جدید ایجنت: پیشنهاد عملیات (با تأیید انسان)، مقایسه‌ی دوره‌ها/پیش‌بینی، خروجی اکسل، یادداشت‌ها.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { getDb } = require('../../db/connection');
const actions = require('./actions');

const EXPORT_TTL_MS = 30 * 60 * 1000;
const exportsMap = new Map(); // token → { adminId, file, name, exp }
const NOTE_MAX = 300;
const MAX_NOTES = 30;

function sweepExports() {
  const now = Date.now();
  for (const [t, e] of exportsMap) if (e.exp < now) { try { fs.unlinkSync(e.file); } catch (_) { /* نبود */ } exportsMap.delete(t); }
}

// ----- مقایسه -----
function flatNumbers(v, prefix = '', out = {}, depth = 0) {
  if (depth > 3) return out;
  if (typeof v === 'number' && Number.isFinite(v)) out[prefix || 'value'] = v;
  else if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) flatNumbers(x, prefix ? `${prefix}.${k}` : k, out, depth + 1);
  return out;
}
const round = (n) => Math.round(n * 100) / 100;

// ----- خروجی اکسل -----
function collectTables(value, name = 'data', out = [], depth = 0) {
  if (depth > 3) return out;
  if (Array.isArray(value)) {
    if (value.length && value.every((r) => r && typeof r === 'object' && !Array.isArray(r))) out.push({ name, rows: value });
  } else if (value && typeof value === 'object') {
    const scalars = {};
    for (const [k, v] of Object.entries(value)) {
      if (v && typeof v === 'object') collectTables(v, k, out, depth + 1); else scalars[k] = v;
    }
    if (Object.keys(scalars).length) out.unshift({ name: `${name}_summary`, rows: [scalars] });
  }
  return out;
}
const cellOf = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);

async function writeXlsx(tables, file) {
  const ExcelJS = require('exceljs');
  const style = require('../../utils/xlsxStyle');
  const wb = new ExcelJS.Workbook();
  const used = new Set();
  for (const t of tables.slice(0, 6)) {
    let nm = String(t.name).replace(/[\\/*?:[\]]/g, '_').slice(0, 28) || 'sheet';
    while (used.has(nm)) nm = `${nm.slice(0, 26)}_${used.size}`;
    used.add(nm);
    const ws = wb.addWorksheet(nm, { views: [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 1 }], ...style.sheetOptions(used.size - 1) });
    const cols = [...new Set(t.rows.slice(0, 500).flatMap((r) => Object.keys(r)))];
    const data = t.rows.slice(0, 5000).map((r) => cols.map((c) => cellOf(r[c])));
    const kinds = style.columnKinds(cols, data);
    ws.columns = cols.map((c, i) => ({ header: c, key: c, width: Math.min(50, Math.max(14, Math.ceil(c.length * 1.5) + 2, ...data.slice(0, 200).map((d) => Math.ceil(String(d[i] == null ? "" : d[i]).length * 1.2) + 2))) }));
    style.styleHeader(ws.getRow(1));
    data.forEach((d, ri) => style.styleBodyRow(ws.addRow(d), ri, kinds));
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  await wb.xlsx.writeFile(file);
}

function build({ ToolError, runRaw, EXPORTABLE }) {
  const wrap = (fn) => (ctx, input) => { try { return fn(ctx, input); } catch (e) { if (e instanceof actions.ActionError) throw new ToolError(e.message); throw e; } };
  const queue = (ctx, kind, input) => {
    const p = actions.propose(ctx.adminUser, kind, input);
    (ctx.pending = ctx.pending || []).push(p);
    return { status: 'awaiting_human_confirmation', actionId: p.id, summary: p.summary, note: 'هنوز اجرا نشده؛ به مدیر بگو با دکمه‌ی «تأیید» اجرا کند (۱۵ دقیقه مهلت).' };
  };

  return [
    {
      name: 'propose_leave_decision',
      description: 'پیشنهاد تأیید/رد یک درخواست مرخصی. اجرا نمی‌کند؛ مدیر باید با دکمه تأیید کند. برای رد، note (دلیل) الزامی است. قبل از پیشنهاد، درخواست را با leave_requests بخوان.',
      input_schema: { type: 'object', properties: { requestId: { type: 'integer' }, decision: { type: 'string', enum: ['approve', 'reject'] }, note: { type: 'string' } }, required: ['requestId', 'decision'] },
      run: wrap((ctx, i) => queue(ctx, 'leave_decision', i)),
    },
    {
      name: 'propose_dispute_reply',
      description: 'پیشنهاد ارسال پاسخ به اعتراض باز یک کارمند (حداکثر ۵۰۰ نویسه). اجرا نمی‌کند؛ نیازمند تأیید مدیر.',
      input_schema: { type: 'object', properties: { disputeId: { type: 'integer' }, message: { type: 'string' } }, required: ['disputeId', 'message'] },
      run: wrap((ctx, i) => queue(ctx, 'dispute_reply', i)),
    },
    {
      name: 'propose_dispute_close',
      description: 'پیشنهاد بستن اعتراض (فقط اعتراض‌های بدون رکورد تردد وابسته). اجرا نمی‌کند؛ نیازمند تأیید مدیر.',
      input_schema: { type: 'object', properties: { disputeId: { type: 'integer' }, note: { type: 'string' } }, required: ['disputeId'] },
      run: wrap((ctx, i) => queue(ctx, 'dispute_resolve', i)),
    },
    {
      name: 'compare_periods',
      description: 'یک ابزار تحلیلی را برای دو بازه اجرا و تفاوت عددها را حساب می‌کند. تخمین ساده‌ی خطی دوره‌ی بعد هم می‌دهد (فقط برآورد، نه قطعی).',
      input_schema: { type: 'object', properties: { tool: { type: 'string', enum: EXPORTABLE }, base: { type: 'object' }, fromA: { type: 'string' }, toA: { type: 'string' }, fromB: { type: 'string' }, toB: { type: 'string' } }, required: ['tool', 'fromA', 'toA', 'fromB', 'toB'] },
      run(ctx, i) {
        if (!EXPORTABLE.includes(i.tool)) throw new ToolError('این ابزار برای مقایسه مجاز نیست.');
        const base = i.base && typeof i.base === 'object' ? i.base : {};
        const a = runRaw(ctx, i.tool, { ...base, range: 'custom', from: i.fromA, to: i.toA });
        const b = runRaw(ctx, i.tool, { ...base, range: 'custom', from: i.fromB, to: i.toB });
        const na = flatNumbers(a); const nb = flatNumbers(b);
        const diff = {};
        Object.keys(nb).filter((k) => k in na).slice(0, 40).forEach((k) => {
          diff[k] = { A: na[k], B: nb[k], delta: round(nb[k] - na[k]), pct: na[k] ? round(((nb[k] - na[k]) / Math.abs(na[k])) * 100) : null, nextLinear: round(nb[k] + (nb[k] - na[k])) };
        });
        return { diff, note: 'nextLinear فقط برون‌یابی خطی ساده است.' };
      },
    },
    {
      name: 'export_excel',
      description: 'خروجی اکسل از نتیجه‌ی یک ابزار (جدول‌های داخل خروجی). دکمه‌ی دانلود برای مدیر ساخته می‌شود. ابزار مالی مجاز نیست.',
      input_schema: { type: 'object', properties: { tool: { type: 'string', enum: EXPORTABLE }, args: { type: 'object' }, title: { type: 'string' } }, required: ['tool'] },
      async run(ctx, i) {
        if (!EXPORTABLE.includes(i.tool)) throw new ToolError('این ابزار قابل خروجی گرفتن نیست.');
        const data = runRaw(ctx, i.tool, i.args && typeof i.args === 'object' ? i.args : {});
        const tables = collectTables(data, i.tool);
        if (!tables.length) throw new ToolError('جدولی برای خروجی در نتیجه نبود.');
        sweepExports();
        const token = crypto.randomBytes(16).toString('hex');
        const file = path.join(os.tmpdir(), `ai-export-${token}.xlsx`);
        await writeXlsx(tables, file);
        const name = `${String(i.title || i.tool).replace(/[^\w؀-ۿ -]/g, '').slice(0, 40) || 'report'}.xlsx`;
        exportsMap.set(token, { adminId: ctx.adminUser.id, file, name, exp: Date.now() + EXPORT_TTL_MS });
        (ctx.files = ctx.files || []).push({ token, name });
        return { status: 'ready', sheets: tables.length, note: 'دکمه‌ی دانلود برای مدیر نمایش داده می‌شود.' };
      },
    },
    {
      name: 'remember_note',
      description: 'ذخیره‌ی یادداشت کوتاه (ترجیح/قرارداد کاری مدیر). فقط وقتی مدیر صریحاً خواست. ممنوع: اطلاعات مالی/پزشکی/شخصی حساس.',
      input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      run(ctx, i) {
        const note = String(i.note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
        if (!note) throw new ToolError('متن یادداشت خالی است.');
        const db = getDb();
        if (db.prepare('SELECT COUNT(*) c FROM ai_notes WHERE author_id=?').get(ctx.adminUser.id).c >= MAX_NOTES) throw new ToolError('سقف یادداشت‌ها پر است؛ ابتدا چندتا را با forget_note حذف کنید.');
        const r = db.prepare('INSERT INTO ai_notes(author_id,note) VALUES (?,?)').run(ctx.adminUser.id, note);
        return { saved: true, id: Number(r.lastInsertRowid) };
      },
    },
    {
      name: 'forget_note',
      description: 'حذف یادداشت خود مدیر با id (یا list=true برای دیدن فهرست).',
      input_schema: { type: 'object', properties: { id: { type: 'integer' }, list: { type: 'boolean' } } },
      run(ctx, i) {
        const db = getDb();
        if (i.list || i.id == null) return { notes: db.prepare('SELECT id, note FROM ai_notes WHERE author_id=? ORDER BY id DESC').all(ctx.adminUser.id) };
        const r = db.prepare('DELETE FROM ai_notes WHERE id=? AND author_id=?').run(Number(i.id), ctx.adminUser.id);
        return { deleted: r.changes === 1 };
      },
    },
  ];
}

function notesFor(adminId, limit = 10) {
  try { return getDb().prepare('SELECT note FROM ai_notes WHERE author_id=? ORDER BY id DESC LIMIT ?').all(adminId, limit).map((r) => r.note); } catch (_) { return []; }
}

function takeExport(adminId, token) {
  sweepExports();
  const e = exportsMap.get(token);
  return e && e.adminId === adminId ? e : null;
}

module.exports = { build, notesFor, takeExport };
