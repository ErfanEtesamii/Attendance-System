// ابزار مشترک «کارتکس» برای همه‌ی خروجی‌های xlsx: مستطیل اطلاعات اصلی بالای جدول + جمع کل، و تبدیل شیت‌های تکراریِ «نام/کد/دپارتمان در هر ردیف»
// به یک شیت اختصاصی برای هر کارمند. فقط ساخت مشخصات شیت (بدون exceljs)؛ نمایش را buildWorkbook/fillSheet در utils/xlsx.js انجام می‌دهد.

const NAME_HEADERS = ['نام', 'نام کارمند', 'کارمند'];
const CODE_HEADERS = ['کد پرسنلی'];
const DEPT_HEADERS = ['دپارتمان'];

/** ستون‌های هویتی یک شیت (ایندکس؛ -1 = ندارد). */
function identityOf(headers) {
  const find = (list) => headers.findIndex((h) => list.includes(h));
  return { name: find(NAME_HEADERS), code: find(CODE_HEADERS), dept: find(DEPT_HEADERS) };
}

/** متن‌های «برچسب: مقدار» را در ردیف‌های ۳تایی با عرض ستونی مساوی می‌چیند (جمع spanها = ncols). */
function autoLines(texts, ncols) {
  const per = ncols >= 6 ? 3 : (ncols >= 4 ? 2 : 1);
  const lines = [];
  for (let i = 0; i < texts.length; i += per) {
    const chunk = texts.slice(i, i + per);
    const k = chunk.length;
    const base = Math.floor(ncols / k); let extra = ncols - base * k;
    lines.push(chunk.map((t) => { const span = base + (extra > 0 ? 1 : 0); if (extra > 0) extra -= 1; return [t, Math.max(1, span)]; }));
  }
  return lines;
}

/** ستون‌هایی که تکرارِ ستون دیگرند (تاریخ میلادیِ هم‌زوج با شمسی) + ستون‌هایی که صریحاً حذف می‌شوند ⇒ ایندکس‌های نگه‌داشته‌شده. */
function keptColumns(headers, extraDrop = []) {
  const drop = new Set(extraDrop);
  return headers.map((h, i) => i).filter((i) => {
    const h = headers[i];
    if (drop.has(h)) return false;
    if (h === 'تاریخ میلادی' || h === 'تاریخ (میلادی)') return false;
    if (headers.includes(`${h} (شمسی)`)) return false; // «تاریخ» + «تاریخ (شمسی)» ⇒ فقط شمسی
    return true;
  });
}
const pick = (sheet, idx) => ({ ...sheet, headers: idx.map((i) => sheet.headers[i]), rows: sheet.rows.map((r) => idx.map((i) => r[i])) });

const SUMMABLE = (h) => /دقیقه|تومان|ریال/.test(h) && !/میانگین|درصد|نرخ|میانه/.test(h);

/** ردیف «جمع کل» برای ستون‌های عددیِ قابل‌جمع؛ null اگر چیزی برای جمع نیست. */
function totalFooter(headers, rows) {
  if (rows.length < 2) return null;
  const idx = headers.map((h, i) => (SUMMABLE(h) && rows.some((r) => typeof r[i] === 'number') ? i : -1));
  const first = idx.find((i) => i >= 0);
  if (first === undefined || first < 1) return null;
  const values = [];
  for (let i = first; i < headers.length; i += 1) values.push(idx[i] >= 0 ? rows.reduce((t, r) => t + (typeof r[i] === 'number' ? r[i] : 0), 0) : '');
  return { label: 'جمع کل', labelSpan: first, values };
}

/** کارت اطلاعاتی بالای یک شیت تخت. lines: متن‌های «برچسب: مقدار». شیت‌های کمتر از ۳ ستون کارت نمی‌گیرند. */
function withCard(input, { title, lines = [], footer = true, drop = [] } = {}) {
  if (!input || input.headers.length < 3) return input;
  const sheet = pick(input, keptColumns(input.headers, drop));
  return {
    ...sheet,
    card: { title, lines: autoLines(lines, sheet.headers.length) },
    ...(footer && !sheet.footer ? (() => { const f = totalFooter(sheet.headers, sheet.rows); return f ? { footer: f } : {}; })() : {}),
  };
}

/**
 * تبدیل شیت‌های «هویت‌دار» به شیت‌های هر کارمند. sheets: فهرست شیت‌های تخت که هر ردیفشان نام (و کد/دپارتمان) دارد؛
 * شیت اول هر کارمند جدول اصلی اوست و بقیه به‌صورت بخش‌های زیرین (extra) همان شیت می‌آیند. ستون‌های هویتی از جدول‌ها حذف می‌شوند.
 * @param {Array<{name,headers,rows}>} sheets
 * @param {{ title: string, extraLines?: string[] }} opts
 */
function splitByEmployee(sheets, opts = {}) {
  const parts = sheets.map((s) => ({ s, id: identityOf(s.headers) })).filter((p) => p.id.name >= 0);
  const keyOf = (id, r) => `${r[id.name] ?? ''}|${id.code >= 0 ? (r[id.code] ?? '') : ''}`;
  const people = new Map(); // key -> { name, code, dept }
  const keepOf = (p) => keptColumns(p.s.headers, opts.drop || []).filter((i) => i !== p.id.name && i !== p.id.code && i !== p.id.dept);
  const slice = (p, r) => keepOf(p).map((i) => r[i]);
  const colsOf = (p) => keepOf(p).map((i) => p.s.headers[i]);
  for (const p of parts) {
    for (const r of p.s.rows) {
      const k = keyOf(p.id, r);
      if (!people.has(k)) people.set(k, { name: String(r[p.id.name] ?? ''), code: p.id.code >= 0 ? String(r[p.id.code] ?? '') : '', dept: p.id.dept >= 0 ? String(r[p.id.dept] ?? '') : '' });
      else if (!people.get(k).dept && p.id.dept >= 0 && r[p.id.dept]) people.get(k).dept = String(r[p.id.dept]);
    }
  }
  const out = [];
  for (const [k, who] of people) {
    const tables = parts.map((p) => ({ title: p.s.name, headers: colsOf(p), rows: p.s.rows.filter((r) => keyOf(p.id, r) === k).map((r) => slice(p, r)) })).filter((t) => t.rows.length);
    if (!tables.length) continue;
    const [main, ...rest] = tables;
    const ncols = main.headers.length;
    const lines = [`کارمند:  ${who.name}`, `کد پرسنلی:  ${who.code || '—'}`, `دپارتمان:  ${who.dept || '—'}`, ...(opts.extraLines || []), `${main.title}:  ${main.rows.length} ردیف`];
    out.push({
      name: who.name || 'کارمند',
      headers: main.headers,
      rows: main.rows,
      tableTitle: main.title,
      card: { title: opts.title || 'مشخصات کارمند', lines: autoLines(lines, Math.max(ncols, 3)) },
      ...(() => { const f = totalFooter(main.headers, main.rows); return f ? { footer: f } : {}; })(),
      extra: rest,
    });
  }
  return out;
}

module.exports = { keptColumns, pick, identityOf, autoLines, totalFooter, withCard, splitByEmployee };
