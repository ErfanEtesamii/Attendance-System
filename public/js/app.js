// منطق سمت کلاینت Telegram Mini App (فاز ۴).
// بدون فریم‌ورک/بیلد؛ فقط Vanilla JS + fetch، طبق تصمیم سادگی پروژه.

(function () {
  'use strict';

  const tg = window.Telegram ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // initData خام (امضاشده توسط تلگرام) - همین رشته مستقیم برای سرور فرستاده می‌شود
  // تا سرور خودش اعتبارش را تأیید کند؛ کلاینت هیچ داده‌ی هویتی را «ادعا» نمی‌کند.
  const initData = tg ? tg.initData : '';
  const initDataUnsafe = tg ? tg.initDataUnsafe : {};

  const state = {
    me: null,
    today: null,
    timerInterval: null,
  };

  // ---------- ابزار کمکی ----------

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function showToast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  async function api(path, options = {}) {
    const res = await fetch('/api/miniapp' + path, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Init-Data': initData,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'خطای ناشناخته');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function fmtDuration(totalMinutes) {
    if (totalMinutes == null) return '—';
    const sign = totalMinutes < 0 ? '-' : '';
    const abs = Math.abs(Math.round(totalMinutes));
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${h} ساعت و ${m} دقیقه`;
  }

  function fmtClock(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) {
      return dateStr;
    }
  }

  const STATUS_LABELS = {
    normal: 'عادی', late: 'تأخیر', incomplete: 'ناقص', leave: 'مرخصی', holiday: 'تعطیل',
  };
  const LEAVE_STATUS_LABELS = { pending: 'در انتظار', approved: 'تأیید شده', rejected: 'رد شده' };

  // ---------- ناوبری ----------

  function switchView(name) {
    $all('.view').forEach((v) => v.classList.add('hidden'));
    $('#view-' + name).classList.remove('hidden');
    $all('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));

    if (name === 'history') loadHistory();
    if (name === 'report') loadReport($('.tab-btn.active')?.dataset.period || 'week');
    if (name === 'leave') loadLeaveList();
    if (name === 'profile') loadProfile();
  }

  $all('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // ---------- صفحه اصلی: وضعیت امروز ----------

  function stopTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  function startTimer(fromIso) {
    stopTimer();
    const from = new Date(fromIso).getTime();
    function tick() {
      const diff = Math.max(0, Date.now() - from);
      const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
      const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
      $('#timer').textContent = `${h}:${m}:${s}`;
    }
    tick();
    state.timerInterval = setInterval(tick, 1000);
  }

  function renderTodayActions() {
    const box = $('#today-actions');
    box.innerHTML = '';
    box.className = 'actions';
    const r = state.today && state.today.record;
    const openBreak = state.today && state.today.openBreak;

    function addBtn(label, cls, handler) {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', handler);
      box.appendChild(b);
    }

    if (!r) {
      box.classList.add('single');
      addBtn('ثبت ورود', 'primary', () => doAction('/check-in', {}, 'ورود ثبت شد.'));
      return;
    }

    if (r.check_out_time) {
      box.classList.add('single');
      const done = document.createElement('div');
      done.className = 'card';
      done.style.textAlign = 'center';
      done.textContent = 'امروز به پایان رسید. تا فردا خوش باشید 🌤️';
      box.appendChild(done);
      return;
    }

    if (openBreak) {
      box.classList.add('single');
      addBtn('پایان استراحت', 'warning', () => doAction('/break/end', {}, 'استراحت پایان یافت.'));
      return;
    }

    addBtn('شروع ناهار', 'secondary', () => doAction('/break/start', { breakType: 'lunch' }, 'استراحت ناهار شروع شد.'));
    addBtn('ثبت خروج', 'danger', () => doAction('/check-out', {}, 'خروج ثبت شد.'));
  }

  async function doAction(path, body, successMsg) {
    try {
      await api(path, { method: 'POST', body });
      showToast(successMsg);
      await loadToday();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadToday() {
    const data = await api('/today');
    state.today = data;
    const r = data.record;

    $('#ti-checkin').textContent = fmtClock(r?.check_in_time);
    $('#ti-checkout').textContent = fmtClock(r?.check_out_time);

    const totalBreak = (data.breaks || []).reduce((sum, b) => {
      if (!b.end_time) return sum;
      return sum + (new Date(b.end_time) - new Date(b.start_time)) / 60000;
    }, 0);
    $('#ti-breaks').textContent = totalBreak > 0 ? fmtDuration(totalBreak) : '—';

    if (!r) {
      $('#status-label').textContent = 'هنوز ورود ثبت نشده';
      stopTimer();
      $('#timer').textContent = '--:--:--';
      $('#today-summary').textContent = '';
    } else if (r.check_out_time) {
      $('#status-label').textContent = '✅ خروج ثبت شد';
      stopTimer();
      $('#timer').textContent = fmtDuration(data.summary?.effectiveMinutes);
      $('#today-summary').textContent = 'ساعت مفید کاری امروز';
    } else if (data.openBreak) {
      $('#status-label').textContent = '🍽️ در حال استراحت';
      startTimer(data.openBreak.start_time);
      $('#today-summary').textContent = 'مدت استراحت جاری';
    } else {
      $('#status-label').textContent = '🟢 حاضر در شرکت';
      startTimer(r.check_in_time);
      $('#today-summary').textContent = 'مدت حضور از لحظه ورود';
    }

    renderTodayActions();
  }

  // ---------- تاریخچه ----------

  async function loadHistory() {
    const list = $('#history-list');
    list.innerHTML = '<div class="list-item">در حال بارگذاری…</div>';
    try {
      const records = await api('/history?days=30');
      if (!records.length) {
        list.innerHTML = '<div class="list-item">رکوردی یافت نشد.</div>';
        return;
      }
      list.innerHTML = '';
      records.forEach((r) => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
          <div class="li-top">
            <span>${fmtDate(r.record_date)}</span>
            <span class="badge ${r.status}">${STATUS_LABELS[r.status] || r.status}</span>
          </div>
          <div class="li-bottom">
            <span>${fmtClock(r.check_in_time)} — ${fmtClock(r.check_out_time)}</span>
            <span>${fmtDuration(r.summary?.effectiveMinutes)}</span>
          </div>`;
        list.appendChild(el);
      });
    } catch (err) {
      list.innerHTML = `<div class="list-item">${err.message}</div>`;
    }
  }

  // ---------- گزارش ----------

  $all('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $all('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      loadReport(btn.dataset.period);
    });
  });

  async function loadReport(period) {
    const card = $('#report-card');
    card.innerHTML = 'در حال بارگذاری…';
    try {
      const r = await api('/report?period=' + period);
      card.innerHTML = `
        <div class="row"><span>مجموع ساعت مفید</span><span>${fmtDuration(r.totalEffective)}</span></div>
        <div class="row"><span>تعداد روزهای کاری</span><span>${r.dayCount}</span></div>
        <div class="row"><span>تعداد تأخیر</span><span>${r.lateCount}</span></div>
        <div class="row"><span>تعداد خروج زودهنگام</span><span>${r.earlyLeaveCount}</span></div>
        <div class="row"><span>رکوردهای ناقص</span><span>${r.incompleteCount}</span></div>`;
    } catch (err) {
      card.innerHTML = err.message;
    }
  }

  // ---------- مرخصی ----------

  $('#leave-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#leave-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    try {
      await api('/leave', {
        method: 'POST',
        body: {
          leaveType: form.leaveType.value,
          startDate: form.startDate.value,
          endDate: form.endDate.value,
          reason: form.reason.value,
        },
      });
      msg.textContent = 'درخواست با موفقیت ارسال شد.';
      msg.classList.add('ok');
      form.reset();
      loadLeaveList();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  async function loadLeaveList() {
    const list = $('#leave-list');
    list.innerHTML = '<div class="list-item">در حال بارگذاری…</div>';
    try {
      const items = await api('/leave');
      if (!items.length) {
        list.innerHTML = '<div class="list-item">درخواستی ثبت نشده است.</div>';
        return;
      }
      list.innerHTML = '';
      items.forEach((it) => {
        const el = document.createElement('div');
        el.className = 'list-item';
        el.innerHTML = `
          <div class="li-top">
            <span>${it.leave_type === 'mission' ? 'مأموریت' : 'مرخصی'}</span>
            <span class="badge ${it.status}">${LEAVE_STATUS_LABELS[it.status] || it.status}</span>
          </div>
          <div class="li-bottom">
            <span>${fmtDate(it.start_date)} تا ${fmtDate(it.end_date)}</span>
          </div>`;
        list.appendChild(el);
      });
    } catch (err) {
      list.innerHTML = `<div class="list-item">${err.message}</div>`;
    }
  }

  // ---------- پروفایل و اعتراض ----------

  async function loadProfile() {
    if (!state.me) return;
    $('#pf-name').textContent = state.me.fullName || '—';
    $('#pf-code').textContent = state.me.personnelCode || '—';
    $('#pf-dept').textContent = state.me.department || '—';
    const roleLabels = { employee: 'کارمند', manager: 'مدیر دپارتمان', admin: 'ادمین کل' };
    $('#pf-role').textContent = roleLabels[state.me.role] || state.me.role;
  }

  $('#dispute-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#dispute-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    try {
      await api('/dispute', {
        method: 'POST',
        body: { message: form.message.value },
      });
      msg.textContent = 'اعتراض شما برای ادمین ارسال شد.';
      msg.classList.add('ok');
      form.reset();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  // ---------- بوت‌استرپ ----------

  async function boot() {
    if (!initData) {
      // اجرای خارج از تلگرام (مثلاً باز کردن مستقیم در مرورگر) - initData وجود ندارد
      $('#not-registered').classList.remove('hidden');
      $('#not-registered .card').innerHTML =
        '<h2>این صفحه باید داخل تلگرام باز شود</h2><p>لطفاً از طریق دکمه منوی بات وارد شوید.</p>';
      return;
    }

    try {
      state.me = await api('/me');
      $('#user-name').textContent = state.me.fullName;
      $('#app').classList.remove('hidden');
      await loadToday();
    } catch (err) {
      if (err.status === 403) {
        const id = (err.data && err.data.telegramUserId) || (initDataUnsafe.user && initDataUnsafe.user.id) || '-';
        $('#tg-id-box').textContent = id;
        $('#not-registered').classList.remove('hidden');
      } else {
        showToast(err.message);
      }
    }
  }

  boot();
})();
