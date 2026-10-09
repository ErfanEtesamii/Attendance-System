// S4-14b: UI تقویم تیم (شبکه‌ی ماهانه) روی API S4-14a (GET /admin/calendar?year=&month= ؛ ماه شمسی).
//   • ردیف = کارمند، ستون = روز ماه. هر سلول «رنگ + نماد + متن» دارد (نماد داخل سلول، متن در title/aria-label و راهنما)،
//     پس معنی فقط به رنگ وابسته نیست.
//   • فیلتر دپارتمان/نفر سمت UI روی همان پاسخ ماه اعمال می‌شود (بدون درخواست دوباره)؛ فقط تغییر ماه API را دوباره می‌خواند.
//   • هشدار هم‌زمانی: روزی که تعداد «مرخصی/مأموریتِ تمام‌روز» در بین افراد «نمایش‌داده‌شده» از آستانه‌ی تنظیم
//     teamCalendarMaxConcurrent بیشتر شود (۰ = خاموش؛ آستانه را API در maxConcurrent می‌دهد).
//   • کلیک روی سلول: مودال جزئیات از داده‌ی همان پاسخ (بدون درخواست اضافه).
// فقط نمایش است: اسکوپ نقش و مجوز (dashboard.read) را سرور اعمال می‌کند؛ پنهان‌بودن منو امنیت نیست.

