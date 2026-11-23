// فیش حقوقی قابل چاپ/PDF. صفحه‌ی مستقل از پوسته‌ی پنل (هم‌تم با پنل)؛ داده از همان API حقوق (اسکوپ و مجوز payroll.read سمت سرور).
// همه‌ی متن‌ها با textContent ساخته می‌شوند (بدون insertion از HTML) و هیچ inline script/style تگ ندارد (CSP پنل).
// پارامترهای صفحه: ?year=1405&month=7[&department=][&userId=][&includeInactive=1][&eidi=1][&all=1]
// تنظیمات شخصی‌سازی در localStorage همین مرورگر نگه داشته می‌شود (فقط ترجیح‌ها؛ نه مبلغ و نه اطلاعات کارمند).
(function (root) {
  'use strict';

  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v).replace(/\d/g, (d) => FA[d]);
  const num = (n) => fa(Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  const hhmm = (m) => `${fa(Math.floor(m / 60))}:${fa(String(Math.round(m) % 60).padStart(2, '0'))}`;
  const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

  function parseAmount(text) {
    const s = String(text == null ? '' : text)
      .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[^\d]/g, '');
    return s === '' ? 0 : parseInt(s, 10);
  }

  // مزد روزانه‌ی اداره‌ی کار (پیش‌فرض) و فرمول عیدی/سنوات: عیدی = مزد روزانه × ۶۰ ÷ ۳۶۵ × روزهای کارکرد؛ سنوات = نصف عیدی
  const DEFAULT_DAILY_WAGE = 541850;
  const eidiOf = (wage, days) => Math.round((Number(wage) * 60 / 365) * Math.max(0, Number(days) || 0));
  const sanavatOf = (eidi) => Math.round(eidi / 2);
  const dayOfYear = (jm, jd) => (jm <= 6 ? (jm - 1) * 31 + jd : 186 + (jm - 7) * 30 + jd);

  function jalaliDate(iso, J) {
    try {
      const j = (J || (root && root.Jalali)).isoToJalali(iso);
      return fa(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
    } catch (_) { return iso || ''; }
  }
  function jalaliDayOfYear(iso, J) {
    try { const j = (J || (root && root.Jalali)).isoToJalali(iso); return Math.min(365, dayOfYear(j.jm, j.jd)); } catch (_) { return 365; }
  }

  // مدل خالص (بدون DOM) برای یک ردیف پاسخ API حقوق
  function buildSlip(row, meta, J) {
    const u = row.user || {};
    const useful = Number(row.usefulMinutes) || 0;
    const ot = Math.min(Number(row.overtimeMinutes) || 0, useful); // اضافه‌کاری «درون» ساعت مفید است
    const rate = row.rateKt == null ? null : row.rateKt * 1000;
    return {
      userId: u.id,
      title: `فیش حقوقی فراز هنر / ${MONTHS[(meta.month || 1) - 1]} ماه`,
      monthName: MONTHS[(meta.month || 1) - 1],
      date: jalaliDate(meta.to, J),
      eidiDays: jalaliDayOfYear(meta.to, J), // پیش‌فرض: از ۱ فروردین تا پایان همین ماه (قابل ویرایش برای هر کارمند)
      name: u.fullName || '',
      personnelCode: u.personnelCode || '',
      department: u.department || '',
      workHours: hhmm(useful - ot),
      overtime: ot ? hhmm(ot) : '',
      deficit: '', // کسری قبلاً در ساعت مفید اعمال شده؛ دوباره کم نمی‌شود
      netHours: hhmm(useful),
      rate: rate == null ? '' : num(rate),
      insurance: Math.max(0, Math.round(Number(row.insuranceToman) || 0)),
      amount: row.amountToman == null ? null : Math.round(row.amountToman),
      noRate: row.rateKt == null,
      excludedDays: Array.isArray(row.excludedDays) ? row.excludedDays.length : 0,
    };
  }

  function selectRows(payload, { all } = {}) {
    const rows = Array.isArray(payload.rows) ? payload.rows : [payload];
    return rows.filter((r) => r && r.user && (all || (r.amountToman != null && r.amountToman > 0)));
  }

  // ---------- تنظیمات شخصی ----------
  const STORE = 'payslip.opts.v1';
  const DEFAULTS = { eidi: false, wage: DEFAULT_DAILY_WAGE, paper: 'a5', perPage: 1, ins: true, extras: true, ids: true, sign: true, stamp: true, company: 'فراز هنر', note: '' };
  function loadOpts(storage) {
    try {
      const raw = storage && storage.getItem(STORE);
      const o = raw ? JSON.parse(raw) : {};
      const out = { ...DEFAULTS };
      for (const k of Object.keys(DEFAULTS)) if (o && typeof o[k] === typeof DEFAULTS[k]) out[k] = o[k];
      if (out.perPage !== 1 && out.perPage !== 2) out.perPage = 1;
      if (out.paper !== 'a5' && out.paper !== 'a4') out.paper = 'a5';
      if (!(out.wage > 0)) out.wage = DEFAULT_DAILY_WAGE;
      return out;
    } catch (_) { return { ...DEFAULTS }; }
  }
  function saveOpts(storage, opts) { try { storage.setItem(STORE, JSON.stringify(opts)); } catch (_) { /* حالت خصوصی */ } }

  // ---------- ساخت DOM یک فیش ----------
  // st: { opts, ed: ویرایش‌های دستی این فیش، sw: { ins, eidi } سوییچ‌های همین فیش }
  function makeSlip(doc, s, st) {
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const o = st.opts; const ed = st.ed || {}; const sw = st.sw;
    const money = (v) => (v == null ? '' : num(v));
    const art = mk('article', 'slip');
    art.dataset.id = String(s.userId);
    art.dataset.base = s.amount == null ? '' : String(s.amount);

    // نوار ابزار روی صفحه (چاپ نمی‌شود)
    const bar = mk('div', 'slip-bar no-print');
    bar.appendChild(mk('b', 'slip-bar-name', s.name || '—'));
    const tg = (key, label, checked, disabled) => {
      const l = mk('label', 'ps-mini'); const i = doc.createElement('input'); i.type = 'checkbox'; i.checked = checked; i.dataset.sw = key; i.disabled = !!disabled;
      l.appendChild(i); l.appendChild(mk('span', '', label)); return l;
    };
    bar.appendChild(tg('ins', 'کسر بیمه', !!sw.ins, false));
    const amt = doc.createElement('input'); amt.type = 'text'; amt.className = 'ps-amt ltr'; amt.inputMode = 'numeric'; amt.autocomplete = 'off'; amt.dataset.insAmt = '1';
    amt.placeholder = 'مبلغ بیمه (تومان)'; amt.setAttribute('aria-label', 'مبلغ کسر بیمه (تومان)');
    amt.value = ed.ins != null ? ed.ins : (s.insurance ? num(s.insurance) : '');
    bar.appendChild(amt);
    bar.appendChild(tg('eidi', 'عیدی و سنوات', sw.eidi, false));
    const rm = mk('button', 'ps-mini-btn', '✕ حذف از چاپ'); rm.type = 'button'; rm.dataset.act = 'remove'; bar.appendChild(rm);
    art.appendChild(bar);

    const paper = mk('div', 'paper');
    const head = mk('div', 'p-head');
    head.appendChild(mk('div', 'p-co', `فیش حقوقی ${o.company || ''}`.trim()));
    head.appendChild(mk('div', 'p-mid', 'هوالرزاق'));
    const hd = mk('div', 'p-date'); hd.appendChild(mk('span', '', `${s.monthName} ماه`)); hd.appendChild(mk('b', '', s.date)); head.appendChild(hd);
    paper.appendChild(head);

    const editable = (el, key, text) => { el.contentEditable = 'true'; el.dataset.key = key; el.setAttribute('role', 'textbox'); el.textContent = (ed[key] != null && key !== 'ins') ? ed[key] : text; return el; };

    // مشخصات
    const info = mk('div', 'p-info');
    const ic = (label, valEl) => { const c = mk('div', 'ic'); c.appendChild(mk('span', 'l', `${label}:`)); c.appendChild(valEl); info.appendChild(c); };
    ic('نام و نام خانوادگی', mk('b', 'v', s.name));
    ic('کد پرسنلی', mk('b', 'v', s.personnelCode ? fa(s.personnelCode) : ''));
    ic('واحد / دپارتمان', mk('b', 'v', s.department));
    if (o.ids) {
      ic('شغل', editable(mk('b', 'v edit'), 'job', ''));
      ic('نوع استخدام', editable(mk('b', 'v edit'), 'emp', ''));
      ic('کد ملی', editable(mk('b', 'v edit'), 'nid', ''));
      ic('شماره بیمه', editable(mk('b', 'v edit'), 'insno', ''));
    }
    paper.appendChild(info);

    const cols = mk('div', 'p-cols');
    const col = (title, items, cls) => {
      const c = mk('div', `p-col ${cls || ''}`); c.appendChild(mk('div', 'p-col-h', title));
      items.forEach(([l, v, opt]) => {
        const r = mk('div', `ln${opt && opt.total ? ' tot' : ''}`); r.appendChild(mk('span', 'l', l));
        const val = mk('span', 'v', v);
        if (opt && opt.key) { editable(val, opt.key, v); val.classList.add('edit'); val.dataset.kind = opt.kind; val.setAttribute('aria-label', l); }
        if (opt && opt.role) val.dataset.role = opt.role;
        r.appendChild(val); c.appendChild(r);
      });
      cols.appendChild(c);
    };
    col('حقوق پایه', [
      ['ساعات کارکرد', s.workHours], ['کسر کار', s.deficit], ['اضافه کار', s.overtime], ['خالص کارکرد', s.netHours],
      ['مبلغ توافق‌شده (ساعتی)', s.rate], ['مبلغ کارکرد', money(s.amount), { role: 'base', total: true }],
    ]);
    const eidiOn = sw.eidi;
    const mid = [['حقوق ماهانه', money(s.amount), { role: 'monthly', total: true }]];
    if (o.extras) mid.push(['حق بن کارگری', '۰', { key: 'bon', kind: 'add' }], ['حق مسکن', '۰', { key: 'mask', kind: 'add' }], ['حق اولاد', '۰', { key: 'olad', kind: 'add' }]);
    if (eidiOn) {
      const days = ed.days != null ? parseAmount(ed.days) : s.eidiDays; const e = eidiOf(o.wage, days);
      mid.push(['روز مبنای عیدی', fa(s.eidiDays), { key: 'days', kind: 'days' }], ['عیدی', num(e), { key: 'eidi', kind: 'add', role: 'eidi' }], ['سنوات (نصف عیدی)', num(sanavatOf(e)), { key: 'san', kind: 'add', role: 'sanavat' }]);
    } else if (o.extras) mid.push(['عیدی و سنوات', '۰', { key: 'eidisan', kind: 'add' }]);
    mid.push(['حقوق خالص', money(s.amount), { role: 'net', total: true }]);
    col('حقوق ماهانه و مزایا', mid, 'mid');
    const sub = [];
    if (o.extras) sub.push(['مساعده', '', { key: 'mosa', kind: 'sub' }], ['وام', '', { key: 'vam', kind: 'sub' }], ['مالیات حقوق', '', { key: 'tax', kind: 'sub' }]);
    sub.push(['حق بیمه کارگری', sw.ins ? (ed.ins != null ? ed.ins : (s.insurance ? num(s.insurance) : '')) : '', { key: 'ins', kind: 'sub' }], ['جمع کسورات', '۰', { role: 'subs', total: true }]);
    col('کسورات', sub, 'last');
    paper.appendChild(cols);

    const paid = mk('div', 'p-paid');
    paid.appendChild(mk('span', 'l', 'مبلغ پرداخت‌شده:')); const pv = mk('b', 'v big', money(s.amount)); pv.dataset.role = 'paid'; paid.appendChild(pv);
    paid.appendChild(mk('span', 'l', 'تاریخ پرداخت:')); paid.appendChild(editable(mk('b', 'v edit date'), 'paidDate', ''));
    paper.appendChild(paid);

    if (o.sign || o.stamp) {
      const sig = mk('div', 'p-sig');
      if (o.sign) { sig.appendChild(mk('div', 'sg', 'محل امضا سرپرست')); sig.appendChild(mk('div', 'sg', 'محل امضا پرسنل')); }
      if (o.stamp) sig.appendChild(mk('div', 'sg stamp', 'محل مهر شرکت'));
      sig.style.gridTemplateColumns = o.sign && o.stamp ? '1fr 1fr 1.2fr' : o.sign ? '1fr 1fr' : '1fr';
      paper.appendChild(sig);
    }
    if (o.note) paper.appendChild(mk('div', 'p-note', o.note));
    art.appendChild(paper);
    if (s.noRate) art.appendChild(mk('div', 'ps-warn no-print', 'برای این کارمند نرخ ساعتی تعریف نشده است.'));
    else if (s.excludedDays) art.appendChild(mk('div', 'ps-warn no-print', `${fa(s.excludedDays)} روز (اعتراض باز / ورود بدون خروج) از محاسبه خارج شده است.`));
    return art;
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
    return `/api/admin/payroll?${q.toString()}`;
  }
  function userIdFrom(search) { const v = new URLSearchParams(search).get('userId'); return v && /^\d+$/.test(v) ? parseInt(v, 10) : null; }

  async function main(win) {
    const doc = win.document;
    const $ = (id) => doc.getElementById(id);
    const status = $('status'); const host = $('slips');
    const qs = new URLSearchParams(win.location.search);
    const opts = loadOpts(win.localStorage);
    if (qs.get('eidi') === '1') opts.eidi = true;
    const state = { rows: [], slips: new Map(), selected: new Set(), edits: new Map(), sw: new Map(), search: '', meta: null };
    const persist = () => saveOpts(win.localStorage, opts);

    // --- اتصال کنترل‌ها به opts ---
    const bindCheck = (id, key) => { const el = $(id); el.checked = !!opts[key]; el.addEventListener('change', () => { opts[key] = el.checked; persist(); draw(); }); };
    { const el = $('opt-ins'); el.checked = !!opts.ins; el.addEventListener('change', () => { opts.ins = el.checked; persist(); state.sw.forEach((v) => { v.ins = opts.ins; }); draw(); }); }
 bindCheck('opt-extras', 'extras'); bindCheck('opt-ids', 'ids'); bindCheck('opt-sign', 'sign'); bindCheck('opt-stamp', 'stamp');
    const wageIn = $('opt-wage'); wageIn.value = num(opts.wage);
    wageIn.addEventListener('change', () => { opts.wage = parseAmount(wageIn.value) || DEFAULT_DAILY_WAGE; wageIn.value = num(opts.wage); persist(); draw(); });
    const company = $('opt-company'); company.value = opts.company;
    company.addEventListener('input', () => { opts.company = company.value; persist(); draw(); });
    const note = $('opt-note'); note.value = opts.note;
    note.addEventListener('input', () => { opts.note = note.value; persist(); draw(); });
    doc.querySelectorAll('input[name="kind"]').forEach((r) => { r.checked = (r.value === 'eidi') === !!opts.eidi; r.addEventListener('change', () => { if (r.checked) { opts.eidi = r.value === 'eidi'; state.sw.clear(); persist(); draw(); } }); });
    const paperVal = () => (opts.paper === 'a5' ? 'a5' : `a4-${opts.perPage}`);
    doc.querySelectorAll('input[name="paper"]').forEach((r) => {
      r.checked = r.value === paperVal();
      r.addEventListener('change', () => { if (!r.checked) return; if (r.value === 'a5') opts.paper = 'a5'; else { opts.paper = 'a4'; opts.perPage = Number(r.value.slice(3)); } persist(); draw(); });
    });
    $('opt-reset').addEventListener('click', () => { Object.assign(opts, DEFAULTS); persist(); state.edits.clear(); state.sw.clear(); win.location.reload(); });
    $('print-btn').addEventListener('click', () => win.print());

    // --- فهرست کارمندان ---
    const list = $('emp-list');
    const drawList = () => {
      list.textContent = '';
      const term = state.search.trim();
      state.rows.filter((r) => !term || (r.user.fullName || '').includes(term) || String(r.user.personnelCode || '').includes(term)).forEach((r) => {
        const li = doc.createElement('li');
        const l = doc.createElement('label'); l.className = 'ps-emp';
        const cb = doc.createElement('input'); cb.type = 'checkbox'; cb.checked = state.selected.has(r.user.id); cb.dataset.id = String(r.user.id);
        const nm = doc.createElement('span'); nm.className = 'n'; nm.textContent = r.user.fullName || 'بدون نام';
        const am = doc.createElement('small'); am.textContent = r.amountToman > 0 ? `${num(r.amountToman)} تومان` : 'بدون حقوق';
        if (!(r.amountToman > 0)) am.className = 'zero';
        l.appendChild(cb); l.appendChild(nm); l.appendChild(am);
        const only = doc.createElement('button'); only.type = 'button'; only.className = 'ps-only'; only.dataset.only = String(r.user.id); only.textContent = 'فقط این'; only.title = 'فقط فیش این کارمند چاپ شود';
        li.appendChild(l); li.appendChild(only); list.appendChild(li);
      });
    };
    list.addEventListener('change', (e) => { const id = Number(e.target.dataset.id); if (!id) return; if (e.target.checked) state.selected.add(id); else state.selected.delete(id); draw(); });
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-only]'); if (!b) return; state.selected = new Set([Number(b.dataset.only)]); drawList(); draw(); });
    $('emp-search').addEventListener('input', (e) => { state.search = e.target.value; drawList(); });
    $('sel-paid').addEventListener('click', () => { state.selected = new Set(state.rows.filter((r) => r.amountToman > 0).map((r) => r.user.id)); drawList(); draw(); });
    $('sel-all').addEventListener('click', () => { state.selected = new Set(state.rows.map((r) => r.user.id)); drawList(); draw(); });
    $('sel-none').addEventListener('click', () => { state.selected = new Set(); drawList(); draw(); });

    // --- رسم فیش‌ها ---
    function draw() {
      host.className = `slips${opts.paper === 'a5' ? ' a5' : (opts.perPage === 2 ? ' two' : '')}`;
      host.textContent = '';
      let n = 0;
      state.rows.forEach((r) => {
        if (!state.selected.has(r.user.id)) return;
        const s = state.slips.get(r.user.id);
        if (!state.edits.has(s.userId)) state.edits.set(s.userId, {});
        if (!state.sw.has(s.userId)) state.sw.set(s.userId, { ins: opts.ins, eidi: opts.eidi });
        const sw = state.sw.get(s.userId);
        const art = makeSlip(doc, s, { opts, ed: state.edits.get(s.userId), sw: { ins: sw.ins, eidi: sw.eidi } });
        host.appendChild(art); recompute(art, opts.wage, false); n += 1;
      });
      $('ps-empty').hidden = n > 0;
      $('print-btn').textContent = n ? `🖨 چاپ / ذخیره PDF (${fa(n)} فیش)` : '🖨 چاپ / ذخیره PDF';
      $('print-btn').disabled = !n;
      status.textContent = '';
    }
    host.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.insAmt) { // مبلغ بیمه از نوار بالای فیش
        const slip0 = t.closest('.slip'); const id0 = Number(slip0.dataset.id);
        const txt = t.value.trim() === '' ? '' : num(parseAmount(t.value));
        state.edits.get(id0).ins = txt; state.sw.get(id0).ins = true;
        const cb = slip0.querySelector('input[data-sw="ins"]'); if (cb) cb.checked = true;
        const cell = slip0.querySelector('[data-key="ins"]'); if (cell) cell.textContent = txt;
        recompute(slip0, opts.wage, false); return;
      }
      const slip = t.closest && t.closest('.slip'); if (!slip || !t.dataset.key) return;
      const id = Number(slip.dataset.id); const ed = state.edits.get(id); ed[t.dataset.key] = t.textContent;
      if (t.dataset.key === 'ins') { const a = slip.querySelector('[data-ins-amt]'); if (a) a.value = t.textContent; state.sw.get(id).ins = true; const cb = slip.querySelector('input[data-sw="ins"]'); if (cb) cb.checked = true; }
      if (t.dataset.key === 'days') { delete ed.eidi; delete ed.san; recompute(slip, opts.wage, true); } else recompute(slip, opts.wage, false);
    });
    host.addEventListener('change', (e) => {
      const t = e.target; const slip = t.closest && t.closest('.slip'); if (!slip || !t.dataset.sw) return;
      const sw = state.sw.get(Number(slip.dataset.id)); sw[t.dataset.sw] = t.checked;
      if (t.dataset.sw === 'eidi') { const ed = state.edits.get(Number(slip.dataset.id)); delete ed.eidi; delete ed.san; delete ed.days; }
      draw();
    });
    host.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-act="remove"]'); if (!b) return; state.selected.delete(Number(b.closest('.slip').dataset.id)); drawList(); draw(); });

    // --- بارگذاری ---
    try {
      status.textContent = 'در حال بارگذاری…';
      const res = await win.fetch(apiUrlFrom(win.location.search), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (res.status === 401) throw new Error('ابتدا وارد پنل شوید، سپس این صفحه را دوباره باز کنید.');
      const payload = await res.json();
      if (!res.ok) throw new Error(payload && payload.error ? payload.error : 'دریافت اطلاعات حقوق ناموفق بود.');
      state.meta = { month: payload.month, to: payload.to };
      state.rows = selectRows(payload, { all: true }).sort((a, b) => (a.user.fullName || '').localeCompare(b.user.fullName || '', 'fa'));
      state.rows.forEach((r) => state.slips.set(r.user.id, buildSlip(r, state.meta, win.Jalali)));
      $('ps-sub').textContent = `${payload.label || ''} — ${fa(state.rows.length)} کارمند`;
      const uid = userIdFrom(win.location.search);
      state.selected = uid && state.rows.some((r) => r.user.id === uid) ? new Set([uid]) : new Set(state.rows.filter((r) => r.amountToman > 0 || qs.get('all') === '1').map((r) => r.user.id));
      drawList(); draw();
    } catch (err) {
      status.textContent = err.message || 'خطا';
      status.className = 'ps-status error';
    }
  }

  const api = { eidiOf, sanavatOf, dayOfYear, DEFAULT_DAILY_WAGE, DEFAULTS, loadOpts, saveOpts, buildSlip, selectRows, makeSlip, recompute, apiUrlFrom, userIdFrom, parseAmount, jalaliDate, hhmm, num, fa };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document && root.addEventListener) {
    root.Payslip = api;
    root.addEventListener('DOMContentLoaded', () => { main(root); });
  }
}(typeof window !== 'undefined' ? window : undefined));
