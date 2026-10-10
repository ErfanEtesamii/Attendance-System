// نمای چاپ گزارش ماهانه (S5-4b). صفحه‌ی مستقل از پوسته‌ی پنل (بدون ناوبری)؛ داده را از همان API گزارش ماهانه می‌گیرد
// (اسکوپ نقش، snapshot ماه بسته و ... همه سمت سرور اعمال می‌شود). همه‌ی متن‌ها با textContent ساخته می‌شوند (بدون innerHTML).
// پارامترهای صفحه: ?year=1405&month=6[&department=][&userId=][&includeInactive=1][&source=live]
(function (root) {
  'use strict';

  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v).replace(/\d/g, (d) => FA[d]);
  const hhmm = (m) => (m === null || m === undefined || Number.isNaN(m) ? '' : `${Math.floor(m / 60)}:${String(Math.round(m) % 60).padStart(2, '0')}`);

  // ستون‌های نمای چاپ (زیرمجموعه‌ی فشرده‌ی xlsx تا در A4 افقی جا شود): [label, kind, getter]
  // kind: name | num | hhmm | text
  const COLUMNS = [
    ['نام کارمند', 'name', (u) => u.user.fullName || ''],
    ['کد', 'text', (u) => u.user.personnelCode || ''],
    ['دپارتمان', 'text', (u) => u.user.department || ''],
    ['روز کاری', 'num', (u) => u.calendar.expectedWorkDays],
    ['حضور', 'num', (u) => u.attendance.presentDays],
    ['غیبت', 'num', (u) => u.attendance.absentDays],
    ['مرخصی', 'num', (u) => u.leave.leaveDays],
    ['مأموریت', 'num', (u) => u.leave.missionDays],
    ['روز تأخیر', 'num', (u) => u.attendance.lateDays],
    ['دقیقه تأخیر', 'num', (u) => u.time.lateMinutes],
    ['روز ناقص', 'num', (u) => u.attendance.incompleteDays],
    ['مفید (ساعت:دقیقه)', 'hhmm', (u) => hhmm(u.time.effectiveMinutes)],
    ['کسری (ساعت:دقیقه)', 'hhmm', (u) => hhmm(u.time.shortfallMinutes)],
    ['اضافه‌کاری قابل‌پرداخت (ساعت:دقیقه)', 'hhmm', (u) => hhmm(u.overtime.payableMinutes)],
  ];

  // مدل خالص (بدون DOM): از payload پاسخ API
  function buildModel(payload, { printedAt } = {}) {
    const users = payload.users || [];
    const closed = payload.source === 'snapshot';
    const notes = [];
    notes.push(closed
      ? `ارقام از snapshot ماه بسته‌شده است (ثابت در لحظه‌ی بستن${payload.closedAt ? `: ${payload.closedAt}` : ''}).`
      : 'ارقام زنده است و تا بسته‌شدن ماه ممکن است تغییر کند.');
    if (payload.closure && payload.closure.status === 'reopened') notes.push('این ماه قبلاً بسته شده و دوباره باز شده است.');
    const adjustments = Array.isArray(payload.adjustments) ? payload.adjustments : [];
    const totals = payload.totals || {};
    const totalRow = users.length ? COLUMNS.map(([, kind, get], i) => {
      if (i === 0) return 'جمع';
      if (kind === 'text') return '';
      return get({ user: {}, calendar: totals.calendar, attendance: totals.attendance, leave: totals.leave, time: totals.time, overtime: totals.overtime });
    }) : null;
    return {
      title: `گزارش ماهانه ${payload.label || ''}`.trim(),
      subtitle: `بازه‌ی میلادی ${payload.from} تا ${payload.to} — ${users.length} کارمند`,
      headers: COLUMNS.map((c) => c[0]),
      kinds: COLUMNS.map((c) => c[1]),
      rows: users.map((u) => COLUMNS.map((c) => c[2](u))),
      totalRow,
      notes,
      closed,
      adjustmentsNote: adjustments.length ? `${adjustments.length} اصلاح پس از بستن ماه ثبت شده است؛ ارقام بالا همان snapshot است و اصلاح‌ها در آن نیامده‌اند.` : '',
      printedAt: printedAt || '',
    };
  }

  const cellText = (kind, v) => (v === '' || v === null || v === undefined ? '' : (kind === 'text' || kind === 'name' ? String(v) : fa(v)));

  function render(doc, model) {
    const el = (id) => doc.getElementById(id);
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    el('title').textContent = model.title;
    el('subtitle').textContent = model.subtitle;
    el('meta').textContent = model.printedAt ? `تاریخ چاپ: ${model.printedAt}` : '';
    const notes = el('notes');
    notes.textContent = '';
    model.notes.forEach((n) => notes.appendChild(mk('div', model.closed ? '' : 'warn', n)));
    const head = mk('tr');
    model.headers.forEach((h) => head.appendChild(mk('th', '', h)));
    el('thead').textContent = '';
    el('thead').appendChild(head);
    const body = el('tbody');
    body.textContent = '';
    model.rows.forEach((r) => {
      const tr = mk('tr');
      r.forEach((v, i) => tr.appendChild(mk('td', model.kinds[i] === 'name' ? 'name' : model.kinds[i], cellText(model.kinds[i], v))));
      body.appendChild(tr);
    });
    const foot = el('tfoot');
    foot.textContent = '';
    if (model.totalRow) {
      const tr = mk('tr');
      model.totalRow.forEach((v, i) => tr.appendChild(mk('td', model.kinds[i] === 'name' ? 'name' : model.kinds[i], cellText(model.kinds[i], v))));
      foot.appendChild(tr);
    }
    el('adjust').textContent = model.adjustmentsNote;
    el('printed-at').textContent = model.printedAt ? `چاپ: ${model.printedAt}` : '';
  }

  // آدرس API از پارامترهای صفحه (فقط پارامترهای شناخته‌شده؛ مقدارها encode می‌شوند)
  function apiUrlFrom(search) {
    const p = new URLSearchParams(search);
    const q = new URLSearchParams();
    for (const k of ['year', 'month', 'department', 'userId', 'includeInactive', 'source']) {
      if (p.get(k) !== null && p.get(k) !== '') q.set(k, p.get(k));
    }
    q.set('days', '0');
    return `/api/admin/reports/monthly?${q.toString()}`;
  }

  async function main(win) {
    const doc = win.document;
    const status = doc.getElementById('status');
    doc.getElementById('print-btn').addEventListener('click', () => win.print());
    try {
      const res = await win.fetch(apiUrlFrom(win.location.search), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (res.status === 401) throw new Error('ابتدا وارد پنل شوید، سپس این صفحه را دوباره باز کنید.');
      const payload = await res.json();
      if (!res.ok) throw new Error(payload && payload.error ? payload.error : 'دریافت گزارش ناموفق بود.');
      const printedAt = new Date().toLocaleString('fa-IR');
      render(doc, buildModel(payload, { printedAt }));
      doc.getElementById('sheet').hidden = false;
      status.textContent = 'آماده‌ی چاپ';
    } catch (err) {
      status.textContent = err.message || 'خطا';
      status.className = 'status error';
    }
  }

  const api = { buildModel, render, apiUrlFrom, COLUMNS, hhmm, fa };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document && root.addEventListener) {
    root.PrintView = api;
    root.addEventListener('DOMContentLoaded', () => { main(root); });
  }
}(typeof window !== 'undefined' ? window : undefined));
