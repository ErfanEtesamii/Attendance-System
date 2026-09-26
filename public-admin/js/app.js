// منطق سمت کلاینت پنل مدیریتی وب (فاز ۸). Vanilla JS، بدون فریم‌ورک/بیلد.

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $all = (sel) => Array.from(document.querySelectorAll(sel));

  const state = { me: null, currentEmployeeId: null };

  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
      method: options.method || 'GET',
      credentials: 'include', // کوکی session حتماً باید همراه هر درخواست برود
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'خطای ناشناخته');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function initials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }

  function fmtDuration(totalMinutes) {
    if (totalMinutes == null) return '—';
    const abs = Math.abs(Math.round(totalMinutes));
    return `${Math.floor(abs / 60)} ساعت و ${abs % 60} دقیقه`;
  }

  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }); }
    catch (_) { return d; }
  }

  function fmtClock(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  }

  const ROLE_LABELS = { employee: 'کارمند', manager: 'مدیر دپارتمان', admin: 'ادمین کل' };
  const TODAY_LABELS = {
    not_checked_in: 'هنوز نیامده', checked_in: 'حاضر', checked_out: 'خارج شده', incomplete: 'ناقص',
  };

  // ---------- ورود با تلگرام ----------

  window.onTelegramAuth = async function (user) {
    try {
      const result = await api('/admin/auth/telegram', { method: 'POST', body: user });
      state.me = result.user;
      enterApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  };

  async function setupLoginWidget() {
    try {
      const cfg = await api('/admin/public-config');
      if (!cfg.botUsername) {
        $('#login-error').textContent =
          'TELEGRAM_BOT_USERNAME روی سرور تنظیم نشده است؛ ویجت ورود قابل نمایش نیست.';
        return;
      }
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.setAttribute('data-telegram-login', cfg.botUsername);
      script.setAttribute('data-size', 'large');
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      script.setAttribute('data-request-access', 'write');
      $('#telegram-login-container').appendChild(script);
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  }

  $('#logout-btn').addEventListener('click', async () => {
    try { await api('/admin/auth/logout', { method: 'POST' }); } catch (_) {}
    location.reload();
  });

  // ---------- ناوبری ----------

  function switchView(name) {
    $all('.view').forEach((v) => v.classList.add('hidden'));
    $('#view-' + name).classList.remove('hidden');
    $all('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'dashboard') loadDashboard();
    if (name === 'employees') loadEmployees();
    if (name === 'leave') loadLeaveQueue();
    if (name === 'settings') { loadSettings(); loadHolidays(); }
    if (name === 'audit') loadAudit();
  }

  $all('.nav-item').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#back-to-employees').addEventListener('click', () => switchView('employees'));

  // ---------- داشبورد ----------

  async function loadDashboard() {
    try {
      const d = await api('/admin/dashboard');
      $('#stat-total').textContent = d.totalEmployees;
      $('#stat-present').textContent = d.presentToday;
      $('#stat-incomplete').textContent = d.incompleteToday;
      $('#dashboard-date').textContent = fmtDate(d.date);
    } catch (err) { showToast(err.message); }
  }

  // ---------- لیست کارمندان ----------

  async function loadEmployees() {
    const tbody = $('#employees-tbody');
    tbody.innerHTML = '<tr><td colspan="5">در حال بارگذاری…</td></tr>';
    try {
      const users = await api('/admin/users');
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="5">کارمندی ثبت نشده است.</td></tr>';
        return;
      }
      tbody.innerHTML = '';
      users.forEach((u) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${u.fullName}</td>
          <td>${u.department || '—'}</td>
          <td><span class="badge ${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
          <td><span class="badge ${u.todayStatus}">${TODAY_LABELS[u.todayStatus] || u.todayStatus}</span></td>
          <td><span class="dot ${u.isActive ? 'on' : 'off'}"></span>${u.isActive ? 'فعال' : 'غیرفعال'}</td>`;
        tr.addEventListener('click', () => openProfile(u.id));
        tbody.appendChild(tr);
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5">${err.message}</td></tr>`;
    }
  }

  // ---------- افزودن کارمند ----------

  $('#add-employee-btn').addEventListener('click', () => {
    $('#add-employee-form').reset();
    $('#add-msg').textContent = '';
    $('#add-modal').classList.remove('hidden');
  });
  $('#cancel-add').addEventListener('click', () => $('#add-modal').classList.add('hidden'));

  $('#add-employee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#add-msg');
    msg.className = 'form-msg';
    try {
      await api('/admin/users', {
        method: 'POST',
        body: {
          fullName: form.fullName.value,
          personnelCode: form.personnelCode.value,
          department: form.department.value,
          role: form.role.value,
          telegramUserId: form.telegramUserId.value || null,
        },
      });
      $('#add-modal').classList.add('hidden');
      showToast('کارمند با موفقیت اضافه شد.');
      loadEmployees();
      loadDashboard();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  // ---------- پروفایل کارمند ----------

  async function openProfile(id) {
    state.currentEmployeeId = id;
    switchView('profile');
    const p = await api('/admin/users/' + id).catch((err) => { showToast(err.message); return null; });
    if (!p) return;

    $('#pf-avatar').textContent = initials(p.fullName);
    $('#pf-name').textContent = p.fullName;
    $('#pf-subtitle').textContent = `${p.department || 'بدون دپارتمان'} · ${ROLE_LABELS[p.role] || p.role}`;

    const form = $('#profile-form');
    form.fullName.value = p.fullName || '';
    form.personnelCode.value = p.personnelCode || '';
    form.department.value = p.department || '';
    form.role.value = p.role;
    form.telegramUserId.value = p.telegramUserId || '';
    form.isActive.checked = !!p.isActive;
    $('#profile-msg').textContent = '';

    // مدیر دپارتمان فقط می‌تواند ببیند؛ ویرایش پروفایل فقط برای ادمین کل مجاز است (سمت سرور هم اجباری است)
    const canEdit = state.me.role === 'admin';
    Array.from(form.elements).forEach((el) => { el.disabled = !canEdit; });
    form.querySelector('button[type="submit"]').classList.toggle('hidden', !canEdit);

    const s = p.last30Days;
    $('#pf-summary').innerHTML = `
      <div class="row"><span>مجموع ساعت مفید</span><span>${fmtDuration(s.totalEffective)}</span></div>
      <div class="row"><span>تعداد روز کاری</span><span>${s.dayCount}</span></div>
      <div class="row"><span>تعداد تأخیر</span><span>${s.lateCount}</span></div>
      <div class="row"><span>رکورد ناقص</span><span>${s.incompleteCount}</span></div>`;

    const recordsBox = $('#pf-records');
    if (!p.recentRecords.length) {
      recordsBox.innerHTML = '<div class="list-item">رکوردی یافت نشد.</div>';
    } else {
      recordsBox.innerHTML = p.recentRecords
        .slice()
        .reverse()
        .map(
          (r) => `<div class="list-item" data-record-id="${r.id}" style="cursor:pointer;">
            <span>${fmtDate(r.record_date)}</span>
            <span>${fmtClock(r.check_in_time)} — ${fmtClock(r.check_out_time)}</span>
            <span>${fmtDuration(r.summary?.effectiveMinutes)}</span>
          </div>`
        )
        .join('');
      if (state.me.role === 'admin') {
        Array.from(recordsBox.children).forEach((el, idx) => {
          const record = p.recentRecords.slice().reverse()[idx];
          el.addEventListener('click', () => openFixRecordModal(record));
        });
      }
    }
  }

  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#profile-msg');
    msg.className = 'form-msg';
    try {
      await api('/admin/users/' + state.currentEmployeeId, {
        method: 'PATCH',
        body: {
          fullName: form.fullName.value,
          personnelCode: form.personnelCode.value,
          department: form.department.value,
          role: form.role.value,
          telegramUserId: form.telegramUserId.value || null,
          isActive: form.isActive.checked,
        },
      });
      msg.textContent = 'ذخیره شد.';
      msg.classList.add('ok');
      loadEmployees();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  // ---------- اصلاح دستی رکورد ----------

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let fixRecordTarget = null;

  function openFixRecordModal(record) {
    fixRecordTarget = record;
    const form = $('#fix-record-form');
    form.reset();
    form.checkInTime.value = toDatetimeLocalValue(record.check_in_time);
    form.checkOutTime.value = toDatetimeLocalValue(record.check_out_time);
    form.status.value = record.status || 'normal';
    $('#fix-msg').textContent = '';
    $('#fix-record-modal').classList.remove('hidden');
  }

  $('#cancel-fix').addEventListener('click', () => $('#fix-record-modal').classList.add('hidden'));

  $('#fix-record-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#fix-msg');
    msg.className = 'form-msg';
    try {
      await api('/admin/attendance-records/' + fixRecordTarget.id, {
        method: 'PATCH',
        body: {
          checkInTime: form.checkInTime.value ? new Date(form.checkInTime.value).toISOString() : null,
          checkOutTime: form.checkOutTime.value ? new Date(form.checkOutTime.value).toISOString() : null,
          status: form.status.value,
          reason: form.reason.value,
        },
      });
      $('#fix-record-modal').classList.add('hidden');
      showToast('رکورد اصلاح شد.');
      openProfile(state.currentEmployeeId);
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  // ---------- صف مرخصی / مأموریت ----------

  $('#leave-status-filter').addEventListener('change', () => loadLeaveQueue());

  const LEAVE_STATUS_LABELS = { pending: 'در انتظار', approved: 'تأیید شده', rejected: 'رد شده' };

  async function loadLeaveQueue() {
    const box = $('#leave-list');
    box.innerHTML = '<div class="list-item">در حال بارگذاری…</div>';
    try {
      const status = $('#leave-status-filter').value;
      const items = await api('/admin/leave-requests?status=' + status);
      if (!items.length) {
        box.innerHTML = '<div class="list-item">درخواستی یافت نشد.</div>';
        return;
      }
      box.innerHTML = '';
      items.forEach((it) => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'stretch';
        el.style.gap = '6px';
        const actionsHtml =
          it.status === 'pending'
            ? `<div class="actions" style="margin:0;">
                 <button class="btn primary" data-act="approve">تأیید</button>
                 <button class="btn danger" data-act="reject">رد</button>
               </div>`
            : `<span class="badge ${it.status}">${LEAVE_STATUS_LABELS[it.status] || it.status}</span>`;
        el.innerHTML = `
          <div class="li-top">
            <span>${it.employee ? it.employee.fullName : '—'} — ${it.leaveType === 'mission' ? 'مأموریت' : 'مرخصی'}</span>
            <span>${fmtDate(it.startDate)} تا ${fmtDate(it.endDate)}</span>
          </div>
          ${it.reason ? `<div class="muted">${it.reason}</div>` : ''}
          ${actionsHtml}`;
        el.querySelectorAll('[data-act]').forEach((btn) => {
          btn.addEventListener('click', () => decideLeave(it.id, btn.dataset.act));
        });
        box.appendChild(el);
      });
    } catch (err) {
      box.innerHTML = `<div class="list-item">${err.message}</div>`;
    }
  }

  async function decideLeave(id, act) {
    try {
      await api(`/admin/leave-requests/${id}/${act}`, { method: 'POST' });
      showToast(act === 'approve' ? 'درخواست تأیید شد.' : 'درخواست رد شد.');
      loadLeaveQueue();
    } catch (err) {
      showToast(err.message);
    }
  }

  // ---------- تنظیمات سیستم ----------

  async function loadSettings() {
    try {
      const s = await api('/admin/settings');
      const form = $('#settings-form');
      form.workDayStart.value = s.workDayStart;
      form.workDayEnd.value = s.workDayEnd;
      form.lateCheckinGraceMinutes.value = s.lateCheckinGraceMinutes;
      form.checkoutReminderMinutesBefore.value = s.checkoutReminderMinutesBefore;
      form.repeatedLatenessThreshold.value = s.repeatedLatenessThreshold;
    } catch (err) {
      showToast(err.message);
    }
  }

  $('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#settings-msg');
    msg.className = 'form-msg';
    try {
      await api('/admin/settings', {
        method: 'PATCH',
        body: {
          workDayStart: form.workDayStart.value,
          workDayEnd: form.workDayEnd.value,
          lateCheckinGraceMinutes: form.lateCheckinGraceMinutes.value,
          checkoutReminderMinutesBefore: form.checkoutReminderMinutesBefore.value,
          repeatedLatenessThreshold: form.repeatedLatenessThreshold.value,
        },
      });
      msg.textContent = 'ذخیره شد و همین الان روی سیستم اعمال شد.';
      msg.classList.add('ok');
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  async function loadHolidays() {
    const box = $('#holiday-list');
    box.innerHTML = '<div class="list-item">در حال بارگذاری…</div>';
    try {
      const items = await api('/admin/holidays');
      if (!items.length) {
        box.innerHTML = '<div class="list-item">تعطیلی ثبت نشده است.</div>';
        return;
      }
      box.innerHTML = '';
      items.forEach((h) => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `<span>${fmtDate(h.holiday_date)} — ${h.title}</span><span data-del="${h.id}" style="cursor:pointer;color:var(--red);">حذف</span>`;
        el.querySelector('[data-del]').addEventListener('click', async () => {
          try {
            await api('/admin/holidays/' + h.id, { method: 'DELETE' });
            loadHolidays();
          } catch (err) { showToast(err.message); }
        });
        box.appendChild(el);
      });
    } catch (err) {
      box.innerHTML = `<div class="list-item">${err.message}</div>`;
    }
  }

  $('#holiday-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#holiday-msg');
    msg.className = 'form-msg';
    try {
      await api('/admin/holidays', { method: 'POST', body: { date: form.date.value, title: form.title.value } });
      form.reset();
      loadHolidays();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  // ---------- Audit Log ----------

  async function loadAudit() {
    const tbody = $('#audit-tbody');
    tbody.innerHTML = '<tr><td colspan="4">در حال بارگذاری…</td></tr>';
    try {
      const rows = await api('/admin/audit-log?limit=150');
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4">رویدادی ثبت نشده است.</td></tr>';
        return;
      }
      tbody.innerHTML = rows
        .map(
          (r) => `<tr>
            <td>${new Date(r.occurred_at).toLocaleString('fa-IR')}</td>
            <td>${r.userFullName || '—'}</td>
            <td>${r.action}</td>
            <td class="muted" style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.details || ''}</td>
          </tr>`
        )
        .join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4">${err.message}</td></tr>`;
    }
  }

  // ---------- بوت‌استرپ ----------

  function enterApp() {
    $('#login-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    $('#me-avatar').textContent = initials(state.me.fullName);
    $('#me-name').textContent = state.me.fullName;
    $('#me-role').textContent = ROLE_LABELS[state.me.role] || state.me.role;
    if (state.me.role !== 'admin') {
      $('#add-employee-btn').style.display = 'none'; // مدیر دپارتمان فقط مشاهده دارد
      $all('.nav-item.admin-only').forEach((el) => el.classList.add('hidden'));
    }
    switchView('dashboard');
  }

  async function boot() {
    try {
      const me = await api('/admin/me');
      state.me = me;
      enterApp();
    } catch (_) {
      setupLoginWidget();
    }
  }

  boot();
})();
