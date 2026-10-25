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
        <div id="an-charts" class="chart-grid" aria-live="polite">${window.UiStates.skeletonHtml('cards', { label: 'در حال بارگذاری نمودارها…' })}</div>`;
      return { html, mount: (page) => mount(page) };
    },
  });

  function mount(page) {
    const form = $('#an-filters', page);
    form.addEventListener('submit', (e) => e.preventDefault());
    $$('input, select', form).forEach((el) => el.addEventListener('change', () => { Object.assign(ui, AP.formData(form)); AP.refresh(); }));
    const box = $('#an-charts', page);
    C.mountInteractiveCharts(box);
    const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
    const ym = { year: ui.year, month: ui.month };
    const dep = { department: ui.department };
    const d = deps();
    // نقشه‌ی حرارتی: ردیف = روز هفته (شنبه تا جمعه)، ستون = ساعت؛ هر خانه جمعِ ورودهای همان ساعت است. ساعت‌های خالیِ ابتدا و انتها حذف می‌شوند.
    const heatmap = (r) => {
      const ORDER = [6, 0, 1, 2, 3, 4, 5]; // شنبه … جمعه (داده: ۰=یکشنبه … ۶=شنبه)
      const NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
      const fa = d.fa;
      const hourly = (r.cells || []).map((row) => Array.from({ length: 24 }, (_, h) => (row || []).slice(h * 4, h * 4 + 4).reduce((a, b) => a + (b || 0), 0)));
      const total = hourly.flat().reduce((a, b) => a + b, 0);
      if (!total) return '<figure class="chart-fig"><figcaption>نقشه حرارتی ساعت ورود</figcaption><div class="empty">داده‌ای برای نمایش نیست.</div></figure>';
      const used = hourly.flatMap((row) => row.map((c, h) => (c ? h : -1))).filter((h) => h >= 0);
      const lo = Math.max(0, Math.min(...used) - 1);
      const hi = Math.min(23, Math.max(...used) + 1);
      const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      const max = Math.max(...hourly.flat());
      const hh = (h) => `${fa(String(h).padStart(2, '0'))}:۰۰`;
      let peak = { c: -1 };
      const rows = ORDER.map((wd) => {
        const row = hourly[wd] || Array(24).fill(0);
        const sum = row.reduce((a, b) => a + b, 0);
        const cells = hours.map((h) => {
          const c = row[h];
          if (c > peak.c) peak = { c, wd, h };
          const lvl = c ? Math.min(5, Math.max(1, Math.ceil((c / max) * 5))) : 0;
          return `<span class="heat-cell" data-level="${lvl}" title="${NAMES[wd]}، ${hh(h)} تا ${hh(h + 1)} — ${fa(c)} ورود">${c ? fa(c) : ''}</span>`;
        }).join('');
        return `${cells}<span class="heat-day"><b>${NAMES[wd]}</b><small>${fa(sum)} ورود</small></span>`;
      }).join('');
      const axis = `${hours.map((h) => `<span class="heat-hour">${fa(String(h).padStart(2, '0'))}</span>`).join('')}<span></span>`;
      const legend = [0, 1, 2, 3, 4, 5].map((l) => `<span class="heat-cell heat-key" data-level="${l}"></span>`).join('');
      return `<figure class="chart-fig heat-fig"><figcaption>نقشه حرارتی ساعت ورود <small class="heat-sub">۳۰ روز اخیر</small></figcaption>
        <div class="heat-summary"><span class="heat-pill">شلوغ‌ترین زمان: <b>${NAMES[peak.wd]}، ${hh(peak.h)} تا ${hh(peak.h + 1)}</b></span><span class="heat-pill">${fa(peak.c)} ورود در همان ساعت</span><span class="heat-pill">مجموع: ${fa(total)} ورود</span></div>
        <div class="heat-scroll"><div class="heatmap" role="img" aria-label="شدت ورودها در روزهای هفته و ساعت‌های روز؛ شلوغ‌ترین زمان ${NAMES[peak.wd]} ${hh(peak.h)}" data-heat-cols="${hours.length}">${rows}${axis}</div></div>
        <div class="heat-legend"><span>کم</span>${legend}<span>زیاد</span></div>
        <p class="chart-note">هر خانه تعداد ورودها در همان ساعت از روز است؛ هرچه رنگ پررنگ‌تر (و در بالاترین سطح نارنجی) باشد ورود بیشتری رخ داده است. خانه‌ی خالی یعنی ورودی ثبت نشده.</p></figure>`;
    };
    // [شناسه، آدرس API، سازنده‌ی نمودار از پاسخ، عنوان برای خطا]
    const jobs = [
      ['trend', `/admin/analytics/late-trend?${q({ granularity: ui.granularity, groupBy: ui.groupBy, ...dep })}`, (r) => C.lineChartHtml(C.fromLateTrend(r, d), d), 'روند نرخ تأخیر'],
      ['compare', `/admin/analytics/late-compare?${q({ ...ym, ...dep })}`, (r) => C.barChartHtml(C.fromLateCompare(r, d), d), 'مقایسه با ماه قبل'],
      ['overtime', `/admin/analytics/rankings?${q({ ...ym, metric: 'overtime', ...dep })}`, (r) => C.barChartHtml(C.fromRankings(r, d), d), 'رتبه‌ی اضافه‌کاری'],
      ['shortfall', `/admin/analytics/rankings?${q({ ...ym, metric: 'shortfall', ...dep })}`, (r) => C.barChartHtml(C.fromRankings(r, d), d), 'رتبه‌ی کسری'],
      ['rate', `/admin/analytics/attendance-rate?${q({ ...ym, groupBy: 'department', ...dep })}`, (r) => C.barChartHtml(C.fromAttendanceRate(r, d), d), 'نرخ حضور'],
      ['leave', `/admin/analytics/leave-by-type?${q({ ...ym, ...dep })}`, (r) => C.barChartHtml(C.fromLeaveByType(r, d), d), 'مرخصی به‌تفکیک نوع'],
      ['checkin', `/admin/analytics/checkin-distribution?${q(dep)}`, (r) => C.barChartHtml(C.fromCheckinDistribution(r, d), d), 'توزیع ساعت ورود'],
      ['heatmap', `/admin/analytics/checkin-heatmap?${q(dep)}`, heatmap, 'نقشه حرارتی ورود'],
      ['patterns', `/admin/analytics/patterns?${q({ ...ym, ...dep })}`, (r) => P.patternsHtml(r, d), 'هشدار الگوها'],
    ];
    // جای هر نمودار از قبل رزرو می‌شود تا ترتیب ثابت بماند، هرچند پاسخ‌ها نامرتب برسند
    box.innerHTML = jobs.map(([id]) => `<div class="chart-slot" data-chart="${id}">${window.UiStates.skeletonHtml('cards', { rows: 2, label: 'در حال بارگذاری نمودار…' })}</div>`).join('');
    const token = AP.currentRoute;
    jobs.forEach(async ([id, url, build, title]) => {
      let out;
      try { out = build(await AP.api(url)); } catch (err) { out = cardError(title, err); }
      if (AP.currentRoute !== token) return; // کاربر صفحه را عوض کرده
      const slot = $(`[data-chart="${id}"]`, box);
      if (slot) {
        slot.innerHTML = out;
        $$('[data-heat-cols]', slot).forEach((el) => el.style.setProperty('--heat-cols', el.dataset.heatCols));
      }
    });
  }
})();