(function () {
  'use strict';
  const AP = window.AP;
  const { $, esc, fmt } = AP;
  const J = window.Jalali;
  const icon = (n) => AP.icon(n);
  const fa = (n) => J.toFaDigits(n);
  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  // وضعیت‌های API ⇒ نماد/برچسب/کلاس. «future» عمداً بی‌نماد است (سلول کم‌رنگ).
  const STATUS = {
    present: { sym: '✓', label: 'حاضر', cls: 'present' },
    late: { sym: 'ت', label: 'تأخیر', cls: 'late' },
    incomplete: { sym: '!', label: 'ناقص (بدون خروج)', cls: 'incomplete' },
    absent: { sym: '✕', label: 'غایب', cls: 'absent' },
    leave: { sym: 'م', label: 'مرخصی', cls: 'leave' },
    mission: { sym: 'ما', label: 'مأموریت', cls: 'mission' },
    holiday: { sym: 'ط', label: 'تعطیل', cls: 'holiday' },
    weekend: { sym: '–', label: 'آخر هفته', cls: 'weekend' },
    pending: { sym: '…', label: 'امروز؛ هنوز ورودی ثبت نشده', cls: 'pending' },
    future: { sym: '', label: 'روز آینده', cls: 'future' },
  };
  const LEGEND = ['present', 'late', 'incomplete', 'absent', 'leave', 'mission', 'holiday', 'weekend', 'pending'];
  const OFF = ['leave', 'mission']; // وضعیت‌هایی که در شمارش هم‌زمانی می‌آیند (مرخصی/مأموریت تمام‌روز)
  const statusOf = (s) => STATUS[s] || { sym: '?', label: String(s || '—'), cls: 'future' };

  // سال/ماه شمسی انتخاب‌شده؛ بین رندرها می‌ماند (مثل بقیه‌ی صفحه‌ها)
  const calUi = { year: 0, month: 0, department: '', userId: '' };
  function ensureMonth() {
    if (calUi.year) return;
    const j = J.isoToJalali(fmt.today());
    calUi.year = j.jy;
    calUi.month = j.jm;
  }
  const YEAR_MIN = 1300; // هم‌مرز اعتبارسنجی API
  const YEAR_MAX = 1500;
  function stepMonth(delta) {
    let y = calUi.year;
    let m = calUi.month + delta;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    if (y < YEAR_MIN || y > YEAR_MAX) return false;
    calUi.year = y;
    calUi.month = m;
    return true;
  }

  // ---------- مدل نمایش (خالص: فقط از پاسخ API + فیلترها) ----------
  const deptOf = (row) => String((row.user && row.user.department) || '').trim();

  function viewModel(data) {
    const rows = Array.isArray(data.users) ? data.users : [];
    const departments = [...new Set(rows.map(deptOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fa'));
    if (calUi.department && !departments.includes(calUi.department)) calUi.department = '';
    const inDept = rows.filter((r) => !calUi.department || deptOf(r) === calUi.department);
    if (calUi.userId && !inDept.some((r) => String(r.user.id) === String(calUi.userId))) calUi.userId = '';
    const visible = inDept.filter((r) => !calUi.userId || String(r.user.id) === String(calUi.userId));
    const dayCount = rows.length && rows[0].days ? rows[0].days.length : 0;
    // هم‌زمانی فقط وقتی معنی دارد که بیش از یک نفر دیده شود
    const counts = [];
    for (let i = 0; i < dayCount; i += 1) {
      counts.push(visible.length > 1 ? visible.filter((r) => r.days[i] && OFF.includes(r.days[i].status)).length : 0);
    }
    const max = Math.max(0, parseInt(data.maxConcurrent, 10) || 0);
    const over = max > 0 ? counts.map((c, i) => (c > max ? i : -1)).filter((i) => i >= 0) : [];
    return { rows, departments, inDept, visible, dayCount, counts, max, over };
  }

  // ---------- HTML ----------
  const dayNumber = (dateStr) => J.isoToJalali(dateStr).jd;

  function cellTitle(row, cell) {
    const st = statusOf(cell.status);
    const parts = [row.user.fullName, fmt.dateFull(cell.date), st.label];
    if (cell.status === 'late' && cell.lateMinutes) parts.push(`${fmt.min(cell.lateMinutes)} تأخیر`);
    if (cell.holidayTitle) parts.push(cell.holidayTitle);
    if (cell.leave && cell.leave.unit !== 'day') parts.push(`${AP.LEAVE_TYPE[cell.leave.kind] || 'مرخصی'} ${unitText(cell.leave)}`);
    return parts.join(' — ');
  }

  function unitText(l) {
    if (!l) return '';
    if (l.unit === 'half_day') return l.halfDayPart === 'afternoon' ? 'نیم‌روز عصر' : 'نیم‌روز صبح';
    if (l.unit === 'hour') return `ساعتی (${fa(l.startTime || '؟')} تا ${fa(l.endTime || '؟')})`;
    return 'تمام‌روز';
  }

  function cellHtml(row, cell, index) {
    const st = statusOf(cell.status);
    const partial = cell.leave && cell.leave.unit !== 'day' ? ' cal-part' : '';
    const title = cellTitle(row, cell);
    return `<td><button type="button" class="cal-cell cal-${esc(st.cls)}${partial}" data-u="${esc(row.user.id)}" data-i="${index}" title="${esc(title)}" aria-label="${esc(title)}">${esc(st.sym)}</button></td>`;
  }

  function gridHtml(vm) {
    const { visible, dayCount, counts, max, over } = vm;
    if (!visible.length) return `<div class="card">${emptyBox('کارمندی با این فیلتر وجود ندارد.')}</div>`;
    const today = fmt.today();
    const first = visible[0].days;
    const head = first.map((c, i) => {
      const allOff = visible.every((r) => r.days[i] && r.days[i].isWorkingDay === false);
      const title = (visible.map((r) => r.days[i] && r.days[i].holidayTitle).find(Boolean)) || '';
      const wd = J.weekdayName(c.date);
      return `<th class="cal-day${allOff ? ' cal-off' : ''}${c.date === today ? ' cal-today' : ''}"${title ? ` title="${esc(title)}"` : ''}><span class="cal-d">${fa(dayNumber(c.date))}</span><span class="cal-w">${esc(wd ? wd.charAt(0) : '')}</span></th>`;
    }).join('');
    const body = visible.map((r) => {
      const u = r.user;
      return `<tr class="${u.isActive ? '' : 'inactive'}"><td class="cal-name"><div class="cell-user">${AP.avatar(u.fullName, 'sm')}<div><b><a href="#/profile/${esc(u.id)}" style="color:inherit">${esc(u.fullName)}</a>${u.isActive ? '' : ' <small>(غیرفعال)</small>'}</b><small>${esc(u.department || '')}</small></div></div></td>${r.days.map((c, i) => cellHtml(r, c, i)).join('')}</tr>`;
    }).join('');
    const sum = visible.length > 1
      ? `<tfoot><tr class="cal-sum"><td class="cal-name">هم‌زمان مرخصی/مأموریت</td>${counts.map((c, i) => {
        const isOver = over.includes(i);
        const t = isOver ? `بیش از ${fmt.num(max)} نفر هم‌زمان (${fmt.num(c)} نفر)` : (c ? `${fmt.num(c)} نفر` : '');
        return `<td class="${isOver ? 'cal-over' : ''}"${t ? ` title="${esc(t)}"` : ''}>${isOver ? '▲' : ''}${c ? fa(c) : ''}</td>`;
      }).join('')}</tr></tfoot>` : '';
    return `<div class="table-wrap cal-wrap"><table class="cal-table"><thead><tr><th class="cal-name">کارمند</th>${head}</tr></thead><tbody>${body}</tbody>${sum}</table></div>`;
  }

  function warnHtml(vm) {
    if (!vm.over.length) return '';
    const first = vm.visible[0].days;
    const days = vm.over.map((i) => fa(dayNumber(first[i].date))).join('، ');
    return `<div class="cal-warn" role="alert">${icon('alert')}<div>هشدار هم‌زمانی: در ${fmt.num(vm.over.length)} روز بیش از ${fmt.num(vm.max)} نفر هم‌زمان مرخصی یا مأموریت دارند (روزهای ${days}).</div></div>`;
  }

  const legendHtml = () => `<div class="cal-legend" aria-label="راهنمای نمادها">${LEGEND.map((k) => {
    const s = STATUS[k];
    return `<span><i class="cal-swatch cal-${esc(s.cls)}">${esc(s.sym)}</i>${esc(s.label)}</span>`;
  }).join('')}<span><i class="cal-swatch cal-leave cal-part"></i>مرخصی نیم‌روز/ساعتی (نقطه‌ی گوشه)</span></div>`;

  const optionsHtml = (items, selected, allLabel) => `${allLabel == null ? '' : `<option value="">${esc(allLabel)}</option>`}${items.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  const peopleOptions = (vm) => optionsHtml(vm.inDept.map((r) => [r.user.id, r.user.fullName]), calUi.userId, 'همه');

  // ---------- مودال جزئیات یک سلول ----------
  function openDetail(row, cell) {
    const st = statusOf(cell.status);
    const kv = [];
    kv.push(['وضعیت', AP.badge(st.cls, st.label)]);
    kv.push(['نوع روز', esc(cell.isWorkingDay ? 'کاری' : (cell.isHoliday ? 'تعطیل رسمی' : 'غیرکاری'))]);
    if (cell.holidayTitle) kv.push(['مناسبت', esc(cell.holidayTitle)]);
    kv.push(['رکورد تردد', esc(cell.hasRecord ? 'دارد' : 'ندارد')]);
    if (cell.lateMinutes) kv.push(['تأخیر', esc(fmt.min(cell.lateMinutes))]);
    if (cell.leave) {
      kv.push([AP.LEAVE_TYPE[cell.leave.kind] || 'مرخصی', esc(unitText(cell.leave))]);
    }
    AP.modal({
      title: `${row.user.fullName} — ${fmt.dateFull(cell.date)}`,
      body: `<div class="kv">${kv.map(([k, v]) => `<div class="kv-row"><span>${esc(k)}</span><span>${v}</span></div>`).join('')}</div>
        <div class="modal-actions" style="margin-top:14px"><a class="btn ghost small" href="#/profile/${esc(row.user.id)}" data-close-x>پروفایل کارمند</a></div>`,
      onMount(b, h) {
        const a = $('[data-close-x]', b);
        if (a) a.addEventListener('click', () => h.close());
      },
    });
  }

  AP.view('teamCalendar', {
    perm: 'dashboard.read',
    nav: { icon: 'calendar', label: 'تقویم تیم', group: 'نمای کلی' },
    async render() {
      ensureMonth();
      const data = await AP.api(`/admin/calendar?year=${calUi.year}&month=${calUi.month}`);
      const vm = viewModel(data);
      const label = data.label || `${J.MONTH_NAMES[calUi.month - 1]} ${calUi.year}`;
      const monthSel = J.MONTH_NAMES.map((n, i) => [i + 1, n]);
      const years = [];
      for (let y = Math.max(YEAR_MIN, calUi.year - 3); y <= Math.min(YEAR_MAX, calUi.year + 3); y += 1) years.push([y, fa(y)]);
      const sub = vm.max > 0
        ? `هشدار هم‌زمانی: بیش از ${fmt.num(vm.max)} نفر`
        : 'هشدار هم‌زمانی خاموش است (تنظیم <span class="ltr">teamCalendarMaxConcurrent</span>)';

      const html = `
        <div class="view-header"><div><h2>تقویم تیم</h2><div class="sub">${esc(label)} · ${fmt.num(vm.rows.length)} نفر · ${sub}</div></div></div>
        <div class="cal-bar" id="cal-nav">
          <button type="button" class="btn ghost small" data-nav="-1">ماه قبل</button>
          <select id="cal-month" aria-label="ماه">${optionsHtml(monthSel, calUi.month)}</select>
          <select id="cal-year" aria-label="سال">${optionsHtml(years, calUi.year)}</select>
          <button type="button" class="btn ghost small" data-nav="1">ماه بعد</button>
          <button type="button" class="btn ghost small" data-nav="today">این ماه</button>
        </div>
        <div class="filters" id="cal-filters">
          <label class="field"><span>دپارتمان</span><select id="cal-dept" name="department">${optionsHtml(vm.departments.map((d) => [d, d]), calUi.department, 'همه')}</select></label>
          <label class="field"><span>کارمند</span><select id="cal-user" name="userId">${peopleOptions(vm)}</select></label>
        </div>
        ${legendHtml()}
        <div id="cal-warn">${warnHtml(vm)}</div>
        <div id="cal-grid">${gridHtml(vm)}</div>`;

      return {
        html,
        mount(page) {
          const grid = $('#cal-grid', page);
          const warn = $('#cal-warn', page);
          let model = vm;
          const redraw = () => {
            model = viewModel(data);
            if (warn) warn.innerHTML = warnHtml(model);
            if (grid) grid.innerHTML = gridHtml(model);
          };
          const go = () => AP.refresh();

          $('#cal-nav', page).addEventListener('click', (e) => {
            const b = e.target.closest('[data-nav]');
            if (!b) return;
            if (b.dataset.nav === 'today') {
              const j = J.isoToJalali(fmt.today());
              calUi.year = j.jy; calUi.month = j.jm;
            } else if (!stepMonth(Number(b.dataset.nav))) {
              AP.toast('خارج از بازه‌ی سال‌های پشتیبانی‌شده است.', true);
              return;
            }
            go();
          });
          const pick = (sel, apply) => {
            const el = $(sel, page);
            if (el) el.addEventListener('change', () => { apply(el.value); go(); });
          };
          pick('#cal-month', (v) => { calUi.month = Number(v); });
          pick('#cal-year', (v) => { calUi.year = Number(v); });

          // فیلترها بدون درخواست دوباره: فقط شبکه/هشدار از پاسخ همین ماه دوباره ساخته می‌شود
          const dept = $('#cal-dept', page);
          const user = $('#cal-user', page);
          if (dept) dept.addEventListener('change', () => {
            calUi.department = dept.value || ''; calUi.userId = '';
            redraw();
            if (user) user.innerHTML = peopleOptions(model);
          });
          if (user) user.addEventListener('change', () => { calUi.userId = user.value || ''; redraw(); });

          if (grid) grid.addEventListener('click', (e) => {
            const b = e.target.closest('[data-u]');
            if (!b) return;
            const row = model.rows.find((r) => String(r.user.id) === String(b.dataset.u));
            const cell = row && row.days[Number(b.dataset.i)];
            if (row && cell) openDetail(row, cell);
          });
        },
      };
    },
  });
}());
