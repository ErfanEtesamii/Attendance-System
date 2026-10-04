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
    const admin = AP.state.isAdmin;
    const u = r.user || {};

    const statusOpts = Object.entries(AP.STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('');

    const breakRow = (b) => `
      <tr data-break="${b.id}">
        <td>${admin ? `<select data-f="type"><option value="lunch" ${b.break_type === 'lunch' ? 'selected' : ''}>ناهار</option><option value="short_break" ${b.break_type === 'short_break' ? 'selected' : ''}>کوتاه</option></select>`
          : esc(b.break_type === 'lunch' ? 'ناهار' : 'کوتاه')}</td>
        <td>${admin ? `<input type="datetime-local" data-f="start" value="${fmt.toLocalInput(b.start_time)}" />` : fmt.clock(b.start_time)}</td>
        <td>${admin ? `<input type="datetime-local" data-f="end" value="${fmt.toLocalInput(b.end_time)}" />` : (b.end_time ? fmt.clock(b.end_time) : AP.badge('on_break', 'در جریان'))}</td>
        ${admin ? `<td><div class="row-actions"><button type="button" class="btn ghost small" data-save-break>ذخیره</button><button type="button" class="btn danger small" data-del-break>${icon('trash')}</button></div></td>` : ''}
      </tr>`;

    const body = `
      <div class="profile-head" style="margin-bottom:14px">
        ${AP.avatar(u.fullName, '')}
        <div class="grow"><h2 style="font-size:17px;margin:0 0 4px"><a href="#/profile/${r.user_id}" style="color:inherit" data-close-link>${esc(u.fullName || '—')}</a></h2>
          <div class="muted">${esc(fmt.dateLong(r.record_date))} · ${esc(u.department || '')}</div></div>
        ${AP.statusBadge(r.status)}
      </div>

      <div class="grid-2" style="gap:12px;margin-bottom:6px">
        <div class="kv">
          <div class="kv-row"><span>ورود</span><span class="num">${fmt.clock(r.check_in_time)}</span></div>
          <div class="kv-row"><span>IP ورود</span><span class="ltr">${esc(r.check_in_ip || '—')}</span></div>
          <div class="kv-row"><span>تأخیر</span><span>${r.summary.lateMinutes ? fmt.min(r.summary.lateMinutes) : '—'}</span></div>
        </div>
        <div class="kv">
          <div class="kv-row"><span>خروج</span><span class="num">${fmt.clock(r.check_out_time)}</span></div>
          <div class="kv-row"><span>IP خروج</span><span class="ltr">${esc(r.check_out_ip || '—')}</span></div>
          <div class="kv-row"><span>ساعت مفید</span><span>${r.summary.effectiveMinutes != null ? fmt.min(r.summary.effectiveMinutes) : '—'}</span></div>
        </div>
      </div>

      <div class="section-title">استراحت‌ها (${fmt.num(r.breaks.length)}) · مجموع ${fmt.min(r.breakMinutes)}</div>
      ${r.breaks.length ? `<div class="table-wrap"><table><thead><tr><th>نوع</th><th>شروع</th><th>پایان</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>${r.breaks.map(breakRow).join('')}</tbody></table></div>` : `<div class="muted">استراحتی ثبت نشده است.</div>`}
      ${admin ? `<form class="form-grid" id="add-break" style="margin-top:12px;align-items:end">
        <label class="field"><span>شروع استراحت جدید</span><input type="datetime-local" name="startTime" required /></label>
        <label class="field"><span>پایان</span><input type="datetime-local" name="endTime" /></label>
        <button class="btn ghost small" type="submit" style="grid-column:1/-1;justify-self:start">${icon('plus')} افزودن استراحت</button></form>` : ''}

      ${admin ? `<div class="section-title">اصلاح رکورد</div>
        <form class="form" id="fix-form">
          <div class="form-grid">
            <label class="field"><span>ساعت ورود</span><input type="datetime-local" name="checkInTime" value="${fmt.toLocalInput(r.check_in_time)}" /></label>
            <label class="field"><span>ساعت خروج</span><input type="datetime-local" name="checkOutTime" value="${fmt.toLocalInput(r.check_out_time)}" /></label>
            <label class="field"><span>وضعیت</span><select name="status">${statusOpts}</select></label>
            <label class="field full"><span>دلیل اصلاح (اجباری — به کارمند در تلگرام اطلاع داده می‌شود)</span><textarea name="reason" rows="2" required></textarea></label>
          </div>
          <div class="form-msg"></div>
          <div class="modal-actions"><button class="btn primary" type="submit">ذخیره اصلاح</button>
            <button class="btn danger" type="button" id="del-rec">${icon('trash')} حذف رکورد</button></div>
        </form>` : ''}

      ${r.disputes.length ? `<div class="section-title">اعتراض‌های مرتبط</div>${r.disputes.map((d) => `<div class="item" style="margin-bottom:8px"><div class="grow">${AP.badge(d.status, d.status === 'open' ? 'باز' : 'بسته')}<p class="text">${esc(d.message)}</p></div></div>`).join('')}` : ''}

      ${admin && r.history.length ? `<div class="section-title">تاریخچه‌ی تغییرات</div><div class="kv">${r.history.map((h) => `
        <div class="kv-row"><span>${esc(h.userFullName || '—')} · ${esc(h.action)}</span><span class="muted">${esc(fmt.dateTime(h.occurred_at))}</span></div>`).join('')}</div>` : ''}`;

    AP.modal({
      title: 'رکورد تردد', wide: true, body,
      onMount(b, h) {
        const reopen = () => { h.close(); AP.openRecord(id); AP.refresh(); };
        const link = $('[data-close-link]', b); if (link) link.addEventListener('click', () => h.close());
        if (!admin) return;

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
            startTime: fmt.fromLocalInput(f.startTime), endTime: fmt.fromLocalInput(f.endTime), reason } }), 'استراحت اضافه شد.');
          if (ok) reopen();
        });

        $$('tr[data-break]', b).forEach((tr) => {
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
            m.innerHTML = esc(err.message) + (err.data && err.data.recordId ? ` <a href="#" data-open="${err.data.recordId}" style="color:var(--green)">مشاهده‌ی رکورد موجود</a>` : '');
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

  AP.view('attendance', {
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
            <a class="btn ghost" href="/api/admin/attendance/export?${qs()}" download>${icon('download')} خروجی CSV</a>
            ${AP.state.isAdmin ? `<button class="btn primary" id="att-new">${icon('plus')} ثبت دستی</button>` : ''}
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
          ${data.records.length ? data.records.map((r) => `<tr class="clickable" data-rec="${r.id}">
            <td><div class="cell-user">${AP.avatar(r.user ? r.user.fullName : '?', 'sm')}<span><b>${esc(r.user ? r.user.fullName : '—')}</b><small>${esc(r.user ? r.user.department || '' : '')}</small></span></div></td>
            <td>${esc(fmt.date(r.record_date))}</td><td class="num">${fmt.clock(r.check_in_time)}</td><td class="num">${fmt.clock(r.check_out_time)}</td>
            <td class="num">${r.breakMinutes ? fmt.min(r.breakMinutes) : '—'}</td>
            <td class="num">${r.summary.effectiveMinutes != null ? fmt.min(r.summary.effectiveMinutes) : '—'}</td>
            <td class="num">${r.summary.lateMinutes ? fmt.min(r.summary.lateMinutes) : '—'}</td>
            <td><span class="ltr muted">${esc(r.check_in_ip || '—')}</span></td><td>${AP.statusBadge(r.status)}</td></tr>`).join('')
            : `<tr><td colspan="9">${emptyBox('رکوردی با این فیلتر پیدا نشد.')}</td></tr>`}
          </tbody></table></div></div>`;
      return {
        html,
        mount(page) {
          const form = $('#att-filters', page);
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

  const leaveUi = { status: 'pending' };
  AP.view('leave', {
    nav: { icon: 'leave', label: 'مرخصی و مأموریت', group: 'درخواست‌ها', counter: true },
    async render() {
      const items = await AP.api(`/admin/leave-requests?status=${leaveUi.status}`);
      const html = `
        <div class="view-header">
          <div><h2>مرخصی و مأموریت</h2><div class="sub">${fmt.num(items.length)} درخواست</div></div>
          <div class="header-actions">${AP.state.isAdmin ? `<button class="btn primary" id="lv-new">${icon('plus')} ثبت برای کارمند</button>` : ''}</div>
        </div>
        <div class="chips" id="lv-chips">${[['pending', 'در انتظار'], ['approved', 'تأییدشده'], ['rejected', 'ردشده'], ['all', 'همه']]
          .map(([k, l]) => `<button class="chip ${k === leaveUi.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <div class="list">${items.length ? items.map((l) => `
          <div class="item">
            ${AP.avatar(l.employee ? l.employee.fullName : '?', '')}
            <div class="grow">
              <div class="title"><a href="#/profile/${l.employee ? l.employee.id : ''}" style="color:inherit">${esc(l.employee ? l.employee.fullName : '—')}</a>
                ${AP.badge(l.leaveType === 'mission' ? 'mission' : 'leave', AP.LEAVE_TYPE[l.leaveType])} ${AP.badge(l.status, AP.LEAVE_STATUS[l.status])}</div>
              <div class="meta">${esc(fmt.dateLong(l.startDate))} تا ${esc(fmt.dateLong(l.endDate))} · ثبت: ${esc(fmt.dateTime(l.createdAt))}</div>
              ${l.reason ? `<p class="text">${esc(l.reason)}</p>` : ''}
            </div>
            <div class="row-actions">
              ${l.status === 'pending' ? `<button class="btn success small" data-act="approve" data-id="${l.id}">${icon('check')} تأیید</button><button class="btn danger small" data-act="reject" data-id="${l.id}">${icon('x')} رد</button>` : ''}
              ${AP.state.isAdmin ? `<button class="btn ghost small" data-edit="${l.id}">${icon('edit')} ویرایش</button>` : ''}
            </div></div>`).join('') : `<div class="card">${emptyBox('درخواستی وجود ندارد.')}</div>`}</div>`;
      return {
        html,
        mount(page) {
          $('#lv-chips', page).addEventListener('click', (e) => { const c = e.target.closest('[data-s]'); if (c) { leaveUi.status = c.dataset.s; AP.refresh(); } });
          $$('[data-act]', page).forEach((b) => b.addEventListener('click', async () => {
            const approve = b.dataset.act === 'approve';
            if (!approve && !(await AP.confirmBox({ title: 'رد درخواست', message: 'درخواست رد شود و به کارمند اطلاع داده شود؟', confirmText: 'رد کن', danger: true }))) return;
            const ok = await AP.attempt(() => AP.api(`/admin/leave-requests/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' }), approve ? 'تأیید شد.' : 'رد شد.');
            if (ok) { AP.refresh(); AP.refreshCounts(); }
          }));
          $$('[data-edit]', page).forEach((b) => b.addEventListener('click', () => AP.openLeaveEditor(b.dataset.edit)));
          const n = $('#lv-new', page); if (n) n.addEventListener('click', () => AP.openLeaveCreate({}));
        },
      };
    },
  });

  // ======================================================
  // اعتراض‌ها
  // ======================================================
  const dispUi = { status: 'open' };
  AP.view('disputes', {
    nav: { icon: 'disputes', label: 'اعتراض‌ها', group: 'درخواست‌ها', counter: true },
    async render() {
      const items = await AP.api(`/admin/disputes${dispUi.status === 'all' ? '' : `?status=${dispUi.status}`}`);
      const html = `
        <div class="view-header"><div><h2>اعتراض‌های کارمندان</h2><div class="sub">${fmt.num(items.length)} مورد</div></div></div>
        <div class="chips" id="d-chips">${[['open', 'باز'], ['resolved', 'بسته‌شده'], ['all', 'همه']]
          .map(([k, l]) => `<button class="chip ${k === dispUi.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
        <div class="list">${items.length ? items.map((d) => `
          <div class="item">
            ${AP.avatar(d.employee ? d.employee.fullName : '?', 'purple')}
            <div class="grow">
              <div class="title"><a href="#/profile/${d.employee ? d.employee.id : ''}" style="color:inherit">${esc(d.employee ? d.employee.fullName : '—')}</a>
                ${AP.badge(d.status, d.status === 'open' ? 'باز' : 'بسته‌شده')}
                <span class="muted" style="font-weight:400;font-size:12px">${esc(fmt.dateTime(d.createdAt))}</span></div>
              <p class="text">${esc(d.message)}</p>
              ${d.record ? `<div class="meta">رکورد مرتبط: <a href="#" data-rec="${d.record.id}" style="color:var(--green)">${esc(fmt.dateLong(d.record.date))}</a></div>` : ''}
            </div>
            <div class="row-actions">
              ${d.status === 'open' ? `<button class="btn success small" data-resolve="${d.id}">${icon('check')} بستن و پاسخ</button>` : `<button class="btn ghost small" data-reopen="${d.id}">بازگشایی</button>`}
              ${d.employee && AP.state.isAdmin ? `<button class="btn ghost small" data-new="${d.employee.id}">ثبت/اصلاح تردد</button>` : ''}
            </div></div>`).join('') : `<div class="card">${emptyBox('اعتراضی وجود ندارد.')}</div>`}</div>`;
      return {
        html,
        mount(page) {
          $('#d-chips', page).addEventListener('click', (e) => { const c = e.target.closest('[data-s]'); if (c) { dispUi.status = c.dataset.s; AP.refresh(); } });
          $$('[data-rec]', page).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); AP.openRecord(a.dataset.rec); }));
          $$('[data-new]', page).forEach((b) => b.addEventListener('click', () => AP.openCreateRecord({ userId: b.dataset.new })));
          $$('[data-resolve]', page).forEach((b) => b.addEventListener('click', async () => {
            const note = await AP.askReason({ title: 'بستن اعتراض', label: 'پاسخ به کارمند (اختیاری — در تلگرام ارسال می‌شود)', confirmText: 'بستن اعتراض', required: false });
            if (note === null) return;
            const ok = await AP.attempt(() => AP.api(`/admin/disputes/${b.dataset.resolve}/resolve`, { method: 'POST', body: { note } }), 'اعتراض بسته شد.');
            if (ok) { AP.refresh(); AP.refreshCounts(); }
          }));
          $$('[data-reopen]', page).forEach((b) => b.addEventListener('click', async () => {
            const ok = await AP.attempt(() => AP.api(`/admin/disputes/${b.dataset.reopen}/reopen`, { method: 'POST', body: {} }), 'اعتراض دوباره باز شد.');
            if (ok) { AP.refresh(); AP.refreshCounts(); }
          }));
        },
      };
    },
  });
})();
