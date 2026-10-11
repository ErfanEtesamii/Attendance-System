// صفحه‌ی «نمودارها» (S5-7a): نمودارهای SVG سبک روی APIهای تحلیل S5-6 (کارمند ممنوع؛ سرپرست فقط تیم خودش؛ سرور اسکوپ را اعمال می‌کند).
// منطق ساخت نمودار در charts.js است (خالص و تست‌شده)؛ اینجا فقط فیلتر، فراخوانی و نمایش.
// هر نمودار مستقل بارگذاری می‌شود: خطا در یکی بقیه را خراب نمی‌کند. «هشدار الگوها» (S5-7c) هم یک کارت مستقل است (patterns.js).

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const C = window.AnalyticsCharts;
  const P = window.PatternWarnings;
  const J = window.Jalali;

  const ui = { year: null, month: null, department: '', granularity: 'week', groupBy: 'none' };

  function deps() {
    return { esc, num: fmt.num, fa: (s) => J.toFaDigits(s), min: fmt.min };
  }

  const cardError = (title, err) => `<figure class="chart-fig"><figcaption>${esc(title)}</figcaption><div class="empty">${AP.icon('alert')}${esc(err && err.message ? err.message : 'بارگذاری نمودار ناموفق بود.')}</div></figure>`;

  AP.view('analytics', {
    skeleton: 'cards', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'analytics.read',
    nav: { icon: 'reports', label: 'نمودارها', group: 'گزارش‌ها' },
    async render() {
      const today = J.toJalali(...fmt.today().split('-').map(Number));
      ui.year = ui.year || today.jy;
      ui.month = ui.month || today.jm;
      const users = await AP.loadUsers().catch(() => []);
      const departments = [...new Set(users.map((u) => (u.department || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
      const html = `
        <div class="view-header"><div><h2>نمودارها</h2><div class="sub">هر نمودار یک «جدول داده‌ها»ی معادل دارد؛ در انتها «هشدار الگوها» نشانه‌های آماری را با دلیل نشان می‌دهد (نه اتهام).</div></div></div>
        <form class="filters" id="an-filters">
          <label class="field"><span>سال</span><input type="number" name="year" min="1300" max="1500" value="${esc(ui.year)}" /></label>
          <label class="field"><span>ماه</span><select name="month">${J.MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${i + 1 === Number(ui.month) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${departments.map((x) => `<option ${x === ui.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <label class="field"><span>روند تأخیر</span><select name="granularity"><option value="week" ${ui.granularity === 'week' ? 'selected' : ''}>هفتگی (۱۲ هفته)</option><option value="month" ${ui.granularity === 'month' ? 'selected' : ''}>ماهانه (۱۲ ماه)</option></select></label>
          <label class="field"><span>گروه‌بندی روند</span><select name="groupBy"><option value="none" ${ui.groupBy === 'none' ? 'selected' : ''}>کل</option><option value="department" ${ui.groupBy === 'department' ? 'selected' : ''}>به‌تفکیک دپارتمان</option></select></label>
        </form>
        <div id="an-charts" class="chart-grid" aria-live="polite"><div class="loading"><div class="spinner"></div>در حال بارگذاری نمودارها…</div></div>`;
      return { html, mount: (page) => mount(page) };
    },
  });

  function mount(page) {
    const form = $('#an-filters', page);
    form.addEventListener('submit', (e) => e.preventDefault());
    $$('input, select', form).forEach((el) => el.addEventListener('change', () => { Object.assign(ui, AP.formData(form)); AP.refresh(); }));
    const box = $('#an-charts', page);
    const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
    const ym = { year: ui.year, month: ui.month };
    const dep = { department: ui.department };
    const d = deps();
    // [شناسه، آدرس API، سازنده‌ی نمودار از پاسخ، عنوان برای خطا]
    const jobs = [
      ['trend', `/admin/analytics/late-trend?${q({ granularity: ui.granularity, groupBy: ui.groupBy, ...dep })}`, (r) => C.lineChartHtml(C.fromLateTrend(r, d), d), 'روند نرخ تأخیر'],
      ['compare', `/admin/analytics/late-compare?${q({ ...ym, ...dep })}`, (r) => C.barChartHtml(C.fromLateCompare(r, d), d), 'مقایسه با ماه قبل'],
      ['overtime', `/admin/analytics/rankings?${q({ ...ym, metric: 'overtime', ...dep })}`, (r) => C.barChartHtml(C.fromRankings(r, d), d), 'رتبه‌ی اضافه‌کاری'],
      ['shortfall', `/admin/analytics/rankings?${q({ ...ym, metric: 'shortfall', ...dep })}`, (r) => C.barChartHtml(C.fromRankings(r, d), d), 'رتبه‌ی کسری'],
      ['rate', `/admin/analytics/attendance-rate?${q({ ...ym, groupBy: 'department', ...dep })}`, (r) => C.barChartHtml(C.fromAttendanceRate(r, d), d), 'نرخ حضور'],
      ['leave', `/admin/analytics/leave-by-type?${q({ ...ym, ...dep })}`, (r) => C.barChartHtml(C.fromLeaveByType(r, d), d), 'مرخصی به‌تفکیک نوع'],
      ['checkin', `/admin/analytics/checkin-distribution?${q(dep)}`, (r) => C.barChartHtml(C.fromCheckinDistribution(r, d), d), 'توزیع ساعت ورود'],
      ['patterns', `/admin/analytics/patterns?${q({ ...ym, ...dep })}`, (r) => P.patternsHtml(r, d), 'هشدار الگوها'],
    ];
    // جای هر نمودار از قبل رزرو می‌شود تا ترتیب ثابت بماند، هرچند پاسخ‌ها نامرتب برسند
    box.innerHTML = jobs.map(([id]) => `<div class="chart-slot" data-chart="${id}"><div class="loading"><div class="spinner"></div></div></div>`).join('');
    const token = AP.currentRoute;
    jobs.forEach(async ([id, url, build, title]) => {
      let out;
      try { out = build(await AP.api(url)); } catch (err) { out = cardError(title, err); }
      if (AP.currentRoute !== token) return; // کاربر صفحه را عوض کرده
      const slot = $(`[data-chart="${id}"]`, box);
      if (slot) slot.innerHTML = out;
    });
  }
})();
