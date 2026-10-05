// صفحه‌های اصلی: داشبورد، تابلوی زنده، کارمندان، پرونده‌ی کارمند.

(function () {
  'use strict';
  const { $, $$, esc, fmt, icon } = Object.assign({}, window.AP, { icon: (n) => window.AP.icon(n) });
  const AP = window.AP;

  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  // ---------- نمودار میله‌ای ۱۴ روز اخیر ----------
  function trendChart(trend) {
    const W = 720, H = 230, padT = 14, padB = 30, padX = 12;
    const max = Math.max(4, ...trend.map((t) => Math.max(t.present, t.late)));
    const niceMax = Math.ceil(max / 2) * 2;
    const step = (W - padX * 2) / trend.length;
    const bw = Math.min(16, step / 3);
    const y = (v) => padT + (H - padT - padB) * (1 - v / niceMax);
    let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="روند حضور ۱۴ روز اخیر">
      <defs><linearGradient id="bar-green" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7be495"/><stop offset="1" stop-color="#16b886"/></linearGradient></defs>`;
    for (let i = 0; i <= 4; i += 1) {
      const v = (niceMax / 4) * i;
      svg += `<line class="grid" x1="${padX}" x2="${W - 36}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text x="${W - 4}" y="${y(v) + 4}" text-anchor="end">${fmt.num(Math.round(v))}</text>`;
    }
    trend.forEach((t, i) => {
      // راست‌به‌چپ: قدیمی‌ترین روز سمت راست
      const cx = W - 44 - (i + 0.5) * ((W - 44 - padX) / trend.length);
      const day = new Date(`${t.date}T00:00:00`).toLocaleDateString('fa-IR', { day: 'numeric' });
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
  AP.view('dashboard', {
    nav: { icon: 'dashboard', label: 'داشبورد', group: 'نمای کلی' },
    async render() {
      const d = await AP.api('/admin/overview');
      const t = d.totals;
      const tiles = [
        ['present', 'حاضر در شرکت', t.present, 'g-green', 'in'],
        ['on_break', 'در استراحت', t.onBreak, 'g-orange', 'coffee'],
        ['checked_out', 'خروج کرده‌اند', t.checkedOut, 'g-purple', 'out'],
        ['absent', 'هنوز نیامده / غایب', t.absent, 'g-red', 'alert'],
        ['leave', 'در مرخصی', t.onLeave, 'g-blue', 'leave'],
        ['late', 'ورود با تأخیر امروز', t.late, 'g-orange', 'clock'],
        ['incomplete', 'رکورد ناقص', t.incomplete, 'g-gray', 'alert'],
      ];
      const html = `
        <div class="view-header">
          <div><h2>سلام ${esc(AP.state.me.fullName)} 👋</h2>
            <div class="sub">وضعیت امروز، ${esc(fmt.dateLong(d.date))}${t.holiday ? ' — امروز تعطیل رسمی است' : ''}</div></div>
          <div class="header-actions">
            ${d.pending.leave ? `<button class="btn ghost" data-go="leave">${icon('leave')} ${fmt.num(d.pending.leave)} درخواست در انتظار</button>` : ''}
            ${d.pending.disputes ? `<button class="btn ghost" data-go="disputes">${icon('disputes')} ${fmt.num(d.pending.disputes)} اعتراض باز</button>` : ''}
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat"><div class="stat-icon g-green">${icon('employees')}</div>
            <div class="stat-value">${fmt.num(t.employees)}</div><div class="stat-label">کارمند فعال</div></div>
          ${tiles.map(([key, label, val, g, ic]) => `
            <button class="stat" data-go="live" data-param="${key}">
              <div class="stat-icon ${g}">${icon(ic)}</div>
              <div class="stat-value">${fmt.num(val)}</div><div class="stat-label">${esc(label)}</div></button>`).join('')}
        </div>

        <div class="grid-2">
          <div class="card"><h3>روند حضور ۱۴ روز اخیر</h3>
            <div class="legend"><span><i style="background:#16b886"></i>حاضر</span><span><i style="background:#ffa94d"></i>ورود با تأخیر</span></div>
            ${trendChart(d.trend)}</div>

          <div class="card"><h3>حضور امروز به تفکیک دپارتمان</h3>
            ${d.departments.length ? d.departments.map((x) => `
              <div class="hbar"><div class="hbar-top"><span>${esc(x.name)}</span><span>${fmt.num(x.present)} از ${fmt.num(x.total)}</span></div>
              <div class="hbar-track"><div class="hbar-fill" style="width:${x.total ? Math.round((x.present / x.total) * 100) : 0}%"></div></div></div>`).join('') : emptyBox('دپارتمانی ثبت نشده است.')}
          </div>
        </div>

        <div class="grid-2 mt">
          <div class="card"><h3>بیشترین تأخیر در ۳۰ روز اخیر</h3>
            ${d.topLate.length ? `<div class="kv">${d.topLate.map((x) => `
              <div class="kv-row"><span><a href="#/profile/${x.userId}" style="color:inherit">${esc(x.fullName)}</a></span>
              <span>${fmt.num(x.count)} بار · ${fmt.min(x.minutes)}</span></div>`).join('')}</div>` : emptyBox('تأخیری ثبت نشده است. 🎉')}
          </div>

          <div class="card"><h3>${AP.state.isAdmin ? 'آخرین رویدادها' : 'ساعت کاری'}</h3>
            ${AP.state.isAdmin ? (d.recentActivity.length ? `<div class="kv">${d.recentActivity.map((r) => `
              <div class="kv-row"><span>${esc(r.userFullName || '—')} · ${esc(r.action)}</span><span class="muted">${esc(fmt.dateTime(r.occurred_at))}</span></div>`).join('')}</div>
              <div class="mt"><button class="btn ghost small" data-go="audit">مشاهده‌ی همه</button></div>` : emptyBox('رویدادی ثبت نشده است.'))
              : `<div class="kv"><div class="kv-row"><span>شروع کار</span><span class="ltr">${esc(d.settings.workDayStart)}</span></div>
                 <div class="kv-row"><span>پایان کار</span><span class="ltr">${esc(d.settings.workDayEnd)}</span></div>
                 <div class="kv-row"><span>مهلت تأخیر</span><span>${fmt.num(d.settings.lateCheckinGraceMinutes)} دقیقه</span></div></div>`}
          </div>
        </div>`;
      return {
        html,
        mount(page) {
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
            <input id="live-q" type="search" placeholder="جستجوی نام…" style="width:200px" />
          </div>
        </div>
        <div class="chips" id="live-chips"></div>
        <div class="card flush"><div class="table-wrap"><table>
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
                <td><a class="cell-user" href="#/profile/${r.user.id}" style="color:inherit;text-decoration:none">${AP.avatar(r.user.fullName, 'sm')}
                  <span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '—')}</small></span></a></td>
                <td>${AP.stateBadge(r.state)} ${r.late ? AP.badge('late', `تأخیر ${fmt.min(r.summary.lateMinutes)}`) : ''} ${r.onMission ? AP.badge('mission', 'مأموریت') : ''}</td>
                <td class="num">${rec && rec.check_in_time ? fmt.clock(rec.check_in_time) : '—'}</td>
                <td class="num">${rec && rec.check_out_time ? fmt.clock(rec.check_out_time) : '—'}</td>
                <td class="num">${r.summary && r.summary.effectiveMinutes != null ? fmt.min(r.summary.effectiveMinutes) : '—'}</td>
                <td class="num">${r.state === 'on_break' ? 'از ' + fmt.clock(r.openBreak.start_time) : r.breakMinutes ? fmt.min(r.breakMinutes) : '—'}</td>
                <td><span class="ltr muted">${esc(rec && rec.check_in_ip ? rec.check_in_ip : '—')}</span></td>
                <td><div class="row-actions">
                  ${AP.state.isStaff ? (rec ? `<button class="btn ghost small" data-rec="${rec.id}">رکورد</button>`
                    : `<button class="btn ghost small" data-new="${r.user.id}">ثبت دستی</button>`) : ''}
                  ${r.user.telegramUserId ? `<button class="btn ghost small" data-msg="${r.user.id}" title="ارسال پیام تلگرام">${AP.icon('mail')}</button>` : ''}
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
    const managers = users.filter((x) => ['manager', 'admin'].includes(x.role) && x.isActive && (!u || x.id !== u.id));
    return `
      <div class="form-grid">
        <label class="field"><span>نام و نام‌خانوادگی</span><input name="fullName" required value="${esc(u ? u.fullName : '')}" /></label>
        <label class="field"><span>کد پرسنلی</span><input name="personnelCode" value="${esc(u ? u.personnelCode || '' : '')}" /></label>
        <label class="field"><span>دپارتمان</span><input name="department" list="dept-list" value="${esc(u ? u.department || '' : '')}" />
          <datalist id="dept-list">${[...new Set(users.map((x) => x.department).filter(Boolean))].map((d) => `<option value="${esc(d)}">`).join('')}</datalist></label>
        <label class="field"><span>نقش</span><select name="role">
          ${Object.entries(AP.ROLE).map(([k, v]) => `<option value="${k}" ${u && u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>سرپرست مستقیم</span><select name="managerId"><option value="">— ندارد —</option>
          ${managers.map((m) => `<option value="${m.id}" ${u && u.managerId === m.id ? 'selected' : ''}>${esc(m.fullName)}</option>`).join('')}</select></label>
        <label class="field"><span>آیدی عددی تلگرام</span><input name="telegramUserId" class="ltr" inputmode="numeric" value="${esc(u ? u.telegramUserId || '' : '')}" /></label>
        ${u ? `<label class="check-row full" style="grid-column:1/-1"><input type="checkbox" name="isActive" ${u.isActive ? 'checked' : ''} /> حساب فعال است</label>` : ''}
      </div>`;
  }
  AP.employeeFormFields = employeeFormFields;

  AP.view('employees', {
    nav: { icon: 'employees', label: 'کارمندان', group: 'کارمندان و تردد' },
    async render() {
      const users = await AP.loadUsers(true);
      const byId = new Map(users.map((u) => [u.id, u]));
      const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
      const html = `
        <div class="view-header">
          <div><h2>کارمندان</h2><div class="sub">${fmt.num(users.length)} نفر ثبت‌شده</div></div>
          <div class="header-actions">
            <a class="btn ghost" href="/api/admin/users/export" download>${icon('download')} خروجی CSV</a>
            ${AP.state.isAdmin ? `<button class="btn primary" id="add-emp">${icon('plus')} افزودن کارمند</button>` : ''}
          </div>
        </div>
        <div class="filters">
          <label class="field grow"><span>جستجو</span><input id="f-q" type="search" placeholder="نام یا کد پرسنلی…" /></label>
          <label class="field"><span>دپارتمان</span><select id="f-dept"><option value="">همه</option>${depts.map((d) => `<option>${esc(d)}</option>`).join('')}</select></label>
          <label class="field"><span>نقش</span><select id="f-role"><option value="">همه</option>${Object.entries(AP.ROLE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field"><span>وضعیت حساب</span><select id="f-active"><option value="">همه</option><option value="1">فعال</option><option value="0">غیرفعال</option></select></label>
        </div>
        <div class="card flush"><div class="table-wrap"><table>
          <thead><tr><th>کارمند</th><th>کد پرسنلی</th><th>دپارتمان</th><th>نقش</th><th>سرپرست مستقیم</th><th>وضعیت امروز</th><th>آیدی تلگرام</th><th>حساب</th></tr></thead>
          <tbody id="emp-body"></tbody></table></div></div>`;
      const todayMap = { not_checked_in: 'absent', checked_in: 'present', checked_out: 'checked_out', incomplete: 'incomplete', holiday: 'holiday', leave: 'leave' };
      return {
        html,
        mount(page) {
          const body = $('#emp-body', page);
          const draw = () => {
            const q = $('#f-q', page).value.trim().toLowerCase();
            const dp = $('#f-dept', page).value;
            const rl = $('#f-role', page).value;
            const ac = $('#f-active', page).value;
            const list = users.filter((u) =>
              (!q || u.fullName.toLowerCase().includes(q) || (u.personnelCode || '').toLowerCase().includes(q)) &&
              (!dp || u.department === dp) && (!rl || u.role === rl) && (!ac || String(u.isActive ? 1 : 0) === ac));
            body.innerHTML = list.length ? list.map((u) => `
              <tr class="clickable ${u.isActive ? '' : 'inactive'}" data-id="${u.id}">
                <td><div class="cell-user">${AP.avatar(u.fullName, 'sm')}<span><b>${esc(u.fullName)}</b></span></div></td>
                <td class="num">${esc(u.personnelCode || '—')}</td>
                <td>${esc(u.department || '—')}</td>
                <td>${AP.badge(u.role === 'admin' ? 'purple' : u.role === 'manager' ? 'blue' : '', AP.ROLE[u.role])}</td>
                <td>${esc(u.managerId && byId.get(u.managerId) ? byId.get(u.managerId).fullName : '—')}</td>
                <td>${AP.stateBadge(todayMap[u.todayStatus] || 'absent')}</td>
                <td><span class="ltr muted">${esc(u.telegramUserId || '—')}</span></td>
                <td>${u.isActive ? AP.badge('green', 'فعال') : AP.badge('red', 'غیرفعال')}</td></tr>`).join('')
              : `<tr><td colspan="8">${emptyBox('کارمندی با این فیلتر پیدا نشد.')}</td></tr>`;
          };
          draw();
          $$('.filters input, .filters select', page).forEach((el) => el.addEventListener('input', draw));
          body.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) AP.go('profile', tr.dataset.id); });
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
  const profileUi = { days: 30, tab: 'attendance' };

  AP.view('profile', {
    employee: true,
    navId: 'employees',
    async render(param) {
      if (!param) throw new Error('کارمندی انتخاب نشده است.');
      const from = fmt.daysAgo(profileUi.days - 1);
      const to = fmt.today();
      const [d, users] = await Promise.all([
        AP.api(`/admin/users/${param}/details?from=${from}&to=${to}`),
        AP.loadUsers(),
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

      const stat = (g, ic, v, l, hint) => `<div class="stat"><div class="stat-icon ${g}">${icon(ic)}</div><div class="stat-value" style="font-size:21px">${v}</div><div class="stat-label">${l}</div>${hint ? `<div class="stat-hint">${hint}</div>` : ''}</div>`;

      const tabs = [['attendance', 'تردد'], ['leave', 'مرخصی و مأموریت'], ['disputes', 'اعتراض‌ها'], ['info', 'اطلاعات و ویرایش']];
      if (d.team.length) tabs.push(['team', 'اعضای تیم']);
      if (AP.state.isAdmin) tabs.push(['activity', 'سوابق و رویدادها']);
      if (!tabs.some((t) => t[0] === profileUi.tab)) profileUi.tab = 'attendance';

      const html = `
        ${AP.state.isEmployee ? '' : '<div class="view-header"><button class="btn ghost small" data-go="employees">→ بازگشت به کارمندان</button></div>'}

        <div class="card profile-head">
          ${AP.avatar(u.fullName, 'lg')}
          <div class="grow">
            <h2>${esc(u.fullName)}</h2>
            <div class="tags">
              ${AP.badge(u.role === 'admin' ? 'purple' : u.role === 'manager' ? 'blue' : '', AP.ROLE[u.role])}
              ${AP.badge('', u.department || 'بدون دپارتمان')}
              ${u.personnelCode ? AP.badge('', `کد ${u.personnelCode}`) : ''}
              ${u.isActive ? AP.badge('green', 'فعال') : AP.badge('red', 'غیرفعال')}
              ${AP.stateBadge(todayKey)}
            </div>
            <div class="muted mt" style="margin-top:10px;font-size:12.5px">سرپرست مستقیم: ${esc(u.managerName || '—')} · عضویت از ${esc(fmt.dateLong(u.createdAt))}</div>
          </div>
          <div class="header-actions">
            ${u.telegramUserId && AP.state.isStaff ? `<button class="btn ghost" id="pf-msg">${icon('mail')} پیام تلگرام</button>` : ''}
            ${AP.state.isStaff ? `<button class="btn ghost" id="pf-rec">${icon('plus')} ثبت دستی تردد</button><button class="btn ghost" id="pf-leave">${icon('leave')} ثبت مرخصی</button>` : ''}
            ${AP.state.isAdmin && u.id !== AP.state.me.id ? `<button class="btn danger" id="pf-del">حذف کارمند</button>` : ''}
          </div>
        </div>

        <div class="filters" style="margin-bottom:12px">
          <label class="field"><span>بازه‌ی آمار</span><select id="pf-days">
            ${[7, 14, 30, 60, 90, 180].map((n) => `<option value="${n}" ${n === profileUi.days ? 'selected' : ''}>${fmt.num(n)} روز اخیر</option>`).join('')}</select></label>
          <div class="muted" style="padding-bottom:10px">${esc(fmt.dateLong(d.range.from))} تا ${esc(fmt.dateLong(d.range.to))}</div>
        </div>

        <div class="stat-grid">
          ${stat('g-green', 'in', fmt.num(s.presentDays), 'روز حضور', s.avgCheckIn ? `میانگین ورود ${fmt.num(Number(s.avgCheckIn.slice(0, 2)))}:${s.avgCheckIn.slice(3)}` : '')}
          ${stat('g-blue', 'clock', fmt.min(s.totalEffective), 'مجموع ساعت مفید', `میانگین روزانه ${fmt.min(s.avgEffective)}`)}
          ${stat('g-orange', 'alert', fmt.num(s.lateCount), 'ورود با تأخیر', s.totalLateMinutes ? `جمعاً ${fmt.min(s.totalLateMinutes)}` : '')}
          ${stat('g-red', 'out', fmt.num(s.earlyLeaveCount), 'خروج زودهنگام', s.totalEarlyMinutes ? `جمعاً ${fmt.min(s.totalEarlyMinutes)}` : '')}
          ${stat('g-purple', 'clock', fmt.min(s.overtimeMinutes), 'اضافه‌کاری')}
          ${stat('g-gray', 'alert', fmt.num(s.incompleteCount), 'رکورد ناقص')}
          ${stat('g-blue', 'leave', fmt.num(s.leaveDays), 'روز مرخصی')}
        </div>

        <div class="tabs" id="pf-tabs">${tabs.map(([k, l]) => `<button class="tab ${k === profileUi.tab ? 'active' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
        <div id="pf-panel"></div>`;

      const panels = {
        attendance() {
          if (!d.records.length) return `<div class="card">${emptyBox('در این بازه رکوردی ثبت نشده است.')}</div>`;
          return `<div class="card flush"><div class="table-wrap"><table>
            <thead><tr><th>تاریخ</th><th>ورود</th><th>خروج</th><th>استراحت‌ها</th><th>ساعت مفید</th><th>تأخیر</th><th>IP ورود / خروج</th><th>وضعیت</th></tr></thead><tbody>
            ${d.records.map((r) => `<tr class="clickable" data-rec="${r.id}">
              <td>${esc(fmt.date(r.record_date))}</td>
              <td class="num">${fmt.clock(r.check_in_time)}</td><td class="num">${fmt.clock(r.check_out_time)}</td>
              <td class="num">${r.breaks.length ? `${fmt.num(r.breaks.length)} بار · ${fmt.min(r.breakMinutes)}` : '—'}</td>
              <td class="num">${r.summary.effectiveMinutes != null ? fmt.min(r.summary.effectiveMinutes) : '—'}</td>
              <td class="num">${r.summary.lateMinutes ? fmt.min(r.summary.lateMinutes) : '—'}</td>
              <td><span class="ltr muted">${esc(r.check_in_ip || '—')} / ${esc(r.check_out_ip || '—')}</span></td>
              <td>${AP.statusBadge(r.status)}</td></tr>`).join('')}
            </tbody></table></div></div>`;
        },
        leave() {
          if (!d.leaves.length) return `<div class="card">${emptyBox('درخواستی ثبت نشده است.')}</div>`;
          return `<div class="list">${d.leaves.map((l) => `
            <div class="item"><div class="grow"><div class="title">${AP.badge(l.leave_type === 'mission' ? 'mission' : 'leave', AP.LEAVE_TYPE[l.leave_type])} ${AP.badge(l.status, AP.LEAVE_STATUS[l.status])}</div>
              <div class="meta">${esc(fmt.dateLong(l.start_date))} تا ${esc(fmt.dateLong(l.end_date))} · ثبت: ${esc(fmt.dateTime(l.created_at))}</div>
              ${l.reason ? `<p class="text">${esc(l.reason)}</p>` : ''}</div>
              ${AP.state.isStaff ? `<button class="btn ghost small" data-leave="${l.id}">ویرایش</button>` : ''}</div>`).join('')}</div>`;
        },
        disputes() {
          if (!d.disputes.length) return `<div class="card">${emptyBox('اعتراضی ثبت نشده است.')}</div>`;
          return `<div class="list">${d.disputes.map((x) => `
            <div class="item"><div class="grow"><div class="title">${AP.badge(x.status, x.status === 'open' ? 'باز' : 'بسته‌شده')}
              <span class="muted" style="font-weight:400">${esc(fmt.dateTime(x.created_at))}</span></div><p class="text">${esc(x.message)}</p></div>
              <button class="btn ghost small" data-go-disputes>مدیریت اعتراض‌ها</button></div>`).join('')}</div>`;
        },
        info() {
          if (!AP.state.isAdmin) {
            return `<div class="card"><div class="kv">
              <div class="kv-row"><span>نام</span><span>${esc(u.fullName)}</span></div>
              <div class="kv-row"><span>کد پرسنلی</span><span>${esc(u.personnelCode || '—')}</span></div>
              <div class="kv-row"><span>دپارتمان</span><span>${esc(u.department || '—')}</span></div>
              <div class="kv-row"><span>نقش</span><span>${esc(AP.ROLE[u.role])}</span></div>
              <div class="kv-row"><span>آیدی تلگرام</span><span class="ltr">${esc(u.telegramUserId || '—')}</span></div></div></div>`;
          }
          const full = users.find((x) => x.id === u.id) || { ...u, managerId: u.managerId };
          return `<div class="card"><form class="form" id="pf-form">${employeeFormFields({ ...full, managerId: u.managerId, isActive: u.isActive }, users)}
            <div class="form-msg"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">ذخیره تغییرات</button></div></form></div>`;
        },
        team() {
          return `<div class="list">${d.team.map((m) => `
            <a class="item" href="#/profile/${m.id}" style="color:inherit;text-decoration:none">${AP.avatar(m.fullName, 'sm')}
              <div class="grow"><div class="title">${esc(m.fullName)}</div><div class="meta">${esc(m.department || '—')}</div></div>
              ${m.isActive ? AP.badge('green', 'فعال') : AP.badge('red', 'غیرفعال')}</a>`).join('')}</div>`;
        },
        activity() {
          if (!d.audit.length) return `<div class="card">${emptyBox('رویدادی ثبت نشده است.')}</div>`;
          return `<div class="card flush"><div class="table-wrap"><table>
            <thead><tr><th>زمان</th><th>انجام‌دهنده</th><th>رویداد</th><th>IP</th><th>جزئیات</th></tr></thead><tbody>
            ${d.audit.map((r) => `<tr><td class="num">${esc(fmt.dateTime(r.occurred_at))}</td><td>${esc(r.userFullName || '—')}</td>
              <td>${esc(r.action)}</td><td><span class="ltr muted">${esc(r.ip_address || '—')}</span></td>
              <td class="wrap"><div class="details-box">${esc(r.details || '')}</div></td></tr>`).join('')}</tbody></table></div></div>`;
        },
      };

      return {
        html,
        mount(page) {
          const panel = $('#pf-panel', page);
          const drawTab = () => {
            panel.innerHTML = panels[profileUi.tab]();
            $$('#pf-tabs .tab', page).forEach((t) => t.classList.toggle('active', t.dataset.tab === profileUi.tab));
            $$('[data-rec]', panel).forEach((el) => el.addEventListener('click', () => AP.openRecord(el.dataset.rec)));
            $$('[data-leave]', panel).forEach((el) => el.addEventListener('click', () => AP.openLeaveEditor(el.dataset.leave)));
            $$('[data-go-disputes]', panel).forEach((el) => el.addEventListener('click', () => AP.go('disputes')));
            const form = $('#pf-form', panel);
            if (form) form.addEventListener('submit', async (e) => {
              e.preventDefault();
              const f = AP.formData(form);
              const ok = await AP.attempt(() => AP.api(`/admin/users/${u.id}`, { method: 'PATCH', body: {
                fullName: f.fullName, personnelCode: f.personnelCode, department: f.department, role: f.role,
                managerId: f.managerId ? Number(f.managerId) : null, telegramUserId: f.telegramUserId, isActive: f.isActive } }), 'تغییرات ذخیره شد.');
              if (ok) { AP.state.users = null; AP.refresh(); }
            });
          };
          drawTab();
          $('#pf-tabs', page).addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { profileUi.tab = t.dataset.tab; drawTab(); } });
          $('#pf-days', page).addEventListener('change', (e) => { profileUi.days = Number(e.target.value); AP.refresh(); });
          $$('[data-go]', page).forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.go)));
          const msg = $('#pf-msg', page); if (msg) msg.addEventListener('click', () => AP.openMessage(u.id));
          const rec = $('#pf-rec', page); if (rec) rec.addEventListener('click', () => AP.openCreateRecord({ userId: u.id }));
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
