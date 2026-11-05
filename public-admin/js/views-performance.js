// «عملکرد کارمندان» (الهام‌گرفته از Search Console) و «حقوق و دستمزد» (فقط ادمین).
//   • عملکرد: بازه‌ی ۲۴ ساعت … ۳ ماه یا دلخواه، فیلتر (روز هفته/وضعیت)، مقایسه با دوره‌ی قبل، حالت روزانه/تجمعی، کاشی‌های قابل‌کلیک،
//     «بینش‌ها»ی خودکار، شاخص‌های کیفیت، نمودار ساعت ورود/خروج، و تب‌های بُعد (روزها، روز هفته، وضعیت‌ها، ساعت ورود، تسک‌ها، مرخصی، اضافه‌کاری، حقوق)
//     با «بازرسی روز» برای هر روز (رکورد، حضور ساعت‌به‌ساعت، استراحت، مرخصی، اعتراض، تسک، مبلغ).
//   • حقوق: جمع/پیش‌بینی/مقایسه با ماه قبل/تفکیک دپارتمان + ریز هر نفر.
// سرور اسکوپ و مجوز را اعمال می‌کند؛ اینجا فقط نمایش است. بدون on*/style درون‌خطی (CSP).

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const J = window.Jalali;
  const PC = window.PerfCharts;
  const fa = (s) => J.toFaDigits(String(s));
  const sum = (a) => a.reduce((t, v) => t + (v || 0), 0);

  const shortDate = (iso) => { try { const j = J.isoToJalali(iso); return `${fa(j.jd)} ${J.MONTH_NAMES[j.jm - 1]}`; } catch (_) { return iso; } };
  PC.init({ esc, fa, fmt, shortDate });
  const clock = PC.clock;
  const toman = (n) => (n == null ? '—' : `${fmt.num(n)} تومان`);
  const mToman = (n) => (n == null ? '—' : `${fa(Math.round((n / 1e6) * 100) / 100)} میلیون`);
  const pctText = (v) => (v == null ? '—' : `${fa(v)}٪`);
  const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const persianWeekday = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;
  const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();

  // kind: min = دقیقه، count = تعداد، money = تومان. good: جهتِ «بهتر»
  const METRICS = [
    { key: 'useful', label: 'ساعت مفید', kind: 'min', good: 'up', icon: 'clock' },
    { key: 'overtime', label: 'اضافه‌کاری', kind: 'min', good: 'up', icon: 'plus' },
    { key: 'shortfall', label: 'کسری کار', kind: 'min', good: 'down', icon: 'alert' },
    { key: 'late', label: 'تأخیر', kind: 'min', good: 'down', icon: 'in' },
    { key: 'breaks', label: 'استراحت', kind: 'min', good: null, icon: 'coffee' },
    { key: 'tasksDone', label: 'تسک انجام‌شده', kind: 'count', good: 'up', icon: 'check' },
    { key: 'present', label: 'روز حضور', kind: 'count', good: 'up', icon: 'attendance' },
    { key: 'earn', label: 'حقوق', kind: 'money', good: 'up', icon: 'wallet', payroll: true },
  ];
  const TEAM_METRICS = [
    { key: 'useful', label: 'ساعت مفید تیم', kind: 'min', good: 'up', icon: 'clock' },
    { key: 'overtime', label: 'اضافه‌کاری', kind: 'min', good: 'up', icon: 'plus' },
    { key: 'shortfall', label: 'کسری کار', kind: 'min', good: 'down', icon: 'alert' },
    { key: 'late', label: 'تأخیر', kind: 'min', good: 'down', icon: 'in' },
    { key: 'breaks', label: 'استراحت', kind: 'min', good: null, icon: 'coffee' },
    { key: 'present', label: 'حاضران', kind: 'count', good: 'up', icon: 'employees' },
    { key: 'absent', label: 'غایبان', kind: 'count', good: 'down', icon: 'x' },
  ];
  const RANGES = [['24h', '۲۴ ساعت'], ['3d', '۳ روز'], ['6d', '۶ روز'], ['30d', '۱ ماه'], ['90d', '۳ ماه'], ['custom', 'دلخواه']];
  const STATUS = { present: 'حاضر', late: 'تأخیر', incomplete: 'ناقص', absent: 'غایب', leave: 'مرخصی', mission: 'مأموریت', holiday: 'تعطیل', weekend: 'آخر هفته', pending: 'امروز', future: 'آینده', manual_leave: 'مرخصی', manual_holiday: 'تعطیل', untimed: 'بدون ساعت', not_started: 'پیش از ثبت' };
  const STATUS_TONE = { present: 'normal', late: 'late', absent: 'late', incomplete: 'late' };
  const FLAGS = { missing_checkout: 'ورود بدون خروج', invalid_time: 'زمان نامعتبر', open_break: 'استراحت باز' };
  const FILTER_STATUS = [['', 'همه‌ی وضعیت‌ها'], ['worked', 'حاضر (با تأخیر یا بدون)'], ['late', 'فقط تأخیر'], ['absent', 'فقط غیبت'], ['leave', 'مرخصی و مأموریت']];

  const ui = {
    range: '30d', from: '', to: '', compare: true, mode: 'daily', tab: 'days', fWeekday: '', fStatus: '',
    active: new Set(['useful', 'overtime', 'shortfall']),
    sort: 'useful', dir: -1, tActive: new Set(['useful', 'late', 'shortfall']), dept: '', search: '', tmode: 'daily',
  };
  const rangeQuery = () => q({ range: ui.range, from: ui.range === 'custom' ? ui.from : '', to: ui.range === 'custom' ? ui.to : '' });
  const rangeLabel = (r) => (r.days === 1 ? fmt.date(r.from) : `${fmt.date(r.from)} تا ${fmt.date(r.to)}`);

  // ---------- ابزارهای نمایش ----------
  const mval = (m, v) => (m.kind === 'min' ? fmt.min(v) : m.kind === 'money' ? toman(v) : fmt.num(v));

  function delta(m, cur, prev) {
    if (prev == null || Number.isNaN(prev)) return '';
    if (cur === 0 && prev === 0) return '<span class="pf-delta flat">بدون تغییر</span>';
    if (!prev) return '<span class="pf-delta flat">قبلی: ۰</span>';
    const p = Math.round(((cur - prev) / prev) * 100);
    if (p === 0) return '<span class="pf-delta flat">بدون تغییر</span>';
    const up = p > 0;
    const tone = m.good == null ? 'flat' : (up === (m.good === 'up') ? 'good' : 'bad');
    return `<span class="pf-delta ${tone}" title="نسبت به دوره‌ی قبل">${up ? '▲' : '▼'} ${fa(Math.abs(p))}٪</span>`;
  }
  // اختلافِ «امتیازی» برای نسبت‌ها (حضور، وقت‌شناسی…) و «واحدی» برای ساعت/پراکندگی
  function deltaAbs(cur, prev, good, unit) {
    if (cur == null || prev == null) return '';
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return '<span class="pf-delta flat">بدون تغییر</span>';
    const tone = good == null ? 'flat' : ((d > 0) === (good === 'up') ? 'good' : 'bad');
    return `<span class="pf-delta ${tone}" title="نسبت به دوره‌ی قبل">${d > 0 ? '▲' : '▼'} ${fa(Math.abs(d))} ${unit}</span>`;
  }

  function downloadCsv(name, head, rows) {
    const e2 = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const blob = new Blob([`﻿${[head.map(e2).join(','), ...rows.map((r) => r.map(e2).join(','))].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const bar = (pct, tone) => `<div class="pf-meter${tone ? ` pf-tone-${tone}` : ''}" data-progress="${Math.max(0, Math.min(100, Math.round(pct || 0)))}"><i></i></div>`;
  const applyProgress = (root) => $$('[data-progress]', root).forEach((m) => m.style.setProperty('--progress', `${Math.max(0, Math.min(100, Number(m.dataset.progress) || 0))}%`));
  const emptyBox = (msg) => `<div class="empty">${esc(msg)}</div>`;

  // نوار بازه (همان ظاهر مشترک range-bar): چیپ‌های سریع + خلاصه‌ی شمسیِ بازه‌ی واقعی + «از/تا» برای حالت دلخواه
  function rangeBar(range) {
    const chips = RANGES.map(([k, l]) => `<button type="button" class="rb-chip pf-range${ui.range === k ? ' is-active' : ''}" data-range="${k}" aria-pressed="${ui.range === k}">${l}</button>`).join('');
    const r = range || {};
    const custom = ui.range === 'custom'
      ? `<div class="rb-fields" id="pf-custom"><label class="field"><span>از</span><input type="date" name="from" value="${esc(ui.from)}" /></label><span class="rb-arrow" aria-hidden="true">←</span><label class="field"><span>تا</span><input type="date" name="to" value="${esc(ui.to)}" /></label></div>`
      : '';
    return `<div class="rb-wrap"><div class="rb" data-rb><div class="rb-top"><span class="rb-label">${AP.icon('calendar')}بازه‌ی زمانی</span>
      <div class="rb-chips" role="group" aria-label="بازه‌ی زمانی">${chips}</div></div>
      <div class="rb-foot">${custom}<div class="rb-summary" aria-live="polite">${r.from ? AP.rangeBar.summaryHtml(r.from, r.to) : ''}</div></div></div></div>`;
  }
  function bindRange(page) {
    $$('.pf-range', page).forEach((b) => b.addEventListener('click', () => {
      ui.range = b.dataset.range;
      if (ui.range === 'custom' && !ui.from) { ui.from = fmt.daysAgo(13); ui.to = fmt.today(); }
      AP.refresh();
    }));
    const f = $('#pf-custom', page);
    if (!f) return;
    if (AP.dates) AP.dates.mount(f); // تقویم شمسی برای «از/تا» (قرارداد AP.dates: قبل از listenerهای صفحه)
    f.addEventListener('change', () => {
      const d = AP.formData(f);
      if (!d.from || !d.to) return; // هنوز نیمه‌کاره
      if (d.from > d.to) { AP.toast('تاریخ شروع نباید بعد از تاریخ پایان باشد.', true); return; }
      ui.from = d.from; ui.to = d.to; AP.refresh();
    });
  }


  // کارت‌های دپارتمان (به‌جای جدول ساده): سهم از کل با حلقه، رقم اصلی درشت، آمار ریز
  const DEPT_TONES = ['brand', 'green', 'orange', 'purple', 'blue', 'red'];
  function ring(pct) {
    const r = 26; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, pct || 0));
    return `<svg class="pf-ring" viewBox="0 0 64 64" aria-hidden="true"><circle class="pf-ring-bg" cx="32" cy="32" r="${r}"/><circle class="pf-ring-fg" cx="32" cy="32" r="${r}" stroke-dasharray="${((v / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/></svg><b class="pf-ring-txt">${fa(Math.round(v))}٪</b>`;
  }
  function deptCards(list, { main, mainLabel, share, stats, title }) {
    if (!list.length) return emptyBox('دپارتمانی نیست.');
    return `<div class="pf-depts" aria-label="${esc(title)}">${list.map((d, i) => `<article class="pf-dept pf-dt-${DEPT_TONES[i % DEPT_TONES.length]}">
      <div class="pf-dept-top"><span class="pf-dept-rank">${fa(i + 1)}</span><h4>${esc(d.department)}</h4><span class="pf-dept-count">${fmt.num(d.employees)} نفر</span></div>
      <div class="pf-dept-body"><div class="pf-dept-ring">${ring(share(d))}</div><div class="pf-dept-main"><span>${esc(mainLabel)}</span><strong>${main(d)}</strong></div></div>
      ${bar(share(d), DEPT_TONES[i % DEPT_TONES.length] === 'brand' ? '' : DEPT_TONES[i % DEPT_TONES.length])}
      <dl class="pf-dept-stats">${stats(d).map(([l, v]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join('')}</dl></article>`).join('')}</div>`.replace(/ style-hook/g, '');
  }

  // مقدار کاشی: عدد درشت + واحد کوچک کنار هم (به‌جای یک جمله‌ی هم‌اندازه که چندخطی می‌شد)؛ مقدارهای غیرِ «عدد+واحد» دست‌نخورده می‌مانند
  const unitize = (raw) => {
    const v = String(raw).replace(/^<span class="pf-amount">([^<]*)<\/span>$/, '$1').trim();
    const tight = (n) => String(n).replace(/[٬,]/g, '<span class="pf-sep">٬</span>'); // جداکننده‌ی هزارگان جمع‌وجور (در وزیرمتن پهن است)
    const part = (n, u) => `<span class="pf-v">${tight(n)}</span><span class="pf-u">${u}</span>`;
    const N = '[\\d۰-۹٬,.٫]+';
    let m = new RegExp(`^(${N})\\s*(تومان|هزار|روز)$`).exec(v);
    if (m) return part(m[1], m[2]);
    m = new RegExp(`^(${N})\\s*ساعت(?:\\s*و\\s*(${N})\\s*دقیقه)?$`).exec(v);
    if (m) return part(m[1], 'ساعت') + (m[2] ? part(m[2], 'دقیقه') : '');
    m = new RegExp(`^(${N})\\s*دقیقه$`).exec(v);
    if (m) return part(m[1], 'دقیقه');
    return /^[\d۰-۹٬,.٫]+$/.test(v) ? `<span class="pf-v">${tight(v)}</span>` : raw;
  };
  const kpi = (label, value, foot, tone) => `<div class="pf-kpi${tone ? ` ${tone}` : ''}"><span class="pf-kpi-label">${label}</span><strong class="pf-kpi-val">${unitize(value)}</strong><span class="pf-kpi-foot">${foot || ''}</span></div>`;

  AP.view('performance', {
    skeleton: 'cards',
    perm: 'performance.read',
    nav: { icon: 'trend', label: 'عملکرد کارمندان', group: 'گزارش‌ها' },
    async render(param) { return param ? employeePage(param) : teamPage(); },
  });

  // =====================================================================
  // نمای تیم
  // =====================================================================
  async function teamPage() {
    const [data, users] = await Promise.all([AP.api(`/admin/performance/team?${q({ ...Object.fromEntries(new URLSearchParams(rangeQuery())), department: ui.dept })}`), AP.loadUsers().catch(() => [])]);
    const deps = [...new Set(users.map((u) => (u.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
    const t = data.totals;
    const chg = t.previousUseful ? Math.round(((t.useful - t.previousUseful) / t.previousUseful) * 100) : null;
    const tiles = TEAM_METRICS.map((m) => {
      const key = m.key; const total = sum(data.daily.map((d) => d[key]));
      const on = ui.tActive.has(key);
      const val = m.kind === 'count' ? `${fmt.num(Math.round(total / Math.max(1, data.daily.length) * 10) / 10)} <small>در روز</small>` : mval(m, total);
      return `<button type="button" class="pf-tile pf-m-${key}${on ? ' on' : ''}" data-metric="${key}" aria-pressed="${on}"><span class="pf-tile-top"><span class="pf-ico">${AP.icon(m.icon)}</span><span class="pf-tile-name">${esc(m.label)}</span><i class="pf-dot" aria-hidden="true"></i></span><span class="pf-tile-val">${val}</span><span class="pf-tile-foot">${key === 'useful' && chg != null ? delta(m, t.useful, t.previousUseful) : ''}</span></button>`;
    }).join('');
    const kpis = [
      kpi('میانگین نرخ حضور', pctText(t.attendanceRate), '', 'good'),
      kpi('میانگین وقت‌شناسی', pctText(t.punctualityRate), '', 'info'),
      kpi('کارمندان', fmt.num(data.rows.length), esc(ui.dept || 'همه‌ی دپارتمان‌ها')),
      kpi('روز تأخیر', fmt.num(t.lateDays), `${fmt.min(t.late)} جمع`, 'warn'),
      kpi('روز غیبت', fmt.num(t.absentDays), '', 'bad'),
    ].join('');
    const html = `
      <div class="view-header"><div><h2>عملکرد کارمندان</h2><div class="sub">${esc(rangeLabel(data.range))} — روی هر کارمند بزنید تا گزارش کامل او را ببینید.</div></div>
        <div class="pf-head-actions"><label class="field pf-pick"><span>دپارتمان</span><select id="pf-dept"><option value="">همه</option>${deps.map((x) => `<option ${x === ui.dept ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label><button type="button" class="btn ghost" id="pf-team-csv">${AP.icon('download')} CSV</button>${AP.exportBar({ path: '/api/admin/performance/export', params: { range: ui.range, from: ui.range === 'custom' ? ui.from : '', to: ui.range === 'custom' ? ui.to : '', department: ui.dept }, formats: [['xlsx', 'اکسل کامل (چندشیتی)']], print: false })}</div></div>
      ${rangeBar(data.range)}
      <p class="pf-tiles-hint">روی هر کارت بزنید تا آن شاخص روی نمودار نمایش داده یا از آن حذف شود.</p>
      <div class="pf-tiles pf-tiles-team" role="group" aria-label="شاخص‌های تیم؛ برای نمایش روی نمودار کلیک کنید">${tiles}</div>
      <div class="pf-kpis">${kpis}</div>
      <figure class="chart-fig pf-chartcard"><figcaption>روند روزانه‌ی تیم<span class="pf-chart-tools"><span class="pf-seg" role="group" aria-label="حالت نمودار"><button type="button" class="${ui.tmode === 'daily' ? 'on' : ''}" data-tmode="daily">روزانه</button><button type="button" class="${ui.tmode === 'cum' ? 'on' : ''}" data-tmode="cum">تجمعی</button></span></span></figcaption>
        <div class="pf-chart" id="pf-chart"></div><p class="chart-note" id="pf-note"></p></figure>
      <div class="pf-leaders" id="pf-leaders"></div>
      <section class="pf-block"><h3 class="pf-sec-title">${AP.icon('employees')} دپارتمان‌ها</h3>${deptCards(data.departments, { title: 'دپارتمان‌ها', mainLabel: 'ساعت مفید', main: (x) => fmt.min(x.useful), share: (x) => (t.useful ? (x.useful / t.useful) * 100 : 0), stats: (x) => [['اضافه‌کاری', fmt.min(x.overtime)], ['کسری', fmt.min(x.shortfall)], ['تأخیر', fmt.min(x.late)], ['روز غیبت', fmt.num(x.absentDays)]] })}</section>
      <div class="card flush pf-team pf-block"><div class="card-head"><h3>${AP.icon('employees')} همه‌ی کارمندان</h3><label class="field pf-search"><input type="search" id="pf-search" placeholder="جستجوی نام…" value="${esc(ui.search)}" aria-label="جستجوی کارمند" /></label></div><div class="table-wrap"><table class="pf-paytable pf-teamtable">
        <thead><tr>${[['name', 'کارمند'], ['useful', 'ساعت مفید'], ['chg', 'تغییر'], ['attendanceRate', 'حضور'], ['punctualityRate', 'وقت‌شناسی'], ['fulfillmentRate', 'تحقق'], ['avgCheckIn', 'میانگین ورود'], ['overtime', 'اضافه‌کاری'], ['shortfall', 'کسری'], ['late', 'تأخیر'], ['absentDays', 'غیبت']].map(([k, l]) => `<th><button type="button" class="pf-sort" data-sort="${k}">${l}${ui.sort === k ? (ui.dir < 0 ? ' ▼' : ' ▲') : ''}</button></th>`).join('')}<th>روند</th></tr></thead>
        <tbody id="pf-team-body"></tbody></table></div></div>`;
    return { html, mount: (page) => { bindRange(page); mountTeam(page, data); } };
  }

  function spark(vals) {
    const W = 96; const H = 30; const max = Math.max(1, ...vals);
    if (vals.length < 2) return '';
    const step = W / (vals.length - 1);
    const pts = vals.map((v, i) => [(W - i * step).toFixed(1), (H - 3 - (v / max) * (H - 8)).toFixed(1)]);
    const line = pts.map((p) => p.join(',')).join(' ');
    return `<svg class="pf-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polygon class="pf-spark-area" points="${line} 0,${H} ${W},${H}" /><polyline points="${line}" /></svg>`;
  }

  function leaderCard(title, icon, list, valueOf, textOf, tone) {
    const mx = Math.max(1, ...list.map(valueOf));
    const body = list.length ? list.map((r, i) => `<button type="button" class="pf-leader" data-id="${r.user.id}"><span class="pf-rank">${fa(i + 1)}</span>${AP.avatar(r.user.fullName, 'sm', r.user.id)}<span class="pf-leader-name"><b>${esc(r.user.fullName)}</b>${bar((valueOf(r) / mx) * 100, tone)}</span><em>${textOf(r)}</em></button>`).join('') : emptyBox('موردی نیست.');
    return `<div class="card pf-leadercard pf-tone-${tone}"><h3>${AP.icon(icon)} ${esc(title)}</h3>${body}</div>`;
  }

  function mountTeam(page, data) {
    const rows = data.rows.map((r) => ({
      ...r, name: r.user.fullName, useful: r.totals.useful,
      chg: r.previousUseful ? (r.totals.useful - r.previousUseful) / r.previousUseful : null,
      overtime: r.totals.overtime, shortfall: r.totals.shortfall, late: r.totals.late, absentDays: r.totals.absentDays,
    }));
    $('#pf-dept', page).addEventListener('change', (e) => { ui.dept = e.target.value; AP.refresh(); });
    $('#pf-team-csv', page).addEventListener('click', () => downloadCsv(`team-performance-${data.range.from}_${data.range.to}.csv`,
      ['کارمند', 'دپارتمان', 'ساعت مفید (دقیقه)', 'اضافه‌کاری', 'کسری', 'تأخیر', 'روز غیبت', 'نرخ حضور %', 'وقت‌شناسی %', 'تحقق %', 'میانگین ورود'],
      rows.map((r) => [r.name, r.user.department, r.useful, r.overtime, r.shortfall, r.late, r.absentDays, r.attendanceRate, r.punctualityRate, r.fulfillmentRate, r.avgCheckIn == null ? '' : clock(r.avgCheckIn)])));
    // نمودار
    const drawTeam = () => {
      const act = TEAM_METRICS.filter((m) => ui.tActive.has(m.key));
      const note = PC.lineChart($('#pf-chart', page), { rows: data.daily, prev: null, metrics: act, mode: ui.tmode, dateLabel: (d) => fmt.date(d), statusLabel: () => '' });
      $('#pf-note', page).textContent = note;
    };
    $$('.pf-tile', page).forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.metric;
      if (ui.tActive.has(k)) { if (ui.tActive.size > 1) ui.tActive.delete(k); } else ui.tActive.add(k);
      $$('.pf-tile', page).forEach((x) => { const on = ui.tActive.has(x.dataset.metric); x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      drawTeam();
    }));
    $$('[data-tmode]', page).forEach((b) => b.addEventListener('click', () => { ui.tmode = b.dataset.tmode; $$('[data-tmode]', page).forEach((x) => x.classList.toggle('on', x === b)); drawTeam(); }));
    drawTeam();
    // برترین‌ها
    const top = (list, n = 5) => list.slice(0, n);
    const byDesc = (key) => rows.slice().sort((a, b) => b[key] - a[key]);
    $('#pf-leaders', page).innerHTML = [
      leaderCard('بیشترین ساعت مفید', 'clock', top(byDesc('useful').filter((r) => r.useful > 0)), (r) => r.useful, (r) => fmt.min(r.useful), 'brand'),
      leaderCard('وقت‌شناس‌ترین‌ها', 'check', top(rows.filter((r) => r.punctualityRate != null).sort((a, b) => b.punctualityRate - a.punctualityRate || b.useful - a.useful)), (r) => r.punctualityRate, (r) => pctText(r.punctualityRate), 'green'),
      leaderCard('بیشترین تأخیر', 'in', top(byDesc('late').filter((r) => r.late > 0)), (r) => r.late, (r) => fmt.min(r.late), 'orange'),
      leaderCard('بیشترین کسری', 'alert', top(byDesc('shortfall').filter((r) => r.shortfall > 0)), (r) => r.shortfall, (r) => fmt.min(r.shortfall), 'red'),
    ].join('');
    applyProgress($('#pf-leaders', page));
    $$('.pf-leader', page).forEach((b) => b.addEventListener('click', () => AP.go('performance', b.dataset.id)));
    // جدول
    const body = $('#pf-team-body', page);
    const paint = () => {
      const s = ui.sort; const term = ui.search.trim();
      const list = rows.filter((r) => !term || r.name.includes(term) || String(r.user.personnelCode || '').includes(term));
      const sorted = list.slice().sort((a, b) => (s === 'name' ? a.name.localeCompare(b.name, 'fa') * -ui.dir : ((a[s] == null ? -1 : a[s]) - (b[s] == null ? -1 : b[s])) * ui.dir));
      const maxUseful = Math.max(0, ...rows.map((r) => r.useful));
      const rate = (v, good, ok) => (v == null ? '<span class="muted">—</span>' : `<span class="pf-rate ${v >= good ? 'good' : v >= ok ? 'warn' : 'bad'}">${pctText(v)}</span>`);
      const tag = (v, tone) => (v ? `<span class="pf-tag ${tone}">${fmt.min(v)}</span>` : '<span class="muted">—</span>');
      body.innerHTML = sorted.map((r, i) => {
        const p = r.chg == null ? null : Math.round(r.chg * 100);
        const chg = p == null ? '<span class="pf-delta flat">جدید</span>' : `<span class="pf-delta ${p > 0 ? 'good' : p < 0 ? 'bad' : 'flat'}">${p === 0 ? 'بدون تغییر' : `${p > 0 ? '▲' : '▼'} ${fa(Math.abs(p))}٪`}</span>`;
        return `<tr class="clickable" data-id="${r.user.id}" tabindex="0"><td><div class="pf-person"><span class="pf-rankdot${i < 3 && ui.sort === 'useful' && ui.dir < 0 && !term ? ` top${i + 1}` : ''}">${fa(i + 1)}</span>${AP.avatar(r.user.fullName, 'sm', r.user.id)}<div><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || 'بدون دپارتمان')}</small></div></div></td>
          <td class="num"><div class="pf-sharecell pf-usefulcell"><strong>${fmt.min(r.useful)}</strong>${bar(maxUseful ? (r.useful / maxUseful) * 100 : 0, 'green')}</div></td>
          <td class="num">${chg}</td>
          <td class="num">${rate(r.attendanceRate, 95, 80)}</td><td class="num">${rate(r.punctualityRate, 90, 70)}</td><td class="num">${rate(r.fulfillmentRate, 100, 90)}</td><td class="num">${r.avgCheckIn == null ? '<span class="muted">—</span>' : `<span class="pf-ratechip">${clock(r.avgCheckIn)}</span>`}</td>
          <td class="num">${tag(r.overtime, 'good')}</td><td class="num">${tag(r.shortfall, 'bad')}</td><td class="num">${tag(r.late, 'warn')}</td><td class="num">${r.absentDays ? `<span class="pf-tag bad">${fmt.num(r.absentDays)} روز</span>` : '<span class="muted">—</span>'}</td>
          <td>${spark(r.spark)}</td></tr>`;
      }).join('') || `<tr><td colspan="12">${emptyBox('کارمندی برای نمایش نیست.')}</td></tr>`;
      applyProgress(body);
    };
    paint();
    $('#pf-search', page).addEventListener('input', (e) => { ui.search = e.target.value; paint(); });
    $$('.pf-sort', page).forEach((b) => b.addEventListener('click', () => { if (ui.sort === b.dataset.sort) ui.dir *= -1; else { ui.sort = b.dataset.sort; ui.dir = -1; } AP.refresh(); }));
    const go = (tr) => { if (tr && tr.dataset.id) AP.go('performance', tr.dataset.id); };
    body.addEventListener('click', (e) => go(e.target.closest('tr')));
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e.target.closest('tr')); });
  }

  // =====================================================================
  // نمای یک کارمند
  // =====================================================================
  const GROUPS = {
    worked: (r) => r.status === 'present' || r.status === 'late',
    late: (r) => r.late > 0,
    absent: (r) => r.status === 'absent',
    leave: (r) => r.status === 'leave' || r.status === 'mission' || r.status === 'manual_leave',
  };
  const filtersActive = () => ui.fWeekday !== '' || ui.fStatus !== '';
  function applyFilters(rows) {
    return rows.filter((r) => (ui.fWeekday === '' || persianWeekday(r.date) === Number(ui.fWeekday)) && (!ui.fStatus || GROUPS[ui.fStatus](r)));
  }
  function totalsOf(rows) {
    const t = {};
    ['useful', 'overtime', 'shortfall', 'late', 'breaks', 'tasksDone', 'tasksTotal', 'present', 'earn'].forEach((k) => { t[k] = sum(rows.map((r) => r[k] || 0)); });
    t.lateDays = rows.filter((r) => r.late > 0).length;
    t.absentDays = rows.filter((r) => r.status === 'absent').length;
    t.taskRate = t.tasksTotal > 0 ? Math.round((t.tasksDone / t.tasksTotal) * 1000) / 10 : null;
    return t;
  }

  async function employeePage(id) {
    const [d, users] = await Promise.all([AP.api(`/admin/performance/employee/${encodeURIComponent(id)}?${rangeQuery()}`), AP.loadUsers().catch(() => [])]);
    const u = d.user;
    const earnBy = new Map(((d.payroll && d.payroll.days) || []).map((x) => [x.date, x.amountToman || 0]));
    d.series.forEach((r) => { r.earn = earnBy.get(r.date) || 0; });
    const options = users.filter((x) => x.isActive !== false).map((x) => `<option value="${x.id}" ${String(x.id) === String(u.id) ? 'selected' : ''}>${esc(x.fullName)}</option>`).join('');
    const t0 = totalsOf(d.series);
    const html = `
      <div class="view-header"><div><h2>عملکرد ${esc(u.fullName)}</h2><div class="sub">${esc(u.department || 'بدون دپارتمان')} · ${esc(rangeLabel(d.range))}</div></div>
        <div class="pf-head-actions"><label class="field pf-pick"><span>کارمند</span><select id="pf-user">${options}</select></label><button type="button" class="btn ghost" id="pf-back">همه‌ی کارمندان</button></div></div>
      <div class="card pf-hero">${AP.avatar(u.fullName, 'lg', u.id)}<div class="pf-hero-text"><h3>${esc(u.fullName)}</h3><p>${esc(AP.ROLE[u.role] || u.role || '')} · ${esc(u.department || 'بدون دپارتمان')}${u.personnelCode ? ` · کد ${esc(u.personnelCode)}` : ''}</p></div>
        <div class="pf-hero-chips"><span class="pf-chip"><b>${fmt.num(t0.present)}</b> روز حضور</span><span class="pf-chip"><b>${fmt.num(t0.lateDays)}</b> روز تأخیر</span><span class="pf-chip"><b>${fmt.num(t0.absentDays)}</b> روز غیبت</span>${t0.taskRate != null ? `<span class="pf-chip"><b>${fa(t0.taskRate)}٪</b> انجام تسک</span>` : ''}</div></div>
      <div class="pf-insights" id="pf-insights" aria-label="بینش‌ها"></div>
      ${rangeBar(d.range)}
      <div class="pf-filterbar" id="pf-filterbar"></div>
      <p class="pf-tiles-hint">روی هر کارت بزنید تا آن شاخص روی نمودار نمایش داده یا از آن حذف شود.</p>
      <div class="pf-tiles" id="pf-tiles" role="group" aria-label="شاخص‌ها؛ برای نمایش روی نمودار کلیک کنید"></div>
      <figure class="chart-fig pf-chartcard"><figcaption><span id="pf-cap">${d.hourly ? 'حضور ساعت‌به‌ساعت' : 'روند'}</span>
        <span class="pf-chart-tools">${d.hourly ? '' : `<span class="pf-seg" role="group" aria-label="حالت نمودار"><button type="button" data-mode="daily">روزانه</button><button type="button" data-mode="cum">تجمعی</button></span><label class="pf-switch"><input type="checkbox" id="pf-compare" /><span>مقایسه با دوره‌ی قبل</span></label>`}</span></figcaption>
        <div class="pf-chart" id="pf-chart"></div><p class="chart-note" id="pf-note"></p></figure>
      <div class="pf-kpis" id="pf-kpis"></div>
      <figure class="chart-fig pf-chartcard" id="pf-times-card"><figcaption>ساعت ورود و خروج<small class="heat-sub">هر نقطه = یک روز؛ خط چین = میانگین</small></figcaption><div class="pf-chart" id="pf-times"></div></figure>
      <div class="card pf-tabscard"><div class="pf-tabs" role="tablist" aria-label="تفکیک‌ها" id="pf-tabs"></div><div class="pf-tabpanel" id="pf-panel" role="tabpanel" aria-live="polite"></div></div>`;
    return { html, mount: (page) => mountEmployee(page, d) };
  }

  function insightList(d, rows, prevRows) {
    const ins = d.insights; const pi = d.previousInsights; const t = totalsOf(rows); const p = totalsOf(prevRows);
    const out = [];
    const add = (tone, icon, text) => out.push({ tone, icon, text });
    if (p.useful || t.useful) {
      const ch = p.useful ? Math.round(((t.useful - p.useful) / p.useful) * 100) : null;
      add(ch == null ? 'info' : ch >= 0 ? 'good' : 'warn', 'trend', ch == null ? `مجموع ساعت مفید ${fmt.min(t.useful)} بود (دوره‌ی قبل داده نداشت).` : `ساعت مفید ${fa(Math.abs(ch))}٪ ${ch >= 0 ? 'بیشتر' : 'کمتر'} از دوره‌ی قبل بود (${fmt.min(t.useful)} در برابر ${fmt.min(p.useful)}).`);
    }
    if (ins.attendanceRate != null) add(ins.attendanceRate >= 95 ? 'good' : ins.attendanceRate >= 80 ? 'info' : 'bad', 'attendance', `نرخ حضور ${pctText(ins.attendanceRate)}${ins.absentDays ? `؛ ${fmt.num(ins.absentDays)} روز غیبت` : '؛ بدون غیبت'}${pi.attendanceRate != null && pi.attendanceRate !== ins.attendanceRate ? ` (قبلاً ${pctText(pi.attendanceRate)})` : ''}.`);
    if (ins.punctualityRate != null) add(ins.punctualityRate >= 90 ? 'good' : ins.punctualityRate >= 70 ? 'info' : 'warn', 'clock', `در ${pctText(ins.punctualityRate)} روزهای حضور به‌موقع رسید${ins.avgCheckIn != null ? `؛ میانگین ورود ${clock(ins.avgCheckIn)}` : ''}${ins.checkInSpread != null ? ` (پراکندگی ±${fmt.min(Math.round(ins.checkInSpread))})` : ''}.`);
    const lateWd = ins.byWeekday.slice().sort((a, b) => b.lateDays - a.lateDays)[0];
    if (lateWd && lateWd.lateDays >= 2) add('warn', 'alert', `بیشترین تأخیر در روزهای «${WEEKDAYS[lateWd.weekday]}» است (${fmt.num(lateWd.lateDays)} بار).`);
    const absWd = ins.byWeekday.slice().sort((a, b) => b.absentDays - a.absentDays)[0];
    if (absWd && absWd.absentDays >= 2) add('bad', 'x', `بیشترین غیبت در «${WEEKDAYS[absWd.weekday]}»‌هاست (${fmt.num(absWd.absentDays)} روز).`);
    if (ins.streakOnTime.longest >= 3) add('good', 'check', `طولانی‌ترین رگه‌ی حضور بدون تأخیر ${fmt.num(ins.streakOnTime.longest)} روز بود${ins.streakOnTime.current ? ` و اکنون ${fmt.num(ins.streakOnTime.current)} روز ادامه دارد` : ''}.`);
    if (ins.bestDay) add('info', 'plus', `پربازده‌ترین روز ${fmt.date(ins.bestDay.date)} با ${fmt.min(ins.bestDay.useful)} کار مفید بود.`);
    if (ins.fulfillmentRate != null) add(ins.fulfillmentRate >= 100 ? 'good' : ins.fulfillmentRate >= 90 ? 'info' : 'warn', 'reports', `${pctText(ins.fulfillmentRate)} از ساعت مورد انتظار در روزهای حاضر انجام شد.`);
    if (ins.overtime.pending) add('warn', 'alert', `${fmt.min(ins.overtime.pending)} اضافه‌کاری در انتظار تأیید است.`);
    if (d.tasks.total) {
      const top = d.tasks.reasons[0];
      add((d.tasks.completionRate || 0) >= 80 ? 'good' : 'info', 'check', `${pctText(d.tasks.completionRate)} تسک‌ها انجام شد (${fmt.num(d.tasks.done)} از ${fmt.num(d.tasks.total)})${top ? `؛ پرتکرارترین دلیل ناانجامی «${esc(top.label)}»` : ''}.`);
    }
    if (d.disputes.open) add('warn', 'disputes', `${fmt.num(d.disputes.open)} اعتراض باز دارد (روز مربوطه در حقوق نمی‌آید).`);
    if (d.payroll && d.payroll.rateKt != null) {
      const prevA = d.payroll.previousAmountToman; const ch = prevA ? Math.round(((d.payroll.amountToman - prevA) / prevA) * 100) : null;
      add('info', 'wallet', `حقوق این بازه ${toman(d.payroll.amountToman)}${ch != null ? ` (${ch >= 0 ? '▲' : '▼'} ${fa(Math.abs(ch))}٪ نسبت به دوره‌ی قبل)` : ''}.`);
    }
    return out;
  }

  function mountEmployee(page, d) {
    const meta = d.hourly ? [] : METRICS.filter((m) => !m.payroll || (d.payroll && d.payroll.rateKt != null));
    const isOneDay = !!d.hourly;
    bindRange(page);
    $('#pf-user', page).addEventListener('change', (e) => AP.go('performance', e.target.value));
    $('#pf-back', page).addEventListener('click', () => AP.go('performance'));
    const metricsAvail = (isOneDay ? METRICS.filter((m) => !m.payroll || (d.payroll && d.payroll.rateKt != null)) : meta);
    for (const k of [...ui.active]) if (!metricsAvail.some((m) => m.key === k)) ui.active.delete(k);
    if (!ui.active.size) ui.active.add('useful');

    const rowsNow = () => applyFilters(d.series);
    const prevNow = () => applyFilters(d.previousSeries);

    const renderFilterbar = () => {
      const bar$ = $('#pf-filterbar', page);
      bar$.innerHTML = `<span class="pf-filter-label">فیلتر</span>
        <label class="field"><span class="sr-only">روز هفته</span><select id="pf-fwd" aria-label="روز هفته"><option value="">همه‌ی روزهای هفته</option>${WEEKDAYS.map((w, i) => `<option value="${i}" ${String(i) === String(ui.fWeekday) ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
        <label class="field"><span class="sr-only">وضعیت</span><select id="pf-fst" aria-label="وضعیت">${FILTER_STATUS.map(([k, l]) => `<option value="${k}" ${k === ui.fStatus ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${filtersActive() ? `<span class="pf-filter-count">${fmt.num(rowsNow().length)} از ${fmt.num(d.series.length)} روز</span><button type="button" class="btn ghost small" id="pf-fclear">پاک‌کردن فیلتر</button>` : '<span class="pf-filter-hint">فیلتر روی نمودار، کاشی‌ها و جدول‌های زیر اعمال می‌شود.</span>'}`;
      $('#pf-fwd', page).addEventListener('change', (e) => { ui.fWeekday = e.target.value; redrawAll(); });
      $('#pf-fst', page).addEventListener('change', (e) => { ui.fStatus = e.target.value; redrawAll(); });
      const c = $('#pf-fclear', page); if (c) c.addEventListener('click', () => { ui.fWeekday = ''; ui.fStatus = ''; redrawAll(); });
    };

    const renderTiles = () => {
      const rows = rowsNow(); const t = totalsOf(rows); const p = totalsOf(prevNow());
      if (d.payroll && !filtersActive()) p.earn = d.payroll.previousAmountToman;
      const showDelta = ui.compare || isOneDay;
      $('#pf-tiles', page).innerHTML = metricsAvail.map((m) => {
        const on = ui.active.has(m.key);
        let extra = '';
        if (m.key === 'tasksDone' && t.taskRate != null) extra = `<small>${fa(t.taskRate)}٪ از ${fmt.num(t.tasksTotal)}</small>`;
        if (m.key === 'late') extra = `<small>${fmt.num(t.lateDays)} روز</small>`;
        const dl = showDelta && !(m.key === 'earn' && filtersActive()) ? delta(m, t[m.key], p[m.key]) : '';
        return `<button type="button" class="pf-tile pf-m-${m.key}${on ? ' on' : ''}" data-metric="${m.key}" aria-pressed="${on}"><span class="pf-tile-top"><span class="pf-ico">${AP.icon(m.icon)}</span><span class="pf-tile-name">${esc(m.label)}</span><i class="pf-dot" aria-hidden="true"></i></span><span class="pf-tile-val">${mval(m, t[m.key])}</span><span class="pf-tile-foot">${dl}${extra}</span></button>`;
      }).join('');
      $$('.pf-tile', page).forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.metric;
        if (ui.active.has(k)) { if (ui.active.size > 1) ui.active.delete(k); } else ui.active.add(k);
        renderTiles(); drawChart();
      }));
    };

    const drawChart = () => {
      const host = $('#pf-chart', page);
      if (isOneDay) { PC.hourlyChart(host, d.hourly); $('#pf-note', page).textContent = 'محور عمودی دقیقه در هر ساعت است؛ بخش رنگی بالایی زمان استراحت را نشان می‌دهد.'; return; }
      const act = metricsAvail.filter((m) => ui.active.has(m.key));
      const note = PC.lineChart(host, { rows: rowsNow(), prev: ui.compare ? prevNow() : null, metrics: act, mode: ui.mode, dateLabel: (x) => fmt.date(x), statusLabel: (r) => STATUS[r.status] || '' });
      $('#pf-note', page).textContent = note;
      $$('[data-mode]', page).forEach((b) => b.classList.toggle('on', b.dataset.mode === ui.mode));
    };

    const renderKpis = () => {
      const ins = d.insights; const pi = d.previousInsights;
      $('#pf-kpis', page).innerHTML = [
        kpi('نرخ حضور', pctText(ins.attendanceRate), deltaAbs(ins.attendanceRate, pi.attendanceRate, 'up', 'امتیاز'), 'good'),
        kpi('وقت‌شناسی', pctText(ins.punctualityRate), deltaAbs(ins.punctualityRate, pi.punctualityRate, 'up', 'امتیاز'), 'info'),
        kpi('تحقق ساعت مورد انتظار', pctText(ins.fulfillmentRate), deltaAbs(ins.fulfillmentRate, pi.fulfillmentRate, 'up', 'امتیاز'), 'good'),
        kpi('میانگین ساعت مفید روزانه', ins.avgDailyUseful == null ? '—' : fmt.min(Math.round(ins.avgDailyUseful)), deltaAbs(ins.avgDailyUseful, pi.avgDailyUseful, 'up', 'دقیقه'), 'info'),
        kpi('میانگین ورود', ins.avgCheckIn == null ? '—' : clock(ins.avgCheckIn), deltaAbs(ins.avgCheckIn, pi.avgCheckIn, 'down', 'دقیقه'), 'warn'),
        kpi('میانگین خروج', ins.avgCheckOut == null ? '—' : clock(ins.avgCheckOut), '', 'info'),
        kpi('پراکندگی ساعت ورود', ins.checkInSpread == null ? '—' : `±${fmt.min(Math.round(ins.checkInSpread))}`, deltaAbs(ins.checkInSpread, pi.checkInSpread, 'down', 'دقیقه'), 'warn'),
        kpi('رگه‌ی بدون تأخیر', `${fmt.num(ins.streakOnTime.longest)} روز`, `اکنون ${fmt.num(ins.streakOnTime.current)} روز`, 'good'),
        kpi('رگه‌ی حضور', `${fmt.num(ins.streakPresent.longest)} روز`, `اکنون ${fmt.num(ins.streakPresent.current)} روز`, 'good'),
        kpi('روز دورکاری', fmt.num(ins.remoteDays), '', 'info'),
      ].join('');
    };

    const renderInsights = () => {
      const list = insightList(d, rowsNow(), prevNow());
      $('#pf-insights', page).innerHTML = list.length
        ? `<div class="card pf-insightcard"><h3>${AP.icon('trend')} بینش‌ها</h3><ul>${list.map((x) => `<li class="pf-ins ${x.tone}"><span class="pf-ins-ico">${AP.icon(x.icon)}</span><span>${x.text}</span></li>`).join('')}</ul></div>` : '';
    };

    // ---- تب‌های تفکیک ----
    const TABS = [['days', 'روزها'], ['weekday', 'روز هفته'], ['status', 'وضعیت‌ها'], ['hist', 'ساعت ورود'], ['tasks', 'تسک‌ها'], ['leaves', 'مرخصی و اعتراض'], ['ot', 'اضافه‌کاری']];
    if (d.payroll && d.payroll.rateKt != null) TABS.push(['pay', 'حقوق']);
    if (!TABS.some(([k]) => k === ui.tab)) ui.tab = 'days';

    const panelDays = (rows) => {
      const withPay = !!(d.payroll && d.payroll.rateKt != null);
      return `<div class="pf-panel-tools"><button type="button" class="btn ghost small" id="pf-days-csv">${AP.icon('download')} CSV</button><span class="pf-filter-hint">برای بازرسی کامل هر روز روی ردیف بزنید.</span></div>
        <div class="table-wrap"><table class="pf-daily pf-paytable"><thead><tr><th>روز</th><th>وضعیت</th><th>ورود</th><th>خروج</th><th>ساعت مفید</th><th>اضافه‌کاری</th><th>کسری</th><th>تأخیر</th><th>استراحت</th><th>تسک</th>${withPay ? '<th>حقوق</th>' : ''}</tr></thead>
        <tbody>${rows.slice().reverse().map((r) => {
        const dash = '<span class="muted">—</span>';
        const tg = (v, tone) => (v ? `<span class="pf-tag ${tone}">${fmt.min(v)}</span>` : dash);
        const wd = persianWeekday(r.date);
        return `<tr class="clickable${r.status === 'absent' ? ' pf-row-bad' : ''}${r.status === 'weekend' || r.status === 'holiday' ? ' pf-row-off' : ''}" data-date="${r.date}" tabindex="0"><td><div class="pf-dayname"><b>${esc(fmt.date(r.date))}</b><small>${WEEKDAYS[wd]}</small></div></td><td>${AP.badge(STATUS_TONE[r.status] || 'normal', STATUS[r.status] || r.status)}${r.viaRemote ? ' <small class="pf-warn">دورکاری</small>' : ''}</td><td class="num">${r.checkIn == null ? dash : `<span class="pf-ratechip pf-in">${clock(r.checkIn)}</span>`}</td><td class="num">${r.checkOut == null ? dash : `<span class="pf-ratechip pf-out">${clock(r.checkOut)}</span>`}</td><td class="num"><b>${r.useful ? fmt.min(r.useful) : '—'}</b></td><td class="num">${tg(r.overtime, 'good')}</td><td class="num">${tg(r.shortfall, 'bad')}</td><td class="num">${tg(r.late, 'warn')}</td><td class="num">${r.breaks ? fmt.min(r.breaks) : dash}</td><td class="num">${r.tasksTotal ? `<span class="pf-rate ${r.tasksDone === r.tasksTotal ? 'good' : r.tasksDone ? 'warn' : 'bad'}">${fmt.num(r.tasksDone)}/${fmt.num(r.tasksTotal)}</span>` : dash}</td>${withPay ? `<td class="num">${r.earn ? `<span class="pf-amtcell">${toman(r.earn)}</span>` : dash}</td>` : ''}</tr>`;
      }).join('') || `<tr><td colspan="11">${emptyBox('داده‌ای در این بازه نیست.')}</td></tr>`}</tbody></table></div>`;
    };
    const panelWeekday = () => {
      const wd = d.insights.byWeekday; const mx = Math.max(1, ...wd.map((x) => x.avgUseful));
      const best = wd.filter((x) => x.avgUseful > 0).slice().sort((a, b) => b.avgUseful - a.avgUseful)[0];
      return `<p class="chart-note">میانگین ساعت مفید و رخدادها به‌تفکیک روز هفته (فقط روزهای کاری سپری‌شده)${best ? ` — پربازده‌ترین: «${WEEKDAYS[best.weekday]}»` : ''}.</p>
        <div class="table-wrap"><table><thead><tr><th>روز هفته</th><th>روز کاری</th><th>میانگین ساعت مفید</th><th>روز تأخیر</th><th>روز غیبت</th><th>میانگین ورود</th></tr></thead><tbody>
        ${wd.map((x) => `<tr><td><b>${WEEKDAYS[x.weekday]}</b></td><td class="num">${fmt.num(x.days)}</td><td class="num">${x.avgUseful ? fmt.min(Math.round(x.avgUseful)) : '—'}${bar((x.avgUseful / mx) * 100, best && best.weekday === x.weekday ? 'green' : '')}</td><td class="num">${x.lateDays ? `<span class="pf-warn">${fmt.num(x.lateDays)}</span>` : '—'}</td><td class="num">${x.absentDays ? `<span class="pf-warn">${fmt.num(x.absentDays)}</span>` : '—'}</td><td class="num">${x.avgCheckIn == null ? '—' : clock(x.avgCheckIn)}</td></tr>`).join('')}</tbody></table></div>`;
    };
    const panelStatus = (rows) => {
      const counts = {}; rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]); const total = rows.length || 1;
      return `<div class="table-wrap"><table><thead><tr><th>وضعیت</th><th>تعداد روز</th><th>سهم</th></tr></thead><tbody>${entries.map(([k, c]) => `<tr><td>${AP.badge(STATUS_TONE[k] || 'normal', STATUS[k] || k)}</td><td class="num">${fmt.num(c)}</td><td class="num">${pctText(Math.round((c / total) * 1000) / 10)}${bar((c / total) * 100, k === 'absent' ? 'red' : k === 'late' ? 'orange' : k === 'present' ? 'green' : '')}</td></tr>`).join('') || `<tr><td colspan="3">${emptyBox('داده‌ای نیست.')}</td></tr>`}</tbody></table></div>`;
    };
    const panelHist = () => {
      const h = d.insights.histogram; const total = sum(h.map((x) => x.count)); const mx = Math.max(1, ...h.map((x) => x.count));
      if (!h.length) return emptyBox('ورودی ثبت نشده است.');
      const peak = h.slice().sort((a, b) => b.count - a.count)[0];
      return `<p class="chart-note">ساعت ورود در بازه‌های نیم‌ساعته؛ شلوغ‌ترین: ${clock(peak.start)} تا ${clock(peak.start + 30)} (${fmt.num(peak.count)} روز).</p>
        <div class="table-wrap"><table><thead><tr><th>بازه‌ی ورود</th><th>تعداد روز</th><th>سهم</th></tr></thead><tbody>${h.map((x) => `<tr><td class="num"><b>${clock(x.start)} تا ${clock(x.start + 30)}</b></td><td class="num">${fmt.num(x.count)}</td><td class="num">${pctText(Math.round((x.count / total) * 1000) / 10)}${bar((x.count / mx) * 100, x === peak ? 'green' : '')}</td></tr>`).join('')}</tbody></table></div>`;
    };
    const panelTasks = () => {
      const tk = d.tasks;
      if (!tk.total) return emptyBox('در این بازه تسکی پاسخ داده نشده است.');
      const mxr = Math.max(1, ...tk.reasons.map((x) => x.count));
      return `<div class="pf-kpis pf-kpis-sm">${[kpi('درصد انجام', pctText(tk.completionRate), '', 'good'), kpi('انجام‌شده', fmt.num(tk.done), '', 'good'), kpi('نیمه‌کاره', fmt.num(tk.partial), '', 'info'), kpi('انجام‌نشده', fmt.num(tk.notDone), '', 'bad'), kpi('منتقل‌شده', fmt.num(tk.carried), '', 'warn'), kpi('حذف‌شده', fmt.num(tk.dropped), '', 'info'), kpi('پاسخ با تأخیر', fmt.num(tk.answeredLate), '', 'warn')].join('')}</div>
        <div class="pf-split"><div><h4>دلایل ناانجامی</h4>${tk.reasons.length ? `<div class="table-wrap"><table><tbody>${tk.reasons.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${fmt.num(x.count)}${bar((x.count / mxr) * 100, 'orange')}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('دلیلی ثبت نشده.')}</div>
        <div><h4>آخرین تسک‌های انجام‌نشده</h4>${tk.recentNotDone.length ? `<div class="table-wrap"><table><thead><tr><th>روز</th><th>تسک</th><th>دلیل</th></tr></thead><tbody>${tk.recentNotDone.map((x) => `<tr><td>${esc(shortDate(x.date))}</td><td>${esc(x.title)}</td><td>${esc(x.reason || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('همه انجام شده 🎉')}</div></div>`;
    };
    const panelLeaves = () => {
      const lv = d.leaves; const ds = d.disputes;
      const stText = { approved: 'تأییدشده', pending: 'در انتظار', rejected: 'ردشده' };
      return `<div class="pf-kpis pf-kpis-sm">${[kpi('درخواست مرخصی/مأموریت', fmt.num(lv.length), '', 'info'), kpi('تأییدشده', fmt.num(lv.filter((x) => x.status === 'approved').length), '', 'good'), kpi('اعتراض باز', fmt.num(ds.open), '', 'bad'), kpi('اعتراض حل‌شده', fmt.num(ds.resolved), '', 'good')].join('')}</div>
        ${lv.length ? `<div class="table-wrap"><table><thead><tr><th>نوع</th><th>از</th><th>تا</th><th>وضعیت</th><th>دلیل</th></tr></thead><tbody>${lv.map((x) => `<tr><td>${AP.badge(x.kind === 'mission' ? 'normal' : 'late', x.type || (x.kind === 'mission' ? 'مأموریت' : 'مرخصی'))}</td><td>${esc(fmt.date(x.from))}</td><td>${esc(fmt.date(x.to))}</td><td>${esc(stText[x.status] || x.status)}</td><td>${esc(x.reason || '—')}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('درخواستی در این بازه نیست.')}`;
    };
    const panelOt = (rows) => {
      const ot = d.insights.overtime; const list = rows.filter((r) => r.overtime > 0 || r.otRaw > 0);
      const apText = { pending: 'در انتظار تأیید', rejected: 'ردشده' };
      return `<div class="pf-kpis pf-kpis-sm">${[kpi('اضافه‌کاری قابل‌پرداخت', fmt.min(ot.payable), `${fmt.num(ot.days)} روز`, 'good'), kpi('در انتظار تأیید', fmt.min(ot.pending), '', 'warn'), kpi('ردشده', fmt.min(ot.rejected), '', 'bad')].join('')}</div>
        ${list.length ? `<div class="table-wrap"><table><thead><tr><th>روز</th><th>قابل‌پرداخت</th><th>محاسبه‌ی روزانه</th><th>وضعیت تأیید</th></tr></thead><tbody>${list.slice().reverse().map((r) => `<tr class="clickable" data-date="${r.date}" tabindex="0"><td>${esc(fmt.date(r.date))}</td><td class="num">${fmt.min(r.overtime)}</td><td class="num">${fmt.min(r.otRaw)}</td><td>${esc(apText[r.otApproval] || (r.otApproval ? 'تأییدشده' : 'بدون نیاز به تأیید'))}</td></tr>`).join('')}</tbody></table></div>` : emptyBox('اضافه‌کاری‌ای در این بازه نیست.')}`;
    };
    const panelPay = (rows) => {
      const pr = d.payroll; const days = rows.filter((r) => r.earn > 0);
      const byWd = Array.from({ length: 7 }, (_, i) => { const l = days.filter((r) => persianWeekday(r.date) === i); return { i, n: l.length, sum: sum(l.map((r) => r.earn)) }; });
      const mxw = Math.max(1, ...byWd.map((x) => x.sum));
      const total = sum(days.map((r) => r.earn));
      const avgDay = days.length ? Math.round(total / days.length) : null;
      const ex = pr.excludedDays.length ? `<p class="chart-note">${fmt.num(pr.excludedDays.length)} روز در محاسبه نیامده (اعتراض باز یا ورود بدون خروج): ${pr.excludedDays.map((x) => esc(shortDate(x.date))).join('، ')}.</p>` : '';
      return `<div class="pf-kpis pf-kpis-sm">${[kpi('حقوق این بازه', `<span class="pf-amount">${toman(total)}</span>`, filtersActive() ? 'با اعمال فیلتر' : delta({ good: 'up' }, pr.amountToman, pr.previousAmountToman), 'good'), kpi('نرخ ساعتی', `${fmt.num(pr.rateKt)} هزار`, 'تومان در ساعت', 'info'), kpi('ساعت مفید محاسبه‌شده', fmt.min(pr.usefulMinutes), '', 'info'), kpi('میانگین هر روز کاری', toman(avgDay), `${fmt.num(days.length)} روز`, 'info'), kpi('دوره‌ی قبل', toman(pr.previousAmountToman), '', 'warn')].join('')}</div>
        ${ex}<h4>درآمد روزانه و تجمعی</h4><div class="pf-chart" id="pf-pay-chart"></div>
        <div class="pf-split"><div><h4>به‌تفکیک روز هفته</h4><div class="table-wrap"><table><thead><tr><th>روز</th><th>روز کاری</th><th>مبلغ</th></tr></thead><tbody>${byWd.map((x) => `<tr><td><b>${WEEKDAYS[x.i]}</b></td><td class="num">${fmt.num(x.n)}</td><td class="num">${x.sum ? toman(x.sum) : '—'}${bar((x.sum / mxw) * 100, 'green')}</td></tr>`).join('')}</tbody></table></div></div>
        <div><h4>پرکارترین روزها</h4><div class="table-wrap"><table><tbody>${days.slice().sort((a, b) => b.earn - a.earn).slice(0, 6).map((r) => `<tr class="clickable" data-date="${r.date}" tabindex="0"><td>${esc(fmt.date(r.date))}</td><td class="num">${fmt.min(r.useful)}</td><td class="num"><b>${toman(r.earn)}</b></td></tr>`).join('') || `<tr><td>${emptyBox('—')}</td></tr>`}</tbody></table></div></div></div>
        <p class="chart-note">مبلغ هر روز جدا گرد می‌شود؛ جمع رسمی بازه از «کل دقیقه‌ها» محاسبه می‌شود (مثل Mini App) و ممکن است چند تومان اختلاف گرد‌کردن داشته باشد.</p>`;
    };

    const renderTabs = () => {
      $('#pf-tabs', page).innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" class="pf-tab${ui.tab === k ? ' on' : ''}" data-tab="${k}" aria-selected="${ui.tab === k}">${l}</button>`).join('');
      $$('.pf-tab', page).forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; renderTabs(); renderPanel(); }));
    };
    const renderPanel = () => {
      const rows = rowsNow(); const host = $('#pf-panel', page);
      const fn = { days: () => panelDays(rows), weekday: panelWeekday, status: () => panelStatus(rows), hist: panelHist, tasks: panelTasks, leaves: panelLeaves, ot: () => panelOt(rows), pay: () => panelPay(rows) }[ui.tab];
      host.innerHTML = fn();
      applyProgress(host);
      $$('tr[data-date]', host).forEach((tr) => {
        tr.addEventListener('click', () => openDay(d.user.id, tr.dataset.date, d));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDay(d.user.id, tr.dataset.date, d); });
      });
      const csv = $('#pf-days-csv', host);
      if (csv) csv.addEventListener('click', () => downloadCsv(`performance-${d.user.id}-${d.range.from}_${d.range.to}.csv`,
        ['تاریخ', 'وضعیت', 'ورود', 'خروج', 'ساعت مفید (دقیقه)', 'اضافه‌کاری', 'کسری', 'تأخیر', 'استراحت', 'تسک انجام‌شده', 'کل تسک', ...(d.payroll ? ['حقوق (تومان)'] : [])],
        rows.map((r) => [r.date, STATUS[r.status] || r.status, r.checkIn == null ? '' : clock(r.checkIn), r.checkOut == null ? '' : clock(r.checkOut), r.useful, r.overtime, r.shortfall, r.late, r.breaks, r.tasksDone, r.tasksTotal, ...(d.payroll ? [r.earn] : [])])));
      if (ui.tab === 'pay') {
        const items = rows.filter((r) => r.earn > 0).map((r) => ({ label: fmt.date(r.date), short: shortDate(r.date), value: r.earn, sub: STATUS[r.status] || '' }));
        PC.barsChart($('#pf-pay-chart', host), items, { unit: 'money', cumulative: true, valueLabel: 'درآمد روز', aria: 'درآمد روزانه و تجمعی' });
      }
    };

    const drawTimes = () => {
      const card = $('#pf-times-card', page);
      if (isOneDay) { card.hidden = true; return; }
      PC.timesChart($('#pf-times', page), rowsNow(), d.insights.avgCheckIn, d.insights.avgCheckOut);
    };

    function redrawAll() { renderFilterbar(); renderInsights(); renderTiles(); drawChart(); drawTimes(); renderPanel(); }

    $$('[data-mode]', page).forEach((b) => b.addEventListener('click', () => { ui.mode = b.dataset.mode; drawChart(); }));
    const cmp = $('#pf-compare', page);
    if (cmp) { cmp.checked = ui.compare; cmp.addEventListener('change', () => { ui.compare = cmp.checked; renderTiles(); drawChart(); }); }
    renderKpis(); renderTabs(); redrawAll();
  }

  // ---------- بازرسی یک روز ----------
  async function openDay(userId, date, d) {
    let r;
    try { r = await AP.api(`/admin/performance/employee/${encodeURIComponent(userId)}/day?${q({ date })}`); } catch (err) { AP.toast(err.message, true); return; }
    const x = r.day; const rec = r.record;
    const dur = (a1, b1) => { const A = Date.parse(a1); const Bt = b1 ? Date.parse(b1) : Date.now(); return Number.isFinite(A) && Number.isFinite(Bt) && Bt > A ? fmt.min(Math.round((Bt - A) / 60000)) : '—'; };
    const flags = (x.flags || []).map((f) => AP.badge('late', FLAGS[f] || f)).join(' ');
    const tk = r.tasks;
    const REMOTE = { approved: 'تأییدشده', pending: 'در انتظار', rejected: 'ردشده', active: 'فعال', closed: 'بسته‌شده' };
    const tile = (label, value, tone, sub) => `<div class="pf-fact ${tone || ''}"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const dash = '<span class="muted">—</span>';
    const dayAmount = r.payroll && r.payroll.days[0] ? r.payroll.days[0].amountToman : null;
    const wd = persianWeekday(date);
    const section = (title, icon, inner) => `<section class="pf-dsec"><h4>${AP.icon(icon)} ${title}</h4>${inner}</section>`;
    const rowsTable = (head, rows) => `<div class="table-wrap pf-daywrap"><table class="pf-paytable pf-mini"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const body = `
      <div class="pf-pay-head pf-day-top">${AP.avatar(r.user ? r.user.fullName : d.user.fullName, 'lg', (r.user || d.user).id)}<div><h4>${esc(r.user ? r.user.fullName : d.user.fullName)}</h4><p>${esc(WEEKDAYS[wd])}، ${esc(fmt.date(date))}</p></div>
        <div class="pf-day-badges">${AP.badge(STATUS_TONE[x.status] || 'normal', STATUS[x.status] || x.status)}${x.holidayTitle ? `<span class="pf-chip">${esc(x.holidayTitle)}</span>` : ''}${x.viaRemote ? '<span class="pf-chip">دورکاری</span>' : ''}${flags}</div>
        ${dayAmount != null ? `<div class="pf-day-amount"><span>مبلغ این روز</span><strong class="pf-amount">${toman(dayAmount)}</strong></div>` : ''}</div>
      <div class="pf-facts-grid">${[
        tile('ورود', x.checkIn == null ? dash : `<span class="pf-in-t">${clock(x.checkIn)}</span>`, 'in'),
        tile('خروج', x.checkOut == null ? dash : `<span class="pf-out-t">${clock(x.checkOut)}</span>`, 'out'),
        tile('ساعت مورد انتظار', fmt.min(x.expected), 'info'),
        tile('ساعت مفید', fmt.min(x.useful), 'good', x.expected ? `${pctText(Math.round((x.useful / x.expected) * 100))} از مورد انتظار` : ''),
        tile('اضافه‌کاری', x.overtime ? fmt.min(x.overtime) : dash, 'good'),
        tile('تأخیر', x.late ? fmt.min(x.late) : dash, 'warn'),
        tile('زودتر رفتن', x.earlyLeave ? fmt.min(x.earlyLeave) : dash, 'warn'),
        tile('کسری', x.shortfall ? fmt.min(x.shortfall) : dash, 'bad'),
        tile('استراحت با حقوق', x.breakPaid ? fmt.min(x.breakPaid) : dash, 'info'),
        tile('استراحت بدون حقوق', x.breakUnpaid ? fmt.min(x.breakUnpaid) : dash, 'info'),
        x.missionMinutes ? tile('مأموریت', fmt.min(x.missionMinutes), 'info') : '',
      ].join('')}</div>
      ${section('حضور ساعت‌به‌ساعت', 'clock', '<div class="pf-chart" id="pf-day-hourly"></div><p class="pf-legend"><i class="pf-lg-w"></i> کار <i class="pf-lg-b"></i> استراحت</p>')}
      <div class="pf-split">
        ${section('بازه‌های حضور', 'attendance', rec && rec.segments.length ? rowsTable(['ورود', 'خروج', 'مدت'], rec.segments.map((sg) => `<tr><td class="num"><span class="pf-ratechip pf-in">${fmt.clock(sg.in)}</span></td><td class="num">${sg.out ? `<span class="pf-ratechip pf-out">${fmt.clock(sg.out)}</span>` : '<span class="pf-tag bad">باز</span>'}</td><td class="num"><b>${dur(sg.in, sg.out)}</b></td></tr>`).join('')) : emptyBox('رکورد ورودی نیست.'))}
        ${section('استراحت‌ها', 'coffee', rec && rec.breaks.length ? rowsTable(['نوع', 'از', 'تا', 'مدت'], rec.breaks.map((b2) => `<tr><td>${b2.type === 'lunch' ? '<span class="pf-tag warn">ناهار</span>' : '<span class="pf-tag good">کوتاه</span>'}</td><td class="num">${fmt.clock(b2.start)}</td><td class="num">${b2.end ? fmt.clock(b2.end) : '<span class="pf-tag bad">باز</span>'}</td><td class="num"><b>${dur(b2.start, b2.end)}</b></td></tr>`).join('')) : emptyBox('استراحتی نیست.'))}
      </div>
      <div class="pf-split">
        ${section('مرخصی و مأموریت', 'calendar', r.leaves.length ? `<ul class="pf-list">${r.leaves.map((l) => `<li><span>${AP.badge(l.kind === 'mission' ? 'normal' : 'late', l.type || (l.kind === 'mission' ? 'مأموریت' : 'مرخصی'))}</span><em>${esc(l.reason || '')}</em></li>`).join('')}</ul>` : emptyBox('ندارد.'))}
        ${section('دورکاری', 'attendance', r.remote.length ? `<ul class="pf-list">${r.remote.map((sr) => `<li><span>${esc(REMOTE[sr.status] || sr.status)} · ${fmt.clock(sr.start)} ← ${sr.end ? fmt.clock(sr.end) : 'باز'}</span><em>${sr.autoClosed ? 'بسته‌شده‌ی خودکار' : ''}</em></li>`).join('')}</ul>` : emptyBox('ندارد.'))}
      </div>
      ${section('اعتراض‌ها', 'disputes', r.disputes.length ? `<ul class="pf-list">${r.disputes.map((sd) => `<li><span>${esc(sd.message)}</span><em>${sd.status === 'open' ? '<span class="pf-tag bad">باز</span>' : '<span class="pf-tag good">حل‌شده</span>'}</em></li>`).join('')}</ul>` : emptyBox('ندارد.'))}
      ${section('تسک‌ها', 'check', tk ? `<div class="pf-facts-grid pf-facts-3">${[tile('انجام‌شده', `${fmt.num(tk.done)} از ${fmt.num(tk.total)}`, 'good', tk.percent != null ? pctText(tk.percent) : ''), tile('نیمه‌کاره', fmt.num(tk.partial), 'info'), tile('بی‌پاسخ', fmt.num((tk.pending || []).length), 'warn')].join('')}</div>
        ${(tk.notDone || []).length ? rowsTable(['تسک انجام‌نشده', 'دلیل'], tk.notDone.map((n) => `<tr><td>${esc(n.title)}</td><td>${esc(n.reason || n.carry || '—')}</td></tr>`).join('')) : ''}` : emptyBox('این روز تسکی نبوده است.'))}
      <div class="pf-day-nav"><button type="button" class="btn ghost" data-next>◂ روز بعد</button><button type="button" class="btn ghost" data-prev>روز قبل ▸</button></div>`;
    const m = AP.modal({ title: `بازرسی روز — ${fmt.date(date)}`, body, wide: true });
    PC.hourlyChart($('#pf-day-hourly', m.el), r.hourly);
    const shift = (n) => { const dt = new Date(`${date}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); };
    const nav = (n) => { m.close(); openDay(userId, shift(n), d); };
    const pv = $('[data-prev]', m.el); const nx = $('[data-next]', m.el);
    if (pv) pv.addEventListener('click', () => nav(-1));
    if (nx) nx.addEventListener('click', () => nav(1));
  }

  // =====================================================================
  // حقوق و دستمزد
  // =====================================================================
  const pay = { year: null, month: null, department: '', search: '', sort: 'amount', dir: -1 };

  AP.view('payroll', {
    skeleton: 'cards',
    perm: 'payroll.read',
    nav: { icon: 'wallet', label: 'حقوق و دستمزد', group: 'گزارش‌ها' },
    async render() {
      const today = J.toJalali(...fmt.today().split('-').map(Number));
      pay.year = pay.year || today.jy; pay.month = pay.month || today.jm;
      const [data, users] = await Promise.all([AP.api(`/admin/payroll?${q({ year: pay.year, month: pay.month, department: pay.department })}`), AP.loadUsers().catch(() => [])]);
      const deps = [...new Set(users.map((u) => (u.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
      const t = data.totals; const pt = data.previous.totals;
      const mom = pt.amountToman ? Math.round(((t.amountToman - pt.amountToman) / pt.amountToman) * 100) : null;
      const money = { good: 'up' };
      const kpis = [
        kpi('جمع حقوق ماه', `<span class="pf-amount">${toman(t.amountToman)}</span>`, mom == null ? '' : `${delta(money, t.amountToman, pt.amountToman)} نسبت به ${esc(data.previous.label)}`, 'good'),
        t.projectedAmountToman != null ? kpi('پیش‌بینی پایان ماه', toman(t.projectedAmountToman), 'بر اساس روزهای کاریِ گذشته', 'info') : '',
        kpi('میانگین هر نفر', toman(t.averageToman), `میانه ${mToman(t.medianToman)}`, 'info'),
        kpi('جمع ساعت مفید', fmt.min(t.usefulMinutes), t.usefulMinutes && t.amountToman ? `هر ساعت ≈ ${toman(Math.round(t.amountToman / (t.usefulMinutes / 60)))}` : '', 'info'),
        kpi('اضافه‌کاری (درون ساعت مفید)', fmt.min(t.overtimeMinutes), '', 'warn'),
        kpi('کارمند دارای نرخ', `${fmt.num(t.employees - t.withoutRate)} از ${fmt.num(t.employees)}`, t.withoutRate ? `<span class="pf-warn">${fmt.num(t.withoutRate)} بدون نرخ</span>` : '', 'good'),
        kpi('روز خارج‌شده از محاسبه', fmt.num(t.excludedDays), 'اعتراض باز / ورود بدون خروج', 'bad'),
      ].join('');
      const html = `
        <div class="view-header"><div><h2>حقوق و دستمزد</h2><div class="sub">${esc(data.label)} — حقوق = نرخ ساعتی × ساعت مفید (همان فرمول «کارکرد تخمینی» کارمند). فقط ادمین این صفحه را می‌بیند.</div></div>
          <div class="header-actions"><button type="button" class="btn ghost" id="pay-csv">${AP.icon('download')} خروجی CSV</button>${AP.exportBar({ path: '/api/admin/payroll/export', params: { year: pay.year, month: pay.month, department: pay.department }, formats: [['xlsx', 'اکسل کامل حقوق (چندشیتی)']], print: false })}</div></div>
        <form class="filters" id="pay-filters">
          <label class="field"><span>سال</span><input type="number" name="year" min="1300" max="1500" value="${esc(pay.year)}" /></label>
          <label class="field"><span>ماه</span><select name="month">${J.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === Number(pay.month) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${deps.map((x) => `<option ${x === pay.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        </form>
        <div class="pf-kpis">${kpis}</div>
        <figure class="chart-fig pf-chartcard"><figcaption>حقوق هر کارمند<small class="heat-sub">${esc(data.label)}</small></figcaption><div class="pf-chart" id="pay-chart"></div></figure>
        <section class="pf-block"><h3 class="pf-sec-title">${AP.icon('employees')} تفکیک دپارتمان</h3>${deptCards(data.departments, { title: 'تفکیک دپارتمان', mainLabel: 'مجموع حقوق', main: (x) => toman(x.amountToman), share: (x) => (t.amountToman ? (x.amountToman / t.amountToman) * 100 : 0), stats: (x) => [['میانگین هر نفر', x.employees ? toman(Math.round(x.amountToman / x.employees)) : '—'], ['ساعت مفید', fmt.min(x.usefulMinutes)], ['هر ساعت', x.usefulMinutes ? toman(Math.round(x.amountToman / (x.usefulMinutes / 60))) : '—']] })}</section>
        <div class="card flush pf-block pf-paycard"><div class="card-head"><h3>${AP.icon('wallet')} ریز هر کارمند</h3><label class="field pf-search"><input type="search" id="pay-search" placeholder="جستجوی نام…" value="${esc(pay.search)}" aria-label="جستجوی کارمند" /></label></div><div class="table-wrap"><table class="pf-paytable pf-paytable-pay"><thead><tr>
          ${[['name', 'کارمند'], ['rate', 'نرخ ساعتی'], ['useful', 'ساعت مفید'], ['ot', 'اضافه‌کاری'], ['days', 'روز کاری'], ['avgDay', 'میانگین روز'], ['amount', 'حقوق'], ['mom', 'نسبت به ماه قبل'], ['proj', 'پیش‌بینی ماه']].map(([k, l]) => `<th><button type="button" class="pf-sort" data-sort="${k}">${l}${pay.sort === k ? (pay.dir < 0 ? ' ▼' : ' ▲') : ''}</button></th>`).join('')}<th>سهم</th></tr></thead><tbody id="pay-body"></tbody>
          <tfoot><tr><td colspan="6"><b>جمع کل</b></td><td class="num" data-label="جمع حقوق"><b>${toman(t.amountToman)}</b></td><td></td><td class="num" data-label="پیش‌بینی ماه">${t.projectedAmountToman != null ? toman(t.projectedAmountToman) : '—'}</td><td></td></tr></tfoot></table></div></div>
        <p class="chart-note">جمع هر کارمند از «کل دقیقه‌ها» محاسبه می‌شود (مثل Mini App)؛ مبلغ هر روز جدا گرد می‌شود و ممکن است با جمع چند تومان اختلاف گرد‌کردن داشته باشد. پیش‌بینی فقط برای ماه جاری است: میانگین روزانه‌ی تاکنون × کل روزهای کاری ماه.</p>`;
      return { html, mount: (page) => mountPayroll(page, data) };
    },
  });

  function mountPayroll(page, data) {
    const f = $('#pay-filters', page);
    f.addEventListener('submit', (e) => e.preventDefault());
    $$('input, select', f).forEach((x) => x.addEventListener('change', () => { Object.assign(pay, AP.formData(f)); AP.refresh(); }));
    AP.monthStepper(f); // ماه قبل/بعد/ماه جاری
    const t = data.totals;
    const rows = data.rows.map((r) => ({
      ...r, name: r.user.fullName, rate: r.rateKt == null ? -1 : r.rateKt, useful: r.usefulMinutes, ot: r.overtimeMinutes, days: r.workedDays, avgDay: r.avgPerWorkedDayToman == null ? -1 : r.avgPerWorkedDayToman,
      amount: r.amountToman == null ? -1 : r.amountToman, proj: r.projectedAmountToman == null ? -1 : r.projectedAmountToman,
      mom: r.previousAmountToman ? (r.amountToman - r.previousAmountToman) / r.previousAmountToman : -999,
    }));
    // نمودار میله‌ایِ سهم هر نفر
    PC.barsChart($('#pay-chart', page), rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount).map((r) => ({ label: r.name, short: r.name.split(' ')[0], value: r.amount, sub: r.user.department || '' })), { unit: 'money', tone: 'green', valueLabel: 'حقوق', aria: 'حقوق هر کارمند' });
    const body = $('#pay-body', page);
    const paint = () => {
      const term = pay.search.trim();
      const list = rows.filter((r) => !term || r.name.includes(term) || String(r.user.personnelCode || '').includes(term));
      const s = pay.sort;
      list.sort((a, b) => (s === 'name' ? a.name.localeCompare(b.name, 'fa') * -pay.dir : (a[s] - b[s]) * pay.dir));
      const maxAmt = Math.max(1, ...rows.map((x) => x.amount));
      body.innerHTML = list.map((r, i) => {
        const mom = r.mom === -999 ? '<span class="muted">—</span>' : `<span class="pf-delta ${r.mom > 0 ? 'good' : r.mom < 0 ? 'bad' : 'flat'}">${r.mom === 0 ? '—' : `${r.mom > 0 ? '▲' : '▼'} ${fa(Math.abs(Math.round(r.mom * 100)))}٪`}</span>`;
        const sharePct = t.amountToman && r.amountToman ? Math.round((r.amountToman / t.amountToman) * 1000) / 10 : 0;
        return `<tr class="clickable" data-id="${r.user.id}" tabindex="0"><td><div class="pf-person"><span class="pf-rankdot${i < 3 && pay.sort === 'amount' && pay.dir < 0 ? ` top${i + 1}` : ''}">${fa(i + 1)}</span>${AP.avatar(r.user.fullName, 'sm', r.user.id)}<div><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '')}</small></div></div></td>
          <td class="num">${r.rateKt == null ? '<span class="muted">ثبت نشده</span>' : `<span class="pf-ratechip">${fmt.num(r.rateKt)} هزار</span>`}</td><td class="num">${fmt.min(r.usefulMinutes)}</td><td class="num">${r.overtimeMinutes ? fmt.min(r.overtimeMinutes) : '—'}</td><td class="num">${fmt.num(r.workedDays)}</td>
          <td class="num">${r.avgPerWorkedDayToman == null ? '—' : toman(r.avgPerWorkedDayToman)}</td>
          <td class="num"><span class="pf-amtcell">${r.amountToman == null ? '—' : toman(r.amountToman)}</span>${r.excludedDays.length ? `<small class="pf-warn">${fmt.num(r.excludedDays.length)} روز خارج</small>` : ''}</td><td class="num">${mom}</td>
          <td class="num">${r.projectedAmountToman == null ? '—' : toman(r.projectedAmountToman)}</td>
          <td><div class="pf-sharecell">${bar(r.amountToman ? (r.amountToman / maxAmt) * 100 : 0, 'green')}<small>${sharePct ? pctText(sharePct) : '—'}</small></div></td></tr>`;
      }).join('') || `<tr><td colspan="10">${emptyBox('کارمندی نیست.')}</td></tr>`;
      applyProgress(body);
    };
    paint();
    $('#pay-search', page).addEventListener('input', (e) => { pay.search = e.target.value; paint(); });
    $$('.pf-sort', page).forEach((b) => b.addEventListener('click', () => { if (pay.sort === b.dataset.sort) pay.dir *= -1; else { pay.sort = b.dataset.sort; pay.dir = -1; } AP.refresh(); }));
    const open = (tr) => { if (tr && tr.dataset.id) openPayDetail(tr.dataset.id, data); };
    body.addEventListener('click', (e) => open(e.target.closest('tr.clickable')));
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e.target.closest('tr.clickable')); });
    $('#pay-csv', page).addEventListener('click', () => downloadCsv(`payroll-${data.year}-${String(data.month).padStart(2, '0')}.csv`,
      ['کارمند', 'کد پرسنلی', 'دپارتمان', 'نرخ ساعتی (هزار تومان)', 'ساعت مفید (دقیقه)', 'اضافه‌کاری (دقیقه)', 'روز کاری', 'میانگین هر روز (تومان)', 'حقوق (تومان)', 'حقوق ماه قبل (تومان)', 'پیش‌بینی پایان ماه (تومان)', 'روز خارج‌شده'],
      data.rows.map((r) => [r.user.fullName, r.user.personnelCode, r.user.department, r.rateKt, r.usefulMinutes, r.overtimeMinutes, r.workedDays, r.avgPerWorkedDayToman, r.amountToman, r.previousAmountToman, r.projectedAmountToman, r.excludedDays.length])));
  }

  async function openPayDetail(id, data) {
    let r;
    try { r = await AP.api(`/admin/payroll/${encodeURIComponent(id)}?${q({ year: data.year, month: data.month })}`); } catch (err) { AP.toast(err.message, true); return; }
    const reason = { open_dispute: 'اعتراض باز', missing_checkout: 'ورود بدون خروج' };
    const days = r.days || [];
    const valid = days.filter((x) => !x.excluded && x.amountToman > 0);
    const maxDay = Math.max(1, ...valid.map((x) => x.amountToman));
    const totalMin = sum(valid.map((x) => x.usefulMinutes));
    const totalAmt = sum(valid.map((x) => x.amountToman));
    const body = `<div class="pf-pay-head">${AP.avatar(r.user.fullName, 'lg', r.user.id)}<div><h4>${esc(r.user.fullName)}</h4><p>${esc(r.user.department || 'بدون دپارتمان')} · ${esc(data.label)}</p></div>${r.rateKt == null ? '' : `<span class="pf-ratechip">${fmt.num(r.rateKt)} هزار تومان / ساعت</span>`}</div>
      <div class="pf-kpis pf-kpis-sm">${[kpi('حقوق ماه', `<span class="pf-amount">${toman(r.amountToman)}</span>`, r.previousAmountToman ? delta({ good: 'up' }, r.amountToman, r.previousAmountToman) : '', 'good'), kpi('ساعت مفید', fmt.min(r.usefulMinutes), `${fmt.num(valid.length)} روز کاری`, 'info'), kpi('اضافه‌کاری', fmt.min(r.overtimeMinutes), '', 'warn'), kpi('میانگین هر روز', toman(r.avgPerWorkedDayToman), '', 'info'), kpi('پیش‌بینی پایان ماه', toman(r.projectedAmountToman), '', 'info')].join('')}</div>
      <h4>درآمد روزانه و تجمعی</h4><div class="pf-chart" id="pf-pay-modal-chart"></div>
      <h4>ریز روزها</h4>
      <div class="table-wrap pf-daywrap"><table class="pf-paytable pf-daytable"><thead><tr><th>روز</th><th>وضعیت</th><th>ساعت مفید</th><th>اضافه‌کاری</th><th>مبلغ</th></tr></thead><tbody>
      ${days.map((x) => `<tr class="${x.excluded ? 'pf-excluded' : ''}"><td><b>${esc(fmt.date(x.date))}</b></td><td>${x.excluded ? AP.badge('late', `خارج از محاسبه: ${reason[x.excluded] || x.excluded}`) : AP.badge(STATUS_TONE[x.status] || 'normal', STATUS[x.status] || x.status || 'حاضر')}</td><td class="num">${x.excluded ? '—' : fmt.min(x.usefulMinutes)}</td><td class="num">${x.excluded || !x.overtimeMinutes ? '<span class="muted">—</span>' : `<span class="pf-tag good">${fmt.min(x.overtimeMinutes)}</span>`}</td><td class="num">${x.excluded ? '—' : `<div class="pf-sharecell"><span class="pf-amtcell">${toman(x.amountToman)}</span>${bar((x.amountToman / maxDay) * 100, 'green')}</div>`}</td></tr>`).join('') || `<tr><td colspan="5">${emptyBox('روز کاری ثبت نشده.')}</td></tr>`}
      </tbody><tfoot><tr><td colspan="2"><b>جمع روزهای محاسبه‌شده</b></td><td class="num"><b>${fmt.min(totalMin)}</b></td><td></td><td class="num"><b>${toman(totalAmt)}</b></td></tr></tfoot></table></div>
      <div class="pf-modal-actions"><a class="btn primary" href="#/performance/${esc(r.user.id)}">${AP.icon('trend')} گزارش عملکرد این کارمند</a></div>`;
    const m = AP.modal({ title: `ریز حقوق — ${r.user.fullName}`, body, wide: true });
    applyProgress(m.el);
    PC.barsChart($('#pf-pay-modal-chart', m.el), days.filter((x) => !x.excluded && x.amountToman > 0).map((x) => ({ label: fmt.date(x.date), short: shortDate(x.date), value: x.amountToman, sub: STATUS[x.status] || '' })), { unit: 'money', tone: 'green', cumulative: true, valueLabel: 'درآمد روز', aria: 'درآمد روزانه و تجمعی' });
    const link = $('.pf-modal-actions a', m.el);
    if (link) link.addEventListener('click', () => m.close());
  }
})();
