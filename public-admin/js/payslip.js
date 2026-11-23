// فیش حقوقی قابل چاپ/PDF (هر کارمند یک فیش). صفحه‌ی مستقل از پوسته‌ی پنل؛ داده از همان API حقوق (اسکوپ و مجوز payroll.read سمت سرور).
// همه‌ی متن‌ها با textContent ساخته می‌شوند (بدون innerHTML) و هیچ inline script/style تگ ندارد (CSP پنل).
// پارامترهای صفحه: ?year=1405&month=7[&department=][&userId=][&includeInactive=1][&all=1]
(function (root) {
  'use strict';

  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v).replace(/\d/g, (d) => FA[d]);
  const num = (n) => fa(Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const hhmm = (m) => `${fa(Math.floor(m / 60))}:${fa(String(Math.round(m) % 60).padStart(2, '0'))}`;
  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

  // رقم فارسی/عربی/کاما ⇒ عدد (برای خانه‌های قابل ویرایش)
  function parseAmount(text) {
    const s = String(text == null ? '' : text)
      .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[^\d]/g, '');
    return s === '' ? 0 : parseInt(s, 10);
  }

  // تاریخ میلادی ISO ⇒ «۱۴۰۵/۰۷/۳۰» (بدون وابستگی به Jalali برای تست؛ اگر نبود خود ISO)
  function jalaliDate(iso, J) {
    try {
      const j = (J || (root && root.Jalali)).isoToJalali(iso);
      return fa(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
    } catch (_) { return iso || ''; }
  }
  function jalaliDayOfYear(iso, J) {
    try { const j = (J || (root && root.Jalali)).isoToJalali(iso); return Math.min(365, dayOfYear(j.jm, j.jd)); } catch (_) { return 365; }
  }

  // مزد روزانه‌ی اداره‌ی کار (پیش‌فرض) و فرمول عیدی/سنوات: عیدی = مزد روزانه × ۶۰ ÷ ۳۶۵ × روزهای کارکرد؛ سنوات = نصف عیدی
  const DEFAULT_DAILY_WAGE = 541850;
  const eidiOf = (wage, days) => Math.round((Number(wage) * 60 / 365) * Math.max(0, Number(days) || 0));
  const sanavatOf = (eidi) => Math.round(eidi / 2);
  // شماره‌ی روز در سال شمسی (۱ فروردین = ۱)
  const dayOfYear = (jm, jd) => (jm <= 6 ? (jm - 1) * 31 + jd : 186 + (jm - 7) * 30 + jd);

  // مدل خالص (بدون DOM) برای یک ردیف پاسخ API حقوق
  function buildSlip(row, meta, J) {
    const u = row.user || {};
    const useful = Number(row.usefulMinutes) || 0;
    const ot = Math.min(Number(row.overtimeMinutes) || 0, useful); // اضافه‌کاری «درون» ساعت مفید است
    const rate = row.rateKt == null ? null : row.rateKt * 1000;
    return {
      userId: u.id,
      title: `فیش حقوقی فراز هنر / ${MONTHS[(meta.month || 1) - 1]} ماه`,
      date: jalaliDate(meta.to, J),
      eidiDays: jalaliDayOfYear(meta.to, J), // پیش‌فرض: از ۱ فروردین تا پایان همین ماه (قابل ویرایش برای هر کارمند)
      name: u.fullName || '',
      personnelCode: u.personnelCode || '',
      department: u.department || '',
      workHours: hhmm(useful - ot),   // ساعات کارکرد عادی
      overtime: ot ? hhmm(ot) : '',    // اضافه‌کار
      deficit: '',                     // کسری قبلاً در ساعت مفید اعمال شده؛ دوباره کم نمی‌شود
      netHours: hhmm(useful),          // خالص کارکرد
      rate: rate == null ? '' : num(rate),
      amount: row.amountToman == null ? null : Math.round(row.amountToman),
      noRate: row.rateKt == null,
      excludedDays: Array.isArray(row.excludedDays) ? row.excludedDays.length : 0,
    };
  }

  function selectRows(payload, { all } = {}) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [payload];
    return rows.filter((r) => r && r.user && (all || (r.amountToman != null && r.amountToman > 0)));
  }

  function render(doc, slips, opts) {
    const o = opts || {};
    const wage = o.wage || DEFAULT_DAILY_WAGE;
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const host = doc.getElementById('slips');
    host.textContent = '';
    slips.forEach((s) => {
      const art = mk('article', 'slip');
      art.dataset.base = s.amount == null ? '' : String(s.amount);
      const t = mk('table', 'slip-table');
      const addRow = (cells) => { const tr = mk('tr'); cells.forEach(([cls, text, attrs]) => { const td = mk('td', cls, text); if (attrs && attrs.colspan) td.colSpan = attrs.colspan; if (attrs && attrs.edit) { td.contentEditable = 'true'; td.dataset.kind = attrs.edit; td.setAttribute('role', 'textbox'); } tr.appendChild(td); }); t.appendChild(tr); return tr; };
      // سرفیش: عنوان | هوالرزاق | تاریخ
      addRow([['h', s.title], ['h c', 'هوالرزاق'], ['h', `تاریخ: ${s.date}`]]);
      // مشخصات
      const info = mk('tr');
      const infoCell = mk('td', 'info'); infoCell.colSpan = 3;
      const grid = mk('div', 'info-grid');
      [['نام و نام خانوادگی', s.name], ['کد پرسنلی', s.personnelCode ? fa(s.personnelCode) : ''], ['شغل / دپارتمان', s.department], ['نوع استخدام', ''], ['کد ملی', ''], ['شماره بیمه', '']].forEach(([l, v]) => {
        const c = mk('div', 'ic'); c.appendChild(mk('span', 'l', `${l}:`)); c.appendChild(mk('b', 'v', v)); grid.appendChild(c);
      });
      infoCell.appendChild(grid); info.appendChild(infoCell); t.appendChild(info);
      // سه ستون
      const body = mk('tr'); body.className = 'cols';
      const col = (title, items, cls) => {
        const td = mk('td', `col ${cls || ''}`);
        td.appendChild(mk('div', 'col-h', title));
        items.forEach(([l, v, opt]) => {
          const r = mk('div', 'ln'); r.appendChild(mk('span', 'l', l));
          const val = mk('span', `v${opt && opt.edit ? ' edit' : ''}${opt && opt.total ? ' total' : ''}`, v);
          if (opt && opt.edit) { val.contentEditable = 'true'; val.dataset.kind = opt.edit; val.setAttribute('role', 'textbox'); val.setAttribute('aria-label', l); }
          if (opt && opt.total) val.dataset.role = opt.total;
          if (opt && opt.role) val.dataset.role = opt.role;
          r.appendChild(val); td.appendChild(r);
        });
        return td;
      };
      const money = (v) => (v == null ? '' : num(v));
      body.appendChild(col('حقوق پایه', [
        ['ساعات کارکرد:', s.workHours], ['کسر کار:', s.deficit], ['اضافه کار:', s.overtime], ['خالص کارکرد:', s.netHours],
        ['مبلغ توافق‌شده (ساعتی):', s.rate], ['مبلغ کارکرد:', money(s.amount), { total: 'base' }],
      ]));
      const eidi = eidiOf(wage, s.eidiDays);
      const mid = [['حقوق ماهانه:', money(s.amount), { total: 'monthly' }], ['حق بن کارگری:', '۰', { edit: 'add' }], ['حق مسکن:', '۰', { edit: 'add' }], ['حق اولاد:', '۰', { edit: 'add' }]];
      if (o.eidi) mid.push(['روز مبنای عیدی:', fa(s.eidiDays), { edit: 'days' }], ['عیدی:', num(eidi), { edit: 'add', role: 'eidi' }], ['سنوات (نصف عیدی):', num(sanavatOf(eidi)), { edit: 'add', role: 'sanavat' }]);
      else mid.push(['عیدی و سنوات:', '۰', { edit: 'add' }]);
      mid.push(['حقوق خالص:', money(s.amount), { total: 'net' }]);
      body.appendChild(col('حقوق ماهانه و مزایا', mid));
      body.appendChild(col('کسورات', [
        ['مساعده:', '', { edit: 'sub' }], ['وام:', '', { edit: 'sub' }], ['مالیات حقوق:', '', { edit: 'sub' }], ['حق بیمه کارگری:', '', { edit: 'sub' }],
        ['جمع کسورات:', '۰', { total: 'subs' }],
      ], 'last'));
      t.appendChild(body);
      // مبلغ پرداخت‌شده
      const paid = mk('tr'); paid.className = 'paid';
      const pc = mk('td'); pc.colSpan = 3;
      const pg = mk('div', 'paid-grid');
      pg.appendChild(mk('span', 'l', 'مبلغ پرداخت‌شده:')); const pv = mk('b', 'v', money(s.amount)); pv.dataset.role = 'paid'; pg.appendChild(pv);
      pg.appendChild(mk('span', 'l', 'تاریخ پرداخت:')); const pd = mk('b', 'v edit', ''); pd.contentEditable = 'true'; pd.setAttribute('role', 'textbox'); pd.setAttribute('aria-label', 'تاریخ پرداخت'); pg.appendChild(pd);
      pc.appendChild(pg); paid.appendChild(pc); t.appendChild(paid);
      // امضاها
      const sig = mk('tr'); sig.className = 'sig';
      const sc = mk('td'); sc.colSpan = 3;
      const sg = mk('div', 'sig-grid');
      sg.appendChild(mk('div', 'sg', 'محل امضا سرپرست')); sg.appendChild(mk('div', 'sg', 'محل امضا پرسنل')); sg.appendChild(mk('div', 'sg stamp', 'محل مهر شرکت'));
      sc.appendChild(sg); sig.appendChild(sc); t.appendChild(sig);
      art.appendChild(t);
      if (s.noRate) art.appendChild(mk('div', 'warn no-print', 'برای این کارمند نرخ ساعتی تعریف نشده است.'));
      else if (s.excludedDays) art.appendChild(mk('div', 'warn no-print', `${fa(s.excludedDays)} روز (اعتراض باز / ورود بدون خروج) از محاسبه خارج شده است.`));
      host.appendChild(art);
      if (o.eidi) recompute(art, wage, false); // خالص و پرداخت‌شده شامل عیدی و سنوات
    });
  }

  // محاسبه‌ی دوباره‌ی جمع‌ها وقتی خانه‌ای ویرایش شد
  function recompute(slip, wage, refreshEidi) {
    if (refreshEidi) {
      const d = slip.querySelector('[data-kind="days"]');
      const ee = slip.querySelector('[data-role="eidi"]'); const ss = slip.querySelector('[data-role="sanavat"]');
      if (d && ee && ss) { const e = eidiOf(wage || DEFAULT_DAILY_WAGE, parseAmount(d.textContent)); ee.textContent = num(e); ss.textContent = num(sanavatOf(e)); }
    }
    const base = slip.dataset.base === '' ? 0 : parseInt(slip.dataset.base, 10);
    let add = 0; let sub = 0;
    slip.querySelectorAll('[data-kind="add"]').forEach((e) => { add += parseAmount(e.textContent); });
    slip.querySelectorAll('[data-kind="sub"]').forEach((e) => { sub += parseAmount(e.textContent); });
    const net = base + add - sub;
    const set = (role, v) => { const e = slip.querySelector(`[data-role="${role}"]`); if (e) e.textContent = slip.dataset.base === '' && add === 0 && sub === 0 ? '' : num(v); };
    set('subs', sub); set('net', net); set('paid', net);
  }

  function apiUrlFrom(search) {
    const p = new URLSearchParams(search);
    const q = new URLSearchParams();
    for (const k of ['year', 'month', 'department', 'includeInactive']) {
      if (p.get(k) !== null && p.get(k) !== '') q.set(k, p.get(k));
    }
    const uid = p.get('userId');
    if (uid && /^\d+$/.test(uid)) return `/api/admin/payroll/${uid}?${q.toString()}`;
    return `/api/admin/payroll?${q.toString()}`;
  }

  async function main(win) {
    const doc = win.document;
    const status = doc.getElementById('status');
    const host = doc.getElementById('slips');
    doc.getElementById('print-btn').addEventListener('click', () => win.print());
    doc.getElementById('opt-two').addEventListener('change', (e) => { host.className = `slips${e.target.checked ? ' two' : ''}`; });
    const qs = new URLSearchParams(win.location.search);
    const eidiBox = doc.getElementById('opt-eidi'); const wageIn = doc.getElementById('opt-wage');
    eidiBox.checked = qs.get('eidi') === '1';
    wageIn.value = num(DEFAULT_DAILY_WAGE);
    const wageNow = () => parseAmount(wageIn.value) || DEFAULT_DAILY_WAGE;
    host.addEventListener('input', (e) => { const s = e.target.closest && e.target.closest('.slip'); if (s) recompute(s, wageNow(), !!(e.target.dataset && e.target.dataset.kind === 'days')); });
    let payload;
    const draw = () => {
      const slips = selectRows(payload, { all: doc.getElementById('opt-all').checked || new URLSearchParams(win.location.search).get('all') === '1' })
        .map((r) => buildSlip(r, { month: payload.month, to: payload.to }, win.Jalali));
      render(doc, slips, { eidi: eidiBox.checked, wage: wageNow() });
      status.textContent = slips.length ? `${fa(slips.length)} فیش آماده‌ی چاپ` : 'کارمندی با حقوق مثبت در این ماه نیست.';
      status.className = 'status';
    };
    try {
      const res = await win.fetch(apiUrlFrom(win.location.search), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (res.status === 401) throw new Error('ابتدا وارد پنل شوید، سپس این صفحه را دوباره باز کنید.');
      payload = await res.json();
      if (!res.ok) throw new Error(payload && payload.error ? payload.error : 'دریافت اطلاعات حقوق ناموفق بود.');
      doc.getElementById('opt-all').addEventListener('change', draw);
      eidiBox.addEventListener('change', draw);
      wageIn.addEventListener('change', draw);
      draw();
    } catch (err) {
      status.textContent = err.message || 'خطا';
      status.className = 'status error';
    }
  }

  const api = { eidiOf, sanavatOf, dayOfYear, DEFAULT_DAILY_WAGE, buildSlip, selectRows, render, recompute, apiUrlFrom, parseAmount, jalaliDate, hhmm, num, fa };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document && root.addEventListener) {
    root.Payslip = api;
    root.addEventListener('DOMContentLoaded', () => { main(root); });
  }
}(typeof window !== 'undefined' ? window : undefined));
