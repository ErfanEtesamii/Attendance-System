// «خروجی‌ها»: یک‌جا همه‌ی خروجی‌های Excel / CSV / متن پنل، دسته‌بندی‌شده، با فیلتر مخصوص هر خروجی.
// هر کارت یک فرم کوچک دارد؛ با تغییر فیلتر، آدرس دکمه‌های دانلود به‌روز می‌شود و دانلود با همان مسیر مشترک exports.js (fetch + پیام خطای واقعی) انجام می‌شود.
// فقط خروجی‌هایی نشان داده می‌شوند که کاربر مجوزشان را دارد (سرور هم جداگانه کنترل می‌کند).
(function () {
  'use strict';
  const AP = window.AP;
  const J = window.Jalali;
  if (!AP) return;
  const { esc, fmt } = AP;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const CATS = [
    ['attendance', 'تردد و ساعت کار', 'attendance'],
    ['perf', 'عملکرد و حقوق', 'wallet'],
    ['tasks', 'تسک‌ها و گزارش‌ها', 'reports'],
    ['leave', 'مرخصی و مأموریت', 'leave'],
    ['people', 'کارمندان و سازمان', 'employees'],
    ['week', 'هفته‌ی کارمند', 'calendar'],
    ['audit', 'ممیزی', 'audit'],
  ];
  const F3 = [['xlsx', 'Excel'], ['csv', 'CSV']];
  const F3T = [['xlsx', 'Excel'], ['csv', 'CSV'], ['txt', 'متن']];
  const STATUS_LEAVE = [['all', 'همه'], ['pending', 'در انتظار'], ['approved', 'تأییدشده'], ['rejected', 'ردشده']];
  const ROLES = [['', 'همه'], ['employee', 'کارمند'], ['manager', 'سرپرست'], ['hr', 'منابع انسانی'], ['admin', 'ادمین']];

  // ---------- فهرست خروجی‌ها ----------
  // fields: range(30) | month | year | dept | user | select:name:label:[[v,l]] | check:name:label | week
  const ITEMS = [
    { id: 'attendance', cat: 'attendance', icon: 'attendance', title: 'رکوردهای تردد', perm: 'attendance.read', path: '/api/admin/attendance/export', fields: ['range:7', 'dept', 'user'],
      desc: 'ورود، خروج، استراحت، ساعت مفید، تأخیر و اضافه‌کاری هر روز هر کارمند.' },
    { id: 'reports', cat: 'attendance', icon: 'reports', title: 'خلاصه‌ی گزارش بازه‌ای', perm: 'reports.read', path: '/api/admin/reports/export', fields: ['range:30', 'dept', 'user'],
      desc: 'جمع روزهای حضور، ساعت مفید، تأخیر و غیبت هر کارمند در بازه‌ی انتخابی.' },
    { id: 'monthly', cat: 'attendance', icon: 'reports', title: 'گزارش ماهانه', perm: 'reports.read', path: '/api/admin/reports/monthly/export', fields: ['month', 'dept', 'check:includeInactive:شامل کارمندان غیرفعال'], formats: F3,
      desc: 'گزارش کامل یک ماه شمسی؛ خلاصه‌ی ماه و ریز روزها در شیت‌های جدا (در Excel).' },
    { id: 'performance', cat: 'perf', icon: 'trend', title: 'عملکرد کارمندان', perm: 'performance.read', path: '/api/admin/performance/export', fields: ['range:30', 'dept', 'check:includeInactive:شامل کارمندان غیرفعال'],
      desc: 'شاخص‌های عملکرد هر کارمند در بازه‌ی انتخابی، همراه با ریز روزها.' },
    { id: 'payroll', cat: 'perf', icon: 'wallet', title: 'حقوق و دستمزد', perm: 'payroll.read', path: '/api/admin/payroll/export', fields: ['month', 'dept', 'check:includeInactive:شامل کارمندان غیرفعال'],
      desc: 'حقوق ماه بر اساس نرخ ساعتی و ساعت مفید، مقایسه با ماه قبل و ریز روزها.' },
    { id: 'taskreport', cat: 'tasks', icon: 'reports', title: 'گزارش کامل تسک‌ها', perm: 'taskreports.read', path: '/api/admin/task-report/export', fields: ['range:30', 'user'], formats: F3,
      desc: 'ریز تسک هر روز با وضعیت، توضیح و علت؛ به‌همراه خلاصه‌ی افراد و تیم‌ها.' },
    { id: 'teamreports', cat: 'tasks', icon: 'reports', title: 'گزارش‌های روزانه‌ی تیم', perm: 'taskreports.read', path: '/api/admin/team-reports/export', fields: ['range:30', 'user'], formats: F3,
      desc: 'گزارش‌هایی که اعضای تیم در پایان روز ثبت کرده‌اند.' },
    { id: 'leave', cat: 'leave', icon: 'leave', title: 'درخواست‌های مرخصی و مأموریت', perm: 'leave.read', path: '/api/admin/leave-requests/export', fields: ['range:90', 'select:status:وضعیت:' + JSON.stringify(STATUS_LEAVE), 'select:kind:نوع:' + JSON.stringify([['', 'همه'], ['annual', 'مرخصی'], ['mission', 'مأموریت']])], formats: F3,
      desc: 'همه‌ی درخواست‌ها با نوع، تاریخ شمسی، وضعیت و تصمیم‌گیرنده (بر اساس تاریخ شروع؛ پیش‌فرض ۹۰ روز اخیر).' },
    { id: 'balances', cat: 'leave', icon: 'leave', title: 'مانده‌ی مرخصی', perm: 'leave.balance.read', path: '/api/admin/leave-balances/export', fields: ['year'], formats: F3,
      desc: 'استحقاق، مانده از قبل، تعدیل، مصرف‌شده و مانده‌ی هر کارمند در سال انتخابی.' },
    { id: 'users', cat: 'people', icon: 'employees', title: 'فهرست کارمندان', perm: 'users.read', path: '/api/admin/users/export', fields: ['dept', 'select:role:نقش:' + JSON.stringify(ROLES), 'select:isActive:وضعیت:' + JSON.stringify([['', 'همه'], ['1', 'فعال'], ['0', 'غیرفعال']])], formats: F3,
      desc: 'نام، کد پرسنلی، دپارتمان، نقش، سرپرست و وضعیت هر کارمند.' },
    { id: 'shifts', cat: 'people', icon: 'clock', title: 'شیفت‌ها', perm: 'shifts.read', path: '/api/admin/shifts/export', fields: [], formats: F3,
      desc: 'ساعت شروع و پایان، مهلت‌ها، روزهای کاری و تعداد کارمندِ هر شیفت.' },
    { id: 'holidays', cat: 'people', icon: 'calendar', title: 'تعطیلات', perm: 'settings.read', path: '/api/admin/holidays/export', fields: [], formats: F3,
      desc: 'فهرست تعطیلات رسمی و شرکتی با تاریخ شمسی.' },
    { id: 'disputes', cat: 'people', icon: 'disputes', title: 'اعتراض‌ها', perm: 'disputes.read', path: '/api/admin/disputes/export', fields: ['select:status:وضعیت:' + JSON.stringify([['', 'همه'], ['open', 'باز'], ['awaiting_admin', 'منتظر پاسخ ادمین'], ['answered', 'پاسخ‌داده‌شده'], ['resolved', 'حل‌شده']])], formats: F3,
      desc: 'اعتراض کارمندان به رکوردهای تردد با وضعیت و تعداد پیام‌ها.' },
    { id: 'userweek', cat: 'week', icon: 'calendar', title: 'برنامه و تردد هفتگیِ یک کارمند', perm: 'team.week_view', pathFn: (p) => `/api/admin/users/${p.userId}/week/export`, fields: ['userreq', 'week'], formats: F3T, needs: ['userId'],
      desc: 'نمای کامل یک هفته: برنامه، تردد، مرخصی و تسک‌ها. «متن» برای چسباندن در پیام‌رسان مناسب است.' },
    { id: 'myweek', cat: 'week', icon: 'calendar', title: 'هفته‌ی من', perm: 'me.read', path: '/api/admin/me/week/export', fields: ['week'], formats: F3T,
      desc: 'برنامه و تردد هفته‌ی خودتان.' },
    { id: 'audit', cat: 'audit', icon: 'audit', title: 'گزارش رویدادها', perm: 'audit.read', path: '/api/admin/audit-log/export', fields: ['range:7', 'user', 'select:limit:تعداد:' + JSON.stringify([['500', '۵۰۰'], ['1000', '۱۰۰۰'], ['2000', '۲۰۰۰']]), 'check:include_archive:شامل آرشیو'], formats: F3,
      desc: 'لاگ غیرقابل‌ویرایش عملیات حساس؛ جدیدترین رویدادها اول.' },
  ];


  // توضیح کامل هر خروجی: gives = آنچه داخل فایل می‌گیرید، use = کاربردش، note = نکته (اختیاری)
  const INFO = {
    attendance: { gives: ['تاریخ شمسی هر روز', 'ساعت ورود و خروج', 'مجموع استراحت', 'ساعت مفید', 'دقیقه‌ی تأخیر', 'زودتر رفتن', 'اضافه‌کاری', 'وضعیت و پرچم‌ها'], use: 'بررسی دقیق تردد روزانه، رفع اختلاف با کارمند و تهیه‌ی مستند برای حسابداری.' },
    reports: { gives: ['روزهای حضور', 'جمع ساعت مفید', 'تعداد و دقایق تأخیر', 'روزهای غیبت', 'اضافه‌کاری'], use: 'یک نگاه سریع به عملکرد همه‌ی کارمندان در یک بازه؛ مناسب جلسه‌ی مدیریتی.' },
    monthly: { gives: ['خلاصه‌ی ماه هر کارمند', 'ریز روزهای ماه (شیت جدا)', 'جمع‌های ماهانه', 'مرخصی و تعطیلی'], use: 'گزارش پایان ماه برای بایگانی یا ارسال به مدیر.', note: 'در Excel خلاصه و ریز روزها در شیت‌های جدا قرار می‌گیرند.' },
    performance: { gives: ['امتیاز و شاخص‌های عملکرد', 'پایبندی به ساعت', 'تسک‌های انجام‌شده', 'ریز روزها'], use: 'مقایسه‌ی کارمندان و ارزیابی دوره‌ای.' },
    payroll: { gives: ['نرخ ساعتی', 'ساعت مفید ماه', 'مبلغ محاسبه‌شده', 'مقایسه با ماه قبل', 'ریز روزها'], use: 'ورودی مستقیم برای محاسبه‌ی حقوق و دستمزد.', note: 'فقط برای نقش‌هایی که دسترسی «حقوق» دارند دیده می‌شود.' },
    taskreport: { gives: ['عنوان و وضعیت هر تسک', 'توضیح کارمند', 'علت انجام‌نشدن', 'خلاصه‌ی هر فرد و تیم'], use: 'ارزیابی خروجی کاری و پیگیری تسک‌های عقب‌افتاده.' },
    teamreports: { gives: ['متن گزارش پایان روز', 'نام کارمند', 'تاریخ ثبت'], use: 'مرور گزارش‌های روزانه‌ی تیم بدون ورق‌زدن تک‌تک آن‌ها.' },
    leave: { gives: ['نوع (مرخصی/مأموریت)', 'تاریخ شروع و پایان', 'وضعیت', 'تصمیم‌گیرنده', 'توضیحات'], use: 'کنترل مرخصی‌های استفاده‌شده و درخواست‌های در انتظار.' },
    balances: { gives: ['استحقاق سالانه', 'مانده از سال قبل', 'تعدیل‌ها', 'مصرف‌شده', 'مانده‌ی فعلی'], use: 'تسویه‌ی مرخصی و برنامه‌ریزی مرخصی‌های سال.' },
    users: { gives: ['نام و کد پرسنلی', 'دپارتمان', 'نقش', 'سرپرست', 'فعال/غیرفعال'], use: 'فهرست پرسنل برای منابع انسانی یا ورود به سیستم‌های دیگر.' },
    shifts: { gives: ['ساعت شروع و پایان', 'مهلت‌ها', 'روزهای کاری', 'تعداد کارمندان شیفت'], use: 'مستندسازی ساختار شیفت‌های سازمان.' },
    holidays: { gives: ['تاریخ شمسی', 'عنوان', 'نوع (رسمی/شرکتی)'], use: 'تقویم تعطیلات سال برای اطلاع‌رسانی.' },
    disputes: { gives: ['کارمند و تاریخ رکورد', 'وضعیت اعتراض', 'تعداد پیام‌ها', 'نتیجه'], use: 'پیگیری اعتراض‌های بازمانده و بررسی تکرار آن‌ها.' },
    userweek: { gives: ['برنامه‌ی هفته', 'تردد هر روز', 'مرخصی', 'تسک‌ها'], use: 'مرور یک هفته‌ی کامل یک کارمند.', note: 'قالب «متن» برای چسباندن در تلگرام یا پیام‌رسان مناسب است.' },
    myweek: { gives: ['برنامه‌ی هفته‌ی شما', 'تردد', 'مرخصی', 'تسک‌ها'], use: 'مرور و بایگانی هفته‌ی خودتان.', note: 'قالب «متن» برای چسباندن در پیام‌رسان مناسب است.' },
    audit: { gives: ['زمان رویداد', 'عامل و هدف', 'نوع عملیات', 'جزئیات'], use: 'ردیابی تغییرات حساس و بازرسی امنیتی.' },
  };
  const FORMAT_HELP = { xlsx: 'Excel: قالب‌بندی‌شده و آماده‌ی چاپ', csv: 'CSV: ساده برای نرم‌افزارهای دیگر', txt: 'متن: برای چسباندن در پیام‌رسان' };

  const ui = { cat: 'all', q: '' };

  const parseSel = (spec) => { const i1 = spec.indexOf(':'); const i2 = spec.indexOf(':', i1 + 1); const i3 = spec.indexOf(':', i2 + 1); return { name: spec.slice(i1 + 1, i2), label: spec.slice(i2 + 1, i3), opts: JSON.parse(spec.slice(i3 + 1) || '[]') }; };

  function fieldHtml(spec, ctx) {
    const [kind] = spec.split(':');
    if (kind === 'range') {
      const days = spec.split(':')[1];
      const to = days ? fmt.today() : '';
      const from = days ? fmt.daysAgo(Number(days) - 1) : '';
      return `<div class="ex-f ex-f-range">${AP.rangeBar.html({ from, to, label: 'بازه‌ی زمانی', presets: ['7', '30', 'month', 'lastMonth'] })}</div>`;
    }
    if (kind === 'month') {
      const t = J.toJalali(...fmt.today().split('-').map(Number));
      return `<label class="field"><span>سال</span><input type="number" name="year" min="1300" max="1500" value="${t.jy}" /></label>
        <label class="field"><span>ماه</span><select name="month">${J.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === t.jm ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
    }
    if (kind === 'year') {
      const t = J.toJalali(...fmt.today().split('-').map(Number));
      return `<label class="field"><span>سال شمسی</span><input type="number" name="year" min="1300" max="1800" value="${t.jy}" /></label>`;
    }
    if (kind === 'dept') return `<label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${ctx.deps.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>`;
    if (kind === 'user' || kind === 'userreq') {
      const req = kind === 'userreq';
      return `<label class="field"><span>${req ? 'کارمند' : 'کارمند (اختیاری)'}</span><select name="userId" ${req ? 'data-required' : ''}><option value="">${req ? 'انتخاب کنید…' : 'همه'}</option>${ctx.users.map((u) => `<option value="${u.id}">${esc(u.fullName)}</option>`).join('')}</select></label>`;
    }
    if (kind === 'select') { const s = parseSel(spec); return `<label class="field"><span>${esc(s.label)}</span><select name="${s.name}">${s.opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>`; }
    if (kind === 'check') { const [, name, ...rest] = spec.split(':'); return `<label class="ex-check"><input type="checkbox" name="${name}" value="1" /><span>${esc(rest.join(':'))}</span></label>`; }
    if (kind === 'week') return `<label class="field"><span>هفته‌ی شامل تاریخ</span><input type="text" name="start" class="ltr-in" data-date placeholder="خالی = هفته‌ی جاری" autocomplete="off" /></label>`;
    return '';
  }

  const cardHtml = (it, ctx) => {
    const info = INFO[it.id] || { gives: [], use: '' };
    const formats = it.formats || F3.slice();
    return `
    <section class="ex-card" data-id="${it.id}" data-cat="${it.cat}" data-text="${esc(`${it.title} ${it.desc} ${info.gives.join(' ')}`.toLowerCase())}">
      <header class="ex-head">
        <span class="ex-ico" aria-hidden="true">${AP.icon(it.icon)}</span>
        <div class="ex-ttl"><h3>${esc(it.title)}</h3><p>${esc(it.desc)}</p></div>
      </header>
      <div class="ex-info">
        ${info.gives.length ? `<div class="ex-gives"><b>داخل فایل چه می‌بینید؟</b><ul>${info.gives.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
        ${info.use ? `<p class="ex-use"><b>به درد چه کاری می‌خورد؟</b> ${esc(info.use)}</p>` : ''}
        ${info.note ? `<p class="ex-note">${AP.icon('info', 14)} ${esc(info.note)}</p>` : ''}
      </div>
      ${it.fields.length ? '<div class="ex-filter-label">فیلتر خروجی</div>' : ''}
      <form class="ex-form" autocomplete="off">${it.fields.map((f) => fieldHtml(f, ctx)).join('')}</form>
      <footer class="ex-actions" data-actions></footer>
      <p class="ex-fmt">${formats.map(([f]) => esc(FORMAT_HELP[f] || '')).filter(Boolean).join(' · ')}</p>
    </section>`;
  };

  function paramsOf(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { if (String(v).trim() !== '') out[k] = String(v).trim(); });
    return out;
  }

  function paintActions(card, it) {
    const form = $('.ex-form', card); const box = $('[data-actions]', card);
    const p = paramsOf(form);
    if (it.id === 'leave' && p.status === 'all') delete p.status;
    const missing = (it.needs || []).filter((k) => !p[k]);
    const path = it.pathFn ? (missing.length ? '' : it.pathFn(p)) : it.path;
    const formats = it.formats || [['xlsx', 'Excel'], ['csv', 'CSV']];
    const params = it.pathFn ? (({ userId, ...rest }) => rest)(p) : p;
    box.innerHTML = formats.map(([f, label], i) => {
      const cls = i === 0 ? 'btn ex-btn ex-btn-main' : 'btn ghost ex-btn';
      if (!path) return `<button type="button" class="${cls}" disabled>${AP.icon('download')} ${label}</button>`;
      return `<a class="${cls}" data-export="${f}" href="${esc(AP.buildExportUrl(path, params, f))}" download>${AP.icon('download')} ${label}</a>`;
    }).join('') + (missing.length ? '<span class="ex-hint">برای دانلود، کارمند را انتخاب کنید.</span>' : '');
  }

  function applyFilter(page) {
    const q = ui.q.trim().toLowerCase();
    let shown = 0;
    $$('.ex-card', page).forEach((c) => {
      const ok = (ui.cat === 'all' || c.dataset.cat === ui.cat) && (!q || c.dataset.text.includes(q));
      c.hidden = !ok; if (ok) shown += 1;
    });
    $$('.ex-group', page).forEach((g) => { g.hidden = !$$('.ex-card:not([hidden])', g).length; });
    $$('.ex-tab', page).forEach((t) => { const on = t.dataset.cat === ui.cat; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    const empty = $('.ex-empty', page); if (empty) empty.hidden = shown > 0;
  }

  AP.view('exports', {
    skeleton: 'table',
    perm: [...new Set(ITEMS.map((i) => i.perm))],
    nav: { icon: 'download', label: 'خروجی‌های اکسل', group: 'گزارش‌ها' },
    async render() {
      const users = await AP.loadUsers().catch(() => []);
      const ctx = { users, deps: [...new Set(users.map((u) => (u.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa')) };
      const items = ITEMS.filter((i) => AP.can(i.perm));
      const cats = CATS.filter(([id]) => items.some((i) => i.cat === id));
      const html = `
        <div class="view-header"><div><h2>خروجی‌های اکسل و CSV</h2><div class="sub">همه‌ی گزارش‌ها و فهرست‌های پنل را با فیلتر دلخواه به‌صورت فایل دانلود کنید.</div></div></div>
        <div class="ex-chips">
          <div class="ex-chip"><span>خروجی در دسترس شما</span><b>${fmt.num(items.length)}</b></div>
          <div class="ex-chip"><span>دسته‌بندی</span><b>${fmt.num(cats.length)}</b></div>
          <div class="ex-chip"><span>قالب‌ها</span><b class="ex-chip-fm">Excel · CSV</b></div>
        </div>
        <div class="ex-bar">
          <div class="ex-tabs" role="tablist" aria-label="دسته‌ی خروجی">
            <button type="button" class="ex-tab active" role="tab" data-cat="all" aria-selected="true">همه <i>${fmt.num(items.length)}</i></button>
            ${cats.map(([id, label, ic]) => `<button type="button" class="ex-tab" role="tab" data-cat="${id}" aria-selected="false">${AP.icon(ic, 15)} ${esc(label)} <i>${fmt.num(items.filter((x) => x.cat === id).length)}</i></button>`).join('')}
          </div>
          <label class="ex-search"><span class="sr-only">جستجو</span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" id="ex-q" placeholder="جستجوی خروجی… (مثلاً حقوق، مرخصی)" value="${esc(ui.q)}" /></label>
        </div>
        ${cats.map(([id, label]) => `<div class="ex-group" data-cat="${id}"><h3 class="ex-group-title"><span></span>${esc(label)}</h3><div class="ex-grid">${items.filter((x) => x.cat === id).map((x) => cardHtml(x, ctx)).join('')}</div></div>`).join('')}
        <div class="ex-empty" hidden><b>خروجی‌ای پیدا نشد</b><span>عبارت جستجو را تغییر دهید یا دسته‌ی دیگری را انتخاب کنید.</span></div>
        <p class="ex-foot">فایل Excel پیش‌فرض است؛ اگر کتابخانه‌ی Excel روی سرور نباشد، CSV دریافت می‌کنید و پیامش نمایش داده می‌شود. هر دانلود در گزارش رویدادها ثبت می‌شود.</p>`;
      return {
        html,
        mount(page) {
          $$('.ex-card', page).forEach((card) => {
            const it = ITEMS.find((x) => x.id === card.dataset.id);
            const form = $('.ex-form', card);
            form.addEventListener('submit', (e) => e.preventDefault());
            if (AP.dates && AP.dates.mount) AP.dates.mount(form);
            if ($('[name="from"]', form) && AP.rangeBar) AP.rangeBar.bind(form);
            const refresh = () => paintActions(card, it);
            form.addEventListener('change', refresh, true);
            form.addEventListener('input', refresh);
            refresh();
          });
          $$('.ex-tab', page).forEach((t) => t.addEventListener('click', () => { ui.cat = t.dataset.cat; applyFilter(page); }));
          const q = $('#ex-q', page); if (q) q.addEventListener('input', () => { ui.q = q.value; applyFilter(page); });
          applyFilter(page);
        },
      };
    },
  });
})();
