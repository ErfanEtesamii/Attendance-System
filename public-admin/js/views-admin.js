// گزارش‌ها، ارسال پیام گروهی، تنظیمات، گزارش رویدادها، سیستم.

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const icon = (n) => AP.icon(n);
  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  function dailyChart(daily) {
    const W = 720, H = 200, padB = 26, padT = 10;
    const max = Math.max(2, ...daily.map((d) => d.present));
    const n = daily.length;
    const slot = (W - 40) / n;
    const bw = Math.max(3, Math.min(18, slot * 0.6));
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="حضور روزانه">`;
    for (let i = 0; i <= 3; i += 1) {
      const y = padT + (H - padT - padB) * (i / 3);
      svg += `<line class="grid" x1="8" x2="${W - 8}" y1="${y}" y2="${y}"/>`;
    }
    const every = Math.ceil(n / 12);
    daily.forEach((d, i) => {
      const cx = W - 30 - (i + 0.5) * slot;
      const h = (H - padT - padB) * (d.present / max);
      svg += `<g><title>${esc(fmt.dateLong(d.date))} — حاضر: ${fmt.num(d.present)}، متأخر: ${fmt.num(d.late)}</title>
        <rect class="bar-a" x="${cx - bw / 2}" y="${H - padB - h}" width="${bw}" height="${h}" rx="3"/></g>`;
      if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${jalaliDayMonth(d.date)}</text>`;
    });
    return `${svg}</svg>`;
  }

  // ======================================================
  // گزارش‌ها
  // ======================================================
  // برچسب محور نمودار: «۱۵/۷» (روز/ماه شمسی)
  const jalaliDayMonth = (iso) => { const j = window.Jalali.isoToJalali(iso); return j ? window.Jalali.toFaDigits(`${j.jd}/${j.jm}`) : ''; };

  const repUi = { from: null, to: null, department: '', sort: 'totalEffective', dir: -1 };
  AP.view('reports', {
    skeleton: 'page', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'reports.read',
    nav: { icon: 'reports', label: 'گزارش‌های تحلیلی', group: 'گزارش‌ها' },
    async render() {
      repUi.from = repUi.from || fmt.daysAgo(29);
      repUi.to = repUi.to || fmt.today();
      const qs = new URLSearchParams(Object.entries({ from: repUi.from, to: repUi.to, department: repUi.department }).filter(([, v]) => v)).toString();
      const d = await AP.api(`/admin/reports/summary?${qs}`);
      const t = d.totals;
      const sortKeys = { name: (r) => r.user.fullName, presentDays: (r) => r.presentDays, totalEffective: (r) => r.totalEffective, avgEffective: (r) => r.avgEffective, lateCount: (r) => r.lateCount, earlyLeaveCount: (r) => r.earlyLeaveCount, incompleteCount: (r) => r.incompleteCount, leaveDays: (r) => r.leaveDays, overtimeMinutes: (r) => r.overtimeMinutes };
      const th = (k, l) => `<th class="sortable" data-sort="${k}">${l}${repUi.sort === k ? (repUi.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
      // مدت‌زمان در کاشی: عدد درشت + واحد کوچک (به‌جای یک جمله‌ی بلند که چند خط می‌شکست)
      const dur = (m) => {
        if (m == null || Number.isNaN(m)) return '—';
        const abs = Math.abs(Math.round(m)); const h = Math.floor(abs / 60); const r = abs % 60;
        const part = (n, u) => `<span class="dur-part"><b>${fmt.num(n)}</b><small>${u}</small></span>`;
        return `<span class="dur" aria-label="${esc(fmt.min(m))}">${h ? part(h, 'ساعت') : ''}${r || !h ? part(r, 'دقیقه') : ''}</span>`;
      };
      // کاشی به سبک پرونده‌ی کارمند؛ zero=true ⇒ «بدون مورد» کم‌رنگ و با تیک
      const stat = (g, ic, v, l, o = {}) => `<div class="stat${o.zero ? ' is-zero' : ''}"><div class="stat-icon ${o.zero ? 'g-gray' : g}">${icon(o.zero ? 'check' : ic)}</div><div class="stat-label">${l}</div><div class="stat-value u-stat-value-sm">${v}</div>${o.hint || o.zero ? `<div class="stat-hint">${o.hint || 'بدون مورد'}</div>` : ''}</div>`;

      const now = new Date();
      const monthlyDefault = window.Jalali.toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
      const monthNames = window.Jalali.MONTH_NAMES;
      const html = `
        <div class="view-header"><div><h2>گزارش‌های تحلیلی</h2><div class="sub">${esc(fmt.dateLong(d.from))} تا ${esc(fmt.dateLong(d.to))}</div></div>
          <div class="header-actions rep-export-top"><span class="export-cap">دانلود همین گزارش (بازه‌ی انتخاب‌شده):</span>${AP.exportBar({ path: '/api/admin/reports/export', params: { from: d.from, to: d.to, department: repUi.department } })}</div></div>
        <form class="filters" id="rep-filters">
          ${AP.rangeBar.html({ from: d.from, to: d.to, label: 'بازه‌ی گزارش', presets: ['7', '30', 'month', 'lastMonth', '90'] })}
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${d.departmentOptions.map((x) => `<option ${x === repUi.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        </form>
        <div class="card mt" id="monthly-card">
          <div class="mc-head">
            <span class="mc-ic" aria-hidden="true">${icon('download')}</span>
            <div><h3>دریافت گزارش ماهانه (فایل اکسل)</h3>
              <div class="sub report-note">گزارش کامل یک ماه شمسی برای همه‌ی کارمندان. این بخش به بازه‌ی بالای صفحه ربطی ندارد؛ فقط ماه را انتخاب کنید و دکمه‌ی دانلود را بزنید.</div></div>
          </div>
          <form class="filters" id="monthly-form">
            <label class="field"><span>۱. سال</span><input type="number" name="year" min="1300" max="1500" value="${monthlyDefault.jy}" /></label>
            <label class="field"><span>۲. ماه</span><select name="month">${monthNames.map((n, i) => `<option value="${i + 1}" ${i + 1 === monthlyDefault.jm ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
            <label class="field"><span>۳. دپارتمان (اختیاری)</span><select name="department"><option value="">همه‌ی دپارتمان‌ها</option>${d.departmentOptions.map((x) => `<option ${x === repUi.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          </form>
          <div class="mc-result">
            <div class="mc-summary" id="monthly-summary" aria-live="polite"></div>
            <div class="header-actions" id="monthly-export"></div>
          </div>
          <div class="mc-foot">فایل شامل شیت‌های «گزارش ماهانه»، «مرخصی و مأموریت»، «مانده مرخصی»، «ریز روزانه» و «راهنما» است. ماهِ بسته‌شده همان اعدادِ لحظه‌ی بسته‌شدن را نشان می‌دهد و ماه جاری زنده محاسبه می‌شود. «چاپ» نسخه‌ی A4 را در تب جدید باز می‌کند.</div>
        </div>
        <div class="prk-kpis">
          <section><h3 class="prk-title">عملکرد در این بازه</h3><div class="stat-grid rep-stats">
            ${stat('g-green', 'in', fmt.num(t.presentDays), 'مجموع روز-نفر حضور')}
            ${stat('g-blue', 'clock', dur(t.totalEffective), 'مجموع ساعت مفید', { hint: `میانگین روزانه ${esc(fmt.min(t.avgEffective))}` })}
            ${stat('g-purple', 'clock', dur(t.overtimeMinutes), 'اضافه‌کاری')}
            ${stat('g-blue', 'leave', fmt.num(t.leaveDays), 'روز مرخصی')}
          </div></section>
          <section><h3 class="prk-title">موارد نیازمند توجه</h3><div class="stat-grid rep-stats">
            ${stat('g-orange', 'alert', fmt.num(t.lateCount), 'ورود با تأخیر', { zero: !t.lateCount })}
            ${stat('g-red', 'out', fmt.num(t.earlyLeaveCount), 'خروج زودهنگام', { zero: !t.earlyLeaveCount })}
            ${stat('g-gray', 'alert', fmt.num(t.incompleteCount), 'رکورد ناقص', { zero: !t.incompleteCount })}
          </div></section>
        </div>
        <div class="card"><h3>تعداد حاضرین به تفکیک روز</h3>${dailyChart(d.daily)}</div>
        <div class="card flush mt"><div class="u-panel-head"><h3>دپارتمان‌ها</h3></div><div class="table-wrap"><table id="rep-dept-table">
          <thead><tr><th>دپارتمان</th><th>کارمند</th><th>روز-نفر حضور</th><th>ساعت مفید</th><th>تأخیر</th><th>ناقص</th><th>مرخصی</th></tr></thead><tbody>
          ${d.departments.map((x) => `<tr><td data-label="دپارتمان">${esc(x.name)}</td><td data-label="کارمند">${fmt.num(x.employees)}</td><td data-label="روز-نفر حضور">${fmt.num(x.presentDays)}</td><td data-label="ساعت مفید">${fmt.min(x.totalEffective)}</td><td data-label="تأخیر">${fmt.num(x.lateCount)}</td><td data-label="ناقص">${fmt.num(x.incompleteCount)}</td><td data-label="مرخصی">${fmt.num(x.leaveDays)}</td></tr>`).join('') || `<tr><td colspan="7">${emptyBox('داده‌ای نیست.')}</td></tr>`}</tbody></table></div>${d.departments.length ? '' : emptyBox('دپارتمانی برای نمایش نیست.')}</div>
        <div class="card flush mt"><div class="u-panel-head"><h3>جزئیات هر کارمند <span class="muted table-hint">(برای مرتب‌سازی روی عنوان ستون کلیک کنید)</span></h3>
          <label class="field rep-sort-m"><span>مرتب‌سازی بر اساس</span><select id="rep-sort-m" aria-label="مرتب‌سازی کارمندان">${[['name', 'کارمند'], ['presentDays', 'روز حضور'], ['totalEffective', 'مجموع مفید'], ['avgEffective', 'میانگین روزانه'], ['lateCount', 'تأخیر'], ['earlyLeaveCount', 'خروج زودهنگام'], ['overtimeMinutes', 'اضافه‌کاری'], ['incompleteCount', 'ناقص'], ['leaveDays', 'مرخصی']].map(([k, l]) => `<option value="${k}" ${repUi.sort === k ? 'selected' : ''}>${l}${repUi.sort === k ? (repUi.dir > 0 ? ' ▲' : ' ▼') : ''}</option>`).join('')}</select></label></div><div class="table-wrap"><table id="rep-table" data-stack-sort>
          <thead><tr>${th('name', 'کارمند')}${th('presentDays', 'روز حضور')}${th('totalEffective', 'مجموع مفید')}${th('avgEffective', 'میانگین روزانه')}${th('lateCount', 'تأخیر')}${th('earlyLeaveCount', 'خروج زودهنگام')}${th('overtimeMinutes', 'اضافه‌کاری')}${th('incompleteCount', 'ناقص')}${th('leaveDays', 'مرخصی')}<th>میانگین ورود</th></tr></thead><tbody>
          ${[...d.rows].sort((a, b) => {
            const f = sortKeys[repUi.sort] || sortKeys.totalEffective;
            const x = f(a); const y = f(b);
            return (typeof x === 'string' ? x.localeCompare(y, 'fa') : x - y) * repUi.dir;
          }).map((r) => `<tr class="clickable" data-id="${r.user.id}"><td><div class="cell-user">${AP.avatar(r.user.fullName, 'sm', r.user.id)}<span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '')}</small></span></div></td>
            <td>${fmt.num(r.presentDays)}</td><td>${fmt.min(r.totalEffective)}</td><td>${fmt.min(r.avgEffective)}</td><td>${fmt.num(r.lateCount)}</td><td>${fmt.num(r.earlyLeaveCount)}</td>
            <td>${fmt.min(r.overtimeMinutes)}</td><td>${fmt.num(r.incompleteCount)}</td><td>${fmt.num(r.leaveDays)}</td><td class="num">${r.avgCheckIn ? `<span class="ltr">${esc(r.avgCheckIn)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>${d.rows.length ? '' : emptyBox('در این بازه داده‌ای برای کارمندان نیست.')}</div>`;
      return {
        html,
        mount(page) {
          const form = $('#rep-filters', page);
          // دکمه‌های گزارش ماهانه با مقدار فعلی فرم (سال/ماه/دپارتمان) ساخته می‌شوند
          const mform = $('#monthly-form', page);
          const drawMonthly = () => {
            const v = AP.formData(mform);
            const params = { year: v.year, month: v.month, department: v.department };
            const mName = window.Jalali.MONTH_NAMES[Number(v.month) - 1] || '';
            $('#monthly-summary', page).innerHTML = `خروجی: گزارش <b>${esc(mName)} ${esc(window.Jalali.toFaDigits(String(v.year || '')))}</b> · ${v.department ? `دپارتمان <b>${esc(v.department)}</b>` : '<b>همه‌ی دپارتمان‌ها</b>'}`;
            const base = '/api/admin/reports/monthly/export';
            const box = $('#monthly-export', page);
            box.innerHTML = AP.exportBar({ path: base, params, formats: [['xlsx', 'دانلود فایل اکسل']], print: false })
              + AP.exportBar({ path: base, params, formats: [['csv', 'CSV']], print: { href: AP.buildExportUrl('/admin/print.html', params) } });
            const x = box.querySelector('a[data-export="xlsx"]');
            if (x) { x.classList.remove('ghost', 'small'); x.classList.add('primary', 'mc-main-btn'); }
          };
          drawMonthly();
          $$('input, select', mform).forEach((el) => el.addEventListener('input', drawMonthly));
          mform.addEventListener('submit', (e) => e.preventDefault());
          AP.dates.mount(form); // از/تا تاریخ شمسی؛ قبل از بستن listenerها (S3-11b)
          AP.rangeBar.bind(form);
          $$('input, select', form).forEach((el) => el.addEventListener('change', () => { Object.assign(repUi, AP.formData(form)); AP.refresh(); }));
          AP.monthStepper(mform); // ماه قبل/بعد/ماه جاری
          $$('th[data-sort]', page).forEach((h) => h.addEventListener('click', () => {
            if (repUi.sort === h.dataset.sort) repUi.dir *= -1; else { repUi.sort = h.dataset.sort; repUi.dir = h.dataset.sort === 'name' ? 1 : -1; }
            AP.refresh();
          }));
          const sm = $('#rep-sort-m', page);
          if (sm) sm.addEventListener('change', () => { repUi.sort = sm.value; repUi.dir = sm.value === 'name' ? 1 : -1; AP.refresh(); }); // موبایل: سرستون‌ها پنهان‌اند
          $$('tr[data-id]', page).forEach((tr) => tr.addEventListener('click', () => AP.go('profile', tr.dataset.id)));
        },
      };
    },
  });

  // ======================================================
  // ارسال پیام گروهی
  // ======================================================
  AP.view('broadcast', {
    skeleton: 'list', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'broadcast.send',
    nav: { icon: 'broadcast', label: 'ارسال پیام گروهی', group: 'مدیریت' },
    async render() {
      const users = (await AP.loadUsers()).filter((u) => u.isActive);
      const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
      const withTg = users.filter((u) => u.telegramUserId);
      const html = `
        <div class="view-header"><div><h2>ارسال پیام گروهی</h2><div class="sub">پیام از طریق بات تلگرام برای کارمندانِ دارای آیدی تلگرام ارسال می‌شود (${fmt.num(withTg.length)} نفر)</div></div></div>
        <div class="card"><form class="form" id="bc-form">
          <div class="form-grid">
            <label class="field"><span>گیرندگان</span><select name="scope" id="bc-scope"><option value="all">${AP.can('users.write') ? 'همه‌ی کارمندان فعال' : 'همه‌ی اعضای تیم من'}</option><option value="department">یک دپارتمان</option><option value="users">انتخاب دستی</option></select></label>
            <label class="field hidden" id="bc-dept-wrap"><span>دپارتمان</span><select name="department">${depts.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>
          </div>
          <div class="recipients hidden" id="bc-users">${withTg.map((u) => `<label class="check-row"><input type="checkbox" value="${u.id}" /> ${esc(u.fullName)}</label>`).join('')}</div>
          <label class="field"><span>متن اطلاعیه</span><textarea name="text" rows="5" required placeholder="مثلاً: فردا به‌دلیل تعطیلی رسمی شرکت تعطیل است."></textarea></label>
          <div class="form-msg"></div>
          <div class="modal-actions"><button class="btn primary" type="submit">${icon('broadcast')} ارسال اطلاعیه</button></div>
        </form></div>`;
      return {
        html,
        mount(page) {
          const scope = $('#bc-scope', page);
          scope.addEventListener('change', () => {
            $('#bc-dept-wrap', page).classList.toggle('hidden', scope.value !== 'department');
            $('#bc-users', page).classList.toggle('hidden', scope.value !== 'users');
          });
          $('#bc-form', page).addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = AP.formData(e.target);
            const userIds = $$('#bc-users input:checked', page).map((c) => Number(c.value));
            if (!(await AP.confirmBox({ title: 'ارسال اطلاعیه', message: 'پیام برای گیرندگان انتخاب‌شده در تلگرام ارسال می‌شود و قابل بازگشت نیست. ادامه می‌دهید؟', confirmText: 'ارسال' }))) return;
            const msg = $('.form-msg', page);
            msg.className = 'form-msg'; msg.textContent = 'در حال ارسال…';
            try {
              const r = await AP.api('/admin/broadcast', { method: 'POST', body: { scope: f.scope, department: f.department, userIds, text: f.text } });
              msg.className = r.failed ? 'form-msg err' : 'form-msg ok';
              msg.textContent = `ارسال شد: ${fmt.num(r.delivered)} از ${fmt.num(r.recipients)} نفر${r.failed ? ` (${fmt.num(r.failed)} ناموفق)` : ''}`;
            } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
          });
        },
      };
    },
  });

  // ======================================================
  // تنظیمات (S3-9a): گروه‌بندی‌شده بر پایه‌ی GET /admin/settings/items؛ ذخیره با PUT /admin/settings/:key (دلیل اجباری)
  // ======================================================
  const WEEKDAY_ORDER = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];
  const WEEKDAY_NAME = Object.fromEntries(WEEKDAY_ORDER);
  const ENUM_LABELS = {
    lateCountsFrom: { shift_start: 'از ساعت شروع کار', after_grace: 'پس از پایان مهلت' },
    planGateMode: { enforce: 'الزامی (بدون برنامه خروج ثبت نمی‌شود)', soft: 'یادآوری (الزامی نیست)', off: 'خاموش' },
    dailyReportGateMode: { enforce: 'الزامی (بدون گزارش خروج ثبت نمی‌شود)', soft: 'نرم (تکمیل تا مهلتِ تنظیم‌شده)', off: 'خاموش' },
    planSubmissionWeekday: { auto: 'خودکار (آخرین روز کاریِ هفته)', 0: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه', 6: 'شنبه' },
    planGateWarnWeekday: { off: 'خاموش', 0: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه', 6: 'شنبه' },
    overtimeRounding: { down: 'به پایین', nearest: 'نزدیک‌ترین', up: 'به بالا' },
    lateLimitGateMode: { off: 'بی‌اثر', soft: 'هشدار (ورود مجاز است)', enforce: 'الزامی (بدون اجازه‌ی سرپرست ثبت نمی‌شود)' },
    crossMidnightMode: { legacy: 'سازگار با گذشته', by_shift_day: 'بر پایه‌ی روز شیفت' },
    leaveBalancePolicy: { block: 'مسدود', warn: 'هشدار', allow_negative: 'مانده‌ی منفی' },
    supervisorRecordEditCountMode: { operation: 'هر عملیات یک بار', record: 'هر رکورد یک بار' },
    fixedLunchMode: { present_in_window: 'فقط با حضور در بازه‌ی ناهار', always: 'همیشه (فقط حداقل حضور روزانه)' },
  };
  // فاز B: برچسب فارسی قابلیت‌های قابل‌خاموش‌شدنِ سرپرست (کلیدها با src/utils/supervisorCapabilities.js یکی است)
  const ST_CAP_LABELS = {
    'leave.approve': 'تأیید/رد مرخصی و ماموریت',
    'leave.edit': 'ثبت و ویرایش مرخصی برای کارمند',
    'records.edit': 'اصلاح رکورد تردد',
    'disputes.resolve': 'تصمیم درباره‌ی اعتراض‌ها',
    'overtime.approve': 'تأیید اضافه‌کاری',
    'suspicious.review': 'بررسی تردد مشکوک',
    'plans.exempt': 'معافیت از گیت برنامه‌ی هفتگی',
    'reviews.write': 'مشاهده و کامنت روی گزارش تیم',
    'checkin_permissions.decide': 'تصمیم درباره‌ی اجازه‌ی ورود',
    'tasks.assign_urgent': 'تعیین تسک فوری',
    'plan.edit_team': 'ویرایش برنامه‌ی هفته‌های آینده‌ی تیم',
    'remote_work.review': 'تأیید/رد ساعت دورکاری',
    'schedule.manage': 'مدیریت برنامه‌ی روزبه‌روز تیم',
    'broadcast.send': 'ارسال پیام گروهی به تیم',
    'users.message': 'ارسال پیام به کارمند',
    'analytics.read': 'تحلیل‌ها و روند تأخیر تیم',
  };
  const stCapLabel = (v) => ST_CAP_LABELS[v] || v;
  const ST_CAP_KEY = 'supervisorEnabledCapabilities';
  const ST_CAP_WARN = 'این تغییر فوراً روی همه‌ی سرپرست‌ها اعمال می‌شود و درخواست‌های در انتظار فقط برای ادمین‌ها دیده می‌شود.';
  // قابلیت‌هایی که با این پیش‌نویس نسبت به مقدار ذخیره‌شده «خاموش» می‌شوند
  const stCapsTurnedOff = (it, draft) => (it.value || []).filter((c) => !(draft || []).includes(c));

  // گروه‌هایی که محاسبه‌ی روز را عوض می‌کنند ⇒ روی عدد روزها/ماه‌های گذشته هم اثر دارند (گزارش‌ها همیشه با تنظیمات فعلی محاسبه می‌شوند)
  const IMPACT_GROUPS = new Set(['workHours', 'calendar', 'overtime']);
  const IMPACT_TEXT = 'این تغییر روی گزارش‌ها و خلاصه‌های همه‌ی روزها و ماه‌های گذشته اثر می‌گذارد؛ رکوردهای تردد عوض نمی‌شود.';

  const IMPACT_SHORT = 'تغییر این بخش روی گزارش‌ها و خلاصه‌های همه‌ی روزها اثر می‌گذارد؛ رکوردهای تردد عوض نمی‌شود.';

  // عنوان یک تنظیم برای کارت، پیام‌ها و دیالوگ‌ها: برچسب کوتاه؛ اگر نبود خودِ توضیح (بدون برش)
  const setShort = (it) => (it.label && it.label.trim()) || it.description.trim();
  function setEnumLabel(it, v) { return (ENUM_LABELS[it.key] && ENUM_LABELS[it.key][v]) || v; }

  // مقدار قابل‌نمایش (برای «پیش‌فرض: …»)
  // ---------- زمان‌بندی (cron) بدون نوشتن عبارت: تبدیل دوطرفه‌ی عبارت ⇄ انتخاب‌های ساده ----------
  // روز هفته در cron: ۰=یکشنبه … ۶=شنبه (ترتیب نمایش: از شنبه)
  const CRON_DAYS = [[6, 'شنبه'], [0, 'یکشنبه'], [1, 'دوشنبه'], [2, 'سه‌شنبه'], [3, 'چهارشنبه'], [4, 'پنجشنبه'], [5, 'جمعه']];
  const cPad = (n) => String(n).padStart(2, '0');
  function cronParse(expr) {
    const f = String(expr == null ? '' : expr).trim().split(/\s+/);
    if (f.length !== 5) return { mode: 'custom' };
    const [mi, h, dom, mon, dow] = f;
    if (dom === '*' && mon === '*' && dow === '*') {
      const m1 = /^\*(?:\/(\d+))?$/.exec(mi); const win = /^(\d{1,2})-(\d{1,2})$/.exec(h);
      if (m1 && (h === '*' || (win && Number(win[1]) <= Number(win[2]) && Number(win[2]) <= 23))) {
        const n = m1[1] ? Number(m1[1]) : 1;
        if (n >= 1 && n <= 59) return { mode: 'minutes', n, win: win ? [Number(win[1]), Number(win[2])] : null };
      }
      if (/^\d{1,2}$/.test(mi) && Number(mi) <= 59 && (h === '*' || /^\*\/\d{1,2}$/.test(h))) {
        const n = h === '*' ? 1 : Number(h.slice(2));
        if (n >= 1 && n <= 23) return { mode: 'hours', n, m: Number(mi) };
      }
    }
    if (/^\d{1,2}$/.test(mi) && Number(mi) <= 59 && /^\d{1,2}$/.test(h) && Number(h) <= 23 && dom === '*' && mon === '*' && (dow === '*' || /^[0-6](,[0-6])*$/.test(dow))) {
      return { mode: 'daily', h: Number(h), m: Number(mi), days: dow === '*' ? [0, 1, 2, 3, 4, 5, 6] : [...new Set(dow.split(',').map(Number))] };
    }
    return { mode: 'custom' };
  }
  function cronBuild(st) {
    if (st.mode === 'minutes') return `${st.n === 1 ? '*' : `*/${st.n}`} ${st.win ? `${st.win[0]}-${st.win[1]}` : '*'} * * *`;
    if (st.mode === 'hours') return `${st.m} ${st.n === 1 ? '*' : `*/${st.n}`} * * *`;
    if (st.mode === 'daily') { const d = [...new Set(st.days)].sort((a, b) => a - b); return `${st.m} ${st.h} * * ${d.length === 7 || !d.length ? '*' : d.join(',')}`; }
    return '';
  }
  function cronHuman(expr) {
    const st = cronParse(expr);
    if (st.mode === 'minutes') return { mode: st.mode, text: `${st.n === 1 ? 'هر دقیقه' : `هر ${fmt.num(st.n)} دقیقه`}${st.win ? `، از ساعت ${cPad(st.win[0])}:00 تا ${cPad(st.win[1])}:59` : ''}` };
    if (st.mode === 'hours') return { mode: st.mode, text: `${st.n === 1 ? 'هر ساعت' : `هر ${fmt.num(st.n)} ساعت`}${st.m === 0 ? ' (سر ساعت)' : ` (دقیقه‌ی ${fmt.num(st.m)})`}` };
    if (st.mode === 'daily') {
      const names = CRON_DAYS.filter(([d]) => st.days.includes(d)).map(([, n]) => n);
      const dayText = names.length === 7 ? 'هر روز' : (names.length > 1 ? `${names.slice(0, -1).join('، ')} و ${names[names.length - 1]}` : names[0]);
      return { mode: st.mode, text: `${dayText} ساعت ${cPad(st.h)}:${cPad(st.m)}` };
    }
    return { mode: 'custom', text: String(expr || '').trim().split(/\s+/).length === 5 ? 'زمان‌بندی سفارشی' : 'عبارت نامعتبر' };
  }

  function setShow(it, v) {
    if (it.type === 'boolean') return v ? 'روشن' : 'خاموش';
    if (it.type === 'weekdays') return (v || []).length ? WEEKDAY_ORDER.filter(([d]) => v.includes(d)).map(([, n]) => n).join('، ') : 'هیچ‌کدام';
    if (it.type === 'enum') return setEnumLabel(it, v);
    if (it.type === 'cron') { const h = cronHuman(v); return h.mode === 'custom' ? String(v) : h.text; }
    if (it.type === 'multiselect') { const a = v || []; return a.length === (it.values || []).length ? `همه (${a.length} مورد)` : (a.length ? a.map(stCapLabel).join('، ') : 'هیچ‌کدام'); }
    return String(v);
  }

  // نرمال‌سازی برای مقایسه‌ی «تغییر کرده؟»
  function setNorm(it, v) {
    if (it.type === 'boolean') return v === true || v === 'true' ? 'true' : 'false';
    if (it.type === 'number') { const n = Number(v); return v === '' || Number.isNaN(n) ? `?${v}` : String(n); }
    if (it.type === 'weekdays') return JSON.stringify([...(v || [])].map(Number).sort((a, b) => a - b));
    if (it.type === 'multiselect') return JSON.stringify([...(v || [])].map(String).sort());
    return String(v == null ? '' : v).trim();
  }

  // واحد نمایشی کنار عدد (از روی نام کلید؛ تا کاربرِ تازه‌کار بداند «۴۵» دقیقه است یا ساعت)
  function stUnit(it) {
    if (it.type !== 'number') return '';
    const k = it.key;
    if (k === 'missionReminderHour') return 'ساعتِ روز';
    if (/Percent/.test(k)) return 'درصد';
    if (/Factor$/.test(k)) return 'برابر';
    if (/Minutes|RoundStep$/.test(k)) return 'دقیقه';
    if (/Hours$/.test(k)) return 'ساعت';
    if (/Days$/.test(k)) return 'روز';
    if (/Months$/.test(k)) return 'ماه';
    if (/Seconds$/.test(k)) return 'ثانیه';
    if (/Kb$/.test(k)) return 'کیلوبایت';
    if (/CommentMax$|ReasonMin$/.test(k)) return 'نویسه';
    return '';
  }

  // راهنمای ساده‌ی هر بخش: «این بخش چه می‌کند» و یک مثال واقعی
  const ST_SECTION_HELP = {
    'ساعت و منطقه‌ی زمانی': ['ساعت رسمی شروع و پایان کار شرکت. تأخیر و زودتر رفتن همه نسبت به همین ساعت‌ها حساب می‌شود.', 'اگر شروع کار ۰۸:۰۰ باشد و کارمندی ۰۸:۲۰ ورود بزند، ۲۰ دقیقه تأخیر دارد.'],
    'تأخیر و زودتر رفتن': ['چند دقیقه ارفاق قبل از اینکه تأخیر یا زودتر رفتن ثبت شود.', 'مهلت تأخیر ۱۰ دقیقه و شروع ۰۸:۰۰: ورود ۰۸:۰۸ تأخیر حساب نمی‌شود.'],
    'ناهار': ['کسر خودکار زمان ناهار از ساعت مفید. با حالت پیش‌فرض فقط کسی کسر می‌شود که در بازه‌ی ناهار در شرکت بوده است.', 'بازه ۱۲:۰۰ تا ۱۴:۰۰ و کسر ۴۵ دقیقه: کسی که کل بازه را در شرکت بوده ۴۵ دقیقه کسر می‌شود؛ کسی که فقط ۲۰ دقیقه‌اش حاضر بوده، با «کسر متناسب» ۲۰ دقیقه.'],
    'خروج و ورود مجدد': ['وقتی کارمند وسط روز از شرکت بیرون می‌رود خروج می‌زند و هنگام برگشت «ورود مجدد». اینجا تعداد دفعات مجاز را تعیین می‌کنید.', 'سقف ۵: هر کارمند تا ۵ بار در روز می‌تواند بیرون برود و برگردد. با گزینه‌ی «نامحدود» سقفی نیست.'],
    'استراحت': ['استراحت‌های کوتاه با حقوق؛ تا سقف تعیین‌شده از ساعت کار کم نمی‌شوند.', 'سه استراحت و مجموع ۴۵ دقیقه: سه بار چای‌خوردن و کلاً ۴۵ دقیقه‌اش حقوقی است.'],
    'پیام خودکار استراحت و ناهار': ['ربات خودش سر ساعت تعیین‌شده برای همه‌ی کسانی که همان لحظه در شرکت‌اند پیام می‌فرستد؛ شیفت مهم نیست. هر دو کلید پیش‌فرض خاموش‌اند.', 'ناهار ۱۲:۱۵ و ۴۵ دقیقه: ربات ۱۲:۱۵ پیام شروع می‌فرستد و چند دقیقه مانده به ۱۳:۰۰ هشدار پایان.'],
    'تایم پرت هنگام خروج': ['هنگام ثبت خروج از کارمند پرسیده می‌شود تایم پرت داشته یا نه؛ اگر «بله» بزند، مقدار انتخابی از ساعت مفید همان روز کم می‌شود.', 'سقف ۰ یعنی بدون محدودیت (تا مدت حضور همان روز)؛ سقف ۱۲۰ و گام ۵: کارمند ۵ تا ۱۲۰ دقیقه با گام ۵ دقیقه ثبت می‌کند. «خیر» چیزی کم نمی‌کند.'],
    'هشدار و علامت‌گذاری': ['تعیین می‌کند چه زمانی یک استراحت یا حضور «غیرعادی» علامت بخورد تا ادمین ببیند.', ''],
    'قواعد اضافه‌کاری': ['اضافه‌کاری چه زمانی حساب شود، آیا تأیید لازم دارد و تا چه سقفی.', 'حداقل ۳۰ دقیقه و سقف روزانه ۲ ساعت: ۲۰ دقیقه کار اضافه حساب نمی‌شود و بیشتر از ۲ ساعت در روز هم محاسبه نمی‌شود.'],
    'ضریب و گرد کردن': ['هر دقیقه اضافه‌کاری با چه ضریبی حساب شود و چطور گرد شود.', 'ضریب روز عادی ۱٫۵: هر ۶۰ دقیقه اضافه‌کاری، ۹۰ دقیقه محاسبه می‌شود.'],
    'استحقاق و مانده': ['مرخصی سالانه‌ی هر کارمند و اینکه مانده‌ی سال قبل و کمبود مانده چطور رفتار کند.', 'استحقاق ۹۶۰۰ دقیقه یعنی ۱۶۰ ساعت مرخصی در سال برای هر کارمند.'],
    'ثبت و مهلت‌ها': ['چه بازه‌ای برای ثبت مرخصی مجاز است و با چه پیش‌اطلاعی.', 'سقف فاصله‌ی آینده ۹۰ روز: مرخصیِ بیش از ۹۰ روز بعد از امروز قابل ثبت نیست.'],
    'پیوست': ['حجم و نوع فایل‌هایی که کارمند می‌تواند به درخواست مرخصی پیوست کند.', 'حداکثر ۵۱۲۰ کیلوبایت یعنی فایل بزرگ‌تر از ۵ مگابایت پذیرفته نمی‌شود.'],
    'ماموریت': ['قواعد ثبت ماموریت: چند روز به گذشته و آینده، یادآوری و تردد با ماموریتِ در انتظار.', 'ثبت برای گذشته ۳ روز: ماموریتِ ۴ روز قبل دیگر قابل ثبت نیست.'],
    'برنامه‌ی هفتگی': ['روز شروع هفته، زمان ثبت برنامه‌ی هفته‌ی بعد و اینکه ثبت برنامه اجباری باشد یا نه.', ''],
    'گزارش روزانه': ['الزام و مهلت تکمیل گزارش کارهای روزانه.', ''],
    'تسک‌ها و پیام‌ها': ['انتقال تسک بین روزها، تسک فوری شخصی و پیام‌های تشویقی.', ''],
    'راه‌اندازی و ثبت تردد': ['حالت راه‌اندازی نهایی، جلوگیری از ثبت تکراری و دستگاه مشترک.', ''],
    'دورکاری': ['اجازه و قواعد دورکاری بیرون از شبکه و از طریق بات.', ''],
    'تأخیر': ['شرط‌های تشخیص الگوهای تأخیر؛ مثلاً چند روز متوالی یا تکرار در یک روز هفته.', 'تأخیر پشت‌سرهم ۳: سه روز متوالی تأخیر به‌عنوان الگو علامت می‌خورد.'],
    'غیبت و ساعت یکسان': ['تشخیص غیبتِ چسبیده به تعطیلی و ورود/خروج با ساعت‌های دقیقاً یکسان.', ''],
    'ماه‌های مبنا': ['چند ماه گذشته مبنای مقایسه است و حداقل داده‌ی لازم برای معتبر بودن یک ماه.', ''],
    'بررسی گزارش تیم': ['قواعد بررسی گزارش تیم و ثبت یادداشت و علت رد ماموریت توسط سرپرست.', ''],
    'مرور شبانه و خلاصه‌ها': ['پیام‌های مرور شبانه و خلاصه‌ی صبحگاهی برای سرپرست و سقف طول آن‌ها.', ''],
    'هشدارها و اعلان‌ها': ['اینکه چه رویدادهایی به سرپرست و ادمین‌ها اعلان شود.', ''],
    'سقف‌ها': ['سقف و نحوه‌ی شمارش اصلاح رکورد توسط سرپرست.', ''],
    'قابلیت‌های سرپرست': ['مشخص می‌کند سرپرست‌ها به چه کارهایی دسترسی دارند.', ''],
    'زمان‌بندی': ['زمان اجرای کارهای خودکار این بخش؛ به‌صورت عبارت cron (مثلاً «* * * * *» یعنی هر دقیقه).', ''],
    'یادآوری‌ها': ['زمان اجرای کارهای خودکارِ یادآوری و پیام؛ هر مورد یک عبارت cron است.', ''],
    'گزارش‌ها': ['زمان ساخت و ارسال گزارش‌های دوره‌ای.', ''],
    'پایان روز و تقویم': ['بستن رکوردهای باز و علامت‌گذاری تعطیلی/مرخصی.', ''],
    'نگهداری و پایش': ['بک‌آپ، آرشیو، نگهداری پایگاه داده و پایش سلامت.', ''],
  };

  function setInput(it, v) {
    const k = esc(it.key);
    const al = `aria-label="${esc(setShort(it))}"`; // برچسب دسترس‌پذیر کنترل (S5-9a)
    switch (it.type) {
      case 'boolean':
        return `<label class="st-switch-wrap"><input type="checkbox" role="switch" class="st-switch" name="${k}" data-key="${k}" ${al}${setNorm(it, v) === 'true' ? ' checked' : ''} /><span class="st-track" aria-hidden="true"></span><span class="st-sw-on">روشن</span><span class="st-sw-off">خاموش</span></label>`;
      case 'number':
        { const u = stUnit(it); const inp = `<input type="number" step="any" name="${k}" data-key="${k}" ${al} value="${esc(v)}"${it.min !== undefined ? ` min="${it.min}"` : ''}${it.max !== undefined ? ` max="${it.max}"` : ''} class="ltr-in" />`; return u ? `<span class="st-unit-wrap">${inp}<span class="st-unit" aria-hidden="true">${u}</span></span>` : inp; }
      case 'time':
        return `<input type="time" name="${k}" data-key="${k}" ${al} value="${esc(v)}" class="ltr-in" dir="ltr" />`;
      case 'enum':
        return `<select name="${k}" data-key="${k}" ${al}>${it.values.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(setEnumLabel(it, o))}</option>`).join('')}</select>`;
      case 'weekdays':
        return `<div class="chk-row" data-key="${k}" role="group" ${al}>${WEEKDAY_ORDER.map(([d, n]) => `<label class="chk st-pill"><input type="checkbox" value="${d}"${(v || []).includes(d) ? ' checked' : ''} /><span>${n}</span></label>`).join('')}</div>`;
      case 'multiselect':
        return `<div class="chk-row st-multi" data-key="${k}" role="group" ${al}>${(it.values || []).map((o) => `<label class="chk st-pill"><input type="checkbox" value="${esc(o)}"${(v || []).includes(o) ? ' checked' : ''} /><span>${esc(stCapLabel(o))}</span></label>`).join('')}</div>`;
      case 'cron': {
        const hm = cronHuman(v);
        return `<div class="st-cron" data-mode="${esc(cronParse(v).mode)}">
          <input type="text" name="${k}" data-key="${k}" ${al} value="${esc(v)}" dir="ltr" class="ltr-in st-cron-raw" autocomplete="off" spellcheck="false" />
          <div class="st-cron-summary"><span class="st-cron-ico" aria-hidden="true">${icon('clock')}</span><div class="st-cron-txt"><strong data-cron-text>${esc(hm.text)}</strong><small class="st-cron-code" data-cron-sub dir="ltr">${esc(v)}</small></div><button type="button" class="btn small st-cron-edit" data-cron-edit aria-expanded="false">تغییر زمان</button></div>
          <div class="st-cron-panel" data-cron-panel hidden></div>
        </div>`;
      }
      default: // string | timezone
        return `<input type="text" name="${k}" data-key="${k}" ${al} value="${esc(v)}" dir="ltr" class="ltr-in" autocomplete="off" spellcheck="false" />`;
    }
  }

  function setHint(it) {
    const bits = [];
    if (it.type === 'number' && it.min !== undefined && it.max !== undefined) bits.push(`بازه: ${it.min} تا ${it.max}`);
    else if (it.type === 'number' && it.min !== undefined) bits.push(`حداقل: ${it.min}`);
    else if (it.type === 'number' && it.max !== undefined) bits.push(`حداکثر: ${it.max}`);
    return bits.join(' · ');
  }

  function setRead(it, row) {
    const el = $(`[data-key="${CSS.escape(it.key)}"]`, row);
    if (!el) return undefined;
    if (it.type === 'boolean') return el.checked ? 'true' : 'false';
    if (it.type === 'weekdays') return $$('input:checked', el).map((c) => Number(c.value));
    if (it.type === 'multiselect') return $$('input:checked', el).map((c) => c.value);
    if (it.type === 'time' && window.TimeInput) { const t = window.TimeInput.parse(el.value); return t.ok ? t.value : el.value; } // H4: ساعت تایپی همیشه HH:MM
    return el.value;
  }


  // آیکون هر نوع تنظیم (کارت تنظیم)؛ خطی، ۲۴×۲۴، رنگ از currentColor
  const ST_ICO = {
    boolean: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.6"/>',
    number: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
    time: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    enum: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    weekdays: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    multiselect: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
    date: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    timezone: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    cron: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    string: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  };
  const stIco = (t) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ST_ICO[t] || ST_ICO.string}</svg>`;
  const ST_TIP_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2v.1h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>';
  const ST_RANGE_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>';
  const ST_RESET_ICO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
  const ST_GROUP_META = {
    workHours: ['clock', 'ساعات پایه‌ی شروع، پایان و استراحت روز کاری را مدیریت کنید.'],
    calendar: ['calendar', 'روزهای کاری، تعطیلات هفتگی و قواعد تقویم سازمان را تنظیم کنید.'],
    overtime: ['trend', 'محاسبه، گرد کردن و محدودیت‌های اضافه‌کاری را تعیین کنید.'],
    leave: ['leave', 'قواعد مرخصی، مأموریت، مانده و مسیر تأیید را مدیریت کنید.'],
    reminders: ['alert', 'آستانه‌های تأخیر و زمان ارسال یادآوری‌ها را تنظیم کنید.'],
    security: ['audit', 'محدودیت‌ها و سیاست‌های امنیتی دسترسی را کنترل کنید.'],
    retention: ['inbox', 'مدت نگهداری داده‌ها و زمان آرشیو خودکار را تعیین کنید.'],
    schedule: ['clock', 'زمان اجرای گزارش‌ها و کارهای خودکار سامانه را تنظیم کنید.'],
    monthClose: ['calendar', 'قواعد و مهلت بستن دوره‌های ماهانه را مدیریت کنید.'],
    reportDelivery: ['mail', 'زمان و مقصد ارسال خودکار گزارش‌ها را مشخص کنید.'],
    patterns: ['alert', 'حساسیت و آستانه‌ی هشدار الگوهای رفتاری را تعیین کنید.'],
    planning: ['attendance', 'قواعد برنامه‌ی هفتگی و گزارش روزانه را تنظیم کنید.'],
    performance: ['trend', 'وزن‌ها و قواعد محاسبه‌ی امتیاز عملکرد را مدیریت کنید.'],
    disputes: ['disputes', 'مهلت و روند ثبت و رسیدگی به اعتراض‌ها را تعیین کنید.'],
    supervisors: ['employees', 'قواعد و محدودیت‌های سرپرست‌ها، مرور شبانه و صف تأییدها را مدیریت کنید.'],
  };
  const stGroupMeta = (g) => ST_GROUP_META[g] || ['settings', 'تنظیمات این بخش را بررسی و مدیریت کنید.'];

  AP.view('settings', {
    skeleton: 'settings', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'settings.edit',
    nav: { icon: 'settings', label: 'تنظیمات', group: 'مدیریت' },
    async render() {
      const data = await AP.api('/admin/settings/items');
      const items = data.items;
      const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
      const drafts = {}; // کلید ← مقدارِ در حال ویرایش (ذخیره‌نشده)
      const groupKeys = Object.keys(data.groups).filter((g) => items.some((i) => i.group === g));
      const draftOf = (it) => (it.key in drafts ? drafts[it.key] : it.value);
      const isDirty = (it) => it.key in drafts && setNorm(it, drafts[it.key]) !== setNorm(it, it.value);
      const tabOf = {}; // گروه ← شناسه‌ی تب فعال (بعد از repaint هم می‌ماند)

      // ----- خلاصه و جمله‌ی اثرِ زنده‌ی هر زیربخش (از مقدارهای فعلی/ذخیره‌نشده ساخته می‌شود) -----
      const V = (k) => (byKey[k] ? draftOf(byKey[k]) : undefined);
      const N = (k) => Number(V(k));
      const ON = (k) => !!byKey[k] && setNorm(byKey[k], V(k)) === 'true';
      const addMin = (t, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t)); if (!m) return String(t); const x = (((Number(m[1]) * 60 + Number(m[2]) + d) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
      const dur = (min) => { const n = Math.max(0, Math.round(Number(min) || 0)); const h = Math.floor(n / 60); const m = n % 60; return h && m ? `${fmt.num(h)} ساعت و ${fmt.num(m)} دقیقه` : (h ? `${fmt.num(h)} ساعت` : `${fmt.num(m)} دقیقه`); };
      const ST_ZERO_TEXT = { breakMaxPerDay: 'بدون سقف', maxLunchMinutes: 'بدون سقف', lateGraceMinutes: 'بدون مهلت', earlyGraceMinutes: 'بدون مهلت' };
      const ST_SUM = {
        'ساعت و منطقه‌ی زمانی': ['workDayStart', 'workDayEnd', 'timezone', 'dailyTargetMinutes'],
        'تأخیر و زودتر رفتن': ['lateGraceMinutes', 'earlyGraceMinutes', 'lateCountsFrom'],
        'ناهار': ['fixedLunchDeductMinutes', 'lunchWindowStart', 'lunchWindowEnd', 'fixedLunchMode'],
        'خروج و ورود مجدد': ['maxReEntriesPerDay'],
        'استراحت': ['paidBreakCount', 'paidBreakMinutes', 'breakMaxPerDay'],
        'پیام خودکار استراحت و ناهار': ['scheduledBreakEnabled', 'scheduledBreakStart', 'scheduledLunchEnabled', 'scheduledLunchStart'],
        'هشدار و علامت‌گذاری': ['longOpenBreakMinutes', 'outsideShiftMarginMinutes'],
      };
      const sumVal = (k) => {
        const it = byKey[k]; if (!it) return '';
        if (k === 'maxReEntriesPerDay' && ON('maxReEntriesUnlimited')) return 'نامحدود';
        if (k === 'paidBreakCount' && ON('paidBreakCountUnlimited')) return 'نامحدود';
        if (it.type === 'number' && Number(V(k)) === 0 && ST_ZERO_TEXT[k]) return ST_ZERO_TEXT[k];
        const base = setShow(it, V(k)); const u = stUnit(it);
        return u && it.type === 'number' ? `${base} ${u}` : base;
      };
      const ST_EFFECT = {
        'ساعت و منطقه‌ی زمانی': () => `روز کاری عمومی از ${V('workDayStart')} تا ${V('workDayEnd')} (${V('timezone')}) است؛ هدف ساعت مفید روزانه ${dur(N('dailyTargetMinutes'))}.`,
        'تأخیر و زودتر رفتن': () => {
          const g = N('lateGraceMinutes'); const e = N('earlyGraceMinutes'); const st = V('workDayStart'); const en = V('workDayEnd');
          const late = g === 0 ? `هر ورود بعد از ${st} تأخیر حساب می‌شود` : `ورود تا ${addMin(st, g)} بدون تأخیر است و بعد از آن تأخیر از ${V('lateCountsFrom') === 'after_grace' ? addMin(st, g) : st} محاسبه می‌شود`;
          const early = e === 0 ? `هر خروج قبل از ${en} «زودتر رفتن» است` : `خروج تا ${addMin(en, -e)} «زودتر رفتن» حساب نمی‌شود`;
          return `با ساعت کاری عمومی: ${late}؛ ${early}.`;
        },
        'ناهار': () => {
          const ded = N('fixedLunchDeductMinutes');
          if (!ded) return 'کسر ثابت ناهار خاموش است؛ فقط ناهارِ ثبت‌شده از ساعت مفید کم می‌شود.';
          if (V('fixedLunchMode') === 'always') return `پس از ${dur(N('fixedLunchMinPresenceMinutes'))} حضور، به هر کارمند ${dur(ded)} ناهار کسر می‌شود؛ حتی اگر در بازه‌ی ناهار در شرکت نبوده باشد.`;
          return `کارمندی که دست‌کم ${dur(N('fixedLunchMinOverlapMinutes'))} از بازه‌ی ${V('lunchWindowStart')} تا ${V('lunchWindowEnd')} در شرکت باشد، ${ON('fixedLunchProRate') ? `به‌نسبت حضورش در بازه (حداکثر ${dur(ded)})` : dur(ded)} ناهار کسر می‌شود؛ کسی که در این بازه حاضر نبوده کسری ندارد.`;
        },
        'خروج و ورود مجدد': () => {
          if (ON('maxReEntriesUnlimited')) return 'هر کارمند هر چند بار بخواهد می‌تواند در روز خارج شود و دوباره وارد شود.';
          const n = N('maxReEntriesPerDay');
          return n === 0 ? 'ورود مجدد بعد از خروج ممکن نیست.' : `هر کارمند در روز حداکثر ${fmt.num(n)} بار می‌تواند بعد از خروج، ورود مجدد بزند.`;
        },
        'استراحت': () => {
          const unl = ON('paidBreakCountUnlimited'); const cnt = N('paidBreakCount'); const min = N('paidBreakMinutes'); const cap = N('breakMaxPerDay');
          if (!unl && (cnt === 0 || min === 0)) return 'استراحت با حقوق خاموش است؛ همه‌ی استراحت‌ها از ساعت مفید کم می‌شود.';
          return `تا ${unl ? 'هر تعداد' : fmt.num(cnt)} استراحت کوتاه و در مجموع ${dur(min)} با حقوق حساب می‌شود${cap ? `؛ شروع استراحت در روز حداکثر ${fmt.num(cap)} بار مجاز است` : ''}.`;
        },
        'قواعد اضافه‌کاری': () => {
          if (!ON('overtimeEnabled')) return 'محاسبه‌ی اضافه‌کاری خاموش است.';
          const min = N('overtimeMinMinutes'); const cap = N('overtimeDailyCapMinutes'); const mcap = N('overtimeMonthlyCapMinutes');
          return `اضافه‌کاری ${ON('overtimeRequiresApproval') ? 'پس از تأیید مدیر' : 'به‌صورت خودکار'} حساب می‌شود${min ? `؛ کمتر از ${dur(min)} در روز حساب نمی‌شود` : ''}؛ ${cap ? `سقف روزانه ${dur(cap)}` : 'بدون سقف روزانه'}${mcap ? ` و سقف ماهانه ${dur(mcap)}` : ''}.`;
        },
        'ضریب و گرد کردن': () => `هر ۶۰ دقیقه اضافه‌کاری در روز عادی ${dur(60 * N('overtimeFactor'))} و در روز تعطیل ${dur(60 * N('overtimeHolidayFactor'))} محاسبه می‌شود؛ گرد کردن با گام ${dur(N('overtimeRoundStep'))} (${setEnumLabel(byKey.overtimeRounding, V('overtimeRounding'))}).`,
        'ثبت و مهلت‌ها': () => `ثبت مرخصی برای گذشته ${ON('leaveAllowPastRequests') ? `تا ${fmt.num(N('leaveMaxPastDays'))} روز قبل` : 'مجاز نیست'}؛ برای آینده تا ${fmt.num(N('leaveMaxFutureDays'))} روز بعد${N('leaveMinNoticeHours') ? `؛ حداقل ${fmt.num(N('leaveMinNoticeHours'))} ساعت پیش‌اطلاع` : ''}.`,
        'دورکاری': () => (ON('remoteWorkEnabled') ? `دورکاری بیرون از شبکه مجاز است${ON('remoteWorkBotEnabled') ? ' و از طریق بات هم ثبت می‌شود' : ''}؛ هر دورکاری حداکثر ${fmt.num(N('remoteWorkMaxOpenHours'))} ساعت باز می‌ماند.` : 'دورکاری بیرون از شبکه خاموش است.'),
        'برنامه‌ی هفتگی': () => `الزام ثبت برنامه‌ی هفتگی: ${setEnumLabel(byKey.planGateMode, V('planGateMode'))}؛ حداقل ${fmt.num(N('planMinTasks'))} تسک در برنامه.`,
        'گزارش روزانه': () => `الزام گزارش روزانه: ${setEnumLabel(byKey.dailyReportGateMode, V('dailyReportGateMode'))}؛ تکمیل گزارش روزهای گذشته تا ${fmt.num(N('reportBackfillDays'))} روز بعد مجاز است.`,
        'پیام خودکار استراحت و ناهار': () => {
          const b = ON('scheduledBreakEnabled'); const l = ON('scheduledLunchEnabled');
          if (!b && !l) return 'هر دو پیام خاموش‌اند؛ ربات خودکار پیامی نمی‌فرستد.';
          return `${b ? `استراحت ساعت ${V('scheduledBreakStart')} (${dur(N('scheduledBreakMinutes'))})` : 'پیام استراحت خاموش'}؛ ${l ? `ناهار ساعت ${V('scheduledLunchStart')} (${dur(N('scheduledLunchMinutes'))})` : 'پیام ناهار خاموش'}. پیام برای هر کارمندِ حاضر در شرکت ارسال می‌شود.`;
        },
      };
      const liveHtml = (sec) => {
        const keys = (ST_SUM[sec] || items.filter((i) => i.section === sec && ['boolean', 'number', 'enum', 'time', 'date'].includes(i.type)).slice(0, 4).map((i) => i.key)).filter((k) => byKey[k]);
        const fx = ST_EFFECT[sec]; let text = '';
        try { text = fx ? fx() : ''; } catch (_) { text = ''; }
        if (!keys.length && !text) return '';
        const chips = keys.map((k) => { const it = byKey[k]; const on = it.type === 'boolean' ? ` data-on="${ON(k) ? '1' : '0'}"` : ''; return `<span class="st-chip"${on}><span class="st-chip-k">${esc(setShort(it))}</span><bdi class="st-chip-v">${esc(sumVal(k))}</bdi></span>`; }).join('');
        return `${chips ? `<div class="st-chips" aria-label="خلاصه‌ی وضعیت فعلی">${chips}</div>` : ''}${text ? `<p class="st-effect"><span class="st-effect-ico" aria-hidden="true">${ST_TIP_ICO}</span><span>${esc(text)}</span></p>` : ''}`;
      };

      // تنظیم وابسته (dependsOn: { key, equals }): تا وقتی شرط برقرار نیست کم‌رنگ می‌شود (ویرایش‌پذیر می‌ماند)
      const depMet = (it) => {
        const d = it.dependsOn; const p = d && byKey[d.key];
        return !p || setNorm(p, draftOf(p)) === setNorm(p, d.equals);
      };
      const depText = (it) => {
        const d = it.dependsOn; const p = d && byKey[d.key];
        if (!p) return '';
        const want = p.type === 'boolean' ? (d.equals ? 'روشن' : 'خاموش') : `«${setEnumLabel(p, d.equals)}»`;
        return `فقط وقتی «${setShort(p)}» ${want} باشد اثر دارد.`;
      };

      // فیلد عریض: روز هفته، cron، رشته و enum با برچسب گزینه‌ی بلند
      const isFull = (it) => ['weekdays', 'multiselect', 'cron', 'string'].includes(it.type) || (it.type === 'enum' && it.values.some((o) => setEnumLabel(it, o).length > 24));
      const rowHtml = (it) => {
        const short = setShort(it);
        const sub = it.label ? it.description.trim() : ''; // توضیح یک‌خطی زیر عنوان؛ بدون برچسب، خودِ توضیح عنوان است
        const more = !!(it.hint && it.hint.trim()); // توضیح بلندتر فقط با «بیشتر»
        const dirty = isDirty(it);
        const did = `st-d-${esc(it.key)}`;
        const hint = setHint(it);
        const ltrDef = ['time', 'timezone', 'number', 'date'].includes(it.type);
        return `
        <div class="st-field${isFull(it) ? ' full' : ''}${dirty ? ' dirty' : ''}${it.isDefault ? '' : ' changed'}${it.dependsOn && !depMet(it) ? ' st-inactive' : ''}" data-row="${esc(it.key)}" data-type="${esc(it.type)}"${it.dependsOn ? ` data-dep="${esc(it.dependsOn.key)}"` : ''}>
          <div class="st-head">
            <span class="st-ico" aria-hidden="true">${stIco(it.type)}</span>
            <div class="st-titles">
              <div class="st-label" title="${esc(it.description)}"><span>${esc(short)}</span><span class="st-tag" data-dirty${dirty ? '' : ' hidden'}>ذخیره‌نشده</span></div>
              ${sub ? `<p class="st-sub">${esc(sub)}</p>` : ''}
            </div>
          </div>
          <div class="st-ctl">${setInput(it, draftOf(it))}</div>
          ${more || hint ? `<div class="st-aux">
            ${hint ? `<span class="st-meta" title="بازه‌ی مجاز">${ST_RANGE_ICO}<span>${esc(hint)}</span></span>` : ''}
            ${more ? `<button type="button" class="st-more" data-more aria-expanded="false" aria-controls="${did}">${ST_TIP_ICO}<span class="st-more-t">نکته‌ی بیشتر</span></button>` : ''}
          </div>` : ''}
          ${more ? `<div class="st-desc st-hint" id="${did}"><span class="st-tip-bar" aria-hidden="true"></span><p>${esc(it.hint.trim())}</p></div>` : ''}
          ${it.dependsOn ? `<p class="st-dep-note" role="note">${esc(depText(it))}</p>` : ''}
          <div class="st-foot"><span class="st-def" title="${esc(it.key)}"><span class="st-def-k">پیش‌فرض</span><bdi dir="${ltrDef ? 'ltr' : 'auto'}">${esc(setShow(it, it.default))}</bdi></span>${it.isDefault ? '' : `<button type="button" class="btn ghost small st-reset" data-reset="${esc(it.key)}" title="بازگشت به پیش‌فرض" aria-label="بازگشت «${esc(short)}» به پیش‌فرض">${ST_RESET_ICO}<span>بازنشانی</span></button>`}</div>
        </div>`;
      };

      // کارت «تنظیمات مرتبط در بخش‌های دیگر»: فقط نمایش + رفتن به ردیف اصلی (ویرایش دوبل نمی‌کند تا drafts به‌هم نخورد)
      const relatedOf = (g) => items.filter((i) => Array.isArray(i.related) && i.related.includes(g) && i.group !== g);
      const relTone = (k) => [...String(k || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 6; // رنگ ثابت برای هر بخش مبدأ (فقط ظاهر)
      const relatedInner = (g) => relatedOf(g).map((it) => {
        const v = it.key in drafts ? drafts[it.key] : it.value;
        const ltr = ['time', 'timezone', 'cron', 'number', 'date'].includes(it.type);
        return `<li class="st-rel-item" data-tone="${relTone(it.group)}">
          <div class="st-rel-main"><span class="st-rel-name">${esc(setShort(it))}</span><span class="st-rel-group muted small">${esc(it.groupLabel || data.groups[it.group] || '')}</span></div>
          <bdi class="st-rel-val" dir="${ltr ? 'ltr' : 'auto'}">${esc(setShow(it, setNorm(it, v) === setNorm(it, it.value) ? it.value : v))}${it.key in drafts && isDirty(it) ? ' <span class="st-tag">ذخیره‌نشده</span>' : ''}</bdi>
          <button type="button" class="btn ghost small" data-goto="${esc(it.key)}" aria-label="رفتن به تنظیم «${esc(setShort(it))}» در بخش ${esc(it.groupLabel || '')}">رفتن به تنظیم</button>
        </li>`;
      }).join('');
      const relatedCard = (g) => (relatedOf(g).length ? `<section class="st-related" aria-labelledby="st-rel-h-${esc(g)}">
          <h4 id="st-rel-h-${esc(g)}">تنظیمات مرتبط در بخش‌های دیگر</h4>
          <p class="muted small">این موارد روی رفتار سرپرست‌ها اثر دارند ولی در بخش خودشان ویرایش می‌شوند.</p>
          <ul class="st-rel-list" data-related="${esc(g)}">${relatedInner(g)}</ul>
        </section>` : '');

      // بخش‌بندی: هر section یک کارت (تب) با عنوان، توضیح ساده، مثال، خلاصه و جمله‌ی اثرِ زنده؛ ردیف‌ها فشرده و موارد تخصصی زیر «پیشرفته»
      const fieldGroups = (g, list) => {
        const chunks = [];
        list.forEach((it, i) => {
          const sec = it.section || '';
          if (i === 0 || (list[i - 1].section || '') !== sec) chunks.push({ sec, idx: i, rows: [] });
          chunks[chunks.length - 1].rows.push(it);
        });
        const secChunks = chunks.filter((c) => c.sec);
        const tabbed = secChunks.length >= 2;
        const cur = tabbed ? (secChunks.some((c) => String(c.idx) === String(tabOf[g])) ? String(tabOf[g]) : String(secChunks[0].idx)) : '';
        const tabs = tabbed
          ? `<div class="st-tabs" role="tablist" aria-label="زیربخش‌ها" data-tabs="${esc(g)}">${secChunks.map((c) => `<button type="button" role="tab" class="st-tab" data-tab="${c.idx}" aria-selected="${String(c.idx) === cur}"><span>${esc(c.sec)}</span><span class="st-tab-n">${fmt.num(c.rows.length)}</span></button>`).join('')}</div>` : '';
        return tabs + chunks.map((c) => {
          const help = ST_SECTION_HELP[c.sec];
          const live = c.sec ? liveHtml(c.sec) : '';
          const head = c.sec ? `<header class="st-group-head"><h4 class="st-section" id="st-sec-${esc(g)}-${c.idx}">${esc(c.sec)}</h4><span class="st-group-count">${fmt.num(c.rows.length)} تنظیم</span>${help ? `<p class="st-group-what">${esc(help[0])}</p>${help[1] ? `<p class="st-group-eg"><span>مثال</span>${esc(help[1])}</p>` : ''}` : ''}<div class="st-live" data-live="${esc(c.sec)}">${live}</div></header>` : '';
          const basic = c.rows.filter((r) => !r.advanced); const adv = c.rows.filter((r) => r.advanced);
          const openAdv = adv.some((r) => isDirty(r) || !r.isDefault);
          const advHtml = adv.length ? `<details class="st-adv"${openAdv ? ' open' : ''}><summary><span class="st-adv-t">تنظیمات پیشرفته</span><span class="st-adv-n">${fmt.num(adv.length)}</span><span class="st-adv-h">مقدار پیش‌فرض برای بیشتر سازمان‌ها مناسب است</span></summary><div class="st-fields st-fields-adv">${adv.map(rowHtml).join('')}</div></details>` : '';
          const off = tabbed && c.sec && String(c.idx) !== cur ? ' st-tab-off' : '';
          return `<section class="st-group${c.sec ? '' : ' st-group-plain'}${off}" data-sec-idx="${c.idx}">${head}<div class="st-fields">${basic.map(rowHtml).join('')}</div>${advHtml}</section>`;
        }).join('');
      };

      const groupBody = (g) => {
        const list = items.filter((i) => i.group === g);
        const notes = [];
        if (IMPACT_GROUPS.has(g)) notes.push(`<div class="st-banner st-banner-warn" role="note"><span class="st-banner-ico" aria-hidden="true">${icon('alert')}</span><p>${esc(IMPACT_SHORT)}</p></div>`);
        if (g === 'schedule') notes.push(`<div class="st-banner st-banner-info" role="note"><span class="st-banner-ico" aria-hidden="true">${icon('clock')}</span><p>تغییر زمان‌بندی بدون ری‌استارت و بلافاصله اعمال می‌شود. مقدار پیش‌فرض از فایل <code class="ltr">.env</code> می‌آید.</p></div>`);
        if (g === 'supervisors' && AP.supervisorsPanel && AP.can('supervisors.manage')) notes.push(AP.supervisorsPanel.html()); // فاز C
        return `${notes.join('')}${fieldGroups(g, list)}${relatedCard(g)}
          <div class="st-actionbar" data-bar="${esc(g)}">
            <div class="st-save-state"><span class="st-status-dot" aria-hidden="true"></span><span class="st-pending" data-pending="${esc(g)}" aria-live="polite">تغییری ذخیره‌نشده نیست</span></div>
            <div class="form-msg" data-msg></div>
            <div class="st-save-actions">
              <button type="button" class="btn ghost small" data-discard="${esc(g)}" disabled>انصراف</button>
              <button type="button" class="btn primary small st-save-btn" data-save="${esc(g)}" disabled>${icon('check')}<span class="st-save-label">ذخیره</span></button>
            </div>
          </div>`;
      };

      const html = `
        <div class="view-header st-page-header"><div><h2>تنظیمات</h2><p class="sub st-page-intro">تنظیمات اصلی سامانه را به تفکیک بخش مدیریت کنید. هر تغییر با دلیل ذخیره و در «گزارش رویدادها» ثبت می‌شود؛ تعطیلات در صفحه‌ی «تعطیلات» است.</p></div></div>
        <div class="st-layout">
          <aside class="card st-nav">
            <div class="st-nav-head">
              <span class="st-nav-ico" aria-hidden="true">${icon('settings')}</span>
              <div><h3>تنظیمات سیستم</h3><div class="muted small">${fmt.num(items.length)} تنظیم در ${fmt.num(groupKeys.length)} بخش</div></div>
            </div>
            <label class="field st-search"><span class="sr-only">جستجو در تنظیمات</span><input type="search" id="set-q" placeholder="جستجو در تنظیمات… (کلید /)" autocomplete="off" /></label>
            <nav aria-label="بخش‌های تنظیمات">${groupKeys.map((g, i) => `
              <button type="button" class="st-nav-item" data-go="${esc(g)}"${i === 0 ? ' aria-current="true"' : ''}>
                <span class="st-nav-item-ico" aria-hidden="true">${icon(stGroupMeta(g)[0])}</span>
                <span class="st-nav-label"><span class="st-nav-name">${esc(data.groups[g])}</span><span class="st-dot" data-dot="${esc(g)}" hidden></span></span>
                <span class="badge st-count" data-count="${esc(g)}">${fmt.num(items.filter((x) => x.group === g).length)}</span>
              </button>`).join('')}
            </nav>
            <dl class="st-stats">
              <div><dt>تغییرکرده از پیش‌فرض</dt><dd data-stat="changed">${fmt.num(items.filter((x) => !x.isDefault).length)}</dd></div>
              <div><dt>ذخیره‌نشده</dt><dd data-stat="dirty">0</dd></div>
            </dl>
            ${AP.viewAllowed && AP.viewAllowed(AP.views.audit) ? `<button type="button" class="btn ghost small st-audit" data-audit>${icon('audit')} گزارش رویدادها</button>` : ''}
          </aside>
          <div class="st-main">${groupKeys.map((g, i) => `
            <section class="card st-panel" data-group="${esc(g)}" aria-labelledby="st-h-${esc(g)}"${i === 0 ? '' : ' hidden'}>
              <header class="st-panel-head"><div class="st-panel-heading"><h3 id="st-h-${esc(g)}" tabindex="-1">${esc(data.groups[g])}</h3><p>${esc(stGroupMeta(g)[1])}</p></div><div class="st-panel-actions"><span class="muted small">${fmt.num(items.filter((x) => x.group === g).length)} تنظیم</span></div></header>
              <div class="st-body">${groupBody(g)}</div>
            </section>`).join('')}
            <div id="set-none" class="hidden">${emptyBox('تنظیمی پیدا نشد. عبارت دیگری را امتحان کنید.')}</div>
          </div>
        </div>`;

      return {
        html,
        mount(page) {
          let active = groupKeys[0];
          const mountSupervisors = () => { if (AP.supervisorsPanel && AP.can('supervisors.manage') && $('[data-sup-panel]', page)) AP.supervisorsPanel.mount(page); }; // فاز C؛ بعد از هر repaint گروه دوباره
          mountSupervisors();
          const stickyTop = $('.topbar');
          if (stickyTop && page.style) page.style.setProperty('--st-sticky-top', `${stickyTop.offsetHeight}px`);
          const msgOf = (g) => $(`.st-panel[data-group="${CSS.escape(g)}"] [data-msg]`, page);
          const refreshSave = (g) => {
            const btn = $(`[data-save="${CSS.escape(g)}"]`, page);
            const n = items.filter((i) => i.group === g && isDirty(i)).length;
            if (btn) btn.disabled = n === 0;
            const dot = $(`[data-dot="${CSS.escape(g)}"]`, page);
            if (dot) { dot.hidden = n === 0; dot.innerHTML = n ? `<span class="sr-only">${fmt.num(n)} تغییر ذخیره‌نشده</span>` : ''; }
            const bar = $(`[data-bar="${CSS.escape(g)}"]`, page);
            if (bar) bar.classList.toggle('dirty', n > 0);
            const pend = $(`[data-pending="${CSS.escape(g)}"]`, page);
            if (pend) pend.textContent = n ? `${fmt.num(n)} تغییر ذخیره‌نشده` : 'تغییری ذخیره‌نشده نیست';
            const dis = $(`[data-discard="${CSS.escape(g)}"]`, page);
            if (dis) dis.disabled = n === 0;
            refreshLive(g);
            refreshStats();
          };
          const refreshLive = (g) => { $$('[data-live]', $(`.st-panel[data-group="${CSS.escape(g)}"]`, page)).forEach((el) => { el.innerHTML = liveHtml(el.dataset.live); }); };
          const refreshStats = () => {
            const ch = $('[data-stat="changed"]', page);
            const dr = $('[data-stat="dirty"]', page);
            if (ch) ch.textContent = fmt.num(items.filter((i) => !i.isDefault).length);
            if (dr) dr.textContent = fmt.num(items.filter(isDirty).length);
          };
          const repaint = (g) => {
            const body = $(`.st-panel[data-group="${CSS.escape(g)}"] .st-body`, page);
            body.innerHTML = groupBody(g);
            bind(g);
            if (g === 'supervisors') mountSupervisors();
            refreshSave(g);
            applyFilter();
          };
          const applyReset = (g) => { const m = msgOf(g); if (m) { m.className = 'form-msg'; m.textContent = ''; } };

          // ویجت زمان‌بندی: خلاصه‌ی فارسی + دکمه‌ی «تغییر زمان» با انتخاب‌های ساده؛ حالت «پیشرفته» خودِ عبارت cron را نشان می‌دهد
          function mountCron(row) {
            const box = $('.st-cron', row); if (!box) return;
            const raw = $('.st-cron-raw', box); const panel = $('[data-cron-panel]', box); const btn = $('[data-cron-edit]', box);
            const txt = $('[data-cron-text]', box); const sub = $('[data-cron-sub]', box);
            const opts = (arr, cur, fmtFn) => arr.map((x) => `<option value="${x}"${Number(x) === Number(cur) ? ' selected' : ''}>${fmtFn ? fmtFn(x) : fmt.num(x)}</option>`).join('');
            const range = (a, b, st = 1) => { const r = []; for (let i = a; i <= b; i += st) r.push(i); return r; };
            const minuteList = (cur) => [...new Set([...range(0, 55, 5), cur])].sort((a, b) => a - b);
            const MODES = [['minutes', 'هر چند دقیقه'], ['hours', 'هر چند ساعت'], ['daily', 'روزانه / روزهای مشخص'], ['custom', 'پیشرفته']];
            let mode = cronParse(raw.value).mode;
            const paint = () => {
              const st = cronParse(raw.value);
              const h = cronHuman(raw.value);
              txt.textContent = h.text; sub.textContent = raw.value; box.dataset.mode = mode;
              box.classList.toggle('is-bad', h.text === 'عبارت نامعتبر');
              if (panel.hidden) return;
              const cur = st.mode === mode ? st : null;
              let body = '';
              if (mode === 'minutes') {
                const c = cur || { n: 5, win: null };
                body = `<div class="st-cron-line"><span>هر</span><select data-c="n" aria-label="فاصله‌ی دقیقه">${opts([1, 2, 3, 5, 10, 15, 20, 30], c.n)}</select><span>دقیقه یک بار اجرا شود</span></div>
                  <label class="st-cron-check"><input type="checkbox" data-c="win"${c.win ? ' checked' : ''} /><span>فقط در بازه‌ی ساعتی مشخص</span></label>
                  <div class="st-cron-line"${c.win ? '' : ' hidden'} data-c-winrow><span>از ساعت</span><select data-c="wa" aria-label="از ساعت">${opts(range(0, 23), c.win ? c.win[0] : 8, (x) => `${cPad(x)}:00`)}</select><span>تا پایانِ ساعت</span><select data-c="wb" aria-label="تا ساعت">${opts(range(0, 23), c.win ? c.win[1] : 17, (x) => `${cPad(x)}`)}</select></div>`;
              } else if (mode === 'hours') {
                const c = cur || { n: 1, m: 0 };
                body = `<div class="st-cron-line"><span>هر</span><select data-c="n" aria-label="فاصله‌ی ساعت">${opts([1, 2, 3, 4, 6, 8, 12], c.n)}</select><span>ساعت، در دقیقه‌ی</span><select data-c="m" aria-label="دقیقه">${opts(minuteList(c.m), c.m)}</select></div>`;
              } else if (mode === 'daily') {
                const c = cur || { h: 8, m: 0, days: [0, 1, 2, 3, 4, 5, 6] };
                body = `<div class="st-cron-line"><span>ساعت</span><select data-c="h" aria-label="ساعت">${opts(range(0, 23), c.h, (x) => cPad(x))}</select><span>:</span><select data-c="m" aria-label="دقیقه">${opts(minuteList(c.m), c.m, (x) => cPad(x))}</select></div>
                  <div class="st-cron-days" role="group" aria-label="روزهای هفته">${CRON_DAYS.map(([d, n]) => `<label class="chk st-pill"><input type="checkbox" data-c="day" value="${d}"${c.days.includes(d) ? ' checked' : ''} /><span>${n}</span></label>`).join('')}<button type="button" class="st-cron-all" data-cron-all>همه‌ی روزها</button></div>`;
              } else {
                body = '<p class="st-cron-help">عبارت cron را مستقیم بنویسید: «دقیقه ساعت روز-ماه ماه روز-هفته». مثال: <bdi dir="ltr">0 17 * * *</bdi> یعنی هر روز ساعت ۱۷:۰۰. فیلد بالا ویرایش‌پذیر است.</p>';
              }
              panel.innerHTML = `<div class="st-cron-modes" role="tablist" aria-label="نوع زمان‌بندی">${MODES.map(([m, n]) => `<button type="button" role="tab" class="st-cron-mode" data-cron-mode="${m}" aria-selected="${m === mode}">${n}</button>`).join('')}</div><div class="st-cron-body">${body}</div>`;
            };
            const commit = (expr) => { raw.value = expr; raw.dispatchEvent(new Event('input', { bubbles: true })); paint(); };
            const read = () => {
              const g = (n) => $(`[data-c="${n}"]`, panel); const num = (n) => Number(g(n).value);
              if (mode === 'minutes') { const win = g('win').checked ? [Math.min(num('wa'), num('wb')), Math.max(num('wa'), num('wb'))] : null; return { mode, n: num('n'), win }; }
              if (mode === 'hours') return { mode, n: num('n'), m: num('m') };
              const days = $$('[data-c="day"]:checked', panel).map((c) => Number(c.value));
              return { mode, h: num('h'), m: num('m'), days: days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
            };
            btn.addEventListener('click', () => { panel.hidden = !panel.hidden; btn.setAttribute('aria-expanded', String(!panel.hidden)); btn.textContent = panel.hidden ? 'تغییر زمان' : 'بستن'; mode = cronParse(raw.value).mode; paint(); });
            panel.addEventListener('click', (e) => {
              const mb = e.target.closest('[data-cron-mode]');
              if (mb) {
                mode = mb.dataset.cronMode;
                if (mode === 'custom') { paint(); const r = raw; r.focus(); return; }
                const st = cronParse(raw.value).mode === mode ? cronParse(raw.value) : (mode === 'minutes' ? { mode, n: 5, win: null } : (mode === 'hours' ? { mode, n: 1, m: 0 } : { mode, h: 8, m: 0, days: [0, 1, 2, 3, 4, 5, 6] }));
                commit(cronBuild(st)); return;
              }
              if (e.target.closest('[data-cron-all]')) { $$('[data-c="day"]', panel).forEach((c) => { c.checked = true; }); commit(cronBuild(read())); }
            });
            panel.addEventListener('change', (e) => { if (e.target.matches('[data-c]')) commit(cronBuild(read())); });
            raw.addEventListener('input', () => { if (mode !== 'custom' && !panel.contains(document.activeElement)) mode = cronParse(raw.value).mode; txt.textContent = cronHuman(raw.value).text; sub.textContent = raw.value; box.classList.toggle('is-bad', cronHuman(raw.value).text === 'عبارت نامعتبر'); });
            paint();
          }

          function bind(g) {
            const card = $(`.st-panel[data-group="${CSS.escape(g)}"]`, page);
            AP.dates.mount(card); // H4: ساعت‌های تنظیمات (شروع/پایان کار و ...) قابل‌تایپ؛ بعد از هر repaint دوباره
            $$('.st-field', card).forEach((row) => {
              const it = byKey[row.dataset.row];
              const onChange = () => {
                drafts[it.key] = setRead(it, row);
                if (!isDirty(it)) delete drafts[it.key];
                row.classList.toggle('dirty', it.key in drafts);
                const tag = $('[data-dirty]', row);
                if (tag) tag.hidden = !(it.key in drafts);
                $$('.st-field[data-dep]', card).forEach((r) => { const d = byKey[r.dataset.row]; if (d) r.classList.toggle('st-inactive', !depMet(d)); });
                refreshSave(g);
                applyReset(g);
              };
              $$('input, select', row).forEach((el) => { el.addEventListener('input', onChange); el.addEventListener('change', onChange); });
              if (it.key in drafts) row.classList.add('dirty');
              if (it.type === 'cron') mountCron(row);
            });
            $$('[data-more]', card).forEach((b) => b.addEventListener('click', () => {
              const d = $(`#${CSS.escape(b.getAttribute('aria-controls'))}`, card);
              const open = b.getAttribute('aria-expanded') !== 'true';
              b.setAttribute('aria-expanded', String(open));
              const bt = $('.st-more-t', b); if (bt) bt.textContent = open ? 'بستن نکته' : 'نکته‌ی بیشتر';
              if (d) d.classList.toggle('open', open);
            }));
            $$('[data-reset]', card).forEach((b) => b.addEventListener('click', async () => {
              const it = byKey[b.dataset.reset];
              const reason = await AP.askReason({
                title: 'بازگشت به پیش‌فرض',
                message: `«${setShort(it)}» به مقدار پیش‌فرض (${setShow(it, it.default)}) برمی‌گردد. ${IMPACT_GROUPS.has(g) ? IMPACT_TEXT : ''}`,
                confirmText: 'بازگشت به پیش‌فرض',
              });
              if (reason === null) return;
              const r = await AP.attempt(() => AP.api(`/admin/settings/${encodeURIComponent(it.key)}/reset`, { method: 'POST', body: { reason } }), 'به پیش‌فرض برگشت.');
              if (!r) return;
              if (r.item) Object.assign(it, r.item);
              delete drafts[it.key];
              warnScheduler(r);
              repaint(g);
            }));
            $(`[data-save="${CSS.escape(g)}"]`, card).addEventListener('click', () => saveGroup(g));
            const discard = $(`[data-discard="${CSS.escape(g)}"]`, card);
            if (discard) discard.addEventListener('click', () => {
              items.filter((i) => i.group === g).forEach((i) => { delete drafts[i.key]; });
              repaint(g);
              applyReset(g);
            });
          }

          function warnScheduler(r) {
            if (r && r.scheduler && r.scheduler.reloaded === false && r.scheduler.reason === 'error') {
              AP.toast('تنظیم ذخیره شد ولی بازسازی زمان‌بندی خطا داد؛ تا ری‌استارت بعدی اعمال نمی‌شود.', true);
            }
          }

          async function saveGroup(g) {
            const dirty = items.filter((i) => i.group === g && isDirty(i));
            if (!dirty.length) return;
            // فاز B: خاموش‌کردن قابلیتِ سرپرست‌ها ⇒ هشدار صریح (فوری، و صف فقط برای ادمین‌ها)
            const capIt = dirty.find((i) => i.key === ST_CAP_KEY);
            const off = capIt ? stCapsTurnedOff(capIt, drafts[capIt.key]) : [];
            const capWarn = off.length ? ` خاموش می‌شود: ${off.map(stCapLabel).join('، ')}. ${ST_CAP_WARN}` : '';
            const reason = await AP.askReason({
              title: 'ذخیره‌ی تنظیمات',
              message: `${fmt.num(dirty.length)} تنظیم تغییر می‌کند: ${dirty.map(setShort).join('؛ ')}.${IMPACT_GROUPS.has(g) ? ` ${IMPACT_TEXT}` : ''}${capWarn}`,
              confirmText: 'ذخیره', placeholder: 'مثلاً: تغییر ساعت کار طبق ابلاغیه‌ی مدیریت',
            });
            if (reason === null) return;
            const saveBtn = $(`[data-save="${CSS.escape(g)}"]`, page);
            const saveLabel = saveBtn && $('.st-save-label', saveBtn);
            if (saveBtn) { saveBtn.disabled = true; saveBtn.setAttribute('aria-busy', 'true'); }
            if (saveLabel) saveLabel.textContent = 'در حال ذخیره…';
            const errors = [];
            let saved = 0;
            for (const it of dirty) {
              try {
                const r = await AP.api(`/admin/settings/${encodeURIComponent(it.key)}`, { method: 'PUT', body: { value: drafts[it.key], reason } });
                if (r.item) Object.assign(it, r.item);
                delete drafts[it.key];
                saved += 1;
                warnScheduler(r);
              } catch (err) { errors.push(err.message); }
            }
            repaint(g);
            const m = msgOf(g);
            if (errors.length) { m.className = 'form-msg err'; m.textContent = `${saved ? `${fmt.num(saved)} مورد ذخیره شد. ` : ''}ذخیره نشد — ${errors.join(' | ')}`; AP.toast(errors[0], true); }
            else { m.className = 'form-msg ok'; m.textContent = `${fmt.num(saved)} تنظیم ذخیره شد.`; AP.toast('تنظیمات ذخیره شد.'); }
          }

          // نمایش پنل‌ها: بدون عبارت جستجو فقط گروه فعال؛ با عبارت، هر گروهِ دارای نتیجه (draftها هیچ‌وقت پاک نمی‌شوند)
          function applyFilter() {
            const q = $('#set-q', page).value.trim().toLowerCase();
            let anyGroup = false;
            $$('.st-panel', page).forEach((card) => {
              let shown = 0;
              $$('.st-field', card).forEach((row) => {
                const it = byKey[row.dataset.row];
                const hit = !q || it.description.toLowerCase().includes(q) || (it.label || '').toLowerCase().includes(q) || it.key.toLowerCase().includes(q) || (it.hint || '').toLowerCase().includes(q) || (it.section || '').toLowerCase().includes(q);
                row.classList.toggle('hidden', !hit);
                if (hit) shown += 1;
                [$('.st-label > span', row), $('.st-sub', row)].forEach((el) => {
                  if (!el) return;
                  if (el.dataset.raw === undefined) el.dataset.raw = el.textContent;
                  const raw = el.dataset.raw; const at = q ? raw.toLowerCase().indexOf(q) : -1;
                  if (at < 0 && el.dataset.hl !== '1') return;
                  el.innerHTML = at < 0 ? esc(raw) : `${esc(raw.slice(0, at))}<mark class="st-mark">${esc(raw.slice(at, at + q.length))}</mark>${esc(raw.slice(at + q.length))}`;
                  el.dataset.hl = at < 0 ? '0' : '1';
                });
              });
              card.hidden = q ? shown === 0 : card.dataset.group !== active;
              const curTab = tabOf[card.dataset.group] !== undefined ? String(tabOf[card.dataset.group]) : (($('.st-tab', card) || { dataset: {} }).dataset.tab);
              $$('.st-tabs', card).forEach((t) => t.classList.toggle('hidden', !!q));
              $$('.st-group', card).forEach((gr) => {
                gr.classList.toggle('hidden', !!q && !$$('.st-field:not(.hidden)', gr).length);
                if (q) gr.classList.remove('st-tab-off'); else if (curTab !== undefined && gr.dataset.secIdx !== undefined && gr.querySelector('.st-group-head')) gr.classList.toggle('st-tab-off', String(gr.dataset.secIdx) !== curTab);
              });
              $$('details.st-adv', card).forEach((d) => { if (q) { const has = !!$('.st-field:not(.hidden)', d); d.open = has; d.classList.toggle('hidden', !has); } else d.classList.remove('hidden'); });
              const g = card.dataset.group;
              const cnt = $(`[data-count="${CSS.escape(g)}"]`, page);
              if (cnt) cnt.textContent = fmt.num(q ? shown : items.filter((i) => i.group === g).length);
              const nb = $(`[data-go="${CSS.escape(g)}"]`, page);
              if (nb) nb.classList.toggle('dim', !!q && shown === 0);
              if (shown) anyGroup = true;
            });
            $('#set-none', page).classList.toggle('hidden', anyGroup);
          }

          // مقدار کارت «مرتبط» از items/drafts زنده خوانده می‌شود؛ هنگام ورود به بخش یا ذخیره در بخش‌های دیگر تازه می‌شود
          function refreshRelated() {
            $$('[data-related]', page).forEach((ul) => { ul.innerHTML = relatedInner(ul.dataset.related); });
          }
          function showTab(g, idx) {
            tabOf[g] = idx;
            const card = $(`.st-panel[data-group="${CSS.escape(g)}"]`, page); if (!card) return;
            $$('.st-tab', card).forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === String(idx))));
            $$('.st-group', card).forEach((gr) => { if (gr.dataset.secIdx !== undefined && gr.querySelector('.st-group-head')) gr.classList.toggle('st-tab-off', String(gr.dataset.secIdx) !== String(idx)); });
          }
          function gotoSetting(key) {
            const it = byKey[key];
            if (!it) return;
            const q = $('#set-q', page);
            if (q) q.value = ''; // جستجوی فعال ردیف مقصد را پنهان نکند
            showGroup(it.group);
            const row = $(`.st-field[data-row="${CSS.escape(key)}"]`, page);
            if (!row) return;
            const grp = row.closest && row.closest('.st-group'); if (grp && grp.dataset && grp.dataset.secIdx !== undefined) showTab(it.group, grp.dataset.secIdx);
            const adv = row.closest && row.closest('details'); if (adv) adv.open = true;
            const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
            const ctl = $('input, select', row);
            if (ctl && typeof ctl.focus === 'function') ctl.focus({ preventScroll: true });
            row.classList.add('st-flash');
            setTimeout(() => row.classList.remove('st-flash'), 1800);
          }
          page.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-goto]');
            if (b) gotoSetting(b.dataset.goto);
            const tb = e.target.closest && e.target.closest('[data-tab]');
            if (tb) { const card = tb.closest('.st-panel'); if (card) showTab(card.dataset.group, tb.dataset.tab); }
            const j = e.target.closest && e.target.closest('[data-jump]');
            if (j) {
              const h = document.getElementById(j.dataset.jump); const grp = h && h.closest('.st-group');
              if (grp && grp.scrollIntoView) { const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; grp.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }); }
            }
          });

          function showGroup(g) {
            active = g;
            refreshRelated();
            $$('[data-go]', page).forEach((b) => {
              if (b.dataset.go === g) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
            });
            applyFilter();
            const tab = $(`[data-go="${CSS.escape(g)}"]`, page);
            if (tab && typeof tab.scrollIntoView === 'function') { // نوار تب افقی موبایل: تب فعال دیده شود (با کاهش حرکت بدون انیمیشن)
              const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              tab.scrollIntoView({ inline: 'center', block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
            }
            const h = $(`#st-h-${CSS.escape(g)}`, page);
            if (h) h.focus();
          }
          $$('[data-go]', page).forEach((b) => b.addEventListener('click', () => showGroup(b.dataset.go)));
          const auditBtn = $('[data-audit]', page);
          if (auditBtn) auditBtn.addEventListener('click', () => AP.go('audit'));

          groupKeys.forEach(bind);
          $('#set-q', page).addEventListener('input', applyFilter);
          // میان‌بر: «/» رفتن به جستجو، Esc پاک‌کردن جستجو، Ctrl/⌘+S ذخیره‌ی بخش فعلی
          const onKey = (e) => {
            if (!page.isConnected) { document.removeEventListener('keydown', onKey); return; }
            const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '');
            if (e.key === '/' && !typing) { e.preventDefault(); $('#set-q', page).focus(); return; }
            if (e.key === 'Escape' && e.target && e.target.id === 'set-q') { e.target.value = ''; applyFilter(); return; }
            if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
              const b = $(`[data-save="${CSS.escape(active)}"]`, page);
              if (b) { e.preventDefault(); if (!b.disabled) b.click(); }
            }
          };
          if (typeof document.addEventListener === 'function') document.addEventListener('keydown', onKey);
        },
      };
    },
  });

  // ======================================================
  // تعطیلات (S3-9b): لیست، افزودن/ویرایش (کامل/نیم‌روز، همه/دپارتمان)، حذف؛ همه با audit سمت سرور
  // ======================================================
  const holUi = { when: 'upcoming' };
  const localToday = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  AP.view('holidays', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'settings.edit',
    nav: { icon: 'attendance', label: 'تعطیلات', group: 'مدیریت' },
    async render() {
      const [all, users] = await Promise.all([AP.api('/admin/holidays'), AP.loadUsers()]);
      const today = localToday();
      const depts = [...new Set(users.map((u) => (u.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
      const rows = all.filter((h) => holUi.when === 'all' || (holUi.when === 'upcoming' ? h.holiday_date >= today : h.holiday_date < today));
      if (holUi.when === 'past') rows.reverse();
      const kindBadge = (h) => (h.kind === 'half' ? AP.badge('orange', `نیم‌روز تا ${h.half_end_time}`) : AP.badge('red', 'تعطیلی کامل'));
      const scopeText = (h) => (h.scope === 'department' ? `دپارتمان «${h.department}»` : 'همه‌ی کارمندان');

      const html = `
        <div class="view-header"><div><h2>تعطیلات</h2><div class="sub">تعطیلی کامل روز را غیرکاری می‌کند؛ نیم‌روز فقط ساعت پایان کار همان روز را زودتر می‌کند · ${fmt.num(all.length)} مورد ثبت‌شده</div></div>
          <div class="header-actions"><button class="btn ghost" id="hol-import">${icon('download')} ورود گروهی</button><button class="btn primary" id="hol-add">${icon('plus')} افزودن تعطیلی</button></div></div>
        <form class="filters" id="hol-filters"><label class="field"><span>نمایش</span>
          <select name="when">${[['upcoming', 'از امروز به بعد'], ['past', 'گذشته'], ['all', 'همه']].map(([v, l]) => `<option value="${v}"${holUi.when === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></form>
        <div class="card flush">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>تاریخ</th><th>عنوان</th><th>نوع</th><th>شامل</th><th></th></tr></thead><tbody>
          ${rows.map((h) => `<tr>
            <td>${esc(fmt.dateLong(h.holiday_date))}<div class="muted small ltr">${esc(h.holiday_date)}</div></td>
            <td>${esc(h.title)}</td><td>${kindBadge(h)}</td><td>${esc(scopeText(h))}</td>
            <td><div class="row-actions"><button class="btn ghost small" data-edit="${h.id}" aria-label="ویرایش">${icon('edit')}</button>
              <button class="btn danger small" data-del="${h.id}" aria-label="حذف">${icon('trash')}</button></div></td></tr>`).join('')}
          </tbody></table></div>` : emptyBox(all.length ? 'در این بازه تعطیلی‌ای نیست.' : 'تعطیلی ثبت نشده است.')}</div>`;

      function openForm(h) {
        const cur = h || { holiday_date: '', title: '', kind: 'full', half_end_time: '12:30', scope: 'all', department: '' };
        const deptList = cur.department && !depts.includes(cur.department) ? [...depts, cur.department] : depts;
        AP.modal({
          title: h ? 'ویرایش تعطیلی' : 'افزودن تعطیلی',
          body: `<form class="form" id="hol-form">
            <div class="form-grid">
              <label class="field"><span>تاریخ</span><input type="date" name="date" required value="${esc(cur.holiday_date)}" /></label>
              <label class="field"><span>عنوان</span><input name="title" required maxlength="100" value="${esc(cur.title)}" placeholder="مثلاً: عید فطر" /></label>
              <label class="field"><span>نوع</span><select name="kind"><option value="full"${cur.kind === 'full' ? ' selected' : ''}>تعطیلی کامل</option><option value="half"${cur.kind === 'half' ? ' selected' : ''}>نیم‌روز</option></select></label>
              <label class="field" data-half><span>ساعت پایان کار در نیم‌روز</span><input type="time" name="halfEndTime" value="${esc(cur.half_end_time || '12:30')}" dir="ltr" class="ltr-in" /></label>
              <label class="field"><span>شامل</span><select name="scope"><option value="all"${cur.scope === 'all' ? ' selected' : ''}>همه‌ی کارمندان</option><option value="department"${cur.scope === 'department' ? ' selected' : ''}>یک دپارتمان</option></select></label>
              <label class="field" data-dept><span>دپارتمان</span><select name="department">${deptList.length ? deptList.map((d) => `<option value="${esc(d)}"${d === cur.department ? ' selected' : ''}>${esc(d)}</option>`).join('') : '<option value="">— هیچ کاربری دپارتمان ندارد —</option>'}</select></label>
            </div>
            <div class="form-msg"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">${h ? 'ذخیره‌ی تغییرات' : 'افزودن'}</button><button class="btn ghost" type="button" data-cancel>انصراف</button></div>
          </form>`,
          onMount(body, m) {
            AP.dates.mount(body); // تاریخ تعطیلی شمسی (مقدار ارسالی همچنان میلادی)؛ ساعت پایان نیم‌روز LTR (S3-11b)
            const form = $('#hol-form', body);
            const sync = () => {
              $('[data-half]', form).classList.toggle('hidden', form.kind.value !== 'half');
              $('[data-dept]', form).classList.toggle('hidden', form.scope.value !== 'department');
            };
            form.kind.addEventListener('change', sync);
            form.scope.addEventListener('change', sync);
            sync();
            $('[data-cancel]', form).addEventListener('click', () => m.close());
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              const r = await AP.attempt(() => AP.api(h ? `/admin/holidays/${h.id}` : '/admin/holidays', { method: h ? 'PUT' : 'POST', body: f }), h ? 'تعطیلی ویرایش شد.' : 'تعطیلی اضافه شد.');
              if (!r) return;
              if (r.warning) AP.toast(r.warning, true);
              m.close();
              AP.refresh();
            });
          },
        });
      }


      // S3-9d: ورود گروهی. متن/CSV ⇒ پیش‌نمایش (بدون ذخیره) ⇒ تأیید. هر تغییر در متن، پیش‌نمایش را باطل می‌کند.
      const IMPORT_STATUS = { new: ['green', 'جدید'], duplicate: ['holiday', 'تکراری (قبلاً ثبت شده)'], duplicate_in_input: ['orange', 'تکرار در همین ورودی'], invalid: ['red', 'نامعتبر'] };
      const importKind = (r) => (r.kind === 'half' ? `نیم‌روز تا ${r.halfEndTime}` : 'کامل');
      function importReport(res) {
        const sm = res.summary;
        const head = `<div class="note${sm.invalid ? ' warn' : ''}"><span>${fmt.num(sm.total)} ردیف: ${fmt.num(sm.new)} جدید · ${fmt.num(sm.duplicate + sm.duplicateInInput)} تکراری (نادیده گرفته می‌شود) · ${fmt.num(sm.invalid)} نامعتبر${sm.invalid ? ' — تا اصلاح خطاها ثبت ممکن نیست.' : ''}</span></div>`;
        const body = res.rows.map((r) => {
          const [cls, label] = IMPORT_STATUS[r.status] || ['holiday', r.status];
          if (r.status === 'invalid') return `<tr><td>${fmt.num(r.line)}</td><td colspan="3" class="ltr">${esc(r.input)}</td><td>${AP.badge(cls, label)}<div class="form-msg err">${esc(r.error)}</div></td></tr>`;
          return `<tr><td>${fmt.num(r.line)}</td><td class="ltr">${esc(r.jalali)}<div class="muted small">${esc(r.date)}</div></td><td>${esc(r.title)}</td>
            <td>${esc(importKind(r))} · ${esc(r.scope === 'department' ? `دپارتمان «${r.department}»` : 'همه')}</td>
            <td>${AP.badge(cls, label)}${r.warning ? `<div class="form-msg err">${esc(r.warning)}</div>` : ''}</td></tr>`;
        }).join('');
        return `${head}<div class="table-wrap u-scroll-short"><table><thead><tr><th>خط</th><th>تاریخ</th><th>عنوان</th><th>نوع / شامل</th><th>وضعیت</th></tr></thead><tbody>${body}</tbody></table></div>`;
      }
      function openImport() {
        AP.modal({
          title: 'ورود گروهی تعطیلات', wide: true,
          body: `<form class="form" id="imp-form">
            <p class="muted small import-help">هر خط یک تعطیلی با <b>تاریخ شمسی</b>: <span class="ltr">1405/01/01 نوروز</span> یا CSV: <span class="ltr">1405/01/03,عنوان,نیم‌روز,11:30,دپارتمان</span>
              (ستون‌های نوع، ساعت پایان و دپارتمان اختیاری‌اند؛ خط‌های خالی و خط‌های شروع‌شده با # نادیده گرفته می‌شوند.)</p>
            <label class="field"><span>فهرست تعطیلات</span><textarea name="text" rows="8" dir="auto" placeholder="1405/01/01 نوروز&#10;1405/01/02 نوروز"></textarea></label>
            <label class="field"><span>یا فایل CSV / متنی</span><input type="file" name="file" accept=".csv,.txt,text/csv,text/plain" /></label>
            <div id="imp-report"></div>
            <div class="form-msg" id="imp-msg"></div>
            <div class="modal-actions"><button class="btn ghost" type="submit" id="imp-preview">پیش‌نمایش</button>
              <button class="btn primary" type="button" id="imp-commit" disabled>ثبت تعطیلی‌ها</button>
              <button class="btn ghost" type="button" data-cancel>انصراف</button></div></form>`,
          onMount(body, m) {
            const form = $('#imp-form', body);
            const report = $('#imp-report', body);
            const msg = $('#imp-msg', body);
            const commitBtn = $('#imp-commit', body);
            const setMsg = (t, cls = '') => { msg.className = `form-msg ${cls}`; msg.textContent = t; };
            const invalidate = () => { commitBtn.disabled = true; report.innerHTML = ''; setMsg(''); };
            const show = (res) => {
              report.innerHTML = importReport(res);
              commitBtn.disabled = !(res.summary.invalid === 0 && res.summary.new > 0);
              commitBtn.textContent = res.summary.new ? `ثبت ${fmt.num(res.summary.new)} تعطیلی` : 'ثبت تعطیلی‌ها';
              if (!res.summary.new && !res.summary.invalid) setMsg('همه‌ی ردیف‌ها قبلاً ثبت شده‌اند؛ چیزی برای ثبت نیست.');
            };
            const call = async (commit) => {
              const text = form.text.value;
              if (!text.trim()) { setMsg('متن یا فایل را وارد کنید.', 'err'); return null; }
              if (text.length > 90000) { setMsg('حجم ورودی زیاد است (حداکثر ۹۰هزار نویسه).', 'err'); return null; }
              try { return await AP.api('/admin/holidays/import', { method: 'POST', body: { text, commit } }); }
              catch (err) {
                if (err.data && err.data.rows) show(err.data);
                setMsg(err.message, 'err');
                return null;
              }
            };
            form.text.addEventListener('input', invalidate);
            form.file.addEventListener('change', async () => {
              const f = form.file.files[0];
              if (!f) return;
              if (f.size > 90000) { setMsg('فایل بزرگ است (حداکثر حدود ۹۰ کیلوبایت).', 'err'); form.file.value = ''; return; }
              form.text.value = await f.text();
              invalidate();
            });
            form.addEventListener('submit', async (e) => {
              e.preventDefault();
              setMsg('در حال بررسی…');
              const res = await call(false);
              if (res) { setMsg(''); show(res); }
            });
            commitBtn.addEventListener('click', async () => {
              commitBtn.disabled = true;
              const res = await call(true);
              if (!res) return;
              AP.toast(`${fmt.num(res.summary.added)} تعطیلی ثبت شد.`);
              m.close();
              AP.refresh();
            });
            $('[data-cancel]', form).addEventListener('click', () => m.close());
          },
        });
      }

      return {
        html,
        mount(page) {
          $('#hol-filters', page).addEventListener('change', (e) => { holUi.when = e.target.value; AP.refresh(); });
          $('#hol-add', page).addEventListener('click', () => openForm(null));
          $('#hol-import', page).addEventListener('click', openImport);
          $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => openForm(all.find((h) => String(h.id) === b.dataset.edit))));
          $$('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
            const h = all.find((x) => String(x.id) === b.dataset.del);
            if (!(await AP.confirmBox({ title: 'حذف تعطیلی', message: `تعطیلی «${h ? h.title : ''}» از تقویم حذف شود؟ روز پس از حذف مطابق تقویم عادی کاری حساب می‌شود.`, confirmText: 'حذف', danger: true }))) return;
            const ok = await AP.attempt(() => AP.api(`/admin/holidays/${b.dataset.del}`, { method: 'DELETE' }), 'حذف شد.');
            if (ok) AP.refresh();
          }));
        },
      };
    },
  });

  // ======================================================
  // گزارش رویدادها (Audit)
  // ======================================================
  // S4-2b: نمایش خوانای diff قبل/بعد برای ورودی‌های جدید (details استاندارد logChange: { entityType, entityId, changes, reason?, redacted? }).
  // هر چیز دیگر (ورودی قدیمی، متن ساده، JSON بدون changes) همان جعبه‌ی متنی قبلی است. همه‌ی مقدارها esc می‌شوند.
  const AU_ENTITY = { user: 'کاربر', attendance_record: 'رکورد تردد', break_record: 'استراحت', leave_request: 'مرخصی/مأموریت', holiday: 'تعطیلی', dispute: 'اعتراض', settings: 'تنظیمات', session: 'نشست', supervisor: 'سرپرست/تیم' };
  const AU_FIELD = {
    full_name: 'نام', personnel_code: 'کد پرسنلی', department: 'دپارتمان', role: 'نقش', manager_id: 'مدیر (شناسه)', is_active: 'وضعیت حساب', telegram_user_id: 'آیدی تلگرام',
    record_date: 'تاریخ رکورد', check_in_time: 'ورود', check_out_time: 'خروج', status: 'وضعیت', break_type: 'نوع استراحت', start_time: 'شروع', end_time: 'پایان',
    leave_type: 'نوع', start_date: 'از تاریخ', end_date: 'تا تاریخ', reason: 'دلیل درخواست', date: 'تاریخ', title: 'عنوان', kind: 'نوع', halfEndTime: 'پایان نیم‌روز', scope: 'دامنه',
    session_version: 'نسخه‌ی نشست', epoch: 'epoch سراسری', added: 'ثبت‌شده‌ها',
  };
  function auParse(details) {
    if (typeof details !== 'string' || details.charAt(0) !== '{') return null;
    try {
      const d = JSON.parse(details);
      return d && typeof d === 'object' && typeof d.entityType === 'string' && d.changes && typeof d.changes === 'object' && !Array.isArray(d.changes) ? d : null;
    } catch (_) { return null; }
  }
  function auVal(key, v) {
    if (v === null || v === undefined) return '<span class="muted">—</span>';
    let s;
    if (key === 'is_active') s = v ? 'فعال' : 'غیرفعال';
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (s.length > 200) s = `${s.slice(0, 200)}…`;
    return esc(s);
  }
  // نمایش خوانای JSON ساده‌ی بدون ساختار diff (مثل هشدارهای سیستمی): هر کلید یک «چیپ». ورودی‌های دیگر همان جعبه‌ی متنی می‌مانند.
  const AU_KEY = { employeeId: 'کارمند', userId: 'کاربر', lateCount: 'تعداد تأخیر', count: 'تعداد', days: 'روز', minutes: 'دقیقه', date: 'تاریخ', month: 'ماه', year: 'سال', reason: 'دلیل' };
  function auFlat(raw) {
    if (typeof raw !== 'string' || raw.charAt(0) !== '{') return null;
    try {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
      const keys = Object.keys(d);
      if (!keys.length || keys.length > 12) return null;
      return keys.every((k) => d[k] === null || ['string', 'number', 'boolean'].includes(typeof d[k])) ? d : null;
    } catch (_) { return null; }
  }
  // رنگ نشان رویداد بر اساس معنای نام (فقط ظاهر؛ مقدار ذخیره‌شده تغییری نمی‌کند)
  function auTone(action) {
    const a = String(action || '').toLowerCase();
    if (/delet|remov|reject|revok|reset|purge|fail|denied|block|lock/.test(a)) return 'red';
    if (/alert|late|warn|suspic|overtime|expire/.test(a)) return 'yellow';
    if (/creat|add|approv|import|grant|restor|login|open/.test(a)) return 'green';
    if (/updat|chang|edit|set|assign|move|sync|export/.test(a)) return 'blue';
    return 'gray';
  }
  function auDetailsHtml(raw) {
    const d = auParse(raw);
    if (!d) {
      const f = auFlat(raw);
      if (f) {
        return `<div class="au-chips">${Object.keys(f).map((k) => `<span class="au-chip"><span class="au-k">${esc(AU_KEY[k] || AU_FIELD[k] || k)}</span><span class="au-v">${f[k] === null ? '—' : esc(String(f[k]))}</span></span>`).join('')}</div>`;
      }
      return `<div class="details-box">${esc(raw || '')}</div>`;
    }
    const keys = Object.keys(d.changes);
    const rows = keys.map((k) => {
      const c = d.changes[k] || {};
      return `<div class="diff-row"><span class="diff-field">${esc(AU_FIELD[k] || k)}</span><span class="diff-before">${auVal(k, c.before)}</span><span class="diff-arrow">←</span><span class="diff-after">${auVal(k, c.after)}</span></div>`;
    }).join('');
    const redacted = Array.isArray(d.redacted) && d.redacted.length ? `<div class="diff-note">فیلد حساس تغییر کرد (مقدار ثبت نمی‌شود): <span class="ltr">${esc(d.redacted.join('، '))}</span></div>` : '';
    const reason = d.reason ? `<div class="diff-reason">دلیل: ${esc(d.reason)}</div>` : '';
    return `<div class="diff">
      <div class="diff-head">${esc(AU_ENTITY[d.entityType] || d.entityType)}${d.entityId !== null && d.entityId !== undefined ? ` <span class="ltr muted">#${esc(d.entityId)}</span>` : ''}</div>
      ${rows || '<div class="diff-note">بدون تغییر در فیلدها</div>'}${redacted}${reason}
      <details class="diff-raw"><summary>متن خام</summary><div class="details-box">${esc(raw)}</div></details></div>`;
  }

  const auUi = { userId: '', action: '', entityType: '', from: '', to: '', q: '', limit: 200 };
  AP.view('audit', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'audit.read',
    nav: { icon: 'audit', label: 'گزارش رویدادها', group: 'مدیریت' },
    async render() {
      const qs = new URLSearchParams(Object.entries(auUi).filter(([, v]) => v)).toString();
      const [rows, actions, users] = await Promise.all([AP.api(`/admin/audit-log?${qs}`), AP.api('/admin/audit-actions'), AP.loadUsers()]);
      const html = `
        <div class="view-header"><div><h2>گزارش رویدادها</h2><div class="sub">لاگ غیرقابل‌ویرایش همه‌ی عملیات حساس · ${fmt.num(rows.length)} مورد نمایش داده می‌شود</div></div>
          <div class="header-actions">${AP.exportBar({ path: '/api/admin/audit-log/export', params: auUi })}</div></div>
        <form class="filters" id="au-filters">
          <label class="field grow"><span>جستجو در جزئیات / IP</span><input type="search" name="q" value="${esc(auUi.q)}" /></label>
          <label class="field"><span>رویداد</span><select name="action"><option value="">همه</option>${actions.map((a) => `<option value="${esc(a.action)}" ${a.action === auUi.action ? 'selected' : ''}>${esc(a.action)} (${fmt.num(a.count)})</option>`).join('')}</select></label>
          <label class="field"><span>موجودیت</span><select name="entityType"><option value="">همه</option>${Object.keys(AU_ENTITY).map((k) => `<option value="${k}" ${k === auUi.entityType ? 'selected' : ''}>${esc(AU_ENTITY[k])}</option>`).join('')}</select></label>
          <label class="field"><span>کاربر</span><select name="userId"><option value="">همه</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === String(auUi.userId) ? 'selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select></label>
          ${AP.rangeBar.html({ from: auUi.from, to: auUi.to, label: 'بازه‌ی رویدادها', presets: ['today', '7', '30', 'month', 'lastMonth'] })}
          <label class="field"><span>تعداد</span><select name="limit">${[100, 200, 500, 1000].map((n) => `<option ${n === auUi.limit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </form>
        <div class="card flush"><div class="table-wrap"><table>
          <thead><tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>IP</th><th>جزئیات</th></tr></thead><tbody>
          ${rows.length ? rows.map((r) => `<tr><td class="num">${esc(fmt.dateTime(r.occurred_at))}</td><td>${esc(r.userFullName || '—')}</td>
            <td><span class="au-act au-act--${auTone(r.action)}">${esc(r.action)}</span></td><td><span class="ltr muted">${esc(r.ip_address || '—')}</span></td>
            <td class="wrap">${auDetailsHtml(r.details)}</td></tr>`).join('') : `<tr><td colspan="5">${emptyBox('رویدادی پیدا نشد.')}</td></tr>`}
          </tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#au-filters', page);
          AP.dates.mount(form); // از/تا تاریخ شمسی؛ قبل از بستن listenerها (S3-11b)
          AP.rangeBar.bind(form);
          let t;
          $$('input, select', form).forEach((el) => el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
            clearTimeout(t);
            t = setTimeout(() => { const f = AP.formData(form); Object.assign(auUi, f, { limit: Number(f.limit) }); AP.refresh().then(() => { const i = $('#au-filters input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, el.type === 'search' ? 450 : 0);
          }));
        },
      };
    },
  });

  // ======================================================
  // سیستم و پشتیبان‌گیری
  // ======================================================
  const fmtBytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const fmtUptime = (sec) => {
    const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
    return [d ? `${fmt.num(d)} روز` : '', h ? `${fmt.num(h)} ساعت` : '', `${fmt.num(m)} دقیقه`].filter(Boolean).join(' و ');
  };
  const TABLE_LABEL = { users: 'کاربران', attendance_records: 'رکوردهای تردد', break_records: 'استراحت‌ها', leave_requests: 'مرخصی/مأموریت', holidays: 'تعطیلات', record_disputes: 'اعتراض‌ها', audit_log: 'رویدادها', settings: 'تنظیمات ذخیره‌شده' };
  const yn = (v, yes, no) => (v ? AP.badge('green', yes) : AP.badge('red', no));

  AP.view('system', {
    skeleton: 'list', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'system.read',
    nav: { icon: 'system', label: 'سیستم و پشتیبان', group: 'مدیریت' },
    async render() {
      const s = await AP.api('/admin/system');
      const html = `
        <div class="view-header"><div><h2>سیستم و پشتیبان‌گیری</h2><div class="sub">وضعیت سرور، دیتابیس و اتصال‌ها</div></div>
          <div class="header-actions">${AP.can('system.manage') ? `<button type="button" class="btn danger" id="sys-revoke-all">خروج همه‌ی کاربران</button><a class="btn primary" href="/api/admin/system/backup" download>${icon('download')} دانلود نسخه‌ی پشتیبان دیتابیس</a>` : ''}</div></div>
        <div class="grid-2">
          <div class="card"><h3>سرور</h3><div class="kv">
            <div class="kv-row"><span>زمان سرور</span><span>${esc(fmt.dateTime(s.serverTime))}</span></div>
            <div class="kv-row"><span>منطقه‌ی زمانی</span><span class="ltr">${esc(s.timezone)}</span></div>
            <div class="kv-row"><span>مدت روشن بودن</span><span>${esc(fmtUptime(s.uptimeSeconds))}</span></div>
            <div class="kv-row"><span>Node.js</span><span class="ltr">${esc(s.nodeVersion)}</span></div>
            <div class="kv-row"><span>سیستم‌عامل</span><span class="ltr">${esc(s.platform)}</span></div>
            <div class="kv-row"><span>مصرف حافظه</span><span>${fmt.num(s.memoryMb)} مگابایت</span></div>
            <div class="kv-row"><span>محیط اجرا</span><span class="ltr">${esc(s.environment)}</span></div></div></div>
          <div class="card"><h3>اتصال‌ها و امنیت</h3><div class="kv">
            <div class="kv-row"><span>بات تلگرام</span><span>${yn(s.integration.botConfigured, 'متصل', 'توکن تنظیم نشده')}</span></div>
            <div class="kv-row"><span>نام کاربری بات</span><span class="ltr">${esc(s.integration.botUsername ? `@${s.integration.botUsername}` : '—')}</span></div>
            <div class="kv-row"><span>Mini App</span><span class="ltr">${esc(s.integration.miniAppUrl || '—')}</span></div>
            <div class="kv-row"><span>HTTPS مستقیم</span><span>${yn(s.integration.httpsDirect, 'فعال', 'غیرفعال')}</span></div>
            <div class="kv-row"><span>شبکه‌ی مجاز ثبت تردد</span><span class="ltr">${esc(s.integration.allowedNetworkCidr)}</span></div>
            <div class="kv-row"><span>TRUST_PROXY</span><span>${yn(!s.integration.trustProxy, 'خاموش (امن)', 'روشن')}</span></div>
            <div class="kv-row"><span>اعتبار نشست ادمین</span><span>${fmt.num(s.integration.sessionMaxAgeDays)} روز</span></div></div></div>
        </div>
        <div class="grid-2 mt">
          <div class="card"><h3>دیتابیس · ${esc(fmtBytes(s.database.sizeBytes))}</h3><div class="kv">
            ${Object.entries(s.database.tables).map(([k, v]) => `<div class="kv-row"><span>${esc(TABLE_LABEL[k] || k)}</span><span>${fmt.num(v)}</span></div>`).join('')}</div></div>
          <div class="card"><h3>زمان‌بندی کارها (Cron)</h3><div class="kv">
            ${Object.entries(s.cron || {}).map(([k, v]) => `<div class="kv-row"><span class="ltr muted">${esc(k)}</span><span class="ltr">${esc(v)}</span></div>`).join('')}</div></div>
        </div>`;
      return {
        html,
        mount(root) {
          const btn = $('#sys-revoke-all', root);
          if (!btn) return;
          btn.addEventListener('click', async () => {
            const reason = await AP.askReason({
              title: 'خروج همه‌ی کاربران', danger: true, confirmText: 'باطل‌کردن همه‌ی نشست‌ها',
              message: 'نشست ورود همه‌ی کاربران (ادمین‌ها، سرپرستان و کارمندان) به پنل باطل می‌شود و همه باید دوباره وارد شوند. نشست خود شما حفظ می‌شود.',
            });
            if (reason === null) return;
            await AP.attempt(() => AP.api('/admin/system/revoke-all-sessions', { method: 'POST', body: { reason } }), 'همه‌ی نشست‌ها باطل شد.');
          });
        },
      };
    },
  });

  // ======================================================
  // وضعیت سیستم (بخش ۲-ج۱): سلامت، Jobها، آخرین خطاها
  // ======================================================
  const STATUS_TEXT = { success: 'موفق', error: 'خطا', running: 'در حال اجرا', interrupted: 'نیمه‌تمام (ری‌استارت)' };
  const STATUS_CLS = { success: 'green', error: 'red', running: 'blue', interrupted: 'orange' };
  const healthBadge = (ok, yes, no) => AP.badge(ok ? 'green' : 'red', ok ? yes : no);

  // تاریخ میلادیِ سرور (YYYY-MM-DD) → نمایش شمسی؛ اگر jalali.js بارگذاری نشده بود همان مقدار
  const faIso = (iso) => (iso && window.Jalali && window.Jalali.formatIso ? window.Jalali.formatIso(iso) : iso);

  // ---- ناحیه‌ی خطر: ریست برنامه (B4) — فقط system.manage؛ همه‌ی گیت‌ها سمت سرور اعمال می‌شوند ----
  function resetZoneHtml(o) {
    const groups = o.groups.map((g) => `<label class="check"><input type="checkbox" name="rz-group" value="${esc(g.key)}" ${g.defaultSelected ? 'checked' : ''}> <span>${esc(g.label)}</span></label>`).join('');
    return `<div class="card danger-zone mt" id="reset-zone"><h3>ناحیه‌ی خطر: ریست برنامه</h3>
      <p class="muted">داده‌ی عملیاتی برای همیشه حذف می‌شود (کاربران، شیفت‌ها، تعطیلات، انواع مرخصی، تنظیمات و گزارش رویدادها حذف نمی‌شوند). پیش از اجرا یک بک‌آپ خودکار ساخته می‌شود و اگر ساخته نشود ریست انجام نخواهد شد.</p>
      ${o.locked ? `<div class="notice danger" role="alert">${AP.badge('red', 'قفل Go-Live')} ریست قفل است؛ فقط با ALLOW_DATA_RESET=true در .env ممکن می‌شود.</div>` : ''}
      <fieldset class="rz-groups"><legend>گروه‌های پاک‌سازی</legend>${groups}</fieldset>
      <label class="field"><span>فقط داده‌های قبل از تاریخ (اختیاری)</span><input type="date" id="rz-before" aria-label="تاریخ برش"></label>
      <div class="rz-actions"><button type="button" class="btn" id="rz-preview" ${o.locked ? 'disabled' : ''}>پیش‌نمایش (بدون حذف)</button></div>
      <div id="rz-result" aria-live="polite"></div></div>`;
  }

  function mountResetZone(root, o) {
    const zone = $('#reset-zone', root);
    if (!zone) return;
    const dps = AP.dates.mount(zone); // «قبل از تاریخ» با تقویم شمسی؛ مقدار میلادی از dp.getValue() خوانده می‌شود
    if (o.locked) return;
    const result = $('#rz-result', zone);
    const words = o.confirmWords || ['RESET', 'ریست'];
    const selected = () => $$('input[name=rz-group]:checked', zone).map((i) => i.value);
    const beforeDate = () => { const v = dps[0] ? dps[0].getValue() : ($('#rz-before', zone) || {}).value; return v || undefined; };
    const body = () => ({ groups: selected(), beforeDate: beforeDate() });

    $('#rz-preview', zone).addEventListener('click', async () => {
      if (!selected().length) { AP.toast('حداقل یک گروه را انتخاب کنید.', true); return; }
      const btn = $('#rz-preview', zone);
      btn.disabled = true; btn.setAttribute('aria-busy', 'true'); result.innerHTML = '<div class="muted">در حال محاسبه…</div>';
      let p;
      try { p = await AP.api('/admin/system/reset/preview', { method: 'POST', body: body() }); } catch (err) {
        result.innerHTML = `<div class="notice danger" role="alert">${esc(err.message)}</div>`;
        return;
      } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
      const rows = p.tables.map((t) => `<tr><td>${esc(t.label)}</td><td class="ltr">${esc(t.table)}</td><td>${fmt.num(t.count)}</td></tr>`).join('');
      result.innerHTML = `<h4>این‌ها حذف می‌شود${p.beforeDate ? ` (قبل از ${esc(faIso(p.beforeDate))})` : ''}</h4>
        <div class="table-wrap"><table><thead><tr><th>داده</th><th>جدول</th><th>تعداد</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><th colspan="2">جمع</th><th>${fmt.num(p.total)}</th></tr></tfoot></table></div>
        <label class="field"><span>برای تأیید عبارت RESET (یا «ریست») را بنویسید</span><input type="text" id="rz-confirm" autocomplete="off" dir="ltr" aria-label="عبارت تأیید"></label>
        <label class="field"><span>کد ۸ رقمی تأیید هویت (از بات تلگرام، گزینه‌ی ورود به پنل)</span><input type="text" id="rz-code" inputmode="numeric" maxlength="8" autocomplete="off" dir="ltr" aria-label="کد تأیید هویت"></label>
        <div class="rz-actions"><button type="button" class="btn danger" id="rz-run" disabled>ریست نهایی برنامه</button></div>
        <div id="rz-done" aria-live="polite"></div>`;
      const run = $('#rz-run', result); const c1 = $('#rz-confirm', result); const c2 = $('#rz-code', result);
      const ready = () => { run.disabled = !(words.includes(c1.value.trim()) && /^\d{8}$/.test(c2.value.trim())); };
      c1.addEventListener('input', ready); c2.addEventListener('input', ready);
      run.addEventListener('click', async () => {
        run.disabled = true; run.setAttribute('aria-busy', 'true');
        const done = $('#rz-done', result);
        done.innerHTML = '<div class="muted">در حال ریست… (بک‌آپ، پاک‌سازی، فشرده‌سازی)</div>';
        try {
          const r = await AP.api('/admin/system/reset', { method: 'POST', body: { ...body(), confirmText: c1.value.trim(), reauthCode: c2.value.trim() } });
          const lines = Object.entries(r.deleted).map(([k, v]) => `<div class="kv-row"><span class="ltr">${esc(k)}</span><span>${fmt.num(v)}</span></div>`).join('');
          done.innerHTML = `<div class="notice ok" role="status"><strong>ریست انجام شد.</strong> ${fmt.num(r.total)} ردیف حذف شد. بک‌آپ: <span class="ltr">${esc(r.backupFile)}</span></div><div class="kv">${lines}</div>`;
          AP.toast('ریست انجام شد.');
          c1.value = ''; c2.value = ''; c1.disabled = true; c2.disabled = true;
        } catch (err) {
          done.innerHTML = `<div class="notice danger" role="alert">${esc(err.message)}</div>`;
          run.removeAttribute('aria-busy'); c2.value = ''; ready();
        }
      });
    });
  }

  // پاک‌سازی بازه‌ایِ داده‌های گذشته: دامنه ثابت است و برخلاف ریست کامل،
  // هیچ گزینه‌ای برای افزودن جدول‌های دیگر ندارد.
  function historyPurgeHtml() {
    return `<div class="card danger-zone mt" id="history-purge-zone"><h3>پاک‌سازی داده‌های گذشته</h3>
      <p class="muted">فقط رکوردهای رفت‌وآمد و برنامه‌های هفتگیِ شروع‌شده در بازهٔ انتخابی حذف می‌شوند. استراحت‌ها، اعتراض‌ها، تأییدهای اضافه‌کاری، تسک‌ها و گزارش‌های روزانهٔ وابسته نیز برای حفظ یکپارچگی حذف می‌شوند؛ کاربران، مرخصی‌ها، تنظیمات، اعلان‌ها و گزارش‌های دیگر دست‌نخورده می‌مانند. پیش از اجرا یک بک‌آپ خودکار ساخته می‌شود.</p>
      <div class="form-grid two"><label class="field"><span>از تاریخ</span><input type="date" id="hp-from" aria-label="شروع بازهٔ پاک‌سازی"></label>
      <label class="field"><span>تا تاریخ</span><input type="date" id="hp-to" aria-label="پایان بازهٔ پاک‌سازی"></label></div>
      <div class="rz-actions"><button type="button" class="btn danger" id="hp-preview">بررسی داده‌های قابل حذف</button></div>
      <div id="hp-result" aria-live="polite"></div></div>`;
  }

  function mountHistoryPurge(root) {
    const zone = $('#history-purge-zone', root);
    if (!zone) return;
    const from = $('#hp-from', zone); const to = $('#hp-to', zone); const result = $('#hp-result', zone);
    const dps = AP.dates.mount(zone); // از/تا با تقویم شمسی؛ مقدار میلادی از dp.getValue() خوانده می‌شود (ترتیب = ترتیب DOM)
    const fromVal = () => (dps[0] ? dps[0].getValue() : from.value);
    const toVal = () => (dps[1] ? dps[1].getValue() : to.value);
    const body = () => ({ fromDate: fromVal(), toDate: toVal() });
    $('#hp-preview', zone).addEventListener('click', async () => {
      if (!fromVal() || !toVal()) { AP.toast('ابتدا و انتهای بازه را انتخاب کنید.', true); return; }
      if (fromVal() > toVal()) { AP.toast('تاریخ شروع نباید بعد از تاریخ پایان باشد.', true); return; }
      const button = $('#hp-preview', zone);
      button.disabled = true; button.setAttribute('aria-busy', 'true');
      result.innerHTML = '<div class="muted">در حال محاسبه…</div>';
      let preview;
      try { preview = await AP.api('/admin/system/history-purge/preview', { method: 'POST', body: body() }); } catch (err) {
        result.innerHTML = `<div class="notice danger" role="alert">${esc(err.message)}</div>`;
        return;
      } finally { button.disabled = false; button.removeAttribute('aria-busy'); }
      const rows = preview.tables.map((t) => `<tr><td>${esc(t.label)}</td><td class="ltr">${esc(t.table)}</td><td>${fmt.num(t.count)}</td></tr>`).join('');
      result.innerHTML = `<h4>داده‌های قابل حذف در بازهٔ ${esc(faIso(preview.fromDate))} تا ${esc(faIso(preview.toDate))}</h4>
        <div class="table-wrap"><table><thead><tr><th>داده</th><th>جدول</th><th>تعداد</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="2">جمع</th><th>${fmt.num(preview.total)}</th></tr></tfoot></table></div>
        <label class="field"><span>برای فعال‌شدن حذف، عبارت «حذف تاریخچه» را بنویسید</span><input type="text" id="hp-confirm" autocomplete="off" aria-label="عبارت تأیید حذف"></label>
        <div class="rz-actions"><button type="button" class="btn danger" id="hp-run" disabled>حذف نهایی داده‌های این بازه</button></div><div id="hp-done" aria-live="polite"></div>`;
      const confirm = $('#hp-confirm', result); const run = $('#hp-run', result);
      const ready = () => { run.disabled = confirm.value.trim() !== 'حذف تاریخچه'; };
      confirm.addEventListener('input', ready);
      run.addEventListener('click', async () => {
        const yes = await AP.confirmBox({
          title: 'تأیید پاک‌سازی داده‌ها',
          message: `مطمئنی می‌خواهید کل رکوردهای تردد و برنامه‌های هفتگیِ بازهٔ ${faIso(preview.fromDate)} تا ${faIso(preview.toDate)} حذف شوند؟ این عمل قابل بازگشت نیست.`,
          confirmText: 'بله، حذف کن', danger: true,
        });
        if (!yes) return;
        run.disabled = true; run.setAttribute('aria-busy', 'true');
        const done = $('#hp-done', result); done.innerHTML = '<div class="muted">در حال ساخت بک‌آپ و پاک‌سازی…</div>';
        try {
          const response = await AP.api('/admin/system/history-purge', { method: 'POST', body: { ...body(), confirmText: confirm.value.trim() } });
          const lines = Object.entries(response.deleted).map(([key, count]) => `<div class="kv-row"><span class="ltr">${esc(key)}</span><span>${fmt.num(count)}</span></div>`).join('');
          done.innerHTML = `<div class="notice ok" role="status"><strong>پاک‌سازی انجام شد.</strong> ${fmt.num(response.total)} ردیف حذف شد. بک‌آپ: <span class="ltr">${esc(response.backupFile)}</span></div><div class="kv">${lines}</div>`;
          AP.toast('داده‌های بازه پاک‌سازی شد.');
          confirm.value = ''; confirm.disabled = true;
        } catch (err) {
          done.innerHTML = `<div class="notice danger" role="alert">${esc(err.message)}</div>`;
          run.removeAttribute('aria-busy'); ready();
        }
      });
    });
  }

  AP.view('status', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'system.read',
    nav: { icon: 'alert', label: 'وضعیت سیستم', group: 'مدیریت' },
    async render() {
      const s = await AP.api('/admin/system/status');
      let resetOpts = null;
      if (AP.can('system.manage')) { try { resetOpts = await AP.api('/admin/system/reset/options'); } catch (_) { resetOpts = null; } }
      const c = s.checks;
      const bot = c.bot;
      const disk = c.disk;
      const backup = c.backup;
      const overall = s.status === 'ok' ? AP.badge('green', 'سالم') : AP.badge('red', 'نیازمند بررسی');

      const jobRows = s.jobs.map((j) => {
        const r = j.lastResult;
        return `<tr><td class="ltr">${esc(j.name)}</td><td class="ltr muted">${esc(j.cron || '—')}</td>
          <td>${r ? AP.badge(STATUS_CLS[r.status] || 'holiday', STATUS_TEXT[r.status] || r.status) : '<span class="muted">هنوز اجرا نشده</span>'}</td>
          <td>${esc(r ? fmt.dateTime(r.at) : '—')}</td><td>${esc(j.lastSuccessAt ? fmt.dateTime(j.lastSuccessAt) : '—')}</td>
          <td>${r && r.durationMs != null ? `${fmt.num(r.durationMs)} ms` : '—'}</td></tr>`;
      }).join('');

      const errRows = s.recentErrors.length
        ? s.recentErrors.map((e) => `<tr><td class="ltr">${esc(e.job_name)}</td><td>${esc(fmt.dateTime(e.finished_at || e.started_at))}</td><td class="u-break-word" dir="auto">${esc(e.error || '—')}</td></tr>`).join('')
        : '<tr><td colspan="3" class="muted u-center-pad">خطایی ثبت نشده است.</td></tr>';

      const alertsHtml = s.activeAlerts.length
        ? s.activeAlerts.map((a) => `<div class="kv-row"><span class="ltr">${esc(a.alert_key)}</span><span>${esc(a.detail || '')}</span></div>`).join('')
        : '<div class="muted health-empty">هشدار فعالی وجود ندارد.</div>';

      const html = `
        <div class="view-header"><div><h2>وضعیت سیستم</h2><div class="sub">سلامت دیتابیس، بات، دیسک، بک‌آپ و Jobها · آخرین بررسی ${esc(fmt.dateTime(s.checkedAt))}</div></div>
          <div class="header-actions">${overall}<button type="button" class="btn" id="st-refresh">تازه‌سازی</button></div></div>
        <div class="grid-2">
          <div class="card"><h3>سلامت</h3><div class="kv">
            <div class="kv-row"><span>دیتابیس (خواندن/نوشتن آزمایشی)</span><span>${healthBadge(c.db.ok, 'سالم', 'خطا')}${c.db.detail ? ` <span class="muted ltr">${esc(c.db.detail)}</span>` : ''}</span></div>
            <div class="kv-row"><span>ارتباط بات با تلگرام (polling)</span><span>${bot.applicable ? healthBadge(bot.ok, 'برقرار', 'قطع') : AP.badge('holiday', 'در این پروسه اجرا نمی‌شود')}</span></div>
            ${bot.applicable ? `<div class="kv-row"><span>آخرین ارتباط موفق</span><span>${esc(bot.lastSuccessAt ? fmt.dateTime(bot.lastSuccessAt) : '—')}</span></div>` : ''}
            ${bot.applicable && bot.lastError ? `<div class="kv-row"><span>آخرین خطای polling</span><span class="ltr u-break-word">${esc(bot.lastError)}</span></div>` : ''}
            <div class="kv-row"><span>فضای آزاد دیسک</span><span>${disk.freeMb != null ? `${healthBadge(disk.ok, 'کافی', 'کم')} <span class="ltr">${fmt.num(disk.freeMb)} / ${fmt.num(disk.totalMb)} MB</span>` : AP.badge('holiday', 'قابل‌اندازه‌گیری نیست')}</span></div>
            <div class="kv-row"><span>آخرین بک‌آپ</span><span>${backup.lastBackupAt ? `${esc(fmt.dateTime(backup.lastBackupAt))} (${fmt.num(backup.ageHours)} ساعت پیش)` : 'یافت نشد'}${backup.applicable ? ` ${healthBadge(backup.ok, 'به‌روز', 'قدیمی')}` : ' <span class="muted">(بررسی هشدار خاموش است)</span>'}</span></div>
            ${backup.suspect ? `<div class="kv-row"><span>فایل بک‌آپ مشکوک</span><span>${AP.badge('red', 'integrity_check ناموفق')} <span class="ltr">${esc(backup.suspect.file)}</span></span></div>` : ''}
            <div class="kv-row"><span>Jobهای ۷۲ ساعت اخیر</span><span>${healthBadge(c.jobs.ok, 'بدون شکست', `${fmt.num(c.jobs.failing.length)} شکست`)}</span></div></div></div>
          <div class="card"><h3>هشدارهای فعال</h3><div class="kv">${alertsHtml}</div>
            <p class="muted u-section-note">watchdog ${s.watchdog.enabled ? `هر چند دقیقه (<span class="ltr">${esc(s.watchdog.cron)}</span>) به ادمین‌ها در تلگرام هشدار می‌دهد؛ هشدار تکراریِ هر نوع حداکثر هر ${fmt.num(s.watchdog.throttleMinutes)} دقیقه` : 'خاموش است'}.</p></div>
        </div>
        <div class="card flush mt"><div class="u-panel-head"><h3>Jobهای زمان‌بندی‌شده</h3></div><div class="table-wrap"><table>
          <thead><tr><th>نام</th><th>Cron</th><th>آخرین نتیجه</th><th>زمان آخرین نتیجه</th><th>آخرین موفقیت</th><th>مدت</th></tr></thead><tbody>${jobRows}</tbody></table></div></div>
        <div class="card flush mt"><div class="u-panel-head"><h3>آخرین خطاهای Job</h3></div><div class="table-wrap"><table>
          <thead><tr><th>Job</th><th>زمان</th><th>خطا</th></tr></thead><tbody>${errRows}</tbody></table></div></div>${resetOpts ? `${historyPurgeHtml()}${resetZoneHtml(resetOpts)}` : ''}`;
      return {
        html,
        mount(root) {
          const btn = $('#st-refresh', root);
          if (btn) btn.addEventListener('click', () => AP.refresh());
          if (resetOpts) { mountHistoryPurge(root); mountResetZone(root, resetOpts); }
        },
      };
    },
  });
})();
