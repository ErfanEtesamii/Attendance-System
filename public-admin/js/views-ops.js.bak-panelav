// عملیات روزمره: تردد، رکورد (مودال)، مرخصی/مأموریت، اعتراض‌ها، پیام مستقیم.

(function () {
  'use strict';
  const AP = window.AP;
  const { $, $$, esc, fmt } = AP;
  const icon = (n) => AP.icon(n);
  const emptyBox = (text) => `<div class="empty">${AP.icon('inbox')}${esc(text)}</div>`;

  const userOptions = (users, selected) =>
    users.filter((u) => u.isActive || String(u.id) === String(selected))
      .map((u) => `<option value="${u.id}" ${String(u.id) === String(selected) ? 'selected' : ''}>${esc(u.fullName)}${u.department ? ` — ${esc(u.department)}` : ''}</option>`).join('');

  // ======================================================
  // پیام تلگرام به یک کارمند
  // ======================================================
  AP.openMessage = async function openMessage(userId) {
    const users = await AP.loadUsers();
    const u = users.find((x) => String(x.id) === String(userId));
    AP.modal({
      title: `پیام تلگرام به ${u ? u.fullName : 'کارمند'}`,
      body: `<form class="form"><label class="field"><span>متن پیام</span><textarea name="text" rows="4" required></textarea></label>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">${icon('mail')} ارسال</button></div></form>`,
      onMount(b, h) {
        $('form', b).addEventListener('submit', async (e) => {
          e.preventDefault();
          const btn = $('button[type=submit]', b);
          btn.disabled = true;
          try {
            await AP.api(`/admin/users/${userId}/message`, { method: 'POST', body: { text: AP.formData(e.target).text } });
            h.close();
            AP.toast('پیام ارسال شد.');
          } catch (err) {
            $('.form-msg', b).className = 'form-msg err';
            $('.form-msg', b).textContent = err.message;
            btn.disabled = false;
          }
        });
      },
    });
  };

  // ======================================================
  // مودال جزئیات / اصلاح یک رکورد تردد
  // ======================================================
  AP.openRecord = async function openRecord(id) {
    let r;
    try { r = await AP.api(`/admin/attendance-records/${id}`); } catch (err) { return AP.toast(err.message, true); }
    const admin = AP.can('records.edit'); // ویرایش رکورد؛ سرپرست روی تیم خودش (سرور اسکوپ را اعمال می‌کند)، ادمین روی همه، hr فقط مشاهده
    const u = r.user || {};

    const statusOpts = Object.entries(AP.STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('');

    const breakRow = (b) => {
      const isLunch = b.break_type === 'lunch';
      const typeLabel = isLunch ? 'ناهار' : 'نماز / استراحت کوتاه';
      return `
      <div class="rec-break ${isLunch ? 'is-lunch' : 'is-short'}" data-break="${b.id}">
        <div class="rec-break-icon" aria-hidden="true">${icon('coffee')}</div>
        <div class="rec-break-fields">
          <label class="rec-f rec-f-type"><span>نوع</span>${admin ? `<select data-f="type" aria-label="نوع استراحت"><option value="lunch" ${isLunch ? 'selected' : ''}>ناهار</option><option value="short_break" ${!isLunch ? 'selected' : ''}>نماز / استراحت کوتاه</option></select>` : `<b>${esc(typeLabel)}</b>`}</label>
          <label class="rec-f"><span>شروع</span>${admin ? `<input type="datetime-local" data-f="start" aria-label="شروع استراحت" value="${fmt.toLocalInput(b.start_time)}" />` : `<b class="num">${fmt.clock(b.start_time)}</b>`}</label>
          <label class="rec-f"><span>پایان</span>${admin ? `<input type="datetime-local" data-f="end" aria-label="پایان استراحت" value="${fmt.toLocalInput(b.end_time)}" />` : (b.end_time ? `<b class="num">${fmt.clock(b.end_time)}</b>` : AP.badge('on_break', 'در جریان'))}</label>
        </div>
        ${admin ? `<div class="row-actions rec-break-actions"><button type="button" class="btn ghost small" data-save-break>${icon('check')} ذخیره</button><button type="button" class="btn danger small" data-del-break aria-label="حذف استراحت">${icon('trash')}</button></div>` : ''}
      </div>`;
    };

    const segmentRow = (s) => `<tr data-segment="${s.seq}">
      <td>نوبت ${fmt.num(s.seq)}</td><td>${fmt.clock(s.check_in_time)}</td><td>${s.check_out_time ? fmt.clock(s.check_out_time) : AP.badge('present', 'باز')}</td>
      <td class="ltr">${esc(s.check_in_ip || '—')} / ${esc(s.check_out_ip || '—')}</td>
      ${admin ? `<td>${s.seq > 1 ? `<button type="button" class="btn danger small" data-del-segment>${icon('trash')} حذف نوبت</button>` : ''}</td>` : ''}</tr>`;

    const tile = (tone, ic, label, value, sub) => `
      <div class="rec-tile" data-tone="${tone}">
        <span class="rec-tile-icon">${icon(ic)}</span>
        <span class="rec-tile-label">${label}</span>
        <b class="rec-tile-value">${value}</b>${sub ? `<small class="rec-tile-sub">${sub}</small>` : ''}
      </div>`;
    const late = r.summary.lateMinutes;
    const eff = r.summary.effectiveMinutes;

    const body = `
      <div class="record-modal" data-status="${esc(r.status)}">
        <header class="rec-hero">
          ${AP.avatar(u.fullName, '')}
          <div class="rec-hero-text">
            <h2><a class="u-link-inherit" href="#/profile/${r.user_id}" data-close-link>${esc(u.fullName || '—')}</a></h2>
            <p>${esc(fmt.dateLong(r.record_date))}${u.department ? ` · ${esc(u.department)}` : ''}</p>
          </div>
          <div class="rec-hero-badges">${AP.statusBadge(r.status)}${r.via_remote ? AP.badge('purple', 'دورکاری') : ''}</div>
        </header>

        <div class="rec-tiles">
          ${tile('green', 'in', 'ورود', `<span class="num">${fmt.clock(r.check_in_time)}</span>`)}
          ${tile('blue', 'out', 'خروج', `<span class="num">${fmt.clock(r.check_out_time)}</span>`)}
          ${tile('purple', 'clock', 'ساعت مفید', eff != null ? fmt.min(eff) : '—')}
          ${tile(late ? 'red' : 'gray', 'alert', 'تأخیر', late ? fmt.min(late) : '—')}
        </div>
        <div class="rec-ips">
          <span class="rec-ip"><em>IP ورود</em><b class="ltr">${esc(r.check_in_ip || '—')}</b></span>
          <span class="rec-ip"><em>IP خروج</em><b class="ltr">${esc(r.check_out_ip || '—')}</b></span>
        </div>

        <section class="rec-section">
          <h4 class="rec-title"><span class="rec-title-icon">${icon('attendance')}</span>نوبت‌های حضور<span class="rec-count">${fmt.num((r.segments || []).length)}</span></h4>
          <div class="rec-card"><div class="table-wrap"><table><thead><tr><th>نوبت</th><th>ورود</th><th>خروج</th><th>IP ورود / خروج</th>${admin ? '<th></th>' : ''}</tr></thead>
            <tbody>${(r.segments || []).map(segmentRow).join('')}</tbody></table></div></div>
        </section>

        <section class="rec-section">
          <h4 class="rec-title"><span class="rec-title-icon">${icon('coffee')}</span>استراحت‌ها<span class="rec-count">${fmt.num(r.breaks.length)}</span><span class="rec-title-note">مجموع ${fmt.min(r.breakMinutes)}</span></h4>
          ${r.breaks.length ? `<div class="rec-breaks">${r.breaks.map(breakRow).join('')}</div>` : `<div class="rec-empty">استراحتی ثبت نشده است.</div>`}
          ${admin ? `<form class="rec-card rec-add add-break-form" id="add-break">
            <div class="rec-card-title">${icon('plus')} افزودن استراحت جدید</div>
            <div class="rec-add-grid">
              <label class="field"><span>نوع استراحت</span><select name="breakType"><option value="lunch" selected>ناهار</option><option value="short_break">نماز / استراحت کوتاه</option></select></label>
              <label class="field"><span>شروع</span><input type="datetime-local" name="startTime" required /></label>
              <label class="field"><span>پایان</span><input type="datetime-local" name="endTime" /></label>
            </div>
            <button class="btn ghost small add-break-submit" type="submit">${icon('plus')} افزودن استراحت</button></form>` : ''}
        </section>

        ${admin ? `<section class="rec-section">
          <h4 class="rec-title"><span class="rec-title-icon">${icon('edit')}</span>اصلاح رکورد</h4>
          <form class="rec-card rec-fix form" id="fix-form">
            <div class="form-grid">
              <label class="field"><span>ساعت ورود</span><input type="datetime-local" name="checkInTime" value="${fmt.toLocalInput(r.check_in_time)}" /></label>
              <label class="field"><span>ساعت خروج</span><input type="datetime-local" name="checkOutTime" value="${fmt.toLocalInput(r.check_out_time)}" /></label>
              <label class="field"><span>وضعیت</span><select name="status">${statusOpts}</select></label>
              <label class="field full"><span>دلیل اصلاح (اجباری — به کارمند در تلگرام اطلاع داده می‌شود)</span><textarea name="reason" rows="2" required></textarea></label>
            </div>
            <div class="form-msg"></div>
            <div class="modal-actions"><button class="btn primary" type="submit">${icon('check')} ذخیره اصلاح</button>
              <button class="btn danger" type="button" id="del-rec">${icon('trash')} حذف رکورد</button></div>
          </form>
        </section>` : ''}

        ${r.disputes.length ? `<section class="rec-section"><h4 class="rec-title"><span class="rec-title-icon">${icon('disputes')}</span>اعتراض‌های مرتبط<span class="rec-count">${fmt.num(r.disputes.length)}</span></h4>${r.disputes.map((d) => `<div class="rec-dispute"><div class="grow">${AP.badge(d.status, d.status === 'open' ? 'باز' : 'بسته')}<p class="text">${esc(d.message)}</p></div></div>`).join('')}</section>` : ''}

        ${AP.can('audit.read') && r.history && r.history.length ? `<section class="rec-section"><h4 class="rec-title"><span class="rec-title-icon">${icon('audit')}</span>تاریخچه‌ی تغییرات</h4><div class="rec-card rec-history"><div class="kv">${r.history.map((h) => `
          <div class="kv-row"><span>${esc(h.userFullName || '—')} · ${esc(h.action)}</span><span class="muted">${esc(fmt.dateTime(h.occurred_at))}</span></div>`).join('')}</div></div></section>` : ''}
      </div>`;

    AP.modal({
      title: 'رکورد تردد', wide: true, body,
      onMount(b, h) {
        const reopen = () => { h.close(); AP.openRecord(id); AP.refresh(); };
        const link = $('[data-close-link]', b); if (link) link.addEventListener('click', () => h.close());
        if (!admin) return;
        AP.dates.mount(b); // قبل از listenerها: datetime-localها ⇒ تاریخ شمسی + ساعت (S3-11a)

        $('#fix-form', b).addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(e.target);
          const body2 = { checkInTime: fmt.fromLocalInput(f.checkInTime), checkOutTime: fmt.fromLocalInput(f.checkOutTime), status: f.status, reason: f.reason };
          try {
            await AP.api(`/admin/attendance-records/${id}`, { method: 'PATCH', body: body2 });
            AP.toast('رکورد اصلاح شد.');
            reopen();
          } catch (err) { $('#fix-form .form-msg', b).className = 'form-msg err'; $('#fix-form .form-msg', b).textContent = err.message; }
        });

        $('#del-rec', b).addEventListener('click', async () => {
          const reason = await AP.askReason({ title: 'حذف کامل رکورد', message: 'رکورد و همه‌ی استراحت‌هایش برای همیشه حذف می‌شود (در گزارش رویدادها ثبت می‌شود).', confirmText: 'حذف رکورد', danger: true });
          if (reason === null) return;
          const ok = await AP.attempt(() => AP.api(`/admin/attendance-records/${id}`, { method: 'DELETE', body: { reason } }), 'رکورد حذف شد.');
          if (ok) { h.close(); AP.refresh(); }
        });

        $('#add-break', b).addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(e.target);
          const reason = await AP.askReason({ title: 'افزودن استراحت', confirmText: 'افزودن' });
          if (reason === null) return;
          const ok = await AP.attempt(() => AP.api(`/admin/attendance-records/${id}/breaks`, { method: 'POST', body: {
            breakType: f.breakType === 'short_break' ? 'short_break' : 'lunch',
            startTime: fmt.fromLocalInput(f.startTime), endTime: fmt.fromLocalInput(f.endTime), reason } }), 'استراحت اضافه شد.');
          if (ok) reopen();
        });

        $$('tr[data-segment]', b).forEach((tr) => {
          const button = $('[data-del-segment]', tr);
          if (!button) return;
          button.addEventListener('click', async () => {
            const reason = await AP.askReason({ title: 'حذف نوبت ورود مجدد', message: 'این نوبت از محاسبه ساعت مفید حذف می‌شود.', confirmText: 'حذف نوبت', danger: true });
            if (reason === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/attendance-records/${id}/segments/${tr.dataset.segment}`, { method: 'DELETE', body: { reason } }), 'نوبت ورود مجدد حذف شد.');
            if (ok) reopen();
          });
        });

        $$('.rec-break[data-break]', b).forEach((tr) => {
          const bid = tr.dataset.break;
          $('[data-save-break]', tr).addEventListener('click', async () => {
            const reason = await AP.askReason({ title: 'ویرایش استراحت', confirmText: 'ذخیره' });
            if (reason === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/break-records/${bid}`, { method: 'PATCH', body: {
              breakType: $('[data-f=type]', tr).value,
              startTime: fmt.fromLocalInput($('[data-f=start]', tr).value),
              endTime: fmt.fromLocalInput($('[data-f=end]', tr).value), reason } }), 'استراحت ذخیره شد.');
            if (ok) reopen();
          });
          $('[data-del-break]', tr).addEventListener('click', async () => {
            const reason = await AP.askReason({ title: 'حذف استراحت', confirmText: 'حذف', danger: true });
            if (reason === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/break-records/${bid}`, { method: 'DELETE', body: { reason } }), 'استراحت حذف شد.');
            if (ok) reopen();
          });
        });
      },
    });
  };

  // ======================================================
  // ثبت دستی رکورد تردد
  // ======================================================
  AP.openCreateRecord = async function openCreateRecord({ userId, date } = {}) {
    const users = await AP.loadUsers();
    AP.modal({
      title: 'ثبت دستی رکورد تردد', wide: true,
      body: `<form class="form">
        <div class="form-grid">
          <label class="field"><span>کارمند</span><select name="userId" required>${userOptions(users, userId)}</select></label>
          <label class="field"><span>تاریخ</span><input type="date" name="date" required value="${esc(date || fmt.today())}" /></label>
          <label class="field"><span>ساعت ورود</span><input type="datetime-local" name="checkInTime" /></label>
          <label class="field"><span>ساعت خروج</span><input type="datetime-local" name="checkOutTime" /></label>
          <label class="field"><span>وضعیت</span><select name="status">${Object.entries(AP.STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="field full"><span>دلیل (اجباری)</span><textarea name="reason" rows="2" required></textarea></label>
        </div>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ثبت رکورد</button></div></form>`,
      onMount(b, h) {
        AP.dates.mount(b); // تاریخ شمسی (S3-11a)
        $('form', b).addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(e.target);
          try {
            await AP.api('/admin/attendance-records', { method: 'POST', body: {
              userId: Number(f.userId), date: f.date, status: f.status, reason: f.reason,
              checkInTime: fmt.fromLocalInput(f.checkInTime), checkOutTime: fmt.fromLocalInput(f.checkOutTime) } });
            h.close();
            AP.toast('رکورد ثبت شد.');
            AP.refresh();
          } catch (err) {
            const m = $('.form-msg', b);
            m.className = 'form-msg err';
            m.innerHTML = esc(err.message) + (err.data && err.data.recordId ? ` <a class="u-link-accent" href="#" data-open="${err.data.recordId}">مشاهده‌ی رکورد موجود</a>` : '');
            const a = $('[data-open]', m);
            if (a) a.addEventListener('click', (ev) => { ev.preventDefault(); h.close(); AP.openRecord(a.dataset.open); });
          }
        });
      },
    });
  };

  // ======================================================
  // صفحه‌ی تردد (همه‌ی رکوردها)
  // ======================================================
  const attUi = { from: null, to: null, userId: '', department: '', status: '', q: '' };
  // ساعت‌های دورکاریِ همان روز زیر ورود/خروج؛ وضعیت هر نشست با نشان (در انتظار / تأییدشده / ردشده)
  const REMOTE_ST = { pending: ['pending', 'در انتظار'], approved: ['approved', 'تأییدشده'], rejected: ['rejected', 'ردشده'] };
  const remoteCell = (list) => (list && list.length
    ? `<div class="remote-times">${list.map((s) => {
      const st = REMOTE_ST[s.status] || [s.status, s.status];
      return `<div class="muted small"><span class="ltr num">${fmt.clock(s.startAt)}–${s.open ? 'در جریان' : fmt.clock(s.endAt)}</span> ${AP.badge('purple', 'دورکاری')} ${AP.badge(st[0], st[1])}</div>`;
    }).join('')}</div>`
    : '');

  AP.view('attendance', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'attendance.read',
    nav: { icon: 'attendance', label: 'رکوردهای تردد', group: 'کارمندان و تردد' },
    async render() {
      attUi.from = attUi.from || fmt.daysAgo(6);
      attUi.to = attUi.to || fmt.today();
      const users = await AP.loadUsers();
      const depts = [...new Set(users.map((u) => u.department).filter(Boolean))];
      const qs = () => new URLSearchParams(Object.entries(attUi).filter(([, v]) => v)).toString();
      const data = await AP.api(`/admin/attendance?${qs()}`);

      const html = `
        <div class="view-header">
          <div><h2>رکوردهای تردد</h2><div class="sub">${fmt.num(data.count)} رکورد · از ${esc(fmt.dateLong(data.from))} تا ${esc(fmt.dateLong(data.to))}</div></div>
          <div class="header-actions">
            ${AP.exportBar({ path: '/api/admin/attendance/export', params: attUi })}
            ${AP.can('records.edit') ? `<button class="btn primary" id="att-new">${icon('plus')} ثبت دستی</button>` : ''}
          </div>
        </div>
        <form class="filters" id="att-filters">
          <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(attUi.from)}" /></label>
          <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(attUi.to)}" /></label>
          <label class="field"><span>کارمند</span><select name="userId"><option value="">همه</option>${userOptions(users, attUi.userId)}</select></label>
          <label class="field"><span>دپارتمان</span><select name="department"><option value="">همه</option>${depts.map((d) => `<option ${d === attUi.department ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
          <label class="field"><span>وضعیت</span><select name="status"><option value="">همه</option>${Object.entries(AP.STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === attUi.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <button class="btn ghost" type="button" data-range="0">امروز</button>
          <button class="btn ghost" type="button" data-range="6">۷ روز</button>
          <button class="btn ghost" type="button" data-range="29">۳۰ روز</button>
        </form>
        <div class="card flush"><div class="table-wrap"><table>
          <thead><tr><th>کارمند</th><th>تاریخ</th><th>ورود</th><th>خروج</th><th>استراحت</th><th>ساعت مفید</th><th>تأخیر</th><th>IP ورود</th><th>وضعیت</th></tr></thead><tbody>
          ${data.records.length ? data.records.map((r) => `<tr class="${r.id ? 'clickable' : ''}" ${r.id ? `data-rec="${r.id}"` : ''}>
            <td><div class="cell-user">${AP.avatar(r.user ? r.user.fullName : '?', 'sm')}<span><b>${esc(r.user ? r.user.fullName : '—')}</b><small>${esc(r.user ? r.user.department || '' : '')}</small></span></div></td>
            <td>${esc(fmt.date(r.record_date))}</td><td class="num">${r.remoteOnly ? '—' : fmt.clock(r.check_in_time)}${remoteCell(r.remoteSessions)}</td><td class="num">${r.remoteOnly ? '—' : fmt.clock(r.check_out_time)}</td>
            <td class="num">${r.breakMinutes ? fmt.min(r.breakMinutes) : '—'}</td>
            <td class="num${r.summary.effectiveMinutes != null ? ' att-eff' : ''}">${r.summary.effectiveMinutes != null ? fmt.min(r.summary.effectiveMinutes) : '—'}</td>
            <td class="num${r.summary.lateMinutes ? ' att-late' : ''}">${r.summary.lateMinutes ? fmt.min(r.summary.lateMinutes) : '—'}</td>
            <td><span class="ltr muted">${esc(String(r.check_in_ip || '—').replace(/^::ffff:/i, ''))}</span></td><td>${r.remoteOnly ? AP.badge('purple', 'فقط دورکاری') : AP.statusBadge(r.status)}${r.via_remote ? ` ${AP.badge('purple', 'دورکاری')}` : ''}</td></tr>`).join('')
            : `<tr><td colspan="9">${emptyBox('رکوردی با این فیلتر پیدا نشد.')}</td></tr>`}
          </tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#att-filters', page);
          AP.dates.mount(form); // فیلتر از/تا تاریخ شمسی؛ قبل از بستن listenerها (S3-11a)
          const apply = () => { Object.assign(attUi, AP.formData(form)); AP.refresh(); };
          $$('input, select', form).forEach((el) => el.addEventListener('change', apply));
          $$('[data-range]', form).forEach((b) => b.addEventListener('click', () => {
            attUi.from = fmt.daysAgo(Number(b.dataset.range));
            attUi.to = fmt.today();
            AP.refresh();
          }));
          $$('tr[data-rec]', page).forEach((tr) => tr.addEventListener('click', () => AP.openRecord(tr.dataset.rec)));
          const n = $('#att-new', page); if (n) n.addEventListener('click', () => AP.openCreateRecord({}));
        },
      };
    },
  });

  // ======================================================
  // مرخصی / مأموریت
  // ======================================================
  AP.openLeaveEditor = async function openLeaveEditor(id) {
    let l;
    try {
      const all = await AP.api('/admin/leave-requests?status=all');
      l = all.find((x) => String(x.id) === String(id));
    } catch (err) { return AP.toast(err.message, true); }
    if (!l) return AP.toast('درخواست یافت نشد.', true);
    AP.modal({
      title: `ویرایش درخواست ${l.employee ? `— ${l.employee.fullName}` : ''}`,
      body: `<form class="form"><div class="form-grid">
        <label class="field"><span>نوع</span><select name="leaveType"><option value="leave" ${l.leaveType === 'leave' ? 'selected' : ''}>مرخصی</option><option value="mission" ${l.leaveType === 'mission' ? 'selected' : ''}>مأموریت</option></select></label>
        <label class="field"><span>وضعیت</span><select name="status">${Object.entries(AP.LEAVE_STATUS).map(([k, v]) => `<option value="${k}" ${l.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>از تاریخ</span><input type="date" name="startDate" value="${esc(l.startDate)}" /></label>
        <label class="field"><span>تا تاریخ</span><input type="date" name="endDate" value="${esc(l.endDate)}" /></label>
        <label class="field full"><span>توضیح</span><textarea name="reason" rows="2">${esc(l.reason || '')}</textarea></label></div>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ذخیره</button>
          <button class="btn danger" type="button" id="del-leave">${icon('trash')} حذف</button></div></form>`,
      onMount(b, h) {
        AP.dates.mount(b); // از/تا تاریخ شمسی (S3-11b)
        $('form', b).addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await AP.api(`/admin/leave-requests/${id}`, { method: 'PATCH', body: AP.formData(e.target) });
            h.close(); AP.toast('ذخیره شد.'); AP.refresh(); AP.refreshCounts();
          } catch (err) { const m = $('.form-msg', b); m.className = 'form-msg err'; m.textContent = err.message; }
        });
        $('#del-leave', b).addEventListener('click', async () => {
          if (!(await AP.confirmBox({ title: 'حذف درخواست', message: 'این درخواست برای همیشه حذف می‌شود. ادامه می‌دهید؟', confirmText: 'حذف', danger: true }))) return;
          const ok = await AP.attempt(() => AP.api(`/admin/leave-requests/${id}`, { method: 'DELETE' }), 'حذف شد.');
          if (ok) { h.close(); AP.refresh(); AP.refreshCounts(); }
        });
      },
    });
  };

  AP.openLeaveCreate = async function openLeaveCreate({ userId } = {}) {
    const users = await AP.loadUsers();
    AP.modal({
      title: 'ثبت مرخصی / مأموریت برای کارمند',
      body: `<form class="form"><div class="form-grid">
        <label class="field full"><span>کارمند</span><select name="userId" required>${userOptions(users, userId)}</select></label>
        <label class="field"><span>نوع</span><select name="leaveType"><option value="leave">مرخصی</option><option value="mission">مأموریت</option></select></label>
        <label class="field"><span>وضعیت</span><select name="status"><option value="approved">تأییدشده</option><option value="pending">در انتظار</option></select></label>
        <label class="field"><span>از تاریخ</span><input type="date" name="startDate" required value="${fmt.today()}" /></label>
        <label class="field"><span>تا تاریخ</span><input type="date" name="endDate" required value="${fmt.today()}" /></label>
        <label class="field full"><span>توضیح</span><textarea name="reason" rows="2"></textarea></label></div>
        <div class="form-msg"></div>
        <div class="modal-actions"><button class="btn primary" type="submit">ثبت</button></div></form>`,
      onMount(b, h) {
        AP.dates.mount(b); // از/تا تاریخ شمسی (S3-11b)
        $('form', b).addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = AP.formData(e.target);
          try {
            await AP.api('/admin/leave-requests', { method: 'POST', body: { ...f, userId: Number(f.userId) } });
            h.close(); AP.toast('ثبت شد.'); AP.refresh(); AP.refreshCounts();
          } catch (err) { const m = $('.form-msg', b); m.className = 'form-msg err'; m.textContent = err.message; }
        });
      },
    });
  };

  // صفحه‌ی ادغام‌شده‌ی «مرخصی و مأموریت»: هرکس مجوز تصمیم دارد (leave.approve یا leave.approve.hr) صف تأیید با فیلترها را می‌بیند؛
  // بقیه (کارمند: فقط leave.read) همان فهرست ساده‌ی داده‌ی خودشان را. کلید قدیمی leaveQueue فقط alias است (لینک‌ها نشکنند).
  const canDecideLeave = () => AP.can('leave.approve') || AP.can('leave.approve.hr');
  const leaveUi = { status: 'pending' };
  AP.view('leave', {
    skeleton: 'list', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'leave.read',
    nav: { icon: 'leave', label: 'مرخصی و مأموریت', group: 'درخواست‌ها', counter: true },
    render() { return canDecideLeave() ? renderLeaveQueue() : renderLeaveSimple(); },
  });
  // alias: #/leaveQueue (داشبورد، لینک‌ها) همان صفحه است؛ مجوز قبلی (فقط تصمیم‌گیرنده) حفظ، بدون آیتم منوی جدا؛ منوی فعال «leave»
  AP.views.leaveQueue = Object.assign({}, AP.views.leave, { perm: ['leave.approve', 'leave.approve.hr'], navId: 'leave' });
  delete AP.views.leaveQueue.nav;

  async function renderLeaveSimple() {
    const items = await AP.api(`/admin/leave-requests?status=${leaveUi.status}`);
    const html = `
      <div class="view-header">
        <div><h2>مرخصی و مأموریت</h2><div class="sub">${fmt.num(items.length)} درخواست</div></div>
        <div class="header-actions">${AP.can('leave.edit') ? `<button class="btn primary" id="lv-new">${icon('plus')} ثبت برای کارمند</button>` : ''}</div>
      </div>
      <div class="chips" id="lv-chips">${[['pending', 'در انتظار'], ['approved', 'تأییدشده'], ['rejected', 'ردشده'], ['all', 'همه']]
        .map(([k, l]) => `<button class="chip ${k === leaveUi.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <div class="list">${items.length ? items.map((l) => `
        <div class="item">
          ${AP.avatar(l.employee ? l.employee.fullName : '?', '')}
          <div class="grow">
            <div class="title"><a class="u-link-inherit" href="#/profile/${l.employee ? l.employee.id : ''}">${esc(l.employee ? l.employee.fullName : '—')}</a>
              ${AP.badge(l.leaveType === 'mission' ? 'mission' : 'leave', AP.LEAVE_TYPE[l.leaveType])} ${AP.badge(l.status, AP.LEAVE_STATUS[l.status])}</div>
            <div class="meta">${esc(fmt.dateLong(l.startDate))} تا ${esc(fmt.dateLong(l.endDate))} · ثبت: ${esc(fmt.dateTime(l.createdAt))}</div>
            ${l.reason ? `<p class="text">${esc(l.reason)}</p>` : ''}
          </div>
          <div class="row-actions">
            ${l.status === 'pending' && AP.can('leave.approve') ? `<button class="btn success small" data-act="approve" data-id="${l.id}">${icon('check')} تأیید</button><button class="btn danger small" data-act="reject" data-id="${l.id}">${icon('x')} رد</button>` : ''}
            ${AP.can('leave.edit') ? `<button class="btn ghost small" data-edit="${l.id}">${icon('edit')} ویرایش</button>` : ''}
          </div></div>`).join('') : `<div class="card">${emptyBox('درخواستی وجود ندارد.')}</div>`}</div>`;
    return {
      html,
      mount(page) {
        $('#lv-chips', page).addEventListener('click', (e) => { const c = e.target.closest('[data-s]'); if (c) { leaveUi.status = c.dataset.s; AP.refresh(); } });
        $$('[data-act]', page).forEach((b) => b.addEventListener('click', async () => {
          const approve = b.dataset.act === 'approve';
          let note = '';
          if (!approve) {
            note = await AP.askReason({ title: 'رد درخواست', label: 'دلیل رد (اختیاری — برای کارمند در تلگرام ارسال می‌شود)', confirmText: 'رد کن', danger: true, required: false });
            if (note === null) return;
          }
          const ok = await AP.attempt(() => AP.api(`/admin/leave-requests/${b.dataset.id}/${b.dataset.act}`, { method: 'POST', body: { note } }), approve ? 'تأیید شد.' : 'رد شد.');
          if (ok) { AP.refresh(); AP.refreshCounts(); }
        }));
        $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => AP.openLeaveEditor(b.dataset.edit)));
        const n = $('#lv-new', page); if (n) n.addEventListener('click', () => AP.openLeaveCreate({}));
      },
    };
  }

  // ======================================================
  // صف تأیید مرخصی/مأموریت (S4-13b): UI روی API صف (S4-13a)؛ حالا داخل صفحه‌ی ادغام‌شده‌ی «مرخصی و مأموریت» (AP.view('leave'))
  //   فیلتر وضعیت/نوع/تیم/بازه + «فقط قابل‌تصمیم من»، مانده‌ی کارمند، پیوست، انتخاب و تأیید/رد دسته‌جمعی (دلیل رد اجباری).
  //   فقط نمایش است: اسکوپ و مجوز تصمیم را سرور اعمال می‌کند؛ مانده مانع تأیید نیست و فقط هشدار می‌دهد.
  // ======================================================
  const QUEUE_LIMIT = 50;
  const queueUi = { status: 'pending', kind: '', leaveTypeId: '', team: '', from: '', to: '', decidable: false, offset: 0 };
  const queueSel = new Set(); // شناسه‌ی درخواست‌های انتخاب‌شده (فقط قابل‌تصمیم‌های همین صفحه)
  const ROLE_STEP = { manager: 'سرپرست', admin: 'ادمین', hr: 'منابع انسانی' };
  const STEP_STATUS = { pending: 'در انتظار', approved: 'تأیید', rejected: 'رد' };
  const BULK_ERR = { NOT_FOUND: 'یافت نشد', ALREADY_DECIDED: 'قبلاً بررسی شده', FORBIDDEN: 'مجاز به تصمیم نیستید', INTERNAL: 'خطای داخلی' };

  const queueQs = () => {
    const p = new URLSearchParams({ status: queueUi.status, limit: String(QUEUE_LIMIT), offset: String(queueUi.offset) });
    ['kind', 'leaveTypeId', 'team', 'from', 'to'].forEach((k) => { if (queueUi[k]) p.set(k, queueUi[k]); });
    if (queueUi.decidable && queueUi.status === 'pending') p.set('decidable', '1');
    return p.toString();
  };

  const queueBalanceHtml = (b) => {
    if (!b || !b.tracked) return '<div class="meta">این نوع از مانده کسر نمی‌شود.</div>';
    const after = b.display && b.display.remainingAfterApproval;
    const warn = b.insufficient === true ? ` ${AP.badge('red', 'مانده کافی نیست')}` : '';
    const afterTxt = b.remainingAfterApproval === null || b.remainingAfterApproval === undefined
      ? (b.status === 'pending' ? ' · پس از تأیید: نامشخص' : '')
      : (after ? ` · پس از تأیید: ${esc(after.text)}` : '');
    return `<div class="meta">مانده‌ی سال ${esc(String(b.jalaliYear))}: ${esc(b.display && b.display.remaining ? b.display.remaining.text : '—')}${afterTxt}${warn}</div>`;
  };

  const queueChainHtml = (it) => {
    if (!it.chain || it.chain.length < 2) return '';
    return `<div class="meta">زنجیره‌ی تأیید: ${it.chain.map((s) => `${esc(ROLE_STEP[s.approverRole] || s.approverRole)} (${esc(STEP_STATUS[s.status] || s.status)})`).join(' ← ')}</div>`;
  };

  const queueItemHtml = (it) => {
    const emp = it.employee;
    const type = it.leaveType && it.leaveType.title ? it.leaveType.title : (AP.LEAVE_TYPE[it.kind] || '—');
    const dur = it.durationMinutes != null ? ` · مدت: ${esc(fmt.min(it.durationMinutes))}` : '';
    const span = it.startDate === it.endDate ? esc(fmt.dateLong(it.startDate)) : `${esc(fmt.dateLong(it.startDate))} تا ${esc(fmt.dateLong(it.endDate))}`;
    const att = it.attachment
      ? `<div class="meta">پیوست: <a class="u-link-accent" href="${esc(it.attachment.url)}" target="_blank" rel="noopener">${esc(it.attachment.name || 'دانلود')}</a></div>` : '';
    const waiting = it.status === 'pending' && it.awaitingRole ? ` ${AP.badge('purple', `منتظر ${ROLE_STEP[it.awaitingRole] || it.awaitingRole}`)}` : '';
    const check = it.canDecide
      ? `<input type="checkbox" class="q-check" data-q="${esc(it.id)}" aria-label="انتخاب درخواست ${esc(emp ? emp.fullName : it.id)}" ${queueSel.has(it.id) ? 'checked' : ''} />` : '';
    const actions = (it.canDecide
      ? `<button class="btn success small" data-act="approve" data-id="${esc(it.id)}">${icon('check')} تأیید</button><button class="btn danger small" data-act="reject" data-id="${esc(it.id)}">${icon('x')} رد</button>` : '')
      + (AP.can('leave.edit') ? `<button class="btn ghost small" data-edit="${esc(it.id)}">${icon('edit')} ویرایش</button>` : '');
    return `
      <div class="item leave-item st-${esc(it.status)}">
        ${check}
        ${AP.avatar(emp ? emp.fullName : '?', '')}
        <div class="grow">
          <div class="title">${emp ? `<a class="u-link-inherit" href="#/profile/${esc(emp.id)}">${esc(emp.fullName)}</a>` : '—'}
            ${AP.badge(it.kind === 'mission' ? 'mission' : 'leave', type)} ${AP.badge(it.status, AP.LEAVE_STATUS[it.status] || it.status)}${waiting}</div>
          <div class="meta">${emp ? `${esc(emp.department || '')}${emp.personnelCode ? ` · کد پرسنلی <span class="ltr">${esc(emp.personnelCode)}</span>` : ''} · ` : ''}${span}${dur} · ثبت: ${esc(fmt.dateTime(it.createdAt))}</div>
          ${it.reason ? `<p class="text">${esc(it.reason)}</p>` : ''}
          ${queueBalanceHtml({ ...(it.balance || {}), status: it.status })}${queueChainHtml(it)}${att}
        </div>
        <div class="row-actions">${actions}</div>
      </div>`;
  };

  // نتیجه‌ی تصمیم دسته‌جمعی: موفق ⇒ توست؛ ناموفق ⇒ مودال با دلیل هر مورد
  function queueShowResult(data, names) {
    const { summary, results } = data;
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) return AP.toast(`${fmt.num(summary.succeeded)} درخواست ${data.action === 'approve' ? 'تأیید' : 'رد'} شد.`);
    AP.modal({
      title: 'نتیجه‌ی تصمیم دسته‌جمعی',
      body: `<p class="bulk-result-copy">${fmt.num(summary.succeeded)} مورد انجام شد و ${fmt.num(summary.failed)} مورد انجام نشد. موارد موفق ثبت شده‌اند و نیازی به تکرار ندارند.</p>
        <div class="list">${failed.map((r) => `<div class="item"><div class="grow"><div class="title">${esc(names.get(r.id) || `درخواست ${r.id}`)}</div>
          <div class="meta">${esc(BULK_ERR[r.code] || r.error || 'ناموفق')}${r.error && BULK_ERR[r.code] ? ` — ${esc(r.error)}` : ''}</div></div></div>`).join('')}</div>
        <div class="modal-actions"><button class="btn ghost" type="button" data-close-x>بستن</button></div>`,
      onMount(b, h) { $('[data-close-x]', b).addEventListener('click', () => h.close()); },
    });
  }

  async function renderLeaveQueue() {
    // فهرست انواع و سرپرست‌ها فقط برای فیلتر است؛ خرابی آن‌ها صفحه را نمی‌اندازد
    const [data, types, users] = await Promise.all([
      AP.api(`/admin/leave-queue?${queueQs()}`),
      AP.api('/admin/leave-types').catch(() => []),
      AP.can('users.read') ? AP.loadUsers().catch(() => []) : [],
    ]);
    // آخرین صفحه‌ی پس از تصمیم‌ها خالی شده؛ یک صفحه عقب برو
    if (!data.items.length && data.total > 0 && queueUi.offset > 0) {
      queueUi.offset = Math.max(0, Math.floor((data.total - 1) / QUEUE_LIMIT) * QUEUE_LIMIT);
      return renderLeaveQueue();
    }
    const managers = AP.state.me && AP.state.me.role === 'manager' ? [] : users.filter((u) => u.role === 'manager' && u.isActive);
    const names = new Map(data.items.map((i) => [i.id, i.employee ? i.employee.fullName : `درخواست ${i.id}`]));
    const decidableIds = data.items.filter((i) => i.canDecide).map((i) => i.id);
    [...queueSel].forEach((id) => { if (!decidableIds.includes(id)) queueSel.delete(id); });
    const from = queueUi.offset + 1;
    const to = queueUi.offset + data.items.length;

    const html = `
      <div class="view-header"><div><h2>مرخصی و مأموریت</h2>
        <div class="sub">${fmt.num(data.total)} درخواست${data.items.length ? ` · نمایش ${fmt.num(from)} تا ${fmt.num(to)}` : ''}</div></div>
        <div class="header-actions">${AP.can('leave.edit') ? `<button class="btn primary" id="lv-new">${icon('plus')} ثبت برای کارمند</button>` : ''}</div></div>
      <div class="chips" id="q-chips">${[['pending', 'در انتظار'], ['approved', 'تأییدشده'], ['rejected', 'ردشده'], ['all', 'همه']]
        .map(([k, l]) => `<button class="chip ${k === queueUi.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <form class="filters" id="q-filters">
        <label class="field"><span>نوع کلی</span><select name="kind"><option value="">همه</option><option value="leave" ${queueUi.kind === 'leave' ? 'selected' : ''}>مرخصی</option><option value="mission" ${queueUi.kind === 'mission' ? 'selected' : ''}>مأموریت</option></select></label>
        <label class="field"><span>نوع مرخصی</span><select name="leaveTypeId"><option value="">همه</option>${types.map((t) => `<option value="${esc(t.id)}" ${String(t.id) === String(queueUi.leaveTypeId) ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>
        ${managers.length ? `<label class="field"><span>تیم (سرپرست)</span><select name="team"><option value="">همه</option>${managers.map((m) => `<option value="${esc(m.id)}" ${String(m.id) === String(queueUi.team) ? 'selected' : ''}>${esc(m.fullName)}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>از تاریخ</span><input type="date" name="from" value="${esc(queueUi.from)}" /></label>
        <label class="field"><span>تا تاریخ</span><input type="date" name="to" value="${esc(queueUi.to)}" /></label>
        ${queueUi.status === 'pending' ? `<label class="check-row"><input type="checkbox" name="decidable" ${queueUi.decidable ? 'checked' : ''} /> فقط مواردی که من تصمیم می‌گیرم</label>` : ''}
      </form>
      ${decidableIds.length ? `<div class="filters filters-center" id="q-bulk">
        <label class="check-row"><input type="checkbox" id="q-all" ${decidableIds.every((id) => queueSel.has(id)) ? 'checked' : ''} /> انتخاب همه‌ی این صفحه</label>
        <span class="muted" id="q-count">${queueSel.size ? `${fmt.num(queueSel.size)} مورد انتخاب شده` : ''}</span>
        <button class="btn success small" type="button" id="q-approve" ${queueSel.size ? '' : 'disabled'}>${icon('check')} تأیید انتخاب‌شده‌ها</button>
        <button class="btn danger small" type="button" id="q-reject" ${queueSel.size ? '' : 'disabled'}>${icon('x')} رد انتخاب‌شده‌ها</button>
      </div>` : ''}
      <div class="list">${data.items.length ? data.items.map(queueItemHtml).join('') : `<div class="card">${emptyBox('درخواستی با این فیلتر وجود ندارد.')}</div>`}</div>
      ${data.total > QUEUE_LIMIT ? `<div class="filters u-actions-center">
        <button class="btn ghost small" type="button" id="q-prev" ${queueUi.offset > 0 ? '' : 'disabled'}>صفحه‌ی قبل</button>
        <button class="btn ghost small" type="button" id="q-next" ${to < data.total ? '' : 'disabled'}>صفحه‌ی بعد</button></div>` : ''}`;

    return {
      html,
      mount(page) {
        const form = $('#q-filters', page);
        AP.dates.mount(form); // از/تا تاریخ شمسی؛ مقدار میلادی (قبل از بستن listenerها)
        const reload = () => { queueSel.clear(); AP.refresh(); };
        $$('input, select', form).forEach((el) => el.addEventListener('change', () => {
          const f = AP.formData(form);
          Object.assign(queueUi, { kind: f.kind || '', leaveTypeId: f.leaveTypeId || '', team: f.team || '', from: f.from || '', to: f.to || '', decidable: !!f.decidable, offset: 0 });
          if (queueUi.from && queueUi.to && queueUi.from > queueUi.to) { AP.toast('تاریخ شروع فیلتر بعد از تاریخ پایان است.', true); return; }
          reload();
        }));
        $('#q-chips', page).addEventListener('click', (e) => {
          const c = e.target.closest('[data-s]');
          if (c) { queueUi.status = c.dataset.s; queueUi.offset = 0; reload(); }
        });
        const prev = $('#q-prev', page); if (prev) prev.addEventListener('click', () => { queueUi.offset = Math.max(0, queueUi.offset - QUEUE_LIMIT); reload(); });
        const next = $('#q-next', page); if (next) next.addEventListener('click', () => { queueUi.offset += QUEUE_LIMIT; reload(); });

        // انتخاب
        const syncBulk = () => {
          const c = $('#q-count', page); if (c) c.textContent = queueSel.size ? `${fmt.num(queueSel.size)} مورد انتخاب شده` : '';
          ['#q-approve', '#q-reject'].forEach((s) => { const b = $(s, page); if (b) b.disabled = !queueSel.size; });
          const all = $('#q-all', page); if (all) all.checked = decidableIds.length > 0 && decidableIds.every((id) => queueSel.has(id));
        };
        $$('.q-check', page).forEach((cb) => cb.addEventListener('change', () => {
          const id = Number(cb.dataset.q);
          if (cb.checked) queueSel.add(id); else queueSel.delete(id);
          syncBulk();
        }));
        const all = $('#q-all', page);
        if (all) all.addEventListener('change', () => {
          decidableIds.forEach((id) => { if (all.checked) queueSel.add(id); else queueSel.delete(id); });
          $$('.q-check', page).forEach((cb) => { cb.checked = all.checked; });
          syncBulk();
        });

        // تصمیم (تکی و دسته‌جمعی هر دو از endpoint دسته‌جمعی؛ منطق یکسان سمت سرور)
        const decide = async (action, ids) => {
          let note = '';
          if (action === 'reject') {
            note = await AP.askReason({
              title: ids.length > 1 ? `رد ${fmt.num(ids.length)} درخواست` : 'رد درخواست',
              label: 'دلیل رد (اجباری — برای کارمند در تلگرام ارسال می‌شود)',
              confirmText: 'رد کن', danger: true,
            });
            if (note === null) return;
          } else {
            const risky = data.items.filter((i) => ids.includes(i.id) && i.balance && i.balance.insufficient === true).length;
            const ok = await AP.confirmBox({
              title: ids.length > 1 ? `تأیید ${fmt.num(ids.length)} درخواست` : 'تأیید درخواست',
              message: `${ids.length > 1 ? `${fmt.num(ids.length)} درخواست` : 'درخواست'} تأیید می‌شود.${risky ? ` توجه: برای ${fmt.num(risky)} مورد مانده‌ی کارمند کافی نیست و پس از تأیید منفی می‌شود.` : ''}`,
              confirmText: 'تأیید',
            });
            if (!ok) return;
          }
          let res;
          try {
            res = await AP.api('/admin/leave-queue/bulk', { method: 'POST', body: { action, ids, note } });
          } catch (err) { AP.toast(err.message, true); return; }
          queueSel.clear();
          queueShowResult(res, names);
          AP.refresh();
          AP.refreshCounts();
        };
        $$('[data-act]', page).forEach((b) => b.addEventListener('click', () => decide(b.dataset.act, [Number(b.dataset.id)])));
        const ba = $('#q-approve', page); if (ba) ba.addEventListener('click', () => decide('approve', [...queueSel]));
        const br = $('#q-reject', page); if (br) br.addEventListener('click', () => decide('reject', [...queueSel]));
        // ویرایش/حذف (مودال openLeaveEditor) و «ثبت برای کارمند» (openLeaveCreate) — همان منطق صفحه‌ی قدیمی «مرخصی و مأموریت»
        $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => AP.openLeaveEditor(b.dataset.edit)));
        const nw = $('#lv-new', page); if (nw) nw.addEventListener('click', () => AP.openLeaveCreate({}));
      },
    };
  }

  // ======================================================
  // صف «اجازه‌ی ورود» (فاز ۱۲، D3): کارمندی که سقف تأخیر ماهانه را رد کرده برای ثبت ورودِ دیر از سرپرست اجازه می‌خواهد.
  // قواعد (اسکوپ تیم، چه کسی تصمیم می‌گیرد، فقط روی pending، ۴۰۹ برای تصمیم دوباره) سمت سرور است؛ UI فقط دکمه‌ها را با canDecide نشان می‌دهد
  // و پیام خطای سرور را بی‌تغییر در توست می‌آورد. HR فقط می‌بیند (canDecide=false).
  // ======================================================
  const cpUi = { status: 'pending' };
  const CP_STATUS = { pending: ['pending', 'در انتظار'], approved: ['approved', 'تأییدشده'], rejected: ['rejected', 'ردشده'], used: ['holiday', 'استفاده‌شده'], expired: ['holiday', 'منقضی‌شده'] };
  const CP_FILTERS = [['pending', 'در انتظار'], ['approved', 'تأییدشده'], ['rejected', 'ردشده'], ['used', 'استفاده‌شده'], ['expired', 'منقضی‌شده'], ['all', 'همه']];

  const cpItemHtml = (it) => {
    const u = it.user;
    const [cls, label] = CP_STATUS[it.status] || ['holiday', it.status];
    const late = it.limit > 0 ? ` · تأخیر این ماه: ${esc(fmt.num(it.lateCount))} از ${esc(fmt.num(it.limit))}` : '';
    const actions = it.canDecide
      ? `<button class="btn success small" data-act="approve" data-id="${esc(it.id)}">${icon('check')} اجازه می‌دهم</button><button class="btn danger small" data-act="reject" data-id="${esc(it.id)}">${icon('x')} رد</button>` : '';
    const decided = it.decidedAt ? `<div class="meta">تصمیم: ${esc(fmt.dateTime(it.decidedAt))}${it.decisionNote ? ` — ${esc(it.decisionNote)}` : ''}</div>` : '';
    return `
      <div class="item">
        ${AP.avatar(u ? u.fullName : '?', '')}
        <div class="grow">
          <div class="title">${u ? `<a class="u-link-inherit" href="#/profile/${esc(u.id)}">${esc(u.fullName)}</a>` : '—'} ${AP.badge(cls, label)}</div>
          <div class="meta">${u ? `${esc(u.department || '')}${u.personnelCode ? ` · کد پرسنلی <span class="ltr">${esc(u.personnelCode)}</span>` : ''} · ` : ''}${esc(fmt.dateLong(it.date))}${late} · درخواست: ${esc(fmt.dateTime(it.requestedAt))}</div>
          <p class="text">${esc(it.reason)}</p>
          ${decided}
        </div>
        <div class="row-actions">${actions}</div>
      </div>`;
  };

  AP.view('checkin_permissions', {
    skeleton: 'list',
    perm: 'checkin_permissions.read',
    nav: { icon: 'clock', label: 'اجازه‌ی ورود', group: 'درخواست‌ها', counter: true },
    async render() {
      const data = await AP.api(`/admin/checkin-permissions?status=${encodeURIComponent(cpUi.status)}`);
      const items = data.items || [];
      const html = `
        <div class="view-header"><div><h2>درخواست‌های اجازه‌ی ورود</h2>
          <div class="sub">${fmt.num(items.length)} درخواست · کارمندی که در یک ماه شمسی به سقف تأخیر برسد، برای ثبت ورودِ دیر به اجازه‌ی سرپرست نیاز دارد.</div></div></div>
        <div class="chips" id="cp-chips">${CP_FILTERS.map(([k, l]) => `<button class="chip ${k === cpUi.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <div class="list">${items.length ? items.map(cpItemHtml).join('') : `<div class="card">${emptyBox('درخواستی با این فیلتر وجود ندارد.')}</div>`}</div>`;
      return {
        html,
        mount(page) {
          $('#cp-chips', page).addEventListener('click', (e) => {
            const c = e.target.closest('[data-s]');
            if (c) { cpUi.status = c.dataset.s; AP.refresh(); }
          });
          const decide = async (id, approve) => {
            let note = '';
            if (approve) {
              const ok = await AP.confirmBox({ title: 'اجازه‌ی ورود', message: 'ورود این کارمند برای مدت محدود آزاد می‌شود (ساعت واقعی ورود و تأخیر همچنان ثبت می‌شود). تأیید می‌کنید؟', confirmText: 'اجازه می‌دهم' });
              if (!ok) return;
            } else {
              note = await AP.askReason({ title: 'رد درخواست اجازه‌ی ورود', label: 'دلیل رد (اختیاری — برای کارمند ارسال می‌شود)', confirmText: 'رد کن', danger: true, required: false });
              if (note === null) return;
            }
            const done = await AP.attempt(() => AP.api(`/admin/checkin-permissions/${id}/decide`, { method: 'POST', body: { decision: approve ? 'approve' : 'reject', note } }), approve ? 'اجازه‌ی ورود داده شد.' : 'درخواست رد شد.');
            if (done) { AP.refresh(); AP.refreshCounts(); }
          };
          $$('[data-act]', page).forEach((b) => b.addEventListener('click', () => decide(Number(b.dataset.id), b.dataset.act === 'approve')));
        },
      };
    },
  });

  // ======================================================
  // اعتراض‌ها و گفت‌وگو (فاز ۱۱، D6)
  // فهرست در #/disputes و thread کامل در #/disputes/<id> (همین view؛ روتر skeleton، خطا و «تلاش دوباره» را می‌دهد).
  // قواعد (اسکوپ نقش، disputes.read/resolve، پاسخ فقط روی اعتراضِ باز، سقف ۵۰۰ نویسه) سمت سرور است؛
  // UI فقط دکمه‌ها را بر اساس وضعیت و مجوز نشان می‌دهد و پیام خطای سرور را بی‌تغییر در توست می‌آورد.
  // ======================================================
  const dispUi = { status: 'open', stickBottom: false };
  const DISP_MSG_MAX = 500; // همان سقف سرور (disputeService.MESSAGE_MAX)
  // فیلتر وضعیت (مدل جدید) و کلید شمارنده‌ی هرکدام در GET /admin/disputes/counts
  const DISP_FILTERS = [
    ['open', 'باز', 'open'], ['awaiting_admin', 'منتظر پاسخ', 'awaitingAdmin'], ['answered', 'پاسخ داده‌شده', 'answered'],
    ['resolved_by_admin', 'حل‌شده توسط ادمین', 'resolvedByAdmin'], ['closed_by_user', 'خاتمه توسط کارمند', 'closedByUser'], ['all', 'همه', 'total'],
  ];
  // phase سرور ⇒ [کلاس badge پنل، متن]؛ «منتظر پاسخ» = باز و آخرین پیام از کارمند
  const DISP_PHASE = { open: ['pending', 'منتظر پاسخ'], answered: ['blue', 'پاسخ داده شد'], resolved: ['resolved', 'حل‌شده'], closed_by_user: ['holiday', 'خاتمه توسط کارمند'] };
  const dispBadge = (d) => { const [cls, label] = DISP_PHASE[d.phase] || DISP_PHASE.open; return AP.badge(cls, label, true); };
  const dispCountBadge = (d) => AP.badge('holiday', `${fmt.num(d.messageCount)} پیام`);

  async function disputeResolve(id) {
    const note = await AP.askReason({ title: 'بستن اعتراض', label: 'پیام پایانی به کارمند (اختیاری — در گفت‌وگو ثبت و در تلگرام ارسال می‌شود)', confirmText: 'بستن اعتراض', required: false });
    if (note === null) return false;
    const ok = await AP.attempt(() => AP.api(`/admin/disputes/${id}/resolve`, { method: 'POST', body: { note } }), 'اعتراض بسته شد.');
    if (ok) { dispUi.stickBottom = true; AP.refresh(); AP.refreshCounts(); }
    return !!ok;
  }
  async function disputeReopen(id) {
    const note = await AP.askReason({ title: 'بازگشایی اعتراض', label: 'پیام به کارمند (اختیاری)', confirmText: 'بازگشایی', required: false });
    if (note === null) return false;
    const ok = await AP.attempt(() => AP.api(`/admin/disputes/${id}/reopen`, { method: 'POST', body: { note } }), 'اعتراض دوباره باز شد.');
    if (ok) { dispUi.stickBottom = true; AP.refresh(); AP.refreshCounts(); }
    return !!ok;
  }

  // ---------- thread کامل ----------
  async function renderDisputeThread(param) {
    if (!/^\d+$/.test(String(param))) throw new Error('شناسه‌ی اعتراض نامعتبر است.');
    const t = await AP.api(`/admin/disputes/${param}`); // اسکوپ نقش/۴۰۴ را سرور تصمیم می‌گیرد؛ خطا ⇒ صفحه‌ی خطا با «تلاش دوباره»
    const d = t.dispute;
    const emp = t.employee;
    const isOpen = d.status === 'open';
    const canWrite = AP.can('disputes.resolve');
    const empName = emp ? emp.fullName : '—';
    const bubble = (m) => {
      const who = m.sender ? m.sender.fullName : (m.senderRole === 'admin' ? 'ادمین' : empName);
      return `<div class="dsp-msg ${m.senderRole === 'admin' ? 'admin' : 'user'}">
        <div class="dsp-meta"><b>${esc(who)}</b><span>${esc(fmt.dateTime(m.createdAt))}</span></div>
        <div class="dsp-text" dir="auto">${esc(m.message)}</div></div>`;
    };
    let footer;
    if (!canWrite) {
      footer = `<div class="card"><p class="muted dsp-note">فقط‌مشاهده: مجوز پاسخ‌دادن به اعتراض را ندارید.</p></div>`;
    } else if (isOpen) {
      footer = `<form class="card form dsp-reply" id="dsp-reply">
        <label class="field"><span>پاسخ به کارمند</span><textarea name="message" rows="3" maxlength="${DISP_MSG_MAX}" dir="auto" required></textarea></label>
        <div class="dsp-actions">
          <span class="muted dsp-counter" id="dsp-counter">${esc(fmt.num(0))} / ${esc(fmt.num(DISP_MSG_MAX))}</span>
          <button type="submit" class="btn primary">ارسال پاسخ</button>
          <button type="button" class="btn success" data-resolve="${d.id}">${icon('check')} بستن و پیام پایانی</button>
        </div></form>`;
    } else {
      footer = `<div class="card dsp-closed"><p class="muted dsp-note">این اعتراض ${d.closedBy === 'user' ? 'توسط کارمند خاتمه یافته' : 'بسته شده'} است. برای پاسخ‌دادن ابتدا آن را بازگشایی کنید.</p>
        <button type="button" class="btn ghost" data-reopen="${d.id}">بازگشایی اعتراض</button></div>`;
    }
    const html = `
      <div class="view-header"><div><h2>گفت‌وگوی اعتراض</h2><div class="sub">ثبت‌شده: ${esc(fmt.dateTime(d.createdAt))}</div></div>
        <div class="row-actions"><button type="button" class="btn ghost" data-back>بازگشت به فهرست</button></div></div>
      <div class="card dsp-head">
        <div class="title">${AP.avatar(empName, 'purple')}
          ${emp ? `<a href="#/profile/${emp.id}" class="dsp-emp">${esc(empName)}</a>` : esc(empName)}
          ${dispBadge(d)} ${dispCountBadge(d)}
          ${d.reopenCount ? `<span class="muted dsp-sub">ادامه: ${fmt.num(d.reopenCount)} بار</span>` : ''}</div>
        ${t.record ? `<div class="meta">رکورد مرتبط: <a href="#" data-rec="${t.record.id}" class="dsp-rec">${esc(fmt.dateLong(t.record.date))}</a></div>` : ''}
      </div>
      <div class="dsp-thread" role="log" aria-live="polite" aria-label="پیام‌های گفت‌وگو">${t.messages.length ? t.messages.map(bubble).join('') : emptyBox('هنوز پیامی در این گفت‌وگو نیست.')}</div>
      ${footer}`;
    return {
      html,
      mount(page) {
        $('[data-back]', page).addEventListener('click', () => AP.go('disputes'));
        $$('[data-rec]', page).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); AP.openRecord(a.dataset.rec); }));
        $$('[data-resolve]', page).forEach((b) => b.addEventListener('click', () => disputeResolve(b.dataset.resolve)));
        $$('[data-reopen]', page).forEach((b) => b.addEventListener('click', () => disputeReopen(b.dataset.reopen)));
        const form = $('#dsp-reply', page);
        if (form) {
          const ta = $('textarea', form);
          const counter = $('#dsp-counter', page);
          ta.addEventListener('input', () => { counter.textContent = `${fmt.num(ta.value.length)} / ${fmt.num(DISP_MSG_MAX)}`; });
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            // خطای سرور (طول، متن خالی، «بسته شده» …) در توست می‌آید و متن نوشته‌شده می‌ماند؛ فقط با موفقیت صفحه تازه می‌شود
            const ok = await AP.attempt(() => AP.api(`/admin/disputes/${d.id}/messages`, { method: 'POST', body: { message: ta.value } }), 'پاسخ ارسال شد.', $('button[type=submit]', form));
            if (ok) { dispUi.stickBottom = true; AP.refresh(); AP.refreshCounts(); }
          });
        }
        if (dispUi.stickBottom) { // بعد از ارسال/بستن: آخرین پیام دیده شود (روتر بعد از رندر به بالا می‌پرد)
          dispUi.stickBottom = false;
          const last = $('.dsp-msg:last-child', page);
          if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'end' });
        }
      },
    };
  }

  // فهرست (بدون param) همین‌جا رندر می‌شود؛ thread کامل (#/disputes/<id>) در renderDisputeThread
  AP.view('disputes', {
    skeleton: 'list', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'disputes.read',
    nav: { icon: 'disputes', label: 'اعتراض‌ها', group: 'درخواست‌ها', counter: true },
    async render(param) {
      if (param) return renderDisputeThread(param);
      const [items, counts] = await Promise.all([
        AP.api(`/admin/disputes${dispUi.status === 'all' ? '' : `?status=${encodeURIComponent(dispUi.status)}`}`),
        AP.api('/admin/disputes/counts').catch(() => null), // شمارنده‌ها تزئینی‌اند؛ شکستشان فهرست را نمی‌اندازد
      ]);
      const canWrite = AP.can('disputes.resolve');
      const chips = DISP_FILTERS.map(([k, label, ck]) => `<button class="chip ${k === dispUi.status ? 'active' : ''}" data-s="${k}">${esc(label)}${counts && counts[ck] != null ? ` <b>${fmt.num(counts[ck])}</b>` : ''}</button>`).join('');
      const rows = items.map((d) => `
        <div class="item">
          ${AP.avatar(d.employee ? d.employee.fullName : '?', 'purple')}
          <div class="grow">
            <div class="title"><a href="#/profile/${d.employee ? d.employee.id : ''}" class="dsp-emp">${esc(d.employee ? d.employee.fullName : '—')}</a>
              ${dispBadge(d)} ${dispCountBadge(d)}
              ${d.reopenCount ? `<span class="muted dsp-sub">ادامه: ${fmt.num(d.reopenCount)} بار</span>` : ''}
              <span class="muted dsp-sub">${esc(fmt.dateTime(d.lastMessageAt))}</span></div>
            <p class="text" dir="auto">${esc(d.message)}</p>
            ${d.record ? `<div class="meta">رکورد مرتبط: <a href="#" data-rec="${d.record.id}" class="dsp-rec">${esc(fmt.dateLong(d.record.date))}</a></div>` : ''}
          </div>
          <div class="row-actions">
            <button class="btn primary small" data-open="${d.id}">گفت‌وگو</button>
            ${!canWrite ? '' : d.status === 'open' ? `<button class="btn success small" data-resolve="${d.id}">${icon('check')} بستن و پاسخ</button>` : `<button class="btn ghost small" data-reopen="${d.id}">بازگشایی</button>`}
            ${d.employee && AP.can('records.edit') ? `<button class="btn ghost small" data-new="${d.employee.id}">ثبت/اصلاح تردد</button>` : ''}
          </div></div>`).join('');
      const html = `
        <div class="view-header"><div><h2>${AP.selfOnly() ? 'اعتراض‌های من' : 'اعتراض‌های کارمندان'}</h2><div class="sub">${fmt.num(items.length)} مورد</div></div></div>
        <div class="chips" id="d-chips">${chips}</div>
        <div class="list">${items.length ? rows : `<div class="card">${emptyBox('اعتراضی وجود ندارد.')}</div>`}</div>`;
      return {
        html,
        mount(page) {
          $('#d-chips', page).addEventListener('click', (e) => { const c = e.target.closest('[data-s]'); if (c) { dispUi.status = c.dataset.s; AP.refresh(); } });
          $$('[data-open]', page).forEach((b) => b.addEventListener('click', () => AP.go('disputes', b.dataset.open)));
          $$('[data-rec]', page).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); AP.openRecord(a.dataset.rec); }));
          $$('[data-new]', page).forEach((b) => b.addEventListener('click', () => AP.openCreateRecord({ userId: b.dataset.new })));
          $$('[data-resolve]', page).forEach((b) => b.addEventListener('click', () => disputeResolve(b.dataset.resolve)));
          $$('[data-reopen]', page).forEach((b) => b.addEventListener('click', () => disputeReopen(b.dataset.reopen)));
        },
      };
    },
  });
  // ======================================================
  // موارد مشکوک (S2-5b): فقط «نشانه» برای بررسی انسانی، نه اتهام یا مدرک
  // ======================================================
  const suspUi = { status: 'open' };
  const SUSP_TYPE = { shared_device: 'یک دستگاه برای چند نفر', same_ip_close: 'یک IP و ثبت‌های بسیار نزدیک', device_change: 'تغییر ناگهانی دستگاه', pending_mission_outside: 'تردد از بیرون شبکه با ماموریتِ در انتظار' };
  const SUSP_STATUS = { open: ['open', 'بررسی‌نشده'], reviewed: ['resolved', 'بررسی‌شده'], ignored: ['holiday', 'بی‌اهمیت'] };
  const shortId = (v) => { const t = String(v == null ? '' : v); return t.length > 10 ? `${t.slice(0, 8)}…` : t; };

  // توضیح فارسی و خوانا از details هر نوع قاعده (همه‌ی مقدارها esc می‌شوند)
  function suspDetailLines(e) {
    const d = e.details || {};
    const out = [];
    if (e.eventType === 'shared_device') {
      out.push(`یک شناسه‌ی دستگاه (${shortId(d.deviceId)}) در همین روز برای ${fmt.num(d.userCount || e.users.length)} نفر ثبت شده است.`);
    } else if (e.eventType === 'same_ip_close') {
      out.push(`ثبت‌ها از یک IP (${d.ip || '—'}) و با فاصله‌ی ${fmt.num(d.minGapSeconds)} ثانیه (آستانه ${fmt.num(d.windowSeconds)} ثانیه) انجام شده‌اند.`);
      out.push('در شبکه‌ی مشترک یا هات‌اسپات، این حالت می‌تواند کاملاً عادی باشد.');
    } else if (e.eventType === 'device_change') {
      out.push(`دستگاه امروز با دستگاه‌های ${fmt.num(d.historyDays)} روز اخیر (از ${fmt.num(d.lookbackDays)} روز گذشته) تفاوت دارد.`);
      out.push('تعویض گوشی یا پاک‌شدن داده‌ی مرورگر/تلگرام هم همین نشانه را می‌سازد.');
    }
    if (e.eventType === 'pending_mission_outside') out.push(`تردد (${d.action === 'check_out' ? 'خروج' : 'ورود'}) از بیرون شبکه فقط به‌خاطر ماموریت #${fmt.num(d.requestId)} که هنوز تصمیم‌گیری نشده مجاز شد؛ پس از تصمیم سرپرست بررسی کنید.`);
    if (d.blocked) out.push('ثبت این تردد به‌دلیل تنظیم «مسدودسازی دستگاه مشترک» انجام نشد.');
    return out;
  }

  AP.view('suspicious', {
    skeleton: 'list', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'suspicious.read',
    nav: { icon: 'alert', label: 'موارد مشکوک', group: 'کارمندان و تردد', counter: true },
    async render() {
      const qs = suspUi.status === 'all' ? '' : `?status=${suspUi.status}`;
      const items = await AP.api(`/admin/suspicious${qs}`);
      const html = `
        <div class="view-header"><div><h2>موارد مشکوک</h2><div class="sub">${fmt.num(items.length)} نشانه</div></div></div>
        <div class="card u-mb-12"><p class="muted import-help">
          اینجا فقط «نشانه» می‌بینید، نه اتهام یا مدرک. شناسه‌ی دستگاه توسط خود برنامه در مرورگر ساخته می‌شود و قابل جعل یا پاک‌شدن است؛
          هر نشانه باید با گفتگو و بررسی انسانی تأیید یا نادیده گرفته شود. ثبت نتیجه‌ی بررسی (با ذکر دلیل) در گزارش رویدادها می‌ماند.</p></div>
        <div class="chips" id="s-chips">${[['open', 'بررسی‌نشده'], ['reviewed', 'بررسی‌شده'], ['ignored', 'بی‌اهمیت'], ['all', 'همه']]
          .map(([k, l]) => `<button class="chip ${k === suspUi.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <div class="list">${items.length ? items.map((e) => {
          const [cls, label] = SUSP_STATUS[e.status] || ['holiday', e.status];
          return `
          <div class="item">
            <div class="grow">
              <div class="title">${esc(SUSP_TYPE[e.eventType] || e.eventType)} ${AP.badge(cls, label)}
                <span class="muted table-hint">${esc(fmt.dateLong(e.eventDate))}</span></div>
              <div class="meta">${e.users.map((u) => `<a class="u-link-accent" href="#/profile/${esc(u.id)}">${esc(u.fullName || `کاربر ${u.id}`)}</a>`).join('، ')}</div>
              ${suspDetailLines(e).map((t) => `<p class="text">${esc(t)}</p>`).join('')}
              ${e.recordIds.length ? `<div class="meta">رکوردهای مرتبط: ${e.recordIds.map((id) => `<a class="u-link-accent" href="#" data-rec="${esc(id)}">#${fmt.num(id)}</a>`).join('، ')}</div>` : ''}
              ${e.reviewedAt ? `<div class="meta">${e.status === 'ignored' ? 'ثبت‌شده به‌عنوان بی‌اهمیت' : 'بررسی‌شده'} توسط ${esc(e.reviewedBy ? e.reviewedBy.fullName || `کاربر ${e.reviewedBy.id}` : '—')} · ${esc(fmt.dateTime(e.reviewedAt))}</div>` : ''}
            </div>
            <div class="row-actions">
              ${!AP.can('suspicious.review') ? '' : e.status === 'open' ? `
                <button class="btn success small" data-review="${e.id}" data-to="reviewed">${icon('check')} بررسی شد</button>
                <button class="btn ghost small" data-review="${e.id}" data-to="ignored">بی‌اهمیت</button>` : `
                <button class="btn ghost small" data-review="${e.id}" data-to="${e.status === 'reviewed' ? 'ignored' : 'reviewed'}">${e.status === 'reviewed' ? 'تغییر به بی‌اهمیت' : 'تغییر به بررسی‌شده'}</button>`}
            </div></div>`;
        }).join('') : `<div class="card">${emptyBox(suspUi.status === 'open' ? 'نشانه‌ی بررسی‌نشده‌ای وجود ندارد.' : 'موردی وجود ندارد.')}</div>`}</div>`;
      return {
        html,
        mount(page) {
          $('#s-chips', page).addEventListener('click', (ev) => { const c = ev.target.closest('[data-s]'); if (c) { suspUi.status = c.dataset.s; AP.refresh(); } });
          $$('[data-rec]', page).forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); AP.openRecord(a.dataset.rec); }));
          $$('[data-review]', page).forEach((b) => b.addEventListener('click', async () => {
            const to = b.dataset.to;
            const reason = await AP.askReason({
              title: to === 'reviewed' ? 'ثبت نتیجه‌ی بررسی' : 'ثبت به‌عنوان بی‌اهمیت',
              label: 'دلیل / نتیجه‌ی بررسی (اجباری — در گزارش رویدادها ثبت می‌شود)',
              message: 'این مورد فقط یک نشانه است. نتیجه‌ی بررسی خود را کوتاه بنویسید.',
              confirmText: to === 'reviewed' ? 'ثبت بررسی' : 'ثبت بی‌اهمیت',
            });
            if (reason === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/suspicious/${b.dataset.review}/review`, { method: 'POST', body: { status: to, reason } }), 'ثبت شد.');
            if (ok) { AP.refresh(); AP.refreshCounts(); }
          }));
        },
      };
    },
  });

  // ======================================================
  // مرور شبانه: وضعیت تیم + مرخصی‌ها + اعتراض‌ها در یک صفحه
  // ======================================================
  const nightUi = { date: null, filter: 'attention' };
  AP.view('nightly', {
    skeleton: 'table', // شکل skeleton هنگام بارگذاری (S5-9c)
    perm: 'dashboard.read',
    nav: { icon: 'clock', label: 'مرور شبانه', group: 'نمای کلی', counter: true },
    async render() {
      const q = nightUi.date ? `?date=${encodeURIComponent(nightUi.date)}` : '';
      const [data, leaves, disputes] = await Promise.all([
        AP.api(`/admin/nightly-review${q}`),
        AP.api('/admin/leave-requests?status=pending'),
        AP.api('/admin/disputes?status=open'),
      ]);
      nightUi.date = data.date;
      const t = data.totals;
      const order = { absent: 0, incomplete: 1, present: 2, checked_out: 3, leave: 4, holiday: 5 };
      const rows = [...data.rows].sort((a, b) =>
        (b.needsAttention - a.needsAttention) || ((order[a.state] ?? 9) - (order[b.state] ?? 9)) || a.user.fullName.localeCompare(b.user.fullName, 'fa'));
      const chips = [['attention', 'نیازمند بررسی', t.attention], ['all', 'همه', t.total]];
      if (!chips.some((c) => c[0] === nightUi.filter)) nightUi.filter = 'attention';

      const leaveItems = leaves.map((l) => `
        <div class="item">
          ${AP.avatar(l.employee ? l.employee.fullName : '?', '')}
          <div class="grow">
            <div class="title"><a class="u-link-inherit" href="#/profile/${l.employee ? l.employee.id : ''}">${esc(l.employee ? l.employee.fullName : '—')}</a>
              ${AP.badge(l.leaveType === 'mission' ? 'mission' : 'leave', AP.LEAVE_TYPE[l.leaveType])}</div>
            <div class="meta">${esc(fmt.dateLong(l.startDate))} تا ${esc(fmt.dateLong(l.endDate))} · ثبت: ${esc(fmt.dateTime(l.createdAt))}</div>
            ${l.reason ? `<p class="text">${esc(l.reason)}</p>` : ''}
          </div>
          <div class="row-actions">
            ${AP.can('leave.approve') ? `<button class="btn success small" data-act="approve" data-id="${l.id}">${icon('check')} تأیید</button>
            <button class="btn danger small" data-act="reject" data-id="${l.id}">${icon('x')} رد</button>` : ''}
          </div></div>`).join('');

      const disputeItems = disputes.map((d) => `
        <div class="item">
          ${AP.avatar(d.employee ? d.employee.fullName : '?', 'purple')}
          <div class="grow">
            <div class="title"><a class="u-link-inherit" href="#/profile/${d.employee ? d.employee.id : ''}">${esc(d.employee ? d.employee.fullName : '—')}</a>
              <span class="muted table-hint">${esc(fmt.dateTime(d.createdAt))}</span></div>
            <p class="text">${esc(d.message)}</p>
            ${d.record ? `<div class="meta">رکورد مرتبط: <a class="u-link-accent" href="#" data-rec="${d.record.id}">${esc(fmt.dateLong(d.record.date))}</a></div>` : ''}
          </div>
          <div class="row-actions">
            ${AP.can('disputes.resolve') ? `<button class="btn success small" data-resolve="${d.id}">${icon('check')} بستن و پاسخ</button>` : ''}
          </div></div>`).join('');

      const html = `
        <div class="view-header">
          <div><h2>مرور شبانه</h2>
            <div class="sub cal-sub"><span class="cal-chip">${esc(fmt.dateLong(data.date))}</span>${data.holiday ? '<span class="cal-chip cal-chip-off">تعطیل رسمی</span>' : ''}<span class="cal-chip">${fmt.num(t.total)} نفر</span><span class="cal-chip nt-chip-warn">${fmt.num(t.attention)} مورد نیازمند بررسی</span></div></div>
          <div class="header-actions">
            <label class="field u-m0"><input type="date" id="nt-date" name="ntDate" value="${esc(data.date)}" max="${esc(data.today)}" /></label>
          </div>
        </div>
        <div class="chips" id="nt-chips">${chips.map(([k, l, c]) => `<button class="chip ${k === nightUi.filter ? 'active' : ''}" data-f="${k}">${esc(l)}<b>${fmt.num(c)}</b></button>`).join('')}</div>
        <div class="nt-stats"><div class="nt-stat nt-present"><b>${fmt.num(t.present)}</b><span>حاضر</span></div><div class="nt-stat nt-late"><b>${fmt.num(t.late)}</b><span>متأخر</span></div><div class="nt-stat nt-noCheckout"><b>${fmt.num(t.noCheckout)}</b><span>بدون خروج</span></div><div class="nt-stat nt-absent"><b>${fmt.num(t.absent)}</b><span>غایب</span></div><div class="nt-stat nt-leave"><b>${fmt.num(t.leave)}</b><span>مرخصی</span></div></div>
        <div class="card card--primary flush"><div class="table-wrap"><table>
          <thead><tr><th>کارمند</th><th>وضعیت</th><th>ورود</th><th>خروج</th><th>ساعت مفید</th><th>نکات</th><th>عملیات</th></tr></thead>
          <tbody id="nt-body"></tbody></table></div></div>

        <div class="view-header u-mt-26"><div><h2>مرخصی و مأموریت منتظر پاسخ</h2><div class="sub">${fmt.num(leaves.length)} درخواست</div></div></div>
        <div class="list">${leaves.length ? leaveItems : `<div class="card">${emptyBox('درخواستی در انتظار نیست.')}</div>`}</div>

        <div class="view-header u-mt-26"><div><h2>اعتراض‌های باز</h2><div class="sub">${fmt.num(disputes.length)} مورد</div></div></div>
        <div class="list">${disputes.length ? disputeItems : `<div class="card">${emptyBox('اعتراض بازی وجود ندارد.')}</div>`}</div>`;

      return {
        html,
        mount(page) {
          AP.dates.mount($('.header-actions', page)); // تاریخ مرور شمسی؛ مقدار ISO در input مخفی ntDate (S3-11b)
          const body = $('#nt-body', page);
          const chipsEl = $('#nt-chips', page);
          const draw = () => {
            $$('.chip', chipsEl).forEach((c) => c.classList.toggle('active', c.dataset.f === nightUi.filter));
            const list = nightUi.filter === 'attention' ? rows.filter((r) => r.needsAttention) : rows;
            body.innerHTML = list.length ? list.map((r) => `<tr>
              <td><a class="cell-user u-link-inherit" href="#/profile/${r.user.id}">${AP.avatar(r.user.fullName, 'sm')}
                <span><b>${esc(r.user.fullName)}</b><small>${esc(r.user.department || '—')}</small></span></a></td>
              <td>${AP.stateBadge(r.state)} ${r.onMission ? AP.badge('mission', 'مأموریت') : ''}</td>
              <td class="num">${r.checkIn ? fmt.clock(r.checkIn) : '—'}</td>
              <td class="num">${r.checkOut ? fmt.clock(r.checkOut) : '—'}</td>
              <td class="num">${r.effectiveMinutes != null ? fmt.min(r.effectiveMinutes) : '—'}</td>
              <td>${r.lateMinutes > 0 ? AP.badge('late', `تأخیر ${fmt.min(r.lateMinutes)}`) : ''} ${r.noCheckout ? AP.badge('incomplete', 'بدون ثبت خروج') : ''}</td>
              <td><div class="row-actions">
                ${r.user.telegramUserId && AP.can('users.message') ? `<button class="btn ghost small" data-msg="${r.user.id}" title="ارسال پیام تلگرام">${icon('mail')}</button>` : ''}
              </div></td></tr>`).join('')
              : `<tr><td colspan="7">${emptyBox(nightUi.filter === 'attention' ? 'مورد نیازمند بررسی‌ای نیست. ✅' : 'کارمندی برای نمایش نیست.')}</td></tr>`;
          };
          draw();
          chipsEl.addEventListener('click', (e) => { const c = e.target.closest('[data-f]'); if (c) { nightUi.filter = c.dataset.f; draw(); } });
          body.addEventListener('click', (e) => { const m = e.target.closest('[data-msg]'); if (m) AP.openMessage(m.dataset.msg); });
          $('input[name="ntDate"]', page).addEventListener('change', (e) => { if (e.target.value) { nightUi.date = e.target.value; AP.refresh(); } });

          $$('[data-rec]', page).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); AP.openRecord(a.dataset.rec); }));
          $$('[data-act]', page).forEach((b) => b.addEventListener('click', async () => {
            const approve = b.dataset.act === 'approve';
            let note = '';
            if (!approve) {
              note = await AP.askReason({ title: 'رد درخواست', label: 'دلیل رد (اختیاری — برای کارمند در تلگرام ارسال می‌شود)', confirmText: 'رد کن', danger: true, required: false });
              if (note === null) return;
            }
            const ok = await AP.attempt(() => AP.api(`/admin/leave-requests/${b.dataset.id}/${b.dataset.act}`, { method: 'POST', body: { note } }), approve ? 'تأیید شد.' : 'رد شد.');
            if (ok) { AP.refresh(); AP.refreshCounts(); }
          }));
          $$('[data-resolve]', page).forEach((b) => b.addEventListener('click', async () => {
            const note = await AP.askReason({ title: 'بستن اعتراض', label: 'پاسخ به کارمند (اختیاری — در تلگرام ارسال می‌شود)', confirmText: 'بستن اعتراض', required: false });
            if (note === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/disputes/${b.dataset.resolve}/resolve`, { method: 'POST', body: { note } }), 'اعتراض بسته شد.');
            if (ok) { AP.refresh(); AP.refreshCounts(); }
          }));
        },
      };
    },
  });
})();
