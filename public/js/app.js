// منطق سمت کلاینت Telegram Mini App (فاز ۴).
// بدون فریم‌ورک/بیلد؛ فقط Vanilla JS + fetch، طبق تصمیم سادگی پروژه.

(function () {
  'use strict';

  const tg = window.Telegram ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor('#1b1c2c');
      tg.setBackgroundColor('#1b1c2c');
      if (tg.setBottomBarColor) tg.setBottomBarColor('#1b1c2c');
    } catch (_) { /* نسخه‌های قدیمی تلگرام */ }
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

  // ---------- شناسه‌ی دستگاه (S2-3) ----------
  // یک شناسه‌ی تصادفی پایدار برای همین مرورگر/نصب تلگرام که فقط همراه ورود/خروج فرستاده می‌شود.
  // فقط یک «نشانه» برای بررسی‌های بعدی است (قابل جعل) و هرگز روی مجاز بودن ثبت تردد اثر ندارد؛
  // هر خطایی در ساخت/خواندن آن نادیده گرفته می‌شود و ورود/خروج بدون آن هم ثبت می‌شود.
  // ترتیب: localStorage اولویت دارد؛ اگر تلگرام CloudStorage داشت، پشتیبان آن است (وقتی localStorage خالی شد برمی‌گردد).
  const DEVICE_KEY = 'attendance_device_id';
  const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
  const CLOUD_TIMEOUT_MS = 1500;
  let deviceIdPromise = null;

  function newDeviceId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && window.crypto.getRandomValues) {
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) { /* می‌رویم سراغ جایگزین */ }
    let out = '';
    while (out.length < 32) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function readLocalDeviceId() {
    try {
      const v = window.localStorage.getItem(DEVICE_KEY);
      return v && DEVICE_ID_RE.test(v) ? v : null;
    } catch (_) { return null; }
  }

  function writeLocalDeviceId(id) {
    try { window.localStorage.setItem(DEVICE_KEY, id); } catch (_) { /* حالت خصوصی/محدود */ }
  }

  function cloudAvailable() {
    return !!(tg && tg.CloudStorage && (!tg.isVersionAtLeast || tg.isVersionAtLeast('6.9')));
  }

  // خواندن از CloudStorage تلگرام؛ در هر شکست/کندی null (بیشترین انتظار CLOUD_TIMEOUT_MS)
  function cloudGetDeviceId() {
    return new Promise((resolve) => {
      if (!cloudAvailable()) return resolve(null);
      const timer = setTimeout(() => resolve(null), CLOUD_TIMEOUT_MS);
      try {
        tg.CloudStorage.getItem(DEVICE_KEY, (err, value) => {
          clearTimeout(timer);
          resolve(!err && value && DEVICE_ID_RE.test(value) ? value : null);
        });
      } catch (_) { clearTimeout(timer); resolve(null); }
    });
  }

  function cloudSetDeviceId(id) {
    try { if (cloudAvailable()) tg.CloudStorage.setItem(DEVICE_KEY, id, () => {}); } catch (_) { /* مهم نیست */ }
  }

  async function resolveDeviceId() {
    let id = readLocalDeviceId();
    const cloudId = await cloudGetDeviceId();
    if (!id) id = cloudId || newDeviceId();
    writeLocalDeviceId(id);
    // فقط اگر ابر خالی بود می‌نویسیم؛ شناسه‌ی موجود در ابر (مثلاً از دستگاه دیگر) بازنویسی نمی‌شود
    if (!cloudId) cloudSetDeviceId(id);
    return id;
  }

  // یک‌بار در هر بار باز شدن صفحه محاسبه و cache می‌شود
  function getDeviceId() {
    if (!deviceIdPromise) deviceIdPromise = resolveDeviceId().catch(() => null);
    return deviceIdPromise;
  }

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

  // ---------- تاریخ شمسی (S3-11d) ----------
  // jalali.js/datepicker.js همان فایل‌های پنل‌اند (/admin/js). اگر بارگذاری نشدند، نمایش به ICU برمی‌گردد
  // و ورودی تاریخ همان input بومی (میلادی) می‌ماند؛ هیچ‌کدام مانع کار برنامه نمی‌شود.
  const J = window.Jalali || null;
  const DP = window.JalaliDatepicker || null;
  const pad2 = (n) => String(n).padStart(2, '0');

  // «YYYY-MM-DD» (یا YYYY-MM-DD HH:MM:SS دیتابیس) ⇒ همان بخش تاریخ؛ نامعتبر ⇒ null
  function isoPart(v) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v == null ? '' : v));
    return m ? m[1] : null;
  }

  // تاریخ میلادی ISO رکورد ⇒ «۱۵ مهر ۱۴۰۵». عمداً از new Date(iso) استفاده نمی‌کند (UTC نیمه‌شب در منطقه‌های منفی روز قبل می‌شد).
  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const iso = isoPart(dateStr);
    if (!iso) return String(dateStr);
    if (J) {
      try {
        const out = J.formatIso(iso, { long: true });
        if (out) return out;
      } catch (_) { /* خارج از بازه‌ی پشتیبانی ⇒ جایگزین */ }
    }
    try {
      return new Date(`${iso}T12:00:00`).toLocaleDateString('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (_) {
      return iso;
    }
  }

  // «امروز» به وقت دستگاه (همان مبنای «امروز»ِ datepicker) ⇒ «چهارشنبه ۱۵ مهر»؛ بدون سال چون جا کم است
  function fmtTodayShort() {
    const d = new Date();
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    if (J) {
      try {
        const j = J.isoToJalali(iso);
        return `${J.weekdayName(iso)} ${J.toFaDigits(j.jd)} ${J.MONTH_NAMES[j.jm - 1]}`;
      } catch (_) { /* جایگزین */ }
    }
    return d.toLocaleDateString('fa-IR-u-ca-persian', { weekday: 'long', month: 'long', day: 'numeric' });
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
    if (name === 'leave') { loadLeaveTypes(); loadLeaveList(); }
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

  const ICONS = {
    in: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    lunch: '<svg viewBox="0 0 24 24"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>',
    resume: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z"/></svg>',
  };

  function renderTodayActions() {
    const box = $('#today-actions');
    box.innerHTML = '';
    box.className = 'actions';
    const r = state.today && state.today.record;
    const openBreak = state.today && state.today.openBreak;

    function addTile({ title, sub, color, icon, wide, handler }) {
      const b = document.createElement('button');
      b.className = 'action-tile t-' + color + (wide ? ' wide' : '');
      b.innerHTML = `
        <span class="tile-icon">${ICONS[icon]}</span>
        <span class="tile-text">
          <span class="tile-title">${title}</span>
          <span class="tile-sub">${sub}</span>
        </span>`;
      b.addEventListener('click', handler);
      box.appendChild(b);
    }

    if (!r) {
      box.classList.add('single');
      addTile({
        title: 'ثبت ورود', sub: 'شروع روز کاری', color: 'green', icon: 'in', wide: true,
        handler: () => doAction('/check-in', {}, 'ورود ثبت شد.'),
      });
      return;
    }

    if (r.check_out_time) {
      box.classList.add('single');
      const done = document.createElement('div');
      done.className = 'card done-card';
      done.textContent = 'امروز به پایان رسید. تا فردا خوش باشید 🌤️';
      box.appendChild(done);
      return;
    }

    if (openBreak) {
      box.classList.add('single');
      addTile({
        title: 'پایان استراحت', sub: 'بازگشت به کار', color: 'orange', icon: 'resume', wide: true,
        handler: () => doAction('/break/end', {}, 'استراحت پایان یافت.'),
      });
      return;
    }

    addTile({
      title: 'شروع ناهار', sub: 'ثبت استراحت', color: 'orange', icon: 'lunch',
      handler: () => doAction('/break/start', { breakType: 'lunch' }, 'استراحت ناهار شروع شد.'),
    });
    addTile({
      title: 'ثبت خروج', sub: 'پایان روز کاری', color: 'red', icon: 'out',
      handler: () => doAction('/check-out', {}, 'خروج ثبت شد.'),
    });
  }

  async function doAction(path, body, successMsg) {
    try {
      // S2-3: device_id فقط همراه ورود/خروج؛ نبودنش مانع ثبت نیست
      if (path === '/check-in' || path === '/check-out') {
        const deviceId = await getDeviceId();
        if (deviceId) body = { ...(body || {}), deviceId };
      }
      await api(path, { method: 'POST', body });
      showToast(successMsg);
      await loadToday();
    } catch (err) {
      showToast(err.message);
    }
  }

  function setStatus(label, cls) {
    $('#status-label').textContent = label;
    $('#status-pill').className = 'status-pill ' + cls;
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

    const TARGET_MIN = 8 * 60;
    const timerEl = $('#timer');
    let progressMin = 0;

    if (!r) {
      setStatus('هنوز ورود ثبت نشده', '');
      stopTimer();
      timerEl.textContent = '--:--:--';
      timerEl.classList.remove('is-text');
      $('#today-summary').textContent = 'برای شروع، ورود خود را ثبت کنید';
    } else if (r.check_out_time) {
      setStatus('خروج ثبت شد', 'is-done');
      stopTimer();
      progressMin = data.summary?.effectiveMinutes || 0;
      timerEl.textContent = fmtDuration(data.summary?.effectiveMinutes);
      timerEl.classList.add('is-text');
      $('#today-summary').textContent = 'ساعت مفید کاری امروز';
    } else if (data.openBreak) {
      setStatus('در حال استراحت', 'is-break');
      startTimer(data.openBreak.start_time);
      timerEl.classList.remove('is-text');
      progressMin = (Date.now() - new Date(r.check_in_time).getTime()) / 60000 - totalBreak;
      $('#today-summary').textContent = 'مدت استراحت جاری';
    } else {
      setStatus('حاضر در شرکت', 'is-active');
      startTimer(r.check_in_time);
      timerEl.classList.remove('is-text');
      progressMin = (Date.now() - new Date(r.check_in_time).getTime()) / 60000 - totalBreak;
      $('#today-summary').textContent = 'مدت حضور از لحظه ورود';
    }

    const pct = Math.max(0, Math.min(100, Math.round((progressMin / TARGET_MIN) * 100)));
    $('#progress-bar').style.width = pct + '%';
    $('#progress-text').textContent = pct.toLocaleString('fa-IR') + '٪ از ۸ ساعت';

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
        <div class="report-head"><span>شاخص</span><span>مقدار</span></div>
        <div class="row"><span class="row-label">مجموع ساعت مفید</span><span class="row-value">${fmtDuration(r.totalEffective)}</span></div>
        <div class="row"><span class="row-label">تعداد روزهای کاری</span><span class="row-value">${r.dayCount}</span></div>
        <div class="row"><span class="row-label">تعداد تأخیر</span><span class="row-value">${r.lateCount}</span></div>
        <div class="row"><span class="row-label">تعداد خروج زودهنگام</span><span class="row-value">${r.earlyLeaveCount}</span></div>
        <div class="row"><span class="row-label">رکوردهای ناقص</span><span class="row-value">${r.incompleteCount}</span></div>`;
    } catch (err) {
      card.innerHTML = err.message;
    }
  }

  // ---------- مرخصی ----------

  // فیلدهای تاریخ فرم مرخصی: با datepicker شمسی، ولی مقدارِ ارسالی همچنان میلادی YYYY-MM-DD است.
  // اگر datepicker بارگذاری نشده باشد، input بومی type=date (که خودش ISO می‌دهد) می‌ماند.
  const leaveForm = $('#leave-form');
  const leaveDates = { startDate: null, endDate: null };
  ['startDate', 'endDate'].forEach((name) => {
    const el = leaveForm[name];
    if (!DP || !el) return;
    el.type = 'text'; // type=date متن شمسی را نمی‌پذیرد
    leaveDates[name] = DP.attach(el, {});
  });

  function readLeaveDate(form, name) {
    return leaveDates[name] ? leaveDates[name].getValue() : form[name].value;
  }

  // ---- انواع و واحدها (S4-10c) ----
  // نوع‌ها از سرور می‌آیند (/leave-types)؛ اگر بارگذاری نشد، گزینه‌های ثابتِ HTML (مرخصی/مأموریتِ روزانه) می‌ماند و همه‌چیز مثل قبل کار می‌کند.
  const UNIT_ROWS = { day: ['#leave-end-row'], half_day: ['#leave-part-row'], hour: ['#leave-starttime-row', '#leave-endtime-row'] };
  const ALL_UNIT_ROWS = ['#leave-end-row', '#leave-part-row', '#leave-starttime-row', '#leave-endtime-row'];
  let leaveTypes = [];
  let leaveTypesLoaded = false;

  const fieldValue = (form, name, fallback = '') => (form[name] && form[name].value !== undefined ? form[name].value : fallback);
  const selectedType = (form) => {
    const v = String(fieldValue(form, 'leaveType'));
    return v.startsWith('id:') ? leaveTypes.find((t) => `id:${t.id}` === v) || null : null;
  };

  function applyUnitUI(form) {
    const type = selectedType(form);
    const units = type ? type.allowedUnits : ['day'];
    const unitRow = $('#leave-unit-row');
    if (unitRow) unitRow.hidden = units.length < 2;
    if (form.unit && !units.includes(form.unit.value)) form.unit.value = units[0];
    const unit = units.length < 2 ? units[0] : fieldValue(form, 'unit', 'day');
    ALL_UNIT_ROWS.forEach((sel) => { const row = $(sel); if (row) row.hidden = !(UNIT_ROWS[unit] || []).includes(sel); });
    if (form.endDate) form.endDate.required = unit === 'day';
    const bal = $('#leave-balance');
    if (bal) bal.textContent = type && type.balance ? `مانده‌ی مرخصی شما: ${type.balance.remainingText}` : '';
    return unit;
  }

  async function loadLeaveTypes() {
    if (leaveTypesLoaded) return;
    try {
      const items = await api('/leave-types');
      if (!Array.isArray(items) || !items.length) return;
      leaveTypes = items;
      leaveTypesLoaded = true;
      const sel = leaveForm.leaveType;
      if (sel && typeof sel.appendChild === 'function') {
        sel.innerHTML = '';
        items.forEach((t) => {
          const opt = document.createElement('option');
          opt.value = `id:${t.id}`;
          opt.textContent = t.title;
          sel.appendChild(opt);
        });
        sel.value = `id:${items[0].id}`;
      }
      applyUnitUI(leaveForm);
    } catch (_) { /* بدون نوع‌های پویا: فرم قدیمی */ }
  }

  ['leaveType', 'unit'].forEach((name) => {
    const el = leaveForm[name];
    if (el && typeof el.addEventListener === 'function') el.addEventListener('change', () => applyUnitUI(leaveForm));
  });

  leaveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const msg = $('#leave-msg');
    msg.textContent = '';
    msg.className = 'form-msg';
    const fail = (text) => { msg.textContent = text; msg.classList.add('err'); };
    const unit = applyUnitUI(form);
    const startDate = readLeaveDate(form, 'startDate');
    const endDate = unit === 'day' ? readLeaveDate(form, 'endDate') : startDate;
    // ورودی شمسی نامعتبر (مثلاً ۳۰ اسفند سال غیرکبیسه) ⇒ مقدار ISO خالی می‌ماند و نباید به سرور برود
    if (!startDate || !endDate) {
      fail(unit === 'day' ? 'تاریخ شروع و پایان را معتبر و به‌صورت شمسی وارد کنید (مثل ۱۴۰۵/۰۷/۱۵).' : 'تاریخ را معتبر و به‌صورت شمسی وارد کنید (مثل ۱۴۰۵/۰۷/۱۵).');
      return;
    }
    if (endDate < startDate) { // ISO میلادی: مقایسه‌ی متنی = مقایسه‌ی تاریخ
      fail('تاریخ پایان نباید قبل از تاریخ شروع باشد.');
      return;
    }
    const typeValue = String(form.leaveType.value);
    const body = { startDate, endDate, reason: form.reason.value };
    if (typeValue.startsWith('id:')) body.leaveTypeId = Number(typeValue.slice(3));
    else body.leaveType = typeValue;
    if (unit !== 'day') body.unit = unit;
    if (unit === 'half_day') body.halfDayPart = fieldValue(form, 'halfDayPart', 'morning');
    if (unit === 'hour') {
      body.startTime = fieldValue(form, 'startTime');
      body.endTime = fieldValue(form, 'endTime');
      if (!body.startTime || !body.endTime || body.endTime <= body.startTime) {
        fail('ساعت شروع و پایان را درست وارد کنید (پایان بعد از شروع).');
        return;
      }
    }
    try {
      const created = await api('/leave', { method: 'POST', body });
      const low = created && Array.isArray(created.warnings) && created.warnings.some((w) => w.code === 'LOW_BALANCE');
      msg.textContent = low ? 'درخواست ارسال شد؛ توجه: مانده‌ی مرخصی شما کافی نیست و ممکن است رد شود.' : 'درخواست با موفقیت ارسال شد.';
      msg.classList.add('ok');
      form.reset();
      // reset فرم حالت داخلی datepicker را پاک نمی‌کند
      Object.values(leaveDates).forEach((dp) => { if (dp) dp.setValue(''); });
      leaveTypesLoaded = false; // مانده عوض شده؛ دفعه‌ی بعد دوباره بخوان
      loadLeaveTypes();
      loadLeaveList();
    } catch (err) {
      fail(err.message);
    }
  });

  const UNIT_TEXT = { half_day: { morning: 'نیم‌روز صبح', afternoon: 'نیم‌روز عصر' } };
  function leaveWhenText(it) {
    if (it.unit === 'half_day') return `${fmtDate(it.start_date)} — ${(UNIT_TEXT.half_day[it.half_day_part]) || 'نیم‌روز'}`;
    if (it.unit === 'hour') return `${fmtDate(it.start_date)} — ${it.start_time} تا ${it.end_time}`;
    return `${fmtDate(it.start_date)} تا ${fmtDate(it.end_date)}`;
  }

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
            <span>${it.kind === 'mission' ? 'مأموریت' : 'مرخصی'}</span>
            <span class="badge ${it.status}">${LEAVE_STATUS_LABELS[it.status] || it.status}</span>
          </div>
          <div class="li-bottom">
            <span>${leaveWhenText(it)}</span>
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
    $('#pf-name-big').textContent = state.me.fullName || '—';
    $('#pf-avatar').textContent = (state.me.fullName || '؟').trim().charAt(0);
    $('#pf-code').textContent = state.me.personnelCode || '—';
    $('#pf-dept').textContent = state.me.department || '—';
    const roleLabels = { employee: 'کارمند', manager: 'سرپرست', admin: 'ادمین کل' };
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
    getDeviceId(); // S2-3: از همین ابتدا آماده شود تا لمس «ثبت ورود» معطل نماند
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
      try {
        $('#header-date').textContent = fmtTodayShort();
      } catch (_) { /* ignore */ }
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
