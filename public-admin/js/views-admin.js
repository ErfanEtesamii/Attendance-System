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
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="حضور روزانه"><defs><linearGradient id="bar-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7be495"/><stop offset="1" stop-color="#16b886"/></linearGradient></defs>`;
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
      if (i % every === 0) svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${new Date(`${d.date}T00:00:00`).toLocaleDateString('fa-IR', { day: 'numeric', month: 'numeric' })}</text>`;
    });
    return `${svg}</svg>`;
  }

  // ======================================================
  // گزارش‌ها
  // ======================================================
  const repUi = { from: null, to: null, department: '', sort: 'totalEffective', dir: -1 };
  AP.view('reports', {
    employee: true,
    nav: { icon: 'reports', label: 'گزارش‌های تحلیلی', group: 'گزارش‌ها' },
    async render() {
      repUi.from = repUi.from || fmt.daysAgo(29);
      repUi.to = repUi.to || fmt.today();
      const qs = new URLSearchParams(Object.entries({ from: repUi.from, to: repUi.to, department: repUi.department }).filter(([, v]) => v)).toString();
      const d = await AP.api(`/admin/reports/summary?${qs}`);
      const t = d.totals;
      const sortKeys = { name: (r) => r.user.fullName, presentDays: (r) => r.presentDays, totalEffective: (r) => r.totalEffective, avgEffective: (r) => r.avgEffective, lateCount: (r) => r.lateCount, earlyLeaveCount: (r) => r.earlyLeaveCount, incompleteCount: (r) => r.incompleteCount, leaveDays: (r) => r.leaveDays, overtimeMinutes: (r) => r.overtimeMinutes };
      const th = (k, l) => `<th class="sortable" data-sort="${k}">${l}${repUi.sort === k ? (repUi.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
      const stat = (g, ic, v, l) => `<div class="stat"><div class="stat-icon ${g}">${icon(ic)}</div><div class="stat-value" style="font-size:21px">${v}</div><div class="stat-label">${l}</div></div>`;

      const html = `
        <div class="view-header"><div><h2>گزارش‌های تحلیلی</h2><div class="sub">${esc(fmt.dateLong(d.from))} تا ${esc(fmt.dateLong(d.to))}</div></div>
          <div class="header-actions"><a class="btn ghost" href="/api/admin/reports/export?from=${esc(d.from)}&to=${esc(d.to)}" download>${icon('download')} خروجی CSV خلاصه</a></div></div>
        <form class="filters" id="rep-filters">
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(d.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(d.to)}" /></label>
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${d.departmentOptions.map((x) => `<option ${x === repUi.department ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <button type="button" class="btn ghost" data-range="6">۷ روز</button><button type="button" class="btn ghost" data-range="29">۳۰ روز</button><button type="button" class="btn ghost" data-range="89">۹۰ روز</button>
        </form>
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
        <div class="card flush mt"><div style="padding:18px 18px 0"><h3>دپارتمان‌ها</h3></div><div class="table-wrap"><table>
          <thead><tr><th>دپارتمان</th><th>کارمند</th><th>روز-نفر حضور</th><th>ساعت مفید</th><th>تأخیر</th><th>ناقص</th><th>مرخصی</th></tr></thead><tbody>
          ${d.departments.map((x) => `<tr><td>${esc(x.name)}</td><td>${fmt.num(x.employees)}</td><td>${fmt.num(x.presentDays)}</td><td>${fmt.min(x.totalEffective)}</td><td>${fmt.num(x.lateCount)}</td><td>${fmt.num(x.incompleteCount)}</td><td>${fmt.num(x.leaveDays)}</td></tr>`).join('') || `<tr><td colspan="7">${emptyBox('داده‌ای نیست.')}</td></tr>`}</tbody></table></div></div>
        <div class="card flush mt"><div style="padding:18px 18px 0"><h3>جزئیات هر کارمند <span class="muted" style="font-weight:400;font-size:12px">(برای مرتب‌سازی روی عنوان ستون کلیک کنید)</span></h3></div><div class="table-wrap"><table id="rep-table">
          <thead><tr>${th('name', 'کارمند')}${th('presentDays', 'روز حضور')}${th('totalEffective', 'مجموع مفید')}${th('avgEffective', 'میانگین روزانه')}${th('lateCount', 'تأخیر')}${th('earlyLeaveCount', 'خروج زودهنگام')}${th('overtimeMinutes', 'اضافه‌کاری')}${th('incompleteCount', 'ناقص')}${th('leaveDays', 'مرخصی')}<th>میانگین ورود</th></tr></thead><tbody>
          ${[...d.rows].sort((a, b) => {
            const f = sortKeys[repUi.sort] || sortKeys.totalEffective;
            const x = f(a); const y = f(b);
            return (typeof x === 'string' ? x.localeCompare(y, 'fa') : x - y) * repUi.dir;
          }).map((r) => `<tr class="clickable" data-id="${r.user.id}"><td><div class="cell-user">${AP.avatar(r.user.fullName, 'sm')}<span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '')}</small></span></div></td>
            <td>${fmt.num(r.presentDays)}</td><td>${fmt.min(r.totalEffective)}</td><td>${fmt.min(r.avgEffective)}</td><td>${fmt.num(r.lateCount)}</td><td>${fmt.num(r.earlyLeaveCount)}</td>
            <td>${fmt.min(r.overtimeMinutes)}</td><td>${fmt.num(r.incompleteCount)}</td><td>${fmt.num(r.leaveDays)}</td><td class="num">${r.avgCheckIn ? `<span class="ltr">${esc(r.avgCheckIn)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#rep-filters', page);
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
    admin: true,
    nav: { icon: 'broadcast', label: 'ارسال پیام گروهی', group: 'مدیریت', admin: true },
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
  // تنظیمات
  // ======================================================
  AP.view('settings', {
    admin: true,
    nav: { icon: 'settings', label: 'تنظیمات و تعطیلات', group: 'مدیریت', admin: true },
    async render() {
      const [s, holidays] = await Promise.all([AP.api('/admin/settings'), AP.api('/admin/holidays')]);
      const html = `
        <div class="view-header"><div><h2>تنظیمات و تعطیلات</h2><div class="sub">تغییرات بلافاصله اعمال می‌شوند؛ نیازی به ری‌استارت سرور نیست</div></div></div>
        <div class="grid-2">
          <div class="card"><h3>ساعت کاری و آستانه‌ها</h3>
            <form class="form" id="set-form">
              <div class="form-grid">
                <label class="field"><span>شروع کار</span><input type="time" name="workDayStart" value="${esc(s.workDayStart)}" /></label>
                <label class="field"><span>پایان کار</span><input type="time" name="workDayEnd" value="${esc(s.workDayEnd)}" /></label>
                <label class="field"><span>مهلت مجاز تأخیر (دقیقه)</span><input type="number" min="0" name="lateCheckinGraceMinutes" value="${esc(s.lateCheckinGraceMinutes)}" /></label>
                <label class="field"><span>یادآوری خروج، چند دقیقه قبل</span><input type="number" min="0" name="checkoutReminderMinutesBefore" value="${esc(s.checkoutReminderMinutesBefore)}" /></label>
                <label class="field full"><span>آستانه‌ی هشدار تأخیر مکرر (تعداد)</span><input type="number" min="1" name="repeatedLatenessThreshold" value="${esc(s.repeatedLatenessThreshold)}" /></label>
              </div>
              <div class="form-msg"></div>
              <div class="modal-actions"><button class="btn primary" type="submit">ذخیره تنظیمات</button></div>
            </form></div>
          <div class="card"><h3>تقویم تعطیلات رسمی</h3>
            <form class="form-grid" id="hol-form" style="align-items:end;margin-bottom:14px">
              <label class="field"><span>تاریخ</span><input type="date" name="date" required /></label>
              <label class="field"><span>عنوان</span><input name="title" required placeholder="مثلاً: عید فطر" /></label>
              <button class="btn ghost" type="submit" style="grid-column:1/-1;justify-self:start">${icon('plus')} افزودن تعطیلی</button></form>
            <div class="kv">${holidays.length ? holidays.map((h) => `
              <div class="kv-row"><span>${esc(fmt.dateLong(h.holiday_date))}</span><span>${esc(h.title)} <button class="btn danger small" data-del="${h.id}" aria-label="حذف">${icon('trash')}</button></span></div>`).join('') : emptyBox('تعطیلی ثبت نشده است.')}</div>
          </div>
        </div>`;
      return {
        html,
        mount(page) {
          $('#set-form', page).addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = AP.formData(e.target);
            const ok = await AP.attempt(() => AP.api('/admin/settings', { method: 'PATCH', body: f }), 'تنظیمات ذخیره شد.');
            if (ok) AP.refresh();
          });
          $('#hol-form', page).addEventListener('submit', async (e) => {
            e.preventDefault();
            const ok = await AP.attempt(() => AP.api('/admin/holidays', { method: 'POST', body: AP.formData(e.target) }), 'تعطیلی اضافه شد.');
            if (ok) AP.refresh();
          });
          $$('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
            if (!(await AP.confirmBox({ title: 'حذف تعطیلی', message: 'این تعطیلی از تقویم حذف شود؟', confirmText: 'حذف', danger: true }))) return;
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
  const auUi = { userId: '', action: '', from: '', to: '', q: '', limit: 200 };
  AP.view('audit', {
    admin: true,
    nav: { icon: 'audit', label: 'گزارش رویدادها', group: 'مدیریت', admin: true },
    async render() {
      const qs = new URLSearchParams(Object.entries(auUi).filter(([, v]) => v)).toString();
      const [rows, actions, users] = await Promise.all([AP.api(`/admin/audit-log?${qs}`), AP.api('/admin/audit-actions'), AP.loadUsers()]);
      const html = `
        <div class="view-header"><div><h2>گزارش رویدادها</h2><div class="sub">لاگ غیرقابل‌ویرایش همه‌ی عملیات حساس · ${fmt.num(rows.length)} مورد نمایش داده می‌شود</div></div>
          <div class="header-actions"><a class="btn ghost" href="/api/admin/audit-log/export?${qs}" download>${icon('download')} خروجی CSV</a></div></div>
        <form class="filters" id="au-filters">
          <label class="field grow"><span>جستجو در جزئیات / IP</span><input type="search" name="q" value="${esc(auUi.q)}" /></label>
          <label class="field"><span>رویداد</span><select name="action"><option value="">همه</option>${actions.map((a) => `<option value="${esc(a.action)}" ${a.action === auUi.action ? 'selected' : ''}>${esc(a.action)} (${fmt.num(a.count)})</option>`).join('')}</select></label>
          <label class="field"><span>کاربر</span><select name="userId"><option value="">همه</option>${users.map((u) => `<option value="${u.id}" ${String(u.id) === String(auUi.userId) ? 'selected' : ''}>${esc(u.fullName)}</option>`).join('')}</select></label>
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(auUi.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(auUi.to)}" /></label>
          <label class="field"><span>تعداد</span><select name="limit">${[100, 200, 500, 1000].map((n) => `<option ${n === auUi.limit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </form>
        <div class="card flush"><div class="table-wrap"><table>
          <thead><tr><th>زمان</th><th>کاربر</th><th>رویداد</th><th>IP</th><th>جزئیات</th></tr></thead><tbody>
          ${rows.length ? rows.map((r) => `<tr><td class="num">${esc(fmt.dateTime(r.occurred_at))}</td><td>${esc(r.userFullName || '—')}</td>
            <td>${esc(r.action)}</td><td><span class="ltr muted">${esc(r.ip_address || '—')}</span></td>
            <td class="wrap"><div class="details-box">${esc(r.details || '')}</div></td></tr>`).join('') : `<tr><td colspan="5">${emptyBox('رویدادی پیدا نشد.')}</td></tr>`}
          </tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#au-filters', page);
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
    admin: true,
    nav: { icon: 'system', label: 'سیستم و پشتیبان', group: 'مدیریت', admin: true },
    async render() {
      const s = await AP.api('/admin/system');
      const html = `
        <div class="view-header"><div><h2>سیستم و پشتیبان‌گیری</h2><div class="sub">وضعیت سرور، دیتابیس و اتصال‌ها</div></div>
          <div class="header-actions"><button type="button" class="btn danger" id="sys-revoke-all">خروج همه‌ی کاربران</button><a class="btn primary" href="/api/admin/system/backup" download>${icon('download')} دانلود نسخه‌ی پشتیبان دیتابیس</a></div></div>
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
})();
