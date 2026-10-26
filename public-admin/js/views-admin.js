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
      const stat = (g, ic, v, l) => `<div class="stat"><div class="stat-icon ${g}">${icon(ic)}</div><div class="stat-value u-stat-value-sm">${v}</div><div class="stat-label">${l}</div></div>`;

      const now = new Date();
      const monthlyDefault = window.Jalali.toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
      const monthNames = window.Jalali.MONTH_NAMES;
      const html = `
        <div class="view-header"><div><h2>گزارش‌های تحلیلی</h2><div class="sub">${esc(fmt.dateLong(d.from))} تا ${esc(fmt.dateLong(d.to))}</div></div>
          <div class="header-actions">${AP.exportBar({ path: '/api/admin/reports/export', params: { from: d.from, to: d.to, department: repUi.department } })}</div></div>
        <form class="filters" id="rep-filters">
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(d.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(d.to)}" /></label>
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${d.departmentOptions.map((x) => `<option ${x === repUi.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <button type="button" class="btn ghost" data-range="6">۷ روز</button><button type="button" class="btn ghost" data-range="29">۳۰ روز</button><button type="button" class="btn ghost" data-range="89">۹۰ روز</button>
        </form>
        <div class="card mt" id="monthly-card">
          <h3>گزارش ماهانه (ماه شمسی)</h3>
          <div class="sub report-note">ماه بسته‌شده از snapshot و در غیر این صورت زنده؛ چاپ A4 در تب جدید باز می‌شود.</div>
          <form class="filters" id="monthly-form">
            <label class="field"><span>سال</span><input type="number" name="year" min="1300" max="1500" value="${monthlyDefault.jy}" /></label>
            <label class="field"><span>ماه</span><select name="month">${monthNames.map((n, i) => `<option value="${i + 1}" ${i + 1 === monthlyDefault.jm ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
            <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${d.departmentOptions.map((x) => `<option ${x === repUi.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
            <div class="header-actions" id="monthly-export"></div>
          </form>
        </div>
        <div class="stat-grid">
          ${stat('g-green', 'in', fmt.num(t.presentDays), 'مجموع روز-نفر حضور')}
          ${stat('g-blue', 'clock', fmt.min(t.totalEffective), 'مجموع ساعت مفید')}
          ${stat('g-blue', 'clock', fmt.min(t.avgEffective), 'میانگین مفید روزانه')}
          ${stat('g-orange', 'alert', fmt.num(t.lateCount), 'ورود با تأخیر')}
          ${stat('g-red', 'out', fmt.num(t.earlyLeaveCount), 'خروج زودهنگام')}
          ${stat('g-purple', 'clock', fmt.min(t.overtimeMinutes), 'اضافه‌کاری')}
          ${stat('g-gray', 'alert', fmt.num(t.incompleteCount), 'رکورد ناقص')}
          ${stat('g-blue', 'leave', fmt.num(t.leaveDays), 'روز مرخصی')}
        </div>
        <div class="card"><h3>تعداد حاضرین به تفکیک روز</h3>${dailyChart(d.daily)}</div>
        <div class="card flush mt"><div class="u-panel-head"><h3>دپارتمان‌ها</h3></div><div class="table-wrap"><table>
          <thead><tr><th>دپارتمان</th><th>کارمند</th><th>روز-نفر حضور</th><th>ساعت مفید</th><th>تأخیر</th><th>ناقص</th><th>مرخصی</th></tr></thead><tbody>
          ${d.departments.map((x) => `<tr><td>${esc(x.name)}</td><td>${fmt.num(x.employees)}</td><td>${fmt.num(x.presentDays)}</td><td>${fmt.min(x.totalEffective)}</td><td>${fmt.num(x.lateCount)}</td><td>${fmt.num(x.incompleteCount)}</td><td>${fmt.num(x.leaveDays)}</td></tr>`).join('') || `<tr><td colspan="7">${emptyBox('داده‌ای نیست.')}</td></tr>`}</tbody></table></div>${d.departments.length ? '' : emptyBox('دپارتمانی برای نمایش نیست.')}</div>
        <div class="card flush mt"><div class="u-panel-head"><h3>جزئیات هر کارمند <span class="muted table-hint">(برای مرتب‌سازی روی عنوان ستون کلیک کنید)</span></h3></div><div class="table-wrap"><table id="rep-table">
          <thead><tr>${th('name', 'کارمند')}${th('presentDays', 'روز حضور')}${th('totalEffective', 'مجموع مفید')}${th('avgEffective', 'میانگین روزانه')}${th('lateCount', 'تأخیر')}${th('earlyLeaveCount', 'خروج زودهنگام')}${th('overtimeMinutes', 'اضافه‌کاری')}${th('incompleteCount', 'ناقص')}${th('leaveDays', 'مرخصی')}<th>میانگین ورود</th></tr></thead><tbody>
          ${[...d.rows].sort((a, b) => {
            const f = sortKeys[repUi.sort] || sortKeys.totalEffective;
            const x = f(a); const y = f(b);
            return (typeof x === 'string' ? x.localeCompare(y, 'fa') : x - y) * repUi.dir;
          }).map((r) => `<tr class="clickable" data-id="${r.user.id}"><td><div class="cell-user">${AP.avatar(r.user.fullName, 'sm')}<span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '')}</small></span></div></td>
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
            $('#monthly-export', page).innerHTML = AP.exportBar({ path: '/api/admin/reports/monthly/export', params, print: { href: AP.buildExportUrl('/admin/print.html', params) } });
          };
          drawMonthly();
          $$('input, select', mform).forEach((el) => el.addEventListener('input', drawMonthly));
          mform.addEventListener('submit', (e) => e.preventDefault());
          AP.dates.mount(form); // از/تا تاریخ شمسی؛ قبل از بستن listenerها (S3-11b)
          $$('input, select', form).forEach((el) => el.addEventListener('change', () => { Object.assign(repUi, AP.formData(form)); AP.refresh(); }));
          $$('[data-range]', form).forEach((b) => b.addEventListener('click', () => { repUi.from = fmt.daysAgo(Number(b.dataset.range)); repUi.to = fmt.today(); AP.refresh(); }));
          $$('th[data-sort]', page).forEach((h) => h.addEventListener('click', () => {
            if (repUi.sort === h.dataset.sort) repUi.dir *= -1; else { repUi.sort = h.dataset.sort; repUi.dir = h.dataset.sort === 'name' ? 1 : -1; }
            AP.refresh();
          }));
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
    perm: 'system.manage',
    nav: { icon: 'broadcast', label: 'ارسال پیام گروهی', group: 'مدیریت' },
    async render() {
      const users = (await AP.loadUsers()).filter((u) => u.isActive);
      const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
      const withTg = users.filter((u) => u.telegramUserId);
      const html = `
        <div class="view-header"><div><h2>ارسال پیام گروهی</h2><div class="sub">پیام از طریق بات تلگرام برای کارمندانِ دارای آیدی تلگرام ارسال می‌شود (${fmt.num(withTg.length)} نفر)</div></div></div>
        <div class="card"><form class="form" id="bc-form">
          <div class="form-grid">
            <label class="field"><span>گیرندگان</span><select name="scope" id="bc-scope"><option value="all">همه‌ی کارمندان فعال</option><option value="department">یک دپارتمان</option><option value="users">انتخاب دستی</option></select></label>
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
    dailyReportGateMode: { enforce: 'الزامی (بدون گزارش خروج ثبت نمی‌شود)', soft: 'نرم (تکمیل تا ۲۴ ساعت بعد)', off: 'خاموش' },
    planSubmissionWeekday: { auto: 'خودکار (آخرین روز کاریِ هفته)', 0: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه', 6: 'شنبه' },
    planGateWarnWeekday: { off: 'خاموش', 0: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه', 6: 'شنبه' },
    overtimeRounding: { down: 'به پایین', nearest: 'نزدیک‌ترین', up: 'به بالا' },
  };
  // گروه‌هایی که محاسبه‌ی روز را عوض می‌کنند ⇒ روی عدد روزها/ماه‌های گذشته هم اثر دارند (گزارش‌ها همیشه با تنظیمات فعلی محاسبه می‌شوند)
  const IMPACT_GROUPS = new Set(['workHours', 'calendar', 'overtime']);
  const IMPACT_TEXT = 'گزارش‌ها و خلاصه‌ها همیشه با مقدار «فعلی» تنظیمات محاسبه می‌شوند؛ پس با تغییر این بخش، عددهای روزها و ماه‌های گذشته (ساعت مفید، تأخیر، اضافه‌کاری، غیبت) هم عوض می‌شود. خودِ رکوردهای تردد تغییری نمی‌کنند.';

  // عنوان کوتاه یک تنظیم (بخش اول توضیح تا اولین «؛» یا «(») برای پیام‌ها و دیالوگ‌ها
  const setShort = (it) => it.description.split(/[؛(]/)[0].trim();
  function setEnumLabel(it, v) { return (ENUM_LABELS[it.key] && ENUM_LABELS[it.key][v]) || v; }

  // مقدار قابل‌نمایش (برای «پیش‌فرض: …»)
  function setShow(it, v) {
    if (it.type === 'boolean') return v ? 'روشن' : 'خاموش';
    if (it.type === 'weekdays') return (v || []).length ? WEEKDAY_ORDER.filter(([d]) => v.includes(d)).map(([, n]) => n).join('، ') : 'هیچ‌کدام';
    if (it.type === 'enum') return setEnumLabel(it, v);
    return String(v);
  }

  // نرمال‌سازی برای مقایسه‌ی «تغییر کرده؟»
  function setNorm(it, v) {
    if (it.type === 'boolean') return v === true || v === 'true' ? 'true' : 'false';
    if (it.type === 'number') { const n = Number(v); return v === '' || Number.isNaN(n) ? `?${v}` : String(n); }
    if (it.type === 'weekdays') return JSON.stringify([...(v || [])].map(Number).sort((a, b) => a - b));
    return String(v == null ? '' : v).trim();
  }

  function setInput(it, v) {
    const k = esc(it.key);
    const al = `aria-label="${esc(setShort(it))}"`; // برچسب دسترس‌پذیر کنترل (S5-9a)
    switch (it.type) {
      case 'boolean':
        return `<label class="st-switch-wrap"><input type="checkbox" role="switch" class="st-switch" name="${k}" data-key="${k}" ${al}${setNorm(it, v) === 'true' ? ' checked' : ''} /><span class="st-track" aria-hidden="true"></span><span class="st-sw-on">روشن</span><span class="st-sw-off">خاموش</span></label>`;
      case 'number':
        return `<input type="number" step="any" name="${k}" data-key="${k}" ${al} value="${esc(v)}"${it.min !== undefined ? ` min="${it.min}"` : ''}${it.max !== undefined ? ` max="${it.max}"` : ''} class="ltr-in" />`;
      case 'time':
        return `<input type="time" name="${k}" data-key="${k}" ${al} value="${esc(v)}" class="ltr-in" dir="ltr" />`;
      case 'enum':
        return `<select name="${k}" data-key="${k}" ${al}>${it.values.map((o) => `<option value="${esc(o)}"${o === v ? ' selected' : ''}>${esc(setEnumLabel(it, o))}</option>`).join('')}</select>`;
      case 'weekdays':
        return `<div class="chk-row" data-key="${k}" role="group" ${al}>${WEEKDAY_ORDER.map(([d, n]) => `<label class="chk st-pill"><input type="checkbox" value="${d}"${(v || []).includes(d) ? ' checked' : ''} /><span>${n}</span></label>`).join('')}</div>`;
      default: // cron | string | timezone
        return `<input type="text" name="${k}" data-key="${k}" ${al} value="${esc(v)}" dir="ltr" class="ltr-in" autocomplete="off" spellcheck="false" />`;
    }
  }

  function setHint(it) {
    const bits = [`پیش‌فرض: ${setShow(it, it.default)}`];
    if (it.type === 'number' && (it.min !== undefined || it.max !== undefined)) bits.push(`بازه: ${it.min !== undefined ? it.min : '…'} تا ${it.max !== undefined ? it.max : '…'}`);
    if (it.type === 'cron') bits.push('الگوی cron پنج‌بخشی، مثل 0 8 * * *');
    if (it.type === 'timezone') bits.push('نام IANA، مثل Asia/Tehran');
    return bits.join(' · ');
  }

  function setRead(it, row) {
    const el = $(`[data-key="${CSS.escape(it.key)}"]`, row);
    if (!el) return undefined;
    if (it.type === 'boolean') return el.checked ? 'true' : 'false';
    if (it.type === 'weekdays') return $$('input:checked', el).map((c) => Number(c.value));
    if (it.type === 'time' && window.TimeInput) { const t = window.TimeInput.parse(el.value); return t.ok ? t.value : el.value; } // H4: ساعت تایپی همیشه HH:MM
    return el.value;
  }

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

      // فیلد عریض: روز هفته، cron، رشته و enum با برچسب گزینه‌ی بلند
      const isFull = (it) => ['weekdays', 'cron', 'string'].includes(it.type) || (it.type === 'enum' && it.values.some((o) => setEnumLabel(it, o).length > 24));
      const rowHtml = (it) => {
        const short = setShort(it);
        const dirty = isDirty(it);
        const did = `st-d-${esc(it.key)}`;
        return `
        <div class="st-field${isFull(it) ? ' full' : ''}${dirty ? ' dirty' : ''}" data-row="${esc(it.key)}">
          <div class="st-label"><span>${esc(short)}</span><span class="st-tag" data-dirty${dirty ? '' : ' hidden'}>ذخیره‌نشده</span></div>
          <div class="st-ctl">${setInput(it, draftOf(it))}</div>
          <div class="st-desc" id="${did}">${esc(it.description)}</div>
          ${it.description.trim() !== short ? `<button type="button" class="st-more" data-more aria-expanded="false" aria-controls="${did}">بیشتر</button>` : ''}
          <div class="st-meta"><code class="ltr">${esc(it.key)}</code> · ${esc(setHint(it))}</div>
          <div class="st-state">${it.isDefault ? '<span class="muted small">پیش‌فرض</span>' : `${AP.badge('blue', 'تغییر‌یافته')} <button type="button" class="btn ghost small" data-reset="${esc(it.key)}">بازگشت به پیش‌فرض</button>`}</div>
        </div>`;
      };

      const groupBody = (g) => {
        const list = items.filter((i) => i.group === g);
        const notes = [];
        if (IMPACT_GROUPS.has(g)) notes.push(`<div class="note warn">${icon('alert')}<span>${esc(IMPACT_TEXT)}</span></div>`);
        if (g === 'schedule') notes.push(`<div class="note">${icon('clock')}<span>تغییر زمان‌بندی بدون ری‌استارت و بلافاصله اعمال می‌شود. مقدار پیش‌فرض از فایل <code class="ltr">.env</code> می‌آید.</span></div>`);
        return `${notes.join('')}<div class="st-fields">${list.map(rowHtml).join('')}</div>
          <div class="st-actionbar" data-bar="${esc(g)}">
            <span class="st-pending" data-pending="${esc(g)}" aria-live="polite">بدون تغییر ذخیره‌نشده</span>
            <div class="form-msg" data-msg></div>
            <button type="button" class="btn ghost" data-discard="${esc(g)}" disabled>انصراف</button>
            <button type="button" class="btn primary" data-save="${esc(g)}" disabled>ذخیره‌ی تغییرات این بخش</button>
          </div>`;
      };

      const html = `
        <div class="view-header"><div><h2>تنظیمات</h2><div class="sub">هر تغییر با ذکر دلیل ذخیره و در «گزارش رویدادها» ثبت می‌شود · تعطیلات در صفحه‌ی «تعطیلات» است</div></div></div>
        <div class="st-layout">
          <aside class="card st-nav">
            <div class="st-nav-head">
              <span class="st-nav-ico" aria-hidden="true">${icon('settings')}</span>
              <div><h3>تنظیمات سیستم</h3><div class="muted small">${fmt.num(items.length)} تنظیم در ${fmt.num(groupKeys.length)} بخش</div></div>
            </div>
            <label class="field st-search"><span class="sr-only">جستجو در تنظیمات</span><input type="search" id="set-q" placeholder="جستجو: اضافه‌کاری، تأخیر، cron …" autocomplete="off" /></label>
            <nav aria-label="بخش‌های تنظیمات">${groupKeys.map((g, i) => `
              <button type="button" class="st-nav-item" data-go="${esc(g)}"${i === 0 ? ' aria-current="true"' : ''}>
                <span class="st-nav-name">${esc(data.groups[g])}</span>
                <span class="st-dot" data-dot="${esc(g)}" hidden></span>
                <span class="badge st-count" data-count="${esc(g)}">${fmt.num(items.filter((x) => x.group === g).length)}</span>
              </button>`).join('')}
            </nav>
            <dl class="st-stats">
              <div><dt>تغییر‌یافته از پیش‌فرض</dt><dd data-stat="changed">${fmt.num(items.filter((x) => !x.isDefault).length)}</dd></div>
              <div><dt>ذخیره‌نشده</dt><dd data-stat="dirty">0</dd></div>
            </dl>
            ${AP.viewAllowed && AP.viewAllowed(AP.views.audit) ? `<button type="button" class="btn ghost small st-audit" data-audit>${icon('audit')} گزارش رویدادها</button>` : ''}
          </aside>
          <div class="st-main">${groupKeys.map((g, i) => `
            <section class="card st-panel" data-group="${esc(g)}" aria-labelledby="st-h-${esc(g)}"${i === 0 ? '' : ' hidden'}>
              <header class="st-panel-head"><h3 id="st-h-${esc(g)}" tabindex="-1">${esc(data.groups[g])}</h3><span class="muted small">${fmt.num(items.filter((x) => x.group === g).length)} تنظیم</span></header>
              <div class="st-body">${groupBody(g)}</div>
            </section>`).join('')}
            <div id="set-none" class="hidden">${emptyBox('تنظیمی با این عبارت پیدا نشد.')}</div>
          </div>
        </div>`;

      return {
        html,
        mount(page) {
          let active = groupKeys[0];
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
            if (pend) pend.textContent = n ? `${fmt.num(n)} تغییر ذخیره‌نشده` : 'بدون تغییر ذخیره‌نشده';
            const dis = $(`[data-discard="${CSS.escape(g)}"]`, page);
            if (dis) dis.disabled = n === 0;
            refreshStats();
          };
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
            refreshSave(g);
            applyFilter();
          };
          const applyReset = (g) => { const m = msgOf(g); if (m) { m.className = 'form-msg'; m.textContent = ''; } };

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
                refreshSave(g);
                applyReset(g);
              };
              $$('input, select', row).forEach((el) => { el.addEventListener('input', onChange); el.addEventListener('change', onChange); });
              if (it.key in drafts) row.classList.add('dirty');
            });
            $$('[data-more]', card).forEach((b) => b.addEventListener('click', () => {
              const d = $(`#${CSS.escape(b.getAttribute('aria-controls'))}`, card);
              const open = b.getAttribute('aria-expanded') !== 'true';
              b.setAttribute('aria-expanded', String(open));
              b.textContent = open ? 'کمتر' : 'بیشتر';
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
            const reason = await AP.askReason({
              title: 'ذخیره‌ی تنظیمات',
              message: `${fmt.num(dirty.length)} تنظیم تغییر می‌کند: ${dirty.map(setShort).join('؛ ')}.${IMPACT_GROUPS.has(g) ? ` ${IMPACT_TEXT}` : ''}`,
              confirmText: 'ذخیره', placeholder: 'مثلاً: تغییر ساعت کار طبق ابلاغیه‌ی مدیریت',
            });
            if (reason === null) return;
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
                const hit = !q || it.description.toLowerCase().includes(q) || it.key.toLowerCase().includes(q);
                row.classList.toggle('hidden', !hit);
                if (hit) shown += 1;
              });
              card.hidden = q ? shown === 0 : card.dataset.group !== active;
              const g = card.dataset.group;
              const cnt = $(`[data-count="${CSS.escape(g)}"]`, page);
              if (cnt) cnt.textContent = fmt.num(q ? shown : items.filter((i) => i.group === g).length);
              const nb = $(`[data-go="${CSS.escape(g)}"]`, page);
              if (nb) nb.classList.toggle('dim', !!q && shown === 0);
              if (shown) anyGroup = true;
            });
            $('#set-none', page).classList.toggle('hidden', anyGroup);
          }

          function showGroup(g) {
            active = g;
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
  const AU_ENTITY = { user: 'کاربر', attendance_record: 'رکورد تردد', break_record: 'استراحت', leave_request: 'مرخصی/مأموریت', holiday: 'تعطیلی', dispute: 'اعتراض', settings: 'تنظیمات', session: 'نشست' };
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
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(auUi.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(auUi.to)}" /></label>
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
            if (!reason) return;
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
        ? s.recentErrors.map((e) => `<tr><td class="ltr">${esc(e.job_name)}</td><td>${esc(fmt.dateTime(e.finished_at || e.started_at))}</td><td class="ltr u-break-word">${esc(e.error || '—')}</td></tr>`).join('')
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
