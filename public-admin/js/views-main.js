// صفحه‌های اصلی: داشبورد، تابلوی زنده، کارمندان، پرونده‌ی کارمند.

(function () {
  'use strict';
  const { $, $$, esc, fmt, icon } = Object.assign({}, window.AP, { icon: (n) => window.AP.icon(n) });
  const AP = window.AP;

  const faD = (v) => window.Jalali.toFaDigits(String(v == null ? '' : v)); // نمایش همه‌ی ارقام فارسی (برای کد پرسنلی و ساعت)
  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  function statTrendHtml(trend, field) {
    const points = (trend || []).map((x) => Number(x[field])).filter(Number.isFinite);
    if (points.length < 2) return '';
    const current = points[points.length - 1];
    const previous = points[points.length - 2];
    const delta = current - previous;
    const max = Math.max(1, ...points);
    const coords = points.map((v, i) => `${Math.round((i / Math.max(1, points.length - 1)) * 92 + 4)},${Math.round(30 - (v / max) * 24)}`).join(' ');
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
    return `<div class="stat-trend ${dir}" aria-label="${delta === 0 ? 'بدون تغییر نسبت به دیروز' : `${Math.abs(delta)} ${delta > 0 ? 'بیشتر' : 'کمتر'} از دیروز`}"><span>${arrow} ${delta === 0 ? 'بدون تغییر' : fmt.num(Math.abs(delta))} نسبت به دیروز</span><svg class="sparkline" viewBox="0 0 100 34" aria-hidden="true"><polyline points="${coords}"/></svg></div>`;
  }

  // ---------- نمودار میله‌ای ۱۴ روز اخیر ----------
  function trendChart(trend) {
    const W = 720, H = 230, padT = 14, padB = 30, padX = 12;
    const max = Math.max(4, ...trend.map((t) => Math.max(t.present, t.late)));
    const niceMax = Math.ceil(max / 2) * 2;
    const step = (W - padX * 2) / trend.length;
    const bw = Math.min(16, step / 3);
    const y = (v) => padT + (H - padT - padB) * (1 - v / niceMax);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="روند حضور ۱۴ روز اخیر">
      <defs><pattern id="bar-late" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="pat-bg" width="6" height="6"/><line class="pat-ln" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`;
    for (let i = 0; i <= 4; i += 1) {
      const v = (niceMax / 4) * i;
      svg += `<line class="grid" x1="${padX}" x2="${W - 36}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text x="${W - 4}" y="${y(v) + 4}" text-anchor="end">${fmt.num(Math.round(v))}</text>`;
    }
    trend.forEach((t, i) => {
      // راست‌به‌چپ: قدیمی‌ترین روز سمت راست
      const cx = W - 44 - (i + 0.5) * ((W - 44 - padX) / trend.length);
      const tj = window.Jalali.isoToJalali(t.date);
      const day = tj ? window.Jalali.toFaDigits(tj.jd) : '';
      const full = fmt.dateLong(t.date);
      svg += `<g><title>${esc(full)} — حاضر: ${fmt.num(t.present)}، متأخر: ${fmt.num(t.late)}</title>
        <rect class="bar-a" x="${cx - bw - 1}" y="${y(t.present)}" width="${bw}" height="${H - padB - y(t.present)}" rx="4"/>
        <rect class="bar-b" x="${cx + 1}" y="${y(t.late)}" width="${bw}" height="${H - padB - y(t.late)}" rx="4"/>
        <text x="${cx}" y="${H - 10}" text-anchor="middle">${day}</text></g>`;
    });
    return `${svg}</svg>`;
  }

  // ======================================================
  // داشبورد
  // ======================================================
  // «آخرین رویدادها» در داشبورد: برچسب فارسی برای رویدادهای رایج (بقیه با نام خودشان) و رنگ نشان؛ فقط نمایشی
  const ACT_LABEL = {
    admin_panel_login: 'ورود به پنل مدیریت', admin_panel_code_issued: 'صدور کد ورود پنل', admin_panel_logout: 'خروج از پنل مدیریت',
    remote_break_start: 'شروع استراحت دورکاری', remote_break_end: 'پایان استراحت دورکاری',
    manager_alerted_repeated_lateness: 'هشدار تأخیر مکرر به مدیر',
  };
  function actTone(action) {
    const a = String(action || '').toLowerCase();
    if (/delet|remov|reject|revok|reset|purge|fail|denied|block|lock/.test(a)) return 'red';
    if (/alert|late|warn|suspic|overtime|expire/.test(a)) return 'yellow';
    if (/creat|add|approv|import|grant|restor|login|open|issued|start/.test(a)) return 'green';
    if (/updat|chang|edit|set|assign|move|sync|export|end/.test(a)) return 'blue';
    return 'gray';
  }

  AP.view('dashboard', {
    skeleton: 'page', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'dashboard.read',
    nav: { icon: 'dashboard', label: 'داشبورد', group: 'نمای کلی' },
    async render() {
      const [d, inbox] = await Promise.all([AP.api('/admin/overview'), AP.api('/admin/inbox')]);
      const t = d.totals;
      const tiles = [
        ['present', 'حاضر در شرکت', t.present, 'g-green', 'in', 'present'],
        ['on_break', 'در استراحت', t.onBreak, 'g-orange', 'coffee'],
        ['checked_out', 'خروج کرده‌اند', t.checkedOut, 'g-purple', 'out'],
        ['absent', 'هنوز نیامده / غایب', t.absent, 'g-red', 'alert'],
        ['leave', 'در مرخصی', t.onLeave, 'g-blue', 'leave'],
        ['late', 'ورود با تأخیر امروز', t.late, 'g-orange', 'clock', 'late'],
        ['incomplete', 'رکورد ناقص', t.incomplete, 'g-gray', 'alert'],
      ];
      const inboxMeta = { leave: ['مرخصی', 'leaveQueue'], mission: ['مأموریت', 'leaveQueue'], remoteWork: ['دورکاری', 'remote'], dispute: ['اعتراض', 'disputes'], checkinPermission: ['اجازه ورود', 'checkin_permissions'], reportReview: ['مرور گزارش تیم', 'teamreports'] };
      const canDecide = (key) => ({ leave: AP.can('leave.approve') || AP.can('leave.approve.hr'), mission: AP.can('leave.approve') || AP.can('leave.approve.hr'), remoteWork: AP.can('remote_work.review'), dispute: AP.can('disputes.resolve'), checkinPermission: AP.can('checkin_permissions.decide'), reportReview: AP.can('reviews.write') })[key];
      const inboxRows = Object.entries(inboxMeta).map(([key, [label, go]]) => {
        const bucket = inbox[key] || {}; const items = bucket.items || [];
        const actions = (item) => !canDecide(key) ? '' : `<span class="inbox-actions">${key === 'reportReview' ? `<button class="btn ghost small" data-inbox-action="approve" data-kind="${key}" data-id="${item.id}" data-user="${item.userId}" data-date="${item.reportDate || ''}">ثبت مشاهده</button>` : `<button class="btn ghost small" data-inbox-action="approve" data-kind="${key}" data-id="${item.id}">تأیید</button><button class="btn danger small" data-inbox-action="reject" data-kind="${key}" data-id="${item.id}">رد</button>`}</span>`;
        const total = Number(bucket.count || 0);
        return `<div class="inbox-group${total ? '' : ' is-empty'}"><div class="inbox-head"><span class="inbox-label">${label}</span><span class="inbox-count" data-inbox-count>${fmt.num(total)}</span><button class="btn ghost small" data-go="${go}">بررسی</button></div>${items.map((item) => `<div class="inbox-item" data-inbox-row><span class="inbox-name">${esc(item.name)}</span>${actions(item)}</div>`).join('')}</div>`;
      }).join('');
      const inboxTotal = Object.keys(inboxMeta).reduce((s, k) => s + Number((inbox[k] || {}).count || 0), 0);
      const html = `
        <div class="view-header">
          <div><h2>سلام ${esc(AP.state.me.fullName)} <span class="hello-emoji" aria-hidden="true">😊</span></h2>
            <div class="sub">وضعیت امروز، ${esc(fmt.dateFull(d.date))}${t.holiday ? ' — امروز تعطیل رسمی است' : ''}</div></div>
          <div class="header-actions">
            ${d.pending.leave ? `<button class="btn ghost" data-go="leave">${icon('leave')} ${fmt.num(d.pending.leave)} درخواست در انتظار</button>` : ''}
            ${d.pending.disputes ? `<button class="btn ghost" data-go="disputes">${icon('disputes')} ${fmt.num(d.pending.disputes)} اعتراض باز</button>` : ''}
          </div>
        </div>

        <div class="stat-grid" data-widget="stats">
          <div class="stat"><div class="stat-icon g-green">${icon('employees')}</div>
            <div class="stat-value">${fmt.num(t.employees)}</div><div class="stat-label">کارمند فعال</div></div>
          ${tiles.map(([key, label, val, g, ic, trendField]) => `
            <button class="stat" data-go="live" data-param="${key}">
              <div class="stat-icon ${g}">${icon(ic)}</div>
              <div class="stat-value">${fmt.num(val)}</div><div class="stat-label">${esc(label)}</div>${trendField ? statTrendHtml(d.trend, trendField) : ''}</button>`).join('')}
        </div>

        <div class="card inbox-card" data-widget="inbox"><div class="view-header"><div><h3>منتظر تصمیم شما</h3><div class="sub">${inboxTotal ? `${fmt.num(inboxTotal)} مورد برای بررسی` : 'همه‌چیز مرتب است'}</div></div></div><div class="inbox-grid">${inboxRows}</div></div>

        <div class="grid-2" data-widget="trend">
          <div class="card card--primary"><h3>روند حضور ۱۴ روز اخیر</h3>
            <div class="legend"><span><i class="lg-a"></i>حاضر</span><span><i class="lg-b"></i>ورود با تأخیر</span></div>
            ${trendChart(d.trend)}</div>

          <div class="card"><h3>حضور امروز به تفکیک دپارتمان</h3>
            ${d.departments.length ? d.departments.map((x) => `
              <div class="hbar"><div class="hbar-top"><span>${esc(x.name)}</span><span>${fmt.num(x.present)} از ${fmt.num(x.total)}</span></div>
              <div class="hbar-track"><div class="hbar-fill" data-progress="${x.total ? Math.round((x.present / x.total) * 100) : 0}"></div></div></div>`).join('') : emptyBox('دپارتمانی ثبت نشده است.')}
          </div>
        </div>

        <div class="grid-2 mt" data-widget="late">
          <div class="card"><h3>بیشترین تأخیر در ۳۰ روز اخیر</h3>
            ${d.topLate.length ? `<div class="kv">${d.topLate.map((x) => `
              <div class="kv-row"><span><a class="u-link-inherit" href="#/profile/${x.userId}">${esc(x.fullName)}</a></span>
              <span>${fmt.num(x.count)} بار · ${fmt.min(x.minutes)}</span></div>`).join('')}</div>` : emptyBox('تأخیری ثبت نشده است. 🎉')}
          </div>

          <div class="card"><h3>${AP.can('audit.read') ? 'آخرین رویدادها' : 'ساعت کاری'}</h3>
            ${AP.can('audit.read') ? ((d.recentActivity || []).length ? `<div class="act-list">${(d.recentActivity || []).map((r) => `
              <div class="act-item act-item--${actTone(r.action)}"><span class="act-dot" aria-hidden="true"></span>
                <div class="act-main"><b class="act-user">${esc(r.userFullName || '—')}</b><span class="act-text" title="${esc(r.action)}">${esc(ACT_LABEL[r.action] || r.action)}</span></div>
                <time class="act-time">${esc(fmt.dateTime(r.occurred_at))}</time></div>`).join('')}</div>
              <div class="mt"><button class="btn ghost small" data-go="audit">مشاهده‌ی همه</button></div>` : emptyBox('رویدادی ثبت نشده است.'))
              : `<div class="kv"><div class="kv-row"><span>شروع کار</span><span class="ltr">${esc(d.settings.workDayStart)}</span></div>
                 <div class="kv-row"><span>پایان کار</span><span class="ltr">${esc(d.settings.workDayEnd)}</span></div>
                 <div class="kv-row"><span>مهلت تأخیر</span><span>${fmt.num(d.settings.lateCheckinGraceMinutes)} دقیقه</span></div></div>`}
          </div>
        </div>`;
      return {
        html,
        mount(page) {
          page.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-inbox-action]'); if (!button || button.disabled) return;
            const { kind, id, user, date } = button.dataset; const reject = button.dataset.inboxAction === 'reject';
            const reason = reject ? await AP.askReason({ title: 'رد درخواست', confirmText: 'رد', danger: true }) : '';
            if (reject && reason === null) return;
            const routes = { leave: `/admin/leave-requests/${id}/${reject ? 'reject' : 'approve'}`, mission: `/admin/leave-requests/${id}/${reject ? 'reject' : 'approve'}`, remoteWork: `/admin/remote-work/${id}/${reject ? 'reject' : 'approve'}`, dispute: `/admin/disputes/${id}/${reject ? 'reopen' : 'resolve'}`, checkinPermission: `/admin/checkin-permissions/${id}/decide`, reportReview: '/admin/report-reviews' };
            const body = kind === 'checkinPermission' ? { decision: reject ? 'reject' : 'approve', note: reason || undefined } : kind === 'remoteWork' ? { reviewNote: reason || undefined } : kind === 'reportReview' ? { subjectUserId: Number(user), reportDate: date } : { note: reason || undefined };
            const row = button.closest('[data-inbox-row]');
            try { button.disabled = true; await AP.api(routes[kind], { method: 'POST', body }); row?.remove(); AP.toast(reject ? 'رد شد.' : 'ثبت شد.'); AP.api('/admin/inbox').then((next) => { const b = next[kind] || {}; const group = row?.closest('.inbox-group'); const count = group?.querySelector('[data-inbox-count]'); if (count) count.textContent = fmt.num(b.count || 0); group?.classList.toggle('is-empty', !(b.count || 0)); }); } catch (err) { button.disabled = false; AP.toast(err.message, true); }
          });
          $$('[data-go]', page).forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.go, b.dataset.param)));
          const timer = setInterval(() => { if (!document.hidden) AP.refresh(); }, 60000);
          AP.onLeave = () => clearInterval(timer);
        },
      };
    },
  });

  // ======================================================
  // تابلوی زنده
  // ======================================================
  AP.view('live', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'dashboard.read',
    nav: { icon: 'live', label: 'تابلوی زنده امروز', group: 'نمای کلی' },
    async render(param) {
      const data = await AP.api('/admin/live');
      const rows = data.rows;
      const withKey = rows.map((r) => ({ ...r, late: !!(r.summary && r.summary.lateMinutes > 0 && r.record && r.record.check_in_time) }));
      const filters = [
        ['all', 'همه', withKey.length],
        ['present', 'حاضر', withKey.filter((r) => r.state === 'present').length],
        ['on_break', 'در استراحت', withKey.filter((r) => r.state === 'on_break').length],
        ['checked_out', 'خارج شده', withKey.filter((r) => r.state === 'checked_out').length],
        ['absent', 'غایب / نیامده', withKey.filter((r) => r.state === 'absent').length],
        ['leave', 'مرخصی', withKey.filter((r) => r.state === 'leave').length],
        ['late', 'متأخر', withKey.filter((r) => r.late).length],
        ['incomplete', 'ناقص', withKey.filter((r) => r.state === 'incomplete').length],
      ];
      let active = filters.some((f) => f[0] === param) ? param : 'all';
      let q = '';

      const html = `
        <div class="view-header">
          <div><h2><span class="live-dot"></span>تابلوی زنده</h2>
            <div class="sub">${esc(fmt.dateLong(data.date))} · به‌روزرسانی خودکار هر ۳۰ ثانیه</div></div>
          <div class="header-actions">
            <input id="live-q" class="search-short" type="search" placeholder="جستجوی نام…" aria-label="جستجوی نام" />
          </div>
        </div>
        <div class="chips" id="live-chips"></div>
        <div class="card card--primary flush"><div class="table-wrap"><table>
          <thead><tr><th>کارمند</th><th>وضعیت</th><th>ورود</th><th>خروج</th><th>ساعت مفید</th><th>استراحت</th><th>IP ورود</th><th>عملیات</th></tr></thead>
          <tbody id="live-body"></tbody></table></div></div>`;

      return {
        html,
        mount(page) {
          const body = $('#live-body', page);
          const chips = $('#live-chips', page);
          const matches = (r) => {
            if (active === 'late' && !r.late) return false;
            if (active !== 'all' && active !== 'late' && r.state !== active) return false;
            return !q || r.user.fullName.toLowerCase().includes(q);
          };
          const draw = () => {
            chips.innerHTML = filters.map(([k, l, c]) => `<button class="chip ${k === active ? 'active' : ''}" data-f="${k}">${esc(l)}<b>${fmt.num(c)}</b></button>`).join('');
            const list = withKey.filter(matches);
            body.innerHTML = list.length ? list.map((r) => {
              const rec = r.record;
              return `<tr>
                <td><a class="cell-user u-link-inherit" href="#/profile/${r.user.id}">${AP.avatar(r.user.fullName, 'sm', r.user.id)}
                  <span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '—')}</small></span></a></td>
                <td>${AP.stateBadge(r.state)} ${r.late ? AP.badge('late', `تأخیر ${fmt.min(r.summary.lateMinutes)}`) : ''} ${r.onMission ? AP.badge('mission', 'مأموریت') : ''}</td>
                <td class="num">${rec && rec.check_in_time ? fmt.clock(rec.check_in_time) : '—'} ${rec && rec.segmentCount > 1 ? AP.badge('purple', `${fmt.num(rec.segmentCount)} نوبت`) : ''}</td>
                <td class="num">${rec && rec.check_out_time ? fmt.clock(rec.check_out_time) : '—'}</td>
                <td class="num">${r.summary && r.summary.effectiveMinutes != null ? fmt.min(r.summary.effectiveMinutes) : '—'}</td>
                <td class="num">${r.state === 'on_break' ? 'از ' + fmt.clock(r.openBreak.start_time) : r.breakMinutes ? fmt.min(r.breakMinutes) : '—'}</td>
                <td><span class="ltr muted">${esc(rec && rec.check_in_ip ? rec.check_in_ip : '—')}</span></td>
                <td><div class="row-actions">
                  ${AP.can('records.edit') ? (rec ? `<button class="btn ghost small" data-rec="${rec.id}">رکورد</button>`
                    : `<button class="btn ghost small" data-new="${r.user.id}">ثبت دستی</button>`) : ''}
                  ${r.user.telegramUserId && AP.can('users.message') ? `<button class="btn ghost small" data-msg="${r.user.id}" title="ارسال پیام تلگرام">${AP.icon('mail')}</button>` : ''}
                </div></td></tr>`;
            }).join('') : `<tr><td colspan="8">${emptyBox('موردی برای نمایش نیست.')}</td></tr>`;
          };
          draw();
          chips.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { active = b.dataset.f; draw(); } });
          $('#live-q', page).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
          body.addEventListener('click', (e) => {
            const rec = e.target.closest('[data-rec]');
            const nw = e.target.closest('[data-new]');
            const msg = e.target.closest('[data-msg]');
            if (rec) AP.openRecord(rec.dataset.rec);
            if (nw) AP.openCreateRecord({ userId: nw.dataset.new, date: data.date });
            if (msg) AP.openMessage(msg.dataset.msg);
          });
          const timer = setInterval(async () => {
            if (document.hidden || document.querySelector('.modal-backdrop')) return;
            const here = AP.currentRoute.id === 'live';
            if (here) AP.go('live', active === 'all' ? null : active);
          }, 30000);
          AP.onLeave = () => clearInterval(timer);
        },
      };
    },
  });

  // ======================================================
  // کارمندان
  // ======================================================
  function employeeFormFields(u, users) {
    const managers = users.filter((x) => ['manager', 'admin', 'owner'].includes(x.role) && x.isActive && (!u || x.id !== u.id));
    return `
      <div class="form-grid">
        <label class="field"><span>نام و نام‌خانوادگی</span><input name="fullName" required value="${esc(u ? u.fullName : '')}" /></label>
        <label class="field"><span>کد پرسنلی</span><input name="personnelCode" value="${esc(u ? u.personnelCode || '' : '')}" /></label>
        <label class="field"><span>دپارتمان</span><input name="department" list="dept-list" value="${esc(u ? u.department || '' : '')}" />
          <datalist id="dept-list">${[...new Set(users.map((x) => x.department).filter(Boolean))].map((d) => `<option value="${esc(d)}">`).join('')}</datalist></label>
        <label class="field"><span>نقش</span><select name="role">
          ${Object.entries(AP.ROLE)
            // owner از پنل قابل تعیین نیست؛ نقش admin فقط برای دارنده‌ی مجوز admins.manage (owner) قابل انتخاب است. نقش فعلیِ خود کاربر همیشه دیده می‌شود.
            .filter(([k]) => (u && u.role === k) || (k !== 'owner' && (k !== 'admin' || AP.can('admins.manage'))))
            .map(([k, v]) => `<option value="${k}" ${u && u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>سرپرست مستقیم</span><select name="managerId"><option value="">— ندارد —</option>
          ${managers.map((m) => `<option value="${m.id}" ${u && u.managerId === m.id ? 'selected' : ''}>${esc(m.fullName)}</option>`).join('')}</select></label>
        <label class="field"><span>آیدی عددی تلگرام</span><input name="telegramUserId" class="ltr" inputmode="numeric" value="${esc(u ? u.telegramUserId || '' : '')}" /></label>
        ${u && AP.can('users.write') ? `<label class="field"><span>نرخ ساعتی (هزار تومان)</span><input name="hourlyRateKt" class="ltr" inputmode="numeric" autocomplete="off" disabled placeholder="در حال بارگذاری…" /></label>` : ''}
        ${u ? `<label class="check-row full u-full"><input type="checkbox" name="isActive" ${u.isActive ? 'checked' : ''} /> حساب فعال است</label>` : ''}
      </div>`;
  }
  AP.employeeFormFields = employeeFormFields;

  AP.view('employees', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'users.read',
    nav: { icon: 'employees', label: 'کارمندان', group: 'کارمندان و تردد' },
    async render() {
      const users = await AP.loadUsers(true);
      const byId = new Map(users.map((u) => [u.id, u]));
      const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
      const SEARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      const html = `
        <div class="emp-v2">
        <div class="view-header">
          <div><h2>کارمندان</h2><div class="sub">${fmt.num(users.length)} نفر ثبت‌شده</div></div>
          <div class="header-actions">
            <span id="emp-export" class="header-actions"></span>
            ${AP.can('users.write') ? `<button class="btn primary" id="add-emp">${icon('plus')} افزودن کارمند</button>` : ''}
          </div>
        </div>
        <div class="emp-stats" id="emp-stats"></div>
        <div class="card emp-drill" id="emp-drill" role="region" aria-live="polite" hidden></div>
        <div class="emp-toolbar">
          <label class="emp-search">${SEARCH_SVG}<input id="f-q" type="search" placeholder="جستجوی نام یا کد پرسنلی…" aria-label="جستجو" /></label>
          <select id="f-dept" aria-label="دپارتمان"><option value="">همه‌ی دپارتمان‌ها</option>${depts.map((d) => `<option>${esc(d)}</option>`).join('')}</select>
          <select id="f-role" aria-label="نقش"><option value="">همه‌ی نقش‌ها</option>${Object.entries(AP.ROLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="f-active" aria-label="وضعیت حساب"><option value="">همه‌ی حساب‌ها</option><option value="1">فقط فعال</option><option value="0">فقط غیرفعال</option></select>
          <div class="emp-view-toggle" role="group" aria-label="نحوه‌ی نمایش">
            <button type="button" data-emp-view="cards" aria-pressed="true">کارتی</button>
            <button type="button" data-emp-view="table" aria-pressed="false">جدولی</button>
          </div>
        </div>
        <div class="emp-count" id="emp-count" role="status" aria-live="polite"></div>
        <div class="emp-cards" id="emp-cards"></div>
        <div class="card flush emp-table" id="emp-table" hidden><div class="table-wrap"><table>
          <thead><tr><th>کارمند</th><th>کد پرسنلی</th><th>دپارتمان</th><th>نقش</th><th>سرپرست مستقیم</th><th>شیفت مؤثر</th><th>وضعیت امروز</th><th>آیدی تلگرام</th><th>حساب</th></tr></thead>
          <tbody id="emp-body"></tbody></table></div></div>
        </div>`;
      const todayMap = { not_checked_in: 'absent', checked_in: 'present', checked_out: 'checked_out', incomplete: 'incomplete', holiday: 'holiday', leave: 'leave' };
      return {
        html,
        mount(page) {
          const body = $('#emp-body', page);
          const draw = () => {
            const q = window.Jalali.toEnDigits($('#f-q', page).value.trim()).toLowerCase(); // کد پرسنلی با رقم فارسی هم پیدا شود
            const dp = $('#f-dept', page).value;
            const rl = $('#f-role', page).value;
            const ac = $('#f-active', page).value;
            // دکمه‌های دانلود همیشه با فیلتر فعال (همان منطق فیلتر سمت سرور users/export)
            $('#emp-export', page).innerHTML = AP.exportBar({ path: '/api/admin/users/export', params: { q: $('#f-q', page).value.trim(), department: dp, role: rl, isActive: ac } });
            const list = users.filter((u) =>
              (!q || u.fullName.toLowerCase().includes(q) || (u.personnelCode || '').toLowerCase().includes(q)) &&
              (!dp || u.department === dp) && (!rl || u.role === rl) && (!ac || String(u.isActive ? 1 : 0) === ac));
            $('#emp-count', page).textContent = `نمایش ${fmt.num(list.length)} از ${fmt.num(users.length)} کارمند`;
            body.innerHTML = list.length ? list.map((u) => `
              <tr class="clickable ${u.isActive ? '' : 'inactive'}" data-id="${u.id}">
                <td><div class="cell-user">${AP.avatar(u.fullName, 'sm', u.id)}<span><b>${esc(u.fullName)}</b></span></div></td>
                <td class="num">${esc(faD(u.personnelCode || '—'))}</td>
                <td>${esc(u.department || '—')}</td>
                <td>${AP.badge(['admin', 'owner'].includes(u.role) ? 'purple' : u.role === 'manager' ? 'blue' : '', AP.ROLE[u.role])}</td>
                <td>${esc(u.managerId && byId.get(u.managerId) ? byId.get(u.managerId).fullName : '—')}</td>
                <td>${u.shiftName ? `${esc(u.shiftName)} <span class="ltr muted">${esc(u.shiftTime)}</span>` : '<span class="muted">پیش‌فرض</span>'}</td>
                <td>${AP.stateBadge(todayMap[u.todayStatus] || 'absent')}</td>
                <td><span class="ltr muted">${esc(u.telegramUserId || '—')}</span></td>
                <td>${u.isActive ? AP.badge('green', 'فعال') : AP.badge('red', 'غیرفعال')}</td></tr>`).join('')
              : `<tr><td colspan="9">${emptyBox('کارمندی با این فیلتر پیدا نشد.')}</td></tr>`;
            // نمای کارتی: هر کارمند یک کارت با وضعیت امروز، نقش، دپارتمان و شیفت
            const cardsEl = $('#emp-cards', page);
            cardsEl.innerHTML = list.length ? list.map((u) => {
              const st = todayMap[u.todayStatus] || 'absent';
              const mgr = u.managerId && byId.get(u.managerId) ? byId.get(u.managerId).fullName : '—';
              return `
              <button type="button" class="emp-card ${u.isActive ? '' : 'inactive'}" data-id="${u.id}" data-state="${st}">
                <span class="emp-card-top">
                  ${AP.avatar(u.fullName, 'sm', u.id)}
                  <span class="emp-card-id"><b>${esc(u.fullName)}</b><span class="muted">${esc(u.department || 'بدون دپارتمان')}</span></span>
                  ${AP.stateBadge(st)}
                </span>
                <span class="emp-card-meta">
                  <span><em>کد پرسنلی</em><b>${esc(faD(u.personnelCode || '—'))}</b></span>
                  <span><em>نقش</em><b>${esc(AP.ROLE[u.role] || '—')}</b></span>
                  <span><em>سرپرست</em><b>${esc(mgr)}</b></span>
                  <span><em>شیفت امروز</em><b>${u.shiftName ? `${esc(u.shiftName)} <i class="ltr">${esc(u.shiftTime)}</i>` : 'پیش‌فرض'}</b></span>
                </span>
                ${u.isActive ? '' : `<span class="emp-card-off">${AP.badge('red', 'حساب غیرفعال')}</span>`}
              </button>`;
            }).join('') : emptyBox('کارمندی با این فیلتر پیدا نشد.');
          };
          const active = users.filter((u) => u.isActive);
          const cntBy = (st) => active.filter((u) => u.todayStatus === st).length;
          // کاشی‌های «داخل شرکت / خارج‌شده / غایب» کلیک‌پذیرند و لیست کارمندانِ همان وضعیت را زیر کاشی‌ها باز می‌کنند
          const DRILL = { checked_in: 'داخل شرکت', checked_out: 'خارج‌شده', not_checked_in: 'غایب / نیامده' };
          const tile = (cls, ic, label, n, st) => {
            const inner = `<span class="emp-stat-ico">${icon(ic)}</span><span class="emp-stat-txt"><span class="emp-stat-n">${fmt.num(n)}</span><span class="emp-stat-l">${label}</span></span>`;
            return st
              ? `<button type="button" class="emp-stat is-click ${cls}" data-st="${st}" aria-pressed="false" aria-controls="emp-drill" title="نمایش لیست کارمندان">${inner}<span class="emp-stat-go" aria-hidden="true">لیست ‹</span></button>`
              : `<div class="emp-stat ${cls}">${inner}</div>`;
          };
          $('#emp-stats', page).innerHTML = tile('', 'employees', 'کل کارمندان', users.length) + tile('is-ok', 'check', 'فعال', active.length) + tile('is-in', 'in', 'داخل شرکت', cntBy('checked_in'), 'checked_in') + tile('is-out', 'out', 'خارج‌شده', cntBy('checked_out'), 'checked_out') + tile('is-abs', 'alert', 'غایب / نیامده', cntBy('not_checked_in'), 'not_checked_in');
          const drill = $('#emp-drill', page);
          let drillSt = null;
          const closeDrill = () => {
            drillSt = null;
            drill.hidden = true;
            drill.innerHTML = '';
            $$('.emp-stat.is-click', page).forEach((b) => { b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
          };
          const openDrill = (st) => {
            drillSt = st;
            const list = active.filter((u) => u.todayStatus === st);
            $$('.emp-stat.is-click', page).forEach((b) => {
              const on = b.dataset.st === st;
              b.classList.toggle('is-selected', on);
              b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            drill.innerHTML = `
              <div class="emp-drill-head">
                <h3>${esc(DRILL[st])} <span class="muted">(${fmt.num(list.length)} نفر)</span></h3>
                <button type="button" class="btn ghost small" data-close>بستن ✕</button>
              </div>
              ${list.length ? `<div class="emp-drill-list">${list.map((u) => `
                <button type="button" class="emp-drill-item" data-id="${u.id}">
                  ${AP.avatar(u.fullName, 'sm', u.id)}
                  <span class="emp-drill-name"><b>${esc(u.fullName)}</b><span class="muted">${esc(u.department || '—')}${u.personnelCode ? ` · کد ${esc(faD(u.personnelCode))}` : ''}</span></span>
                  <span class="emp-drill-shift">${u.shiftName ? `${esc(u.shiftName)} <span class="ltr muted">${esc(u.shiftTime)}</span>` : '<span class="muted">شیفت پیش‌فرض</span>'}</span>
                </button>`).join('')}</div>` : emptyBox('کارمندی در این وضعیت نیست.')}`;
            drill.hidden = false;
          };
          $('#emp-stats', page).addEventListener('click', (e) => {
            const b = e.target.closest('.emp-stat.is-click');
            if (!b) return;
            if (drillSt === b.dataset.st) closeDrill(); else openDrill(b.dataset.st);
          });
          drill.addEventListener('click', (e) => {
            if (e.target.closest('[data-close]')) { closeDrill(); return; }
            const it = e.target.closest('.emp-drill-item[data-id]');
            if (it) AP.go('profile', it.dataset.id);
          });
          draw();
          $$('.emp-toolbar input, .emp-toolbar select', page).forEach((el) => el.addEventListener('input', draw));
          body.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) AP.go('profile', tr.dataset.id); });
          $('#emp-cards', page).addEventListener('click', (e) => { const c = e.target.closest('.emp-card[data-id]'); if (c) AP.go('profile', c.dataset.id); });
          // تغییر نمای کارتی/جدولی (انتخاب کاربر در مرورگر نگه داشته می‌شود)
          const setView = (v) => {
            $('#emp-cards', page).hidden = v !== 'cards';
            $('#emp-table', page).hidden = v !== 'table';
            $$('[data-emp-view]', page).forEach((b) => b.setAttribute('aria-pressed', b.dataset.empView === v ? 'true' : 'false'));
            try { window.localStorage.setItem('emp-view', v); } catch (_) { /* ignore */ }
          };
          let savedView = 'cards';
          try { if (window.localStorage.getItem('emp-view') === 'table') savedView = 'table'; } catch (_) { /* ignore */ }
          setView(savedView);
          $$('[data-emp-view]', page).forEach((b) => b.addEventListener('click', () => setView(b.dataset.empView)));
          const add = $('#add-emp', page);
          if (add) add.addEventListener('click', () => {
            AP.modal({
              title: 'افزودن کارمند جدید',
              wide: true,
              body: `<form class="form">${employeeFormFields(null, users)}<div class="form-msg err"></div>
                <div class="modal-actions"><button class="btn primary" type="submit">افزودن</button></div></form>`,
              onMount(b, h) {
                $('form', b).addEventListener('submit', async (ev) => {
                  ev.preventDefault();
                  const f = AP.formData(ev.target);
                  try {
                    await AP.api('/admin/users', { method: 'POST', body: { ...f, managerId: f.managerId ? Number(f.managerId) : null } });
                    h.close();
                    AP.toast('کارمند اضافه شد.');
                    AP.state.users = null;
                    AP.refresh();
                  } catch (err) { $('.form-msg', b).textContent = err.message; }
                });
              },
            });
          });
        },
      };
    },
  });

  // ======================================================
  // پرونده‌ی کارمند
  // ======================================================
  const profileUi = { from: '', to: '', tab: 'attendance' }; // from/to خالی ⇒ پیش‌فرض «۳۰ روز اخیر»
  const PF_MONTHS_BACK = 12; // منوی «ماه کامل»: ماه جاری + ۱۱ ماه قبل
  // بازه‌ی انتخاب‌شده ⇒ { from, to } (از نوار بازه؛ پیش‌فرض ۳۰ روز اخیر)
  const pfRange = () => (profileUi.from && profileUi.to
    ? { from: profileUi.from, to: profileUi.to }
    : { from: fmt.daysAgo(29), to: fmt.today() });

  AP.view('profile', {
    skeleton: 'page', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'users.details.read',
    navId: 'employees',
    async render(param) {
      if (!param) throw new Error('کارمندی انتخاب نشده است.');
      const { from, to } = pfRange();
      const [d, users, shiftList] = await Promise.all([
        AP.api(`/admin/users/${param}/details?from=${from}&to=${to}`),
        AP.loadUsers(),
        AP.can('shifts.edit', 'shifts.read') ? AP.api('/admin/shifts').catch(() => []) : [], // S3-9e: فقط برای کارت انتساب شیفت
      ]);
      const u = d.user;
      const s = d.stats;
      const todayRec = d.todayState;
      let todayKey = 'absent';
      if (todayRec) {
        if (todayRec.status === 'leave' || todayRec.status === 'holiday' || todayRec.status === 'incomplete') todayKey = todayRec.status;
        else if (todayRec.check_out_time) todayKey = 'checked_out';
        else if (todayRec.breaks.some((b) => !b.end_time)) todayKey = 'on_break';
        else if (todayRec.check_in_time) todayKey = 'present';
      } else if (d.onLeaveToday) todayKey = 'leave';

      // کاشی‌های آمار پروفایل: عدد و واحد در یک خط؛ گروه «نیازمند توجه» وقتی صفر است کم‌رنگ و با تیک نشان داده می‌شود
      const durHtml = (m) => {
        if (m == null || Number.isNaN(m)) return '<span class="prk-v">—</span>';
        const abs = Math.abs(Math.round(m));
        const h = Math.floor(abs / 60);
        const r = abs % 60;
        const part = (n, u) => `<span class="prk-v">${fmt.num(n)}</span><span class="prk-u">${u}</span>`;
        if (!h) return part(r, 'دقیقه');
        return part(h, 'ساعت') + (r ? part(r, 'دقیقه') : '');
      };
      const cntHtml = (n, unit) => `<span class="prk-v">${fmt.num(n)}</span><span class="prk-u">${unit}</span>`;
      const kpi = (tone, ic, label, valueHtml, hint, zero) => `
        <div class="prk${zero ? ' is-zero' : ''}" data-tone="${zero ? 'gray' : tone}">
          <span class="prk-ico">${icon(zero ? 'check' : ic)}</span>
          <span class="prk-body">
            <span class="prk-label">${label}</span>
            <span class="prk-val">${valueHtml}</span>
            ${hint || zero ? `<span class="prk-hint">${hint || 'بدون مورد'}</span>` : ''}
          </span>
        </div>`;

      const tabs = [['attendance', 'تردد'], ['leave', 'مرخصی و مأموریت'], ['disputes', 'اعتراض‌ها'], ['info', 'اطلاعات و ویرایش']];
      if (AP.scheduleTab && AP.can('schedule.read')) tabs.push(['schedule', 'برنامه‌ی روزبه‌روز']); // B2
      if (d.team.length) tabs.push(['team', 'اعضای تیم']);
      if (AP.can('audit.read')) tabs.push(['activity', 'سوابق و رویدادها']);
      if (!tabs.some((t) => t[0] === profileUi.tab)) profileUi.tab = 'attendance';

      const html = `
        ${AP.can('users.read') ? '<div class="view-header"><button class="btn ghost small" data-go="employees">→ بازگشت به کارمندان</button></div>' : ''}

        <div class="card profile-head">
          ${AP.avatar(u.fullName, 'lg', u.id)}
          <div class="grow">
            <h2>${esc(u.fullName)}</h2>
            <div class="tags">
              ${AP.badge(['admin', 'owner'].includes(u.role) ? 'purple' : u.role === 'manager' ? 'blue' : '', AP.ROLE[u.role])}
              ${AP.badge('', u.department || 'بدون دپارتمان')}
              ${u.personnelCode ? AP.badge('', `کد ${faD(u.personnelCode)}`) : ''}
              ${u.isActive ? AP.badge('green', 'فعال') : AP.badge('red', 'غیرفعال')}
              ${AP.stateBadge(todayKey)}
              ${d.lateLimit && d.lateLimit.limit > 0 ? AP.badge(d.lateLimit.overLimit ? 'red' : '', `تأخیر این ماه: ${fmt.num(d.lateLimit.lateCount)} از ${fmt.num(d.lateLimit.limit)}${d.lateLimit.enabled ? '' : ' (اعمال خاموش)'}`) : ''}
            </div>
            <div class="muted mt profile-meta">سرپرست مستقیم: ${esc(u.managerName || '—')} · عضویت از ${esc(fmt.dateLong(u.createdAt))}</div>
          </div>
          <div class="header-actions">
            ${AP.can('team.week_view') ? `<button class="btn ghost" id="pf-week">${icon('reports')} برنامه‌ی هفتگی</button>` : ''}
            ${u.telegramUserId && AP.can('users.message') ? `<button class="btn ghost" id="pf-msg">${icon('mail')} پیام تلگرام</button>` : ''}
            ${AP.can('records.edit') ? `<button class="btn ghost" id="pf-rec">${icon('plus')} ثبت دستی تردد</button>` : ''}${AP.can('leave.edit') ? `<button class="btn ghost" id="pf-leave">${icon('leave')} ثبت مرخصی</button>` : ''}
            ${AP.can('users.write') ? `<button class="btn ghost" id="pf-revoke" title="باطل‌کردن همه‌ی نشست‌های ورود این کاربر در پنل">خروج از همه‌ی نشست‌ها</button>` : ''}
            ${AP.can('users.write') && u.id !== AP.state.me.id ? `<button class="btn danger" id="pf-del">حذف کارمند</button>` : ''}
          </div>
        </div>

        <div class="filters u-mb-12" id="pf-range">
          ${AP.rangeBar.html({ from: d.range.from, to: d.range.to, label: 'بازه‌ی آمار', presets: ['7', '14', '30', '90'], months: PF_MONTHS_BACK })}
        </div>

        <div class="prk-kpis">
          <section class="prk-group" aria-label="عملکرد این بازه">
            <h4 class="prk-title">عملکرد در این بازه</h4>
            <div class="prk-row">
              ${kpi('green', 'in', 'روز حضور', cntHtml(s.presentDays, 'روز'), s.avgCheckIn ? `میانگین ورود ${faD(s.avgCheckIn.slice(0, 5))}` : '')}
              ${kpi('blue', 'clock', 'مجموع ساعت مفید', durHtml(s.totalEffective), `میانگین روزانه ${fmt.min(s.avgEffective)}`)}
              ${kpi('purple', 'clock', 'اضافه‌کاری', durHtml(s.overtimeMinutes), '')}
              ${kpi('blue', 'leave', 'مرخصی', cntHtml(s.leaveDays, 'روز'), '')}
            </div>
          </section>
          <section class="prk-group" aria-label="موارد نیازمند توجه">
            <h4 class="prk-title">موارد نیازمند توجه</h4>
            <div class="prk-row">
              ${kpi('orange', 'alert', 'ورود با تأخیر', cntHtml(s.lateCount, 'بار'), s.totalLateMinutes ? `جمعاً ${fmt.min(s.totalLateMinutes)}` : '', !s.lateCount)}
              ${kpi('red', 'out', 'خروج زودهنگام', cntHtml(s.earlyLeaveCount, 'بار'), s.totalEarlyMinutes ? `جمعاً ${fmt.min(s.totalEarlyMinutes)}` : '', !s.earlyLeaveCount)}
              ${kpi('gray', 'alert', 'رکورد ناقص', cntHtml(s.incompleteCount, 'مورد'), '', !s.incompleteCount)}
            </div>
          </section>
        </div>

        <div class="tabs" id="pf-tabs">${tabs.map(([k, l]) => `<button class="tab ${k === profileUi.tab ? 'active' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
        <div id="pf-panel"></div>`;

      const panels = {
        attendance() {
          if (!d.records.length) return `<div class="card">${emptyBox('در این بازه رکوردی ثبت نشده است.')}</div>`;
          // گروه‌بندی برای فیلتر سریع: عادی / تأخیر / ناقص / مرخصی و تعطیل
          const groupOf = (st) => (st === 'normal' ? 'normal' : st === 'late' ? 'late' : st === 'incomplete' ? 'incomplete' : 'other');
          const toneOf = { normal: 'green', late: 'orange', incomplete: 'red', other: 'purple' };
          const GROUP_LABEL = { normal: 'عادی', late: 'با تأخیر', incomplete: 'ناقص', other: 'مرخصی / تعطیل' };
          const counts = { normal: 0, late: 0, incomplete: 0, other: 0 };
          d.records.forEach((r) => { counts[groupOf(r.status)] += 1; });
          const maxEff = Math.max(1, ...d.records.map((r) => (r.summary.effectiveMinutes > 0 ? r.summary.effectiveMinutes : 0)));
          const cleanIp = (v) => String(v || '').replace(/^::ffff:/i, '');
          const chips = [['all', 'همه', d.records.length]].concat(Object.keys(counts).filter((k) => counts[k]).map((k) => [k, GROUP_LABEL[k], counts[k]]));
          const dayCard = (r) => {
            const iso = String(r.record_date || '').slice(0, 10);
            const j = iso && window.Jalali.isoToJalali(iso);
            const g = groupOf(r.status);
            const eff = r.summary.effectiveMinutes;
            const late = r.summary.lateMinutes;
            const missingOut = r.check_in_time && !r.check_out_time;
            const ipTitle = (r.check_in_ip || r.check_out_ip) ? `IP ورود: ${cleanIp(r.check_in_ip) || '—'} · IP خروج: ${cleanIp(r.check_out_ip) || '—'}` : '';
            return `
            <button type="button" class="atd-day" data-rec="${r.id}" data-group="${g}" data-tone="${toneOf[g]}">
              <span class="atd-date" aria-hidden="true"><em>${esc(j ? window.Jalali.weekdayName(iso) : '')}</em><b>${j ? fmt.num(j.jd) : '—'}</b><small>${esc(j ? window.Jalali.MONTH_NAMES[j.jm - 1] : '')}</small></span>
              <span class="atd-times">
                <span class="atd-t"><em>ورود</em><b>${r.check_in_time ? fmt.clock(r.check_in_time) : '—'}</b></span>
                <span class="atd-arrow" aria-hidden="true">←</span>
                <span class="atd-t${missingOut ? ' is-missing' : ''}"><em>خروج</em><b>${r.check_out_time ? fmt.clock(r.check_out_time) : (missingOut ? 'ثبت نشده' : '—')}</b></span>
                ${r.segmentCount > 1 ? `<span class="atd-seg">${fmt.num(r.segmentCount)} نوبت</span>` : ''}
              </span>
              <span class="atd-metrics">
                <span class="atd-m"><em>ساعت مفید</em><b>${eff != null ? fmt.min(eff) : '—'}</b>${eff > 0 ? `<i class="atd-bar"><i style="--w:${Math.max(4, Math.round((eff / maxEff) * 100))}%"></i></i>` : ''}</span>
                <span class="atd-m"><em>استراحت</em><b>${r.breaks.length ? `${fmt.num(r.breaks.length)} بار · ${fmt.min(r.breakMinutes)}` : 'بدون استراحت'}</b></span>
                ${late ? `<span class="atd-m is-late"><em>تأخیر</em><b>${fmt.min(late)}</b></span>` : ''}
              </span>
              <span class="atd-state">
                ${AP.statusBadge(r.status)}${r.via_remote ? ` ${AP.badge('purple', 'دورکاری')}` : ''}
                ${ipTitle ? `<span class="atd-ip" title="${esc(ipTitle)}">IP</span>` : ''}
              </span>
            </button>`;
          };
          return `
            <div class="atd-filters" role="group" aria-label="فیلتر وضعیت">
              ${chips.map(([k, l, n], i) => `<button type="button" class="atd-chip" data-att-filter="${k}" aria-pressed="${i === 0 ? 'true' : 'false'}">${l} <b>${fmt.num(n)}</b></button>`).join('')}
            </div>
            <div class="atd-list">${d.records.map(dayCard).join('')}</div>
            <div class="atd-none" hidden>${emptyBox('رکوردی با این فیلتر نیست.')}</div>`;
        },
        leave() {
          if (!d.leaves.length) return `<div class="card">${emptyBox('درخواستی ثبت نشده است.')}</div>`;
          return `<div class="list">${d.leaves.map((l) => `
            <div class="item"><div class="grow"><div class="title">${AP.badge(l.leave_type === 'mission' ? 'mission' : 'leave', AP.LEAVE_TYPE[l.leave_type])} ${AP.badge(l.status, AP.LEAVE_STATUS[l.status])}</div>
              <div class="meta">${esc(fmt.dateLong(l.start_date))} تا ${esc(fmt.dateLong(l.end_date))} · ثبت: ${esc(fmt.dateTime(l.created_at))}</div>
              ${l.reason ? `<p class="text">${esc(l.reason)}</p>` : ''}</div>
              ${AP.can('leave.edit') ? `<button class="btn ghost small" data-leave="${l.id}">ویرایش</button>` : ''}</div>`).join('')}</div>`;
        },
        disputes() {
          if (!d.disputes.length) return `<div class="card">${emptyBox('اعتراضی ثبت نشده است.')}</div>`;
          return `<div class="list">${d.disputes.map((x) => `
            <div class="item"><div class="grow"><div class="title">${AP.badge(x.status, x.status === 'open' ? 'باز' : 'بسته‌شده')}
              <span class="muted font-regular">${esc(fmt.dateTime(x.created_at))}</span></div><p class="text">${esc(x.message)}</p></div>
              <button class="btn ghost small" data-go-disputes>مدیریت اعتراض‌ها</button></div>`).join('')}</div>`;
        },
        info() {
          if (!AP.can('users.write')) {
            return `<div class="card"><div class="kv">
              <div class="kv-row"><span>نام</span><span>${esc(u.fullName)}</span></div>
              <div class="kv-row"><span>کد پرسنلی</span><span>${esc(faD(u.personnelCode || '—'))}</span></div>
              <div class="kv-row"><span>دپارتمان</span><span>${esc(u.department || '—')}</span></div>
              <div class="kv-row"><span>نقش</span><span>${esc(AP.ROLE[u.role])}</span></div>
              <div class="kv-row"><span>آیدی تلگرام</span><span class="ltr">${esc(u.telegramUserId || '—')}</span></div></div></div>`;
          }
          const full = users.find((x) => x.id === u.id) || { ...u, managerId: u.managerId };
          return `<div class="card"><form class="form" id="pf-form">${employeeFormFields({ ...full, managerId: u.managerId, isActive: u.isActive }, users)}
            <div class="form-msg"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">ذخیره تغییرات</button></div></form></div>${AP.shiftAssignCard && AP.can('shifts.edit') ? AP.shiftAssignCard(u, shiftList) : ''}`;
        },
        team() {
          return `<div class="list">${d.team.map((m) => `
            <a class="item u-link-inherit" href="#/profile/${m.id}">${AP.avatar(m.fullName, 'sm', m.id)}
              <div class="grow"><div class="title">${esc(m.fullName)}</div><div class="meta">${esc(m.department || '—')}</div></div>
              ${m.isActive ? AP.badge('green', 'فعال') : AP.badge('red', 'غیرفعال')}</a>`).join('')}</div>`;
        },
        activity() {
          if (!(d.audit || []).length) return `<div class="card">${emptyBox('رویدادی ثبت نشده است.')}</div>`;
          return `<div class="card flush"><div class="table-wrap"><table>
            <thead><tr><th>زمان</th><th>انجام‌دهنده</th><th>رویداد</th><th>IP</th><th>جزئیات</th></tr></thead><tbody>
            ${(d.audit || []).map((r) => `<tr><td class="num">${esc(fmt.dateTime(r.occurred_at))}</td><td>${esc(r.userFullName || '—')}</td>
              <td>${esc(r.action)}</td><td><span class="ltr muted">${esc(r.ip_address || '—')}</span></td>
              <td class="wrap"><div class="details-box">${esc(r.details || '')}</div></td></tr>`).join('')}</tbody></table></div></div>`;
        },
      };

      panels.schedule = () => (AP.scheduleTab ? AP.scheduleTab.html() : '');

      return {
        html,
        mount(page) {
          const panel = $('#pf-panel', page);
          const drawTab = () => {
            panel.innerHTML = panels[profileUi.tab]();
            $$('#pf-tabs .tab', page).forEach((t) => t.classList.toggle('active', t.dataset.tab === profileUi.tab));
            $$('[data-rec]', panel).forEach((el) => el.addEventListener('click', () => AP.openRecord(el.dataset.rec)));
            $$('[data-att-filter]', panel).forEach((b) => b.addEventListener('click', () => {
              const f = b.dataset.attFilter;
              $$('[data-att-filter]', panel).forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
              $$('.atd-day', panel).forEach((c) => { c.hidden = !(f === 'all' || c.dataset.group === f); });
              const none = $('.atd-none', panel);
              if (none) none.hidden = $$('.atd-day:not([hidden])', panel).length > 0;
            }));
            $$('[data-leave]', panel).forEach((el) => el.addEventListener('click', () => AP.openLeaveEditor(el.dataset.leave)));
            $$('[data-go-disputes]', panel).forEach((el) => el.addEventListener('click', () => AP.go('disputes')));
            if (AP.bindShiftAssign) AP.bindShiftAssign(panel, u);
            if (profileUi.tab === 'schedule' && AP.scheduleTab) AP.scheduleTab.mount(panel, u);
            const form = $('#pf-form', panel);
            // Phase 20: نرخ ساعتی جدا از پروفایل (پاسخ عمومی کاربر آن را ندارد) بارگذاری می‌شود؛ تا بارگذاری موفق نشده فیلد غیرفعال است و در PATCH نمی‌رود (نرخ بی‌خبر پاک نمی‌شود).
            const rateInput = form ? form.querySelector('[name="hourlyRateKt"]') : null;
            if (rateInput) {
              AP.api(`/admin/users/${u.id}/hourly-rate`).then((r) => {
                rateInput.value = r && r.hourlyRateKt != null ? String(r.hourlyRateKt) : '';
                rateInput.placeholder = 'تعریف نشده';
                rateInput.disabled = false;
                rateInput.dataset.loaded = '1';
              }).catch(() => { rateInput.placeholder = 'بارگذاری نشد'; });
            }
            if (form) form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              const rateField = rateInput && rateInput.dataset.loaded === '1' ? { hourlyRateKt: String(f.hourlyRateKt || '').replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))) } : {};
              const ok = await AP.attempt(() => AP.api(`/admin/users/${u.id}`, { method: 'PATCH', body: {
                fullName: f.fullName, personnelCode: f.personnelCode, department: f.department, role: f.role,
                managerId: f.managerId ? Number(f.managerId) : null, telegramUserId: f.telegramUserId, isActive: f.isActive, ...rateField } }), 'تغییرات ذخیره شد.');
              if (ok) { AP.state.users = null; AP.refresh(); }
            });
          };
          drawTab();
          $('#pf-tabs', page).addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { profileUi.tab = t.dataset.tab; drawTab(); } });
          const pfBox = $('#pf-range', page);
          AP.dates.mount(pfBox);
          AP.rangeBar.bind(pfBox, { onApply: (from, to) => { profileUi.from = from; profileUi.to = to; AP.refresh(); } });
          $$('[data-go]', page).forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.go)));
          const week = $('#pf-week', page); if (week) week.addEventListener('click', () => AP.go('weekly', u.id));
          const msg = $('#pf-msg', page); if (msg) msg.addEventListener('click', () => AP.openMessage(u.id));
          const rec = $('#pf-rec', page); if (rec) rec.addEventListener('click', () => AP.openCreateRecord({ userId: u.id }));
          const revoke = $('#pf-revoke', page);
          if (revoke) revoke.addEventListener('click', async () => {
            const reason = await AP.askReason({
              title: 'خروج از همه‌ی نشست‌ها', danger: true, confirmText: 'باطل‌کردن نشست‌ها',
              message: `همه‌ی نشست‌های ورود «${u.fullName}» به پنل باطل می‌شود و باید دوباره وارد شود.${u.id === AP.state.me.id ? ' (این حساب خود شماست؛ خودتان هم خارج می‌شوید.)' : ''}`,
            });
            if (reason === null) return;
            try {
              const r = await AP.api(`/admin/users/${u.id}/revoke-sessions`, { method: 'POST', body: { reason } });
              if (r.selfLoggedOut) { location.reload(); return; }
              AP.toast('نشست‌های کاربر باطل شد.');
            } catch (err) { AP.toast(err.message, true); }
          });
          const del = $('#pf-del', page);
          if (del) del.addEventListener('click', async () => {
            const first = await AP.confirmBox({
              title: 'حذف کارمند', danger: true, confirmText: 'حذف',
              message: `آیا از حذف «${u.fullName}» مطمئن هستید؟`,
            });
            if (!first) return;
            try {
              await AP.api(`/admin/users/${u.id}`, { method: 'DELETE' });
            } catch (err) {
              if (err.status === 409 && err.data && err.data.code === 'HAS_HISTORY') {
                const c = err.data.counts;
                const second = await AP.confirmBox({
                  title: 'حذف دائمی همراه با سوابق', danger: true, confirmText: 'حذف دائمی همه',
                  message: `«${u.fullName}» دارای ${fmt.num(c.attendance)} رکورد تردد، ${fmt.num(c.leave)} درخواست مرخصی/مأموریت و ${fmt.num(c.disputes)} اعتراض است. با ادامه، همه‌ی این سوابق برای همیشه پاک می‌شوند و قابل بازگشت نیست. اگر فقط می‌خواهید دسترسی او قطع شود، به‌جای حذف، در تب «اطلاعات و ویرایش» تیک «حساب فعال است» را بردارید.`,
                });
                if (!second) return;
                if (!(await AP.attempt(() => AP.api(`/admin/users/${u.id}?force=1`, { method: 'DELETE' })))) return;
              } else {
                AP.toast(err.message, true);
                return;
              }
            }
            AP.toast('کارمند حذف شد.');
            AP.state.users = null;
            AP.go('employees');
          });
          const lv = $('#pf-leave', page); if (lv) lv.addEventListener('click', () => AP.openLeaveCreate({ userId: u.id }));
        },
      };
    },
  });
})();
