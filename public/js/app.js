// منطق سمت کلاینت Telegram Mini App (فاز ۴).
// بدون فریم‌ورک/بیلد؛ فقط Vanilla JS + fetch، طبق تصمیم سادگی پروژه.

(function () {
  'use strict';

  const tg = window.Telegram ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
    // رنگ نوار بالا/پایین را theme.js با تم روشن/تیره هماهنگ می‌کند (S5-8a)؛ اینجا فقط اگر theme.js بارگذاری نشده بود
    if (window.Theme && window.Theme.apply) window.Theme.apply();
    else {
      try {
        tg.setHeaderColor('#1b1c2c');
        tg.setBackgroundColor('#1b1c2c');
        if (tg.setBottomBarColor) tg.setBottomBarColor('#1b1c2c');
      } catch (_) { /* نسخه‌های قدیمی تلگرام */ }
    }
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

  function showToast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.setAttribute('role', isErr ? 'alert' : 'status'); // خطا فوراً اعلام شود (S5-9c)
    el.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  // ---------- حالت‌های UI (S5-9c): skeleton، خالی، خطا با «تلاش دوباره»، دکمه‌ی در حال ارسال ----------
  const U = window.UiStates;
  function renderLoading(el, kind) {
    el.setAttribute('aria-busy', 'true');
    el.innerHTML = U ? U.skeletonHtml(kind, { rows: 4 }) : '<div class="list-item">در حال بارگذاری…</div>';
  }
  function renderEmpty(el, message) {
    el.removeAttribute('aria-busy');
    el.innerHTML = U ? U.emptyHtml(message) : `<div class="list-item">${message}</div>`;
  }
  function renderError(el, err, retry, retryId) {
    el.removeAttribute('aria-busy');
    el.innerHTML = U ? U.errorHtml(err.message, { retryId }) : '<div class="list-item"></div>';
    if (!U) { el.firstChild.textContent = err.message; return; }
    const b = el.querySelector('#' + retryId);
    if (b) b.addEventListener('click', retry);
  }
  // دکمه را تا پایان درخواست غیرفعال می‌کند (جلوگیری از ارسال دوباره)
  async function withBusy(btn, fn) {
    if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }
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
    const navName = name === 'dispute' ? 'profile' : name; // گفت‌وگوی اعتراض زیرمجموعه‌ی «پروفایل» است
    $all('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === navName));

    if (name === 'history') loadHistory();
    if (name === 'report') loadReport($('.tab-btn.active')?.dataset.period || 'week');
    if (name === 'leave') { loadLeaveTypes(); loadLeaveList(); }
    if (name === 'mission') loadMissionList();
    if (name !== 'plan') planUi.onSubmitted = null; // خروجِ معلق فقط با ثبت برنامه اجرا شود، نه با برگشت به صفحه‌ی دیگر
    if (name === 'plan') openPlanWizard();
    if (name === 'profile') { loadProfile(); loadDisputeList(); }
    if (name === 'dispute') loadDisputeThread();
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
      if (state.breakNoteTick) state.breakNoteTick(diff); // C1: پیام «استراحت با حقوق» هم‌گام با تایمر
    }
    tick();
    state.timerInterval = setInterval(tick, 1000);
  }

  const ICONS = {
    in: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
    out: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
    lunch: '<svg viewBox="0 0 24 24"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>',
    resume: '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z"/></svg>',
    plan: '<svg viewBox="0 0 24 24"><path d="M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M8 16h6"/></svg>',
    mission: '<svg viewBox="0 0 24 24"><path d="M5 17h14M3 13l2-6h14l2 6v4H3v-4zM7 17v2M17 17v2M7 13h.01M17 13h.01"/></svg>',
  };

  // ---------- اجازه‌ی ورود (D2) ----------
  // وقتی POST /check-in با ۴۰۹ LATE_LIMIT_REACHED رد شد، کارت اجازه باز می‌شود؛ وضعیت درخواست (در انتظار/تأییدشده/ردشده) با polling سبک (۱۰ ثانیه)
  // یا دکمه‌ی «بررسی وضعیت» به‌روز می‌شود. همه‌ی متن‌ها با textContent درج می‌شوند.
  const lateLimitUi = { open: false, gate: null, timer: null, busy: false };

  function hideLateLimitCard() {
    const card = $('#late-limit-card');
    if (card) { card.classList.add('hidden'); card.textContent = ''; }
    if (lateLimitUi.timer) { clearInterval(lateLimitUi.timer); lateLimitUi.timer = null; }
    lateLimitUi.open = false;
  }

  function lateLimitPermission() { return (lateLimitUi.gate && lateLimitUi.gate.permission) || null; }

  async function pollLateGate(manual) {
    try {
      const { gate } = await api('/checkin-permission');
      if (!lateLimitUi.open) return;
      lateLimitUi.gate = gate;
      renderLateLimitCard();
      if (manual) showToast('وضعیت درخواست به‌روز شد.');
    } catch (err) { if (manual) showToast(err.message, true); }
  }

  function renderLateLimitCard() {
    const card = $('#late-limit-card');
    if (!card) return;
    const g = lateLimitUi.gate || {};
    const p = lateLimitPermission();
    const fa = (n) => (J ? J.toFaDigits(String(n)) : String(n));
    const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text !== undefined) x.textContent = text; return x; };
    card.textContent = '';
    card.classList.remove('hidden');
    card.appendChild(el('div', 'card-title', 'اجازه‌ی ثبت ورود'));
    card.appendChild(el('p', 'late-limit-msg', `این ماه ${fa(g.limit || 0)} بار تأخیر داشته‌اید؛ برای ثبت ورود باید از سرپرست خود اجازه بگیرید.`));

    const status = p && p.status;
    if (status === 'pending') {
      card.appendChild(el('p', 'late-limit-status is-pending', 'درخواست شما ارسال شد؛ در انتظار تأیید سرپرست…'));
      const b = el('button', 'btn secondary', 'بررسی وضعیت');
      b.addEventListener('click', () => pollLateGate(true));
      card.appendChild(b);
    } else if (status === 'approved') {
      const until = p.expiresAt ? new Date(p.expiresAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
      card.appendChild(el('p', 'late-limit-status is-approved', `اجازه تأیید شد${until ? ` — تا ساعت ${until} معتبر است` : ''}.`));
      const b = el('button', 'btn primary', 'ثبت ورود');
      b.addEventListener('click', async () => { b.disabled = true; const ok = await doAction('/check-in', {}, 'ورود ثبت شد (با اجازه‌ی سرپرست).'); if (!ok) b.disabled = false; });
      card.appendChild(b);
    } else {
      if (status === 'rejected') card.appendChild(el('p', 'late-limit-status is-rejected', `درخواست قبلی رد شد${p.decisionNote ? `: ${p.decisionNote}` : '.'}`));
      if (status === 'expired') card.appendChild(el('p', 'late-limit-status is-rejected', 'مهلت اجازه‌ی قبلی تمام شد؛ دوباره درخواست دهید.'));
      const ta = el('textarea', 'late-limit-reason');
      ta.maxLength = 200;
      ta.rows = 3;
      ta.placeholder = 'علت تأخیر را بنویسید (حداکثر ۲۰۰ نویسه)';
      const send = el('button', 'btn primary', 'ارسال درخواست اجازه');
      send.addEventListener('click', async () => {
        const reason = ta.value.trim();
        if (!reason) { showToast('علت درخواست را بنویسید.', true); return; }
        send.disabled = true;
        try {
          const { permission } = await api('/checkin-permission', { method: 'POST', body: { reason } });
          lateLimitUi.gate = { ...g, permission };
          showToast('درخواست برای سرپرست ارسال شد.');
        } catch (err) {
          showToast(err.message, true);
          if (err.data && err.data.permission) lateLimitUi.gate = { ...g, permission: err.data.permission }; // درخواست فعال از قبل هست
        }
        renderLateLimitCard();
      });
      card.append(ta, send);
    }
    // polling سبک فقط وقتی منتظر تصمیم‌ایم
    if (status === 'pending' && !lateLimitUi.timer) lateLimitUi.timer = setInterval(() => pollLateGate(false), 10000);
    if (status !== 'pending' && lateLimitUi.timer) { clearInterval(lateLimitUi.timer); lateLimitUi.timer = null; }
  }

  // بعد از reload: اگر امروز درخواستِ فعال/ردشده‌ای هست کارت دوباره باز شود (وگرنه با اولین ورودِ مسدود از ۴۰۹ باز می‌شود)
  async function syncLateGate() {
    try {
      const { gate } = await api('/checkin-permission');
      const p = gate && gate.permission;
      if (gate && gate.enabled && p && ['pending', 'approved', 'rejected', 'expired'].includes(p.status) && gate.overLimit) {
        lateLimitUi.gate = gate;
        lateLimitUi.open = true;
        renderTodayActions();
      }
    } catch (_) { /* بی‌صدا: ورود عادی کار می‌کند */ }
  }

  function renderTodayActions() {
    const box = $('#today-actions');
    box.innerHTML = '';
    box.className = 'actions';
    const r = state.today && state.today.record;
    const openBreak = state.today && state.today.openBreak;

    function addTile({ title, sub, color, icon, wide, handler, locked }) {
      const b = document.createElement('button');
      b.className = 'action-tile t-' + color + (wide ? ' wide' : '');
      b.innerHTML = `
        <span class="tile-icon">${ICONS[icon]}</span>
        <span class="tile-text">
          <span class="tile-title">${title}</span>
          <span class="tile-sub">${sub}</span>
        </span>`;
      if (locked) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.dataset.locked = '1'; }
      else b.addEventListener('click', handler);
      box.appendChild(b);
    }
    // کاشی ماموریت (C2): همیشه هست؛ با استراحت باز غیرفعال است (ابتدا استراحت را پایان دهید)
    const addMissionTile = () => addTile({
      title: 'ماموریت 🚗', sub: openBreak ? 'ابتدا استراحت را پایان دهید' : 'ثبت درخواست ماموریت', color: 'purple', icon: 'mission', wide: true,
      handler: () => openMissionView(), locked: !!openBreak,
    });

    const addPlanTile = () => addTile({ title: 'برنامه‌ی هفتگی 📅', sub: 'ثبت یا ویرایش برنامه‌ی هفته', color: 'green', icon: 'plan', wide: true, handler: () => switchView('plan') });

    if (!r) {
      box.classList.add('single');
      // D2: سقف تأخیر ماهانه رد شده ⇒ به‌جای دکمه‌ی ورود، کارت «درخواست اجازه‌ی ورود» (با تأیید سرپرست، دکمه‌ی ورود داخل همان کارت فعال می‌شود)
      if (lateLimitUi.open) renderLateLimitCard();
      else {
        hideLateLimitCard();
        addTile({
          title: 'ثبت ورود', sub: 'شروع روز کاری', color: 'green', icon: 'in', wide: true,
          handler: () => doAction('/check-in', {}, 'ورود ثبت شد.'),
        });
      }
      addMissionTile();
      addPlanTile();
      return;
    }

    hideLateLimitCard(); // رکورد امروز هست ⇒ کارت اجازه لازم نیست
    if (r.check_out_time) {
      box.classList.add('single');
      const done = document.createElement('div');
      done.className = 'card done-card';
      done.textContent = 'امروز به پایان رسید. تا فردا خوش باشید 🌤️';
      box.appendChild(done);
      addMissionTile();
      addPlanTile();
      return;
    }

    if (openBreak) {
      box.classList.add('single');
      addTile({
        title: 'پایان استراحت', sub: 'بازگشت به کار', color: 'orange', icon: 'resume', wide: true,
        handler: () => doAction('/break/end', {}, 'استراحت پایان یافت.'),
      });
      addMissionTile();
      addPlanTile();
      return;
    }

    addTile({
      title: 'ثبت استراحت', sub: 'شروع وقفه', color: 'orange', icon: 'lunch',
      handler: () => openBreakSheet(),
    });
    addTile({
      title: 'ثبت خروج', sub: 'پایان روز کاری', color: 'red', icon: 'out',
      handler: () => startCheckout(),
    });
    addMissionTile();
    addPlanTile();
  }

  // ---------- bottom-sheet انتخاب نوع استراحت (A1) ----------
  // سه گزینه: ناهار (lunch)، نماز و استراحت کوتاه (هر دو short_break). آخرین انتخاب پیش‌انتخاب است.
  const BREAK_KIND_KEY = 'lastBreakKind';
  const BREAK_KINDS = ['lunch', 'prayer', 'short'];

  function readLastBreakKind() {
    try {
      const v = window.localStorage.getItem(BREAK_KIND_KEY);
      return BREAK_KINDS.includes(v) ? v : 'lunch';
    } catch (e) { return 'lunch'; }
  }
  function saveLastBreakKind(kind) {
    try { window.localStorage.setItem(BREAK_KIND_KEY, kind); } catch (e) { /* حافظه‌ی محلی در دسترس نیست؛ مشکلی نیست */ }
  }

  // ریست برنامه (B4): با تغییر reset_epoch، state محلیِ کاربر (آخرین نوع استراحت و پیش‌نویس‌ها) پاک می‌شود.
  // شناسه‌ی دستگاه عمداً حفظ می‌شود (هویت دستگاه است، نه state برنامه).
  const RESET_EPOCH_KEY = 'resetEpoch';
  function syncResetEpoch(epoch) {
    if (epoch === undefined || epoch === null) return;
    try {
      const ls = window.localStorage;
      const prev = ls.getItem(RESET_EPOCH_KEY);
      if (prev !== null && prev !== String(epoch)) {
        ls.removeItem(BREAK_KIND_KEY);
        Object.keys(ls).filter((k) => k.indexOf('draft:') === 0 || k.indexOf(DISPUTE_SEEN_PREFIX) === 0).forEach((k) => ls.removeItem(k));
        state.today = null;
      }
      ls.setItem(RESET_EPOCH_KEY, String(epoch));
    } catch (e) { /* حافظه‌ی محلی در دسترس نیست */ }
  }

  let breakSheetReturnFocus = null;

  function closeBreakSheet() {
    const root = $('#break-sheet');
    if (!root || root.classList.contains('hidden')) return;
    root.classList.add('hidden');
    document.removeEventListener('keydown', onBreakSheetKey, true);
    const back = breakSheetReturnFocus;
    breakSheetReturnFocus = null;
    if (back && back.isConnected) { try { back.focus(); } catch (e) { /* ignore */ } }
  }

  // Esc بسته می‌کند؛ Tab داخل sheet می‌چرخد (focus trap)
  function onBreakSheetKey(ev) {
    const root = $('#break-sheet');
    if (!root || root.classList.contains('hidden')) return;
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeBreakSheet(); return; }
    if (ev.key !== 'Tab') return;
    const items = Array.from(root.querySelectorAll('button:not([disabled])'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!root.contains(active)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && active === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
  }

  function chooseBreakKind(btn) {
    saveLastBreakKind(btn.dataset.breakKind);
    closeBreakSheet();
    doAction('/break/start', { breakType: btn.dataset.breakType }, 'استراحت شروع شد.');
  }

  function openBreakSheet() {
    const root = $('#break-sheet');
    if (!root) { doAction('/break/start', { breakType: 'lunch' }, 'استراحت شروع شد.'); return; }
    breakSheetReturnFocus = document.activeElement;
    const last = readLastBreakKind();
    const options = Array.from(root.querySelectorAll('.sheet-option'));
    options.forEach((b) => {
      const on = b.dataset.breakKind === last;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    root.classList.remove('hidden');
    document.addEventListener('keydown', onBreakSheetKey, true);
    const pre = options.find((b) => b.dataset.breakKind === last) || options[0];
    if (pre) pre.focus();
  }

  let breakSheetBound = false;
  function initBreakSheet() {
    const root = $('#break-sheet');
    if (!root || breakSheetBound) return;
    breakSheetBound = true;
    // یک شنونده‌ی واحد: گزینه‌ها، انصراف و لمس پس‌زمینه‌ی بیرون از sheet
    root.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t === root) { closeBreakSheet(); return; }
      const opt = t && t.closest ? t.closest('.sheet-option') : null;
      if (opt) { chooseBreakKind(opt); return; }
      if (t && t.closest && t.closest('#break-sheet-cancel')) closeBreakSheet();
    });
  }

  // پیام موفقیتِ خروج: یادآوری‌های برنامه‌ی هفته‌ی بعد (D5) و گزارش روزانه در حالت soft (D7)
  function checkoutMessage(res, fallback) {
    const parts = ['خروج ثبت شد.'];
    const cheer = window.DailyReport ? window.DailyReport.encouragementOf(res) : '';
    if (cheer) parts.push(cheer);
    if (res && res.reportReminder && res.reportReminder.pendingTasks && res.reportReminder.pendingTasks.length) {
      parts.push(`${res.reportReminder.pendingTasks.length.toLocaleString('fa-IR')} تسک بدون پاسخ ماند؛ تا ۲۴ ساعت می‌توانید گزارش را تکمیل کنید.`);
    }
    if (res && res.planReminder) parts.push('فراموش نکنید برنامه‌ی هفته‌ی بعد را ثبت کنید.');
    return parts.length > 1 ? parts.join(' ') : fallback;
  }

  // خروجی: true در موفقیت. گیت‌های سرور (D5/D7) خطای 409 با code می‌دهند و UI کاربر را به ویزارد مربوط می‌برد.
  async function doAction(path, body, successMsg) {
    const btns = $all('#today-actions button');
    btns.forEach((b) => { b.disabled = true; });
    const unlock = () => btns.forEach((b) => { if (b.isConnected && !(b.dataset && b.dataset.locked)) b.disabled = false; });
    try {
      // S2-3: device_id فقط همراه ورود/خروج؛ نبودنش مانع ثبت نیست
      if (path === '/check-in' || path === '/check-out') {
        const deviceId = await getDeviceId();
        if (deviceId) body = { ...(body || {}), deviceId };
      }
      const res = await api(path, { method: 'POST', body });
      showToast(path === '/check-out' ? checkoutMessage(res, successMsg) : successMsg);
      if (path === '/check-out') { reportUi.answers = new Map(); reportUi.extras = []; reportUi.date = ''; switchView('today'); }
      await loadToday();
      return true;
    } catch (err) {
      const code = err && err.data && err.data.code;
      // گیت D2: سقف تأخیر ماهانه رد شده ⇒ کارت «درخواست اجازه‌ی ورود» (سرور چیزی ثبت نکرده)
      if (path === '/check-in' && code === 'LATE_LIMIT_REACHED') {
        showToast(err.message, true);
        unlock();
        lateLimitUi.gate = { enabled: true, overLimit: true, blocked: true, limit: err.data.limit, lateCount: err.data.lateCount, permission: err.data.permission || null };
        lateLimitUi.open = true;
        renderTodayActions();
        return false;
      }
      // گیت D7: گزارش تسک‌های امروز لازم است ⇒ ویزارد؛ پاسخ‌های قبلیِ همین بدنه حفظ می‌شود
      if (path === '/check-out' && code === 'daily_report_required') {
        showToast(err.message);
        unlock();
        // A1: pendingTasks فقط الزامی‌هاست؛ اختیاری‌ها (low) بعد از آن‌ها می‌آیند و مانع نیستند
        openReportWizard({ mode: 'checkout', date: err.data.date, today: err.data.date, tasks: [...(err.data.pendingTasks || []), ...(err.data.optionalTasks || [])], body, allowLater: false, teamReview: err.data.teamReview });
        return false;
      }
      showToast(err.message, true);
      unlock();
      // گیت D5: ثبت برنامه‌ی هفته‌ی بعد لازم است ⇒ ویزارد؛ سرور چیزی ذخیره نکرده، پس بعد از ثبت برنامه همان بدنه (با گزارش) دوباره فرستاده می‌شود
      if (path === '/check-out' && code === 'weekly_plan_required') {
        planUi.week = 'next';
        const resend = body;
        planUi.onSubmitted = () => {
          if (hasReportBody(resend)) openReportConfirm(resend); // ترتیب: گزارش ← برنامه ← تأیید خروج
          else { switchView('today'); doAction('/check-out', resend, 'خروج ثبت شد.'); }
        };
        switchView('plan');
      }
      return false;
    }
  }

  function setStatus(label, cls) {
    $('#status-label').textContent = label;
    $('#status-pill').className = 'status-pill ' + cls;
  }

  // اولین بارگذاری نمای «امروز»: skeleton به‌جای مقدارهای خالی (--:--:--)؛ بعد از پایان (موفق یا ناموفق) برداشته می‌شود (S5-9c)
  function showTodaySkeleton(on) {
    const view = $('#view-today');
    const box = $('#today-skeleton');
    if (!view || !box) return;
    if (on) {
      box.innerHTML = U ? U.skeletonHtml('today', { label: 'در حال بارگذاری وضعیت امروز…' }) : '';
      box.classList.remove('hidden');
      view.classList.add('is-loading');
      view.setAttribute('aria-busy', 'true');
    } else {
      box.innerHTML = '';
      box.classList.add('hidden');
      view.classList.remove('is-loading');
      view.removeAttribute('aria-busy');
    }
  }

  // استراحت با حقوق (C1): فقط برای استراحت کوتاهِ بازِ جاری وقتی سیاست روشن است؛ متن‌ها با textContent و هماهنگ با تایمر سرور
  function renderBreakNote(data) {
    const el = $('#break-note');
    if (!el) return;
    const paid = data && data.openBreakPaid;
    if (!paid || !data.openBreak || data.record?.check_out_time) { el.classList.add('hidden'); el.textContent = ''; el.classList.remove('is-over'); return; }
    const fa = (n) => (J ? J.toFaDigits(String(n)) : String(n));
    const from = new Date(data.openBreak.start_time).getTime();
    const paint = (diffMs) => {
      const over = paid.isPaid && diffMs > paid.minutes * 60000;
      let text;
      if (!paid.isPaid) text = `سهمیه‌ی استراحت با حقوقِ امروز (${fa(paid.count)} بار) تمام شده؛ این استراحت از ساعت کاری کم می‌شود.`;
      else if (over) text = `استراحت با حقوق ${fa(paid.index)} از ${fa(paid.count)} — از این‌جا به بعد از ساعت کاری کم می‌شود.`;
      else text = `استراحت با حقوق ${fa(paid.index)} از ${fa(paid.count)} — ${fa(paid.minutes)} دقیقه`;
      if (el.textContent !== text) el.textContent = text;
      el.classList.toggle('is-over', over || !paid.isPaid);
    };
    el.classList.remove('hidden');
    paint(Math.max(0, Date.now() - from));
    state.breakNoteTick = paid.isPaid ? paint : null; // سهمیه‌ی تمام‌شده ثابت است؛ تیک لازم ندارد
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
    state.breakNoteTick = null;
    renderBreakNote(data); // C1: خاموش/بدون استراحت باز ⇒ پنهان

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
    if (!(data && data.record)) syncLateGate();
    loadWorkHours();
    loadPlanGateBanner();
    loadReportBanner();
  }

  // ساعت کاری مؤثر امروز و فردا (B2): اگر ادمین/سرپرست «برنامه‌ی ویژه» گذاشته باشد با نشان جدا؛ خطا هرگز نمای امروز را نمی‌شکند.
  // متن‌ها (از جمله عنوان تعطیلی که ادمین وارد کرده) فقط با textContent درج می‌شوند.
  async function loadWorkHours() {
    const card = $('#work-hours-card');
    if (!card) return;
    try {
      const { days } = await api('/schedule/upcoming');
      const fa = (t) => (J ? J.toFaDigits(t) : t);
      card.textContent = '';
      days.forEach((d, i) => {
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.className = 'row-label';
        label.textContent = i === 0 ? 'ساعت کاری امروز' : 'ساعت کاری فردا';
        const value = document.createElement('span');
        value.className = 'row-value';
        value.textContent = d.isWorkingDay
          ? `${fa(d.expectedStart)} تا ${fa(d.expectedEnd)}`
          : (d.special === 'off' ? 'آف' : (d.holidayTitle ? `تعطیل — ${d.holidayTitle}` : 'روز غیرکاری'));
        if (d.special) {
          const badge = document.createElement('span');
          badge.className = 'chip-special';
          badge.textContent = 'برنامه‌ی ویژه';
          value.append(' ', badge);
        }
        row.append(label, value);
        card.appendChild(row);
      });
      card.classList.remove('hidden');
    } catch (_) {
      card.classList.add('hidden');
    }
  }

  // بنر الزام برنامه‌ی هفتگی (D5): فقط اطلاع‌رسانی؛ خطای آن هرگز نمای امروز را نمی‌شکند
  async function loadPlanGateBanner() {
    const box = $('#plan-gate-banner');
    if (!box) return;
    try {
      const g = await api('/plan-gate');
      box.textContent = '';
      const show = g && (g.banner || (g.blocked && !(state.today && state.today.record && state.today.record.check_out_time)));
      if (!show) { box.classList.add('hidden'); return; }
      const msg = document.createElement('div');
      msg.textContent = g.banner
        ? 'خروج دیروز به‌صورت خودکار بسته شد و برنامه‌ی هفته‌ی بعد ثبت نشده بود. لطفاً همین حالا برنامه را ثبت کنید.'
        : 'امروز روز ثبت برنامه‌ی هفته‌ی بعد است؛ بدون ثبت برنامه، خروج ثبت نمی‌شود.';
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn primary'; btn.textContent = 'ثبت برنامه‌ی هفتگی';
      btn.addEventListener('click', () => { planUi.week = g.banner ? 'current' : 'next'; switchView('plan'); });
      box.appendChild(msg); box.appendChild(btn);
      box.classList.remove('hidden');
    } catch (_) { box.classList.add('hidden'); }
  }

  // ---------- تاریخچه ----------

  async function loadHistory() {
    const list = $('#history-list');
    renderLoading(list, 'list');
    try {
      const records = await api('/history?days=30');
      if (!records.length) { renderEmpty(list, 'رکوردی یافت نشد.'); return; }
      list.removeAttribute('aria-busy');
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
      renderError(list, err, loadHistory, 'retry-history');
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
    renderLoading(card, 'table');
    try {
      const r = await api('/report?period=' + period);
      card.removeAttribute('aria-busy');
      card.innerHTML = `
        <div class="report-head"><span>شاخص</span><span>مقدار</span></div>
        <div class="row"><span class="row-label">مجموع ساعت مفید</span><span class="row-value">${fmtDuration(r.totalEffective)}</span></div>
        <div class="row"><span class="row-label">تعداد روزهای کاری</span><span class="row-value">${r.dayCount}</span></div>
        <div class="row"><span class="row-label">تعداد تأخیر</span><span class="row-value">${r.lateCount}</span></div>
        <div class="row"><span class="row-label">تعداد خروج زودهنگام</span><span class="row-value">${r.earlyLeaveCount}</span></div>
        <div class="row"><span class="row-label">رکوردهای ناقص</span><span class="row-value">${r.incompleteCount}</span></div>`;
    } catch (err) {
      renderError(card, err, () => loadReport(period), 'retry-report');
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
    const submitBtn = form.querySelector('[type="submit"]');
    try {
      const created = await withBusy(submitBtn, () => api('/leave', { method: 'POST', body }));
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
    renderLoading(list, 'list');
    try {
      const items = await api('/leave');
      if (!items.length) { renderEmpty(list, 'درخواستی ثبت نشده است.'); return; }
      list.removeAttribute('aria-busy');
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
      renderError(list, err, loadLeaveList, 'retry-leave');
    }
  }

  // ---------- ماموریت (C2) ----------
  // فرم و فهرست «ماموریت‌های من». همه‌ی قواعد (بازه‌ی ثبت، تداخل، علت ۵–۳۰۰ نویسه) سمت سرور اعمال می‌شود؛ این‌جا فقط راهنمای کاربر است.
  const MISSION_UNIT_ROWS = { day: ['#mission-end-row'], half_day: ['#mission-part-row'], hour: ['#mission-starttime-row', '#mission-endtime-row'] };
  const MISSION_ALL_ROWS = ['#mission-end-row', '#mission-part-row', '#mission-starttime-row', '#mission-endtime-row'];
  const missionForm = $('#mission-form');
  const missionDates = { startDate: null, endDate: null };
  const missionOk = !!(missionForm && typeof missionForm.addEventListener === 'function' && typeof missionForm.querySelector === 'function');

  if (missionOk) {
    ['startDate', 'endDate'].forEach((name) => {
      const el = missionForm[name];
      if (!DP || !el) return;
      el.type = 'text'; // type=date متن شمسی را نمی‌پذیرد
      missionDates[name] = DP.attach(el, {});
    });
  }
  const readMissionDate = (name) => (missionDates[name] ? missionDates[name].getValue() : missionForm[name].value);

  function openMissionView() { switchView('mission'); }

  function applyMissionUnitUI() {
    const unit = missionForm.unit ? missionForm.unit.value : 'day';
    MISSION_ALL_ROWS.forEach((sel) => { const row = $(sel); if (row) row.hidden = true; });
    (MISSION_UNIT_ROWS[unit] || []).forEach((sel) => { const row = $(sel); if (row) row.hidden = false; });
    return unit;
  }

  // هشدار «بیرون از ساعت کاری» (ساعت کاری روز از سرور می‌آید؛ فقط راهنماست، چیزی را مسدود نمی‌کند)
  const toMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  async function refreshMissionWarning() {
    const box = $('#mission-warning');
    if (!box) return;
    const unit = applyMissionUnitUI();
    const date = readMissionDate('startDate');
    let text = '';
    if (date && unit !== 'day') {
      try {
        const day = await api('/mission/day?date=' + encodeURIComponent(date));
        if (!day.isWorkingDay) text = 'این روز کاری نیست؛ آن بخش ساعت کاری حساب نمی‌شود.';
        else if (unit === 'hour') {
          const s = toMin(fieldValue(missionForm, 'startTime')); const en = toMin(fieldValue(missionForm, 'endTime'));
          const ws = toMin(day.expectedStart); const we = toMin(day.expectedEnd);
          if (s !== null && en !== null && ws !== null && we !== null && (s < ws || en > we)) text = 'بخشی از بازه بیرون ساعت کاری است؛ آن بخش ساعت کاری حساب نمی‌شود.';
        }
      } catch (_) { text = ''; }
    }
    box.textContent = text;
    box.hidden = !text;
  }

  const MISSION_STATUS = { pending: 'در انتظار تأیید', approved: 'تأیید شده', rejected: 'رد شده' };
  function missionWhenText(m) {
    if (m.unit === 'half_day') return `${fmtDate(m.startDate)} — ${m.halfDayPart === 'afternoon' ? 'نیم‌روز عصر' : 'نیم‌روز صبح'}`;
    if (m.unit === 'hour') return `${fmtDate(m.startDate)} — ${m.startTime} تا ${m.endTime}`;
    return m.startDate === m.endDate ? fmtDate(m.startDate) : `${fmtDate(m.startDate)} تا ${fmtDate(m.endDate)}`;
  }

  // C6: «ماموریت همین حالا» — دکمه‌ی شروع/پایان بر پایه‌ی وجود ماموریتِ بازِ خودِ کاربر
  function syncMissionNow(items) {
    const startBtn = $('#mission-now-start');
    const endBtn = $('#mission-now-end');
    if (!startBtn || !endBtn) return;
    const open = (items || []).some((m) => m.openNow);
    startBtn.hidden = open;
    endBtn.hidden = !open;
  }

  async function loadMissionList() {
    const list = $('#mission-list');
    if (!list) return;
    renderLoading(list, 'list');
    try {
      const items = await api('/missions');
      syncMissionNow(items);
      if (!items.length) { renderEmpty(list, 'ماموریتی ثبت نشده است.'); return; }
      list.removeAttribute('aria-busy');
      list.innerHTML = '';
      items.forEach((m) => {
        const el = document.createElement('div');
        el.className = 'list-item';
        const top = document.createElement('div');
        top.className = 'li-top';
        const t1 = document.createElement('span'); t1.textContent = m.destination ? `ماموریت — ${m.destination}` : 'ماموریت';
        const badge = document.createElement('span'); badge.className = 'badge ' + m.status; badge.textContent = MISSION_STATUS[m.status] || m.status;
        top.appendChild(t1); top.appendChild(badge);
        const bottom = document.createElement('div');
        bottom.className = 'li-bottom';
        const when = document.createElement('span'); when.textContent = missionWhenText(m);
        bottom.appendChild(when);
        el.appendChild(top); el.appendChild(bottom);
        const reason = document.createElement('div'); reason.className = 'mission-note'; reason.textContent = m.reason || '';
        el.appendChild(reason);
        if (m.managerNote) {
          const note = document.createElement('div'); note.className = 'mission-note'; note.textContent = 'یادداشت سرپرست: ' + m.managerNote;
          el.appendChild(note);
        }
        if (m.status === 'pending') {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'btn secondary mission-cancel'; btn.textContent = 'لغو درخواست';
          let armed = false;
          btn.addEventListener('click', async () => {
            if (!armed) { armed = true; btn.textContent = 'مطمئنید؟ دوباره بزنید'; setTimeout(() => { armed = false; if (btn.isConnected) btn.textContent = 'لغو درخواست'; }, 4000); return; }
            try { await withBusy(btn, () => api('/missions/' + m.id, { method: 'DELETE' })); showToast('درخواست ماموریت لغو شد.'); loadMissionList(); } catch (err) { showToast(err.message, true); }
          });
          el.appendChild(btn);
        }
        list.appendChild(el);
      });
    } catch (err) {
      renderError(list, err, loadMissionList, 'retry-mission');
    }
  }

  // آپلود پیوست اختیاری بعد از ثبت (بدنه = خودِ فایل). شکست آپلود ثبت ماموریت را باطل نمی‌کند.
  async function uploadMissionAttachment(id, file) {
    const res = await fetch('/api/miniapp/missions/' + id + '/attachment', {
      method: 'POST',
      headers: { 'Content-Type': file.type, 'X-Telegram-Init-Data': initData, 'X-File-Name': encodeURIComponent(file.name || '') },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'ارسال پیوست ناموفق بود.');
  }

  if (missionOk) {
    const backBtn = $('#mission-back');
    if (backBtn && typeof backBtn.addEventListener === 'function') backBtn.addEventListener('click', () => switchView('today'));
    ['unit', 'halfDayPart', 'startTime', 'endTime'].forEach((name) => {
      const el = missionForm[name];
      if (el && typeof el.addEventListener === 'function') el.addEventListener('change', refreshMissionWarning);
    });
    if (missionDates.startDate && typeof missionForm.startDate.addEventListener === 'function') missionForm.startDate.addEventListener('change', refreshMissionWarning);

    const nowStart = $('#mission-now-start');
    const nowEnd = $('#mission-now-end');
    if (nowStart && typeof nowStart.addEventListener === 'function') {
      nowStart.addEventListener('click', async () => {
        try { await withBusy(nowStart, () => api('/mission/now', { method: 'POST', body: {} })); showToast('ماموریت شروع شد. پایان آن را فراموش نکنید.'); loadMissionList(); } catch (err) { showToast(err.message, true); }
      });
    }
    if (nowEnd && typeof nowEnd.addEventListener === 'function') {
      nowEnd.addEventListener('click', async () => {
        try { await withBusy(nowEnd, () => api('/mission/now/end', { method: 'POST', body: {} })); showToast('ماموریت پایان یافت.'); loadMissionList(); } catch (err) { showToast(err.message, true); }
      });
    }

    missionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const msg = $('#mission-msg');
      msg.textContent = ''; msg.className = 'form-msg';
      const fail = (text) => { msg.textContent = text; msg.classList.add('err'); };
      const unit = applyMissionUnitUI();
      const startDate = readMissionDate('startDate');
      const endDate = unit === 'day' ? readMissionDate('endDate') : startDate;
      if (!startDate || !endDate) { fail('تاریخ را معتبر و به‌صورت شمسی وارد کنید (مثل ۱۴۰۵/۰۷/۱۵).'); return; }
      if (endDate < startDate) { fail('تاریخ پایان نباید قبل از تاریخ شروع باشد.'); return; }
      const reason = String(form.reason.value || '').trim();
      if (reason.length < 5) { fail('علت ماموریت را حداقل ۵ نویسه بنویسید.'); return; }
      if (reason.length > 300) { fail('علت ماموریت حداکثر ۳۰۰ نویسه است.'); return; }
      const body = { unit, startDate, endDate, reason, destination: String(form.destination.value || '').trim() };
      if (unit === 'half_day') body.halfDayPart = fieldValue(form, 'halfDayPart', 'morning');
      if (unit === 'hour') {
        body.startTime = fieldValue(form, 'startTime');
        body.endTime = fieldValue(form, 'endTime');
        if (!body.startTime || !body.endTime || body.endTime <= body.startTime) { fail('ساعت شروع و پایان را درست وارد کنید (پایان بعد از شروع).'); return; }
      }
      const file = form.attachment && form.attachment.files && form.attachment.files[0];
      const submitBtn = form.querySelector('[type="submit"]');
      try {
        const created = await withBusy(submitBtn, () => api('/mission', { method: 'POST', body }));
        let note = 'درخواست ماموریت ارسال شد و منتظر تأیید است.';
        if (file) {
          try { await uploadMissionAttachment(created.id, file); } catch (upErr) { note += ' (پیوست ارسال نشد: ' + upErr.message + ')'; }
        }
        msg.textContent = note; msg.classList.add('ok');
        form.reset();
        Object.values(missionDates).forEach((dp) => { if (dp) dp.setValue(''); });
        applyMissionUnitUI();
        const box = $('#mission-warning'); if (box) { box.textContent = ''; box.hidden = true; }
        loadMissionList();
      } catch (err) {
        fail(err.message);
      }
    });
    applyMissionUnitUI();
  }

  // ---------- برنامه‌ی هفتگی (D4): ویزارد انتقال ← افزودن تسک ← مرور ← ثبت ----------
  const PLAN_PRIORITY = { low: 'کم', normal: 'عادی', high: 'بالا' };
  // C2: ترتیب نمایش «بالا / عادی / کم»، توضیح هر اولویت و پیام قفل هفته‌ی شروع‌شده
  const PLAN_PRIORITY_ORDER = ['high', 'normal', 'low'];
  const PLAN_PRIORITY_HELP = {
    high: 'تا انجام ندهی یا علتش را ننویسی نمی‌توانی ثبت خروج کنی.',
    normal: 'تا انجام ندهی یا علتش را ننویسی نمی‌توانی ثبت خروج کنی.',
    low: 'ثبت خروج را مسدود نمی‌کند.',
  };
  const PLAN_PRIORITY_NOTE = 'بالا و عادی: تا انجام ندهی یا علتش را ننویسی نمی‌توانی ثبت خروج کنی. کم: ثبت خروج را مسدود نمی‌کند.';
  const PLAN_LOCKED_MSG = 'هفته شروع شده و برنامه‌اش قابل ویرایش نیست.';
  const PLAN_MONTH_CLOSED_MSG = 'این هفته در ماهِ بسته‌شده است و فقط قابل مشاهده است.';
  const planPrio = (p) => (PLAN_PRIORITY[p] ? p : 'normal');
  const planUi = { data: null, tasks: [], carry: new Set(), step: 'tasks', week: 'next', msg: '', busy: false, drafts: {}, focus: null, focusTop: false };

  function planEl(tag, props, ...kids) {
    const e = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else if (k === 'on') Object.entries(v).forEach(([ev, fn]) => e.addEventListener(ev, fn)); else e[k] = v;
    });
    kids.flat().forEach((c) => { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  // اعتبارسنجی سمت کاربر (سرور دوباره همه‌چیز را چک می‌کند)
  function planValidate(tasks, data) {
    const mine = tasks.filter((t) => !t.isSystem);
    for (let i = 0; i < mine.length; i += 1) {
      const t = mine[i];
      const title = String(t.title || '').trim();
      if (!title) return `عنوان تسک ${i + 1} را بنویسید.`;
      if (title.length > 120) return `عنوان تسک ${i + 1} حداکثر ۱۲۰ نویسه است.`;
      if (String(t.description || '').length > 500) return `توضیح تسک ${i + 1} حداکثر ۵۰۰ نویسه است.`;
    }
    if (mine.length > data.maxTasks) return `حداکثر ${data.maxTasks} تسک مجاز است.`;
    return '';
  }

  function planWeekDays(data) {
    const out = [];
    const [y, m, d] = data.weekStart.split('-').map(Number);
    for (let i = 0; i < 7; i += 1) {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      out.push(dt.toISOString().slice(0, 10));
    }
    return out;
  }

  // C1: روز هفته + تاریخ شمسی برای عنوان کارت («شنبه ۱۲ مهر»)؛ بدون سال چون جا کم است
  function fmtPlanDay(iso) {
    if (J) {
      try {
        const j = J.isoToJalali(iso);
        return `${J.weekdayName(iso)} ${J.toFaDigits(j.jd)} ${J.MONTH_NAMES[j.jm - 1]}`;
      } catch (_) { /* جایگزین */ }
    }
    try {
      return new Date(`${iso}T12:00:00`).toLocaleDateString('fa-IR-u-ca-persian', { weekday: 'long', month: 'long', day: 'numeric' });
    } catch (_) {
      return iso;
    }
  }

  // روزهای هفته با نوع روز از سرور (data.days)؛ اگر سرور نفرستاد همه کاری فرض می‌شود
  const PLAN_DAY_BADGE = { half: 'نیم‌روز', weekend: 'تعطیل', holiday: 'تعطیل رسمی' };
  function planDays(data) {
    const info = new Map((data.days || []).map((d) => [d.date, d]));
    return planWeekDays(data).map((date) => {
      const d = info.get(date) || {};
      return { date, kind: d.kind || 'working', holidayTitle: d.holidayTitle || null };
    });
  }

  // نشان رنگی اولویت (متن + نماد؛ فقط به رنگ متکی نیست)
  function prioBadge(p) {
    const v = planPrio(p);
    return planEl('span', { class: 'prio-badge prio-' + v, text: PLAN_PRIORITY[v] });
  }

  // C2: نمای فقط‌خواندنی برنامه (هفته‌ی ثبت‌شده/شروع‌شده/ماه بسته) با همان ظاهر کارت‌ها؛ هیچ کنترل فعالی ندارد
  function planReadonlyBoard(data) {
    const days = planDays(data);
    const dayDates = new Set(days.map((d) => d.date));
    const rows = (list) => list.map((t) => planEl('li', { class: 'day-task day-task-ro' },
      t.isSystem ? planEl('span', { class: 'plan-sys', text: 'تسک خودکار: ' + t.title })
        : [planEl('div', { class: 'day-task-main' }, prioBadge(t.priority), planEl('span', { class: 'day-task-text', text: t.title })),
          t.description ? planEl('div', { class: 'plan-meta', text: t.description }) : null]));
    let seq = 0;
    const card = (titleText, badge, list) => {
      seq += 1;
      const section = planEl('section', { class: 'day-card day-card-ro' },
        planEl('div', { class: 'day-card-head' }, planEl('h4', { class: 'day-card-title', id: 'plan-ro-' + seq, text: titleText }), badge ? planEl('span', { class: 'day-badge', text: badge }) : null),
        planEl('ul', { class: 'day-list' }, rows(list)));
      section.setAttribute('aria-labelledby', 'plan-ro-' + seq);
      return section;
    };
    const cards = [];
    const general = data.tasks.filter((t) => !t.plannedDate || !dayDates.has(t.plannedDate));
    if (general.length) cards.push(card('هر روز / بدون روز مشخص', '', general));
    days.forEach((d) => {
      const list = data.tasks.filter((t) => t.plannedDate === d.date);
      if (list.length) cards.push(card(fmtPlanDay(d.date), PLAN_DAY_BADGE[d.kind] || '', list));
    });
    if (!cards.length) return planEl('div', { class: 'empty', role: 'status', text: 'تسکی در این برنامه ثبت نشده است.' });
    return planEl('div', { class: 'plan-board' }, planEl('div', { class: 'plan-days' }, cards));
  }

  function planPayload() {
    return planUi.tasks.filter((t) => !t.isSystem).map((t) => ({
      id: t.id || undefined, title: String(t.title || '').trim(), description: String(t.description || '').trim(),
      plannedDate: t.plannedDate || null, priority: t.priority || 'normal', carriedFromTaskId: t.carriedFromTaskId || undefined,
    }));
  }

  async function openPlanWizard(week) {
    const body = $('#plan-body');
    if (!body) return;
    planUi.week = week || planUi.week || 'next';
    planUi.msg = '';
    planUi.drafts = {};
    planUi.focus = null;
    renderLoading(body, 'plan');
    try {
      const data = await api('/plan?week=' + planUi.week);
      planUi.data = data;
      planUi.tasks = data.tasks.map((t) => ({ ...t }));
      planUi.carry = new Set();
      planUi.step = data.status === 'submitted' || data.editMode === 'readonly' ? 'done' : (data.carryOver.length && !data.tasks.length ? 'carry' : 'tasks');
      renderPlan();
    } catch (err) {
      renderError(body, err, () => openPlanWizard(planUi.week), 'retry-plan');
    }
  }

  function renderPlan() {
    const body = $('#plan-body');
    const data = planUi.data;
    if (!body || !data) return;
    body.removeAttribute('aria-busy');
    body.innerHTML = '';
    const mine = () => planUi.tasks.filter((t) => !t.isSystem);
    const steps = [['carry', 'انتقال'], ['tasks', 'تسک‌ها'], ['review', 'مرور']];
    const heading = $('#plan-title');
    heading.textContent = planUi.week === 'current' ? 'برنامه‌ی این هفته' : 'برنامه‌ی هفته‌ی بعد';
    heading.setAttribute('tabindex', '-1'); // با تغییر مرحله فوکوس به عنوان می‌رود تا خوانشگر مرحله‌ی تازه را اعلام کند
    if (planUi.focusTop) { planUi.focusTop = false; setTimeout(() => { if (typeof heading.focus === 'function') heading.focus(); }, 0); }
    body.appendChild(planEl('div', { class: 'plan-meta', text: `هفته‌ی ${fmtDate(data.weekStart)} تا ${fmtDate(data.weekEnd)}${data.planDay ? ' · روز ثبت برنامه: ' + fmtDate(data.planDay) : ''}` }));
    if (planUi.step !== 'done') body.appendChild(planEl('div', { class: 'plan-steps' }, steps.map(([k, l], i) => { const sp = planEl('span', { class: planUi.step === k ? 'on' : '', text: `${i + 1}. ${l}` }); if (planUi.step === k) sp.setAttribute('aria-current', 'step'); return sp; })));
    const msg = planEl('div', { class: 'form-msg' + (planUi.msg ? ' err' : ''), role: planUi.msg ? 'alert' : 'status', text: planUi.msg }); // خطا ⇒ alert تا خوانشگر اعلام کند
    const go = (step) => { planUi.step = step; planUi.msg = ''; planUi.focusTop = true; renderPlan(); };

    if (planUi.step === 'done') {
      const readonly = data.editMode === 'readonly';
      const card = planEl('div', { class: 'card' + (readonly ? ' plan-lock' : '') });
      if (readonly) card.appendChild(planEl('div', { role: 'status', text: data.lockReason === 'week_started' ? (planUi.msg || PLAN_LOCKED_MSG) : PLAN_MONTH_CLOSED_MSG }));
      else card.appendChild(planEl('div', { text: data.status === 'submitted' ? 'برنامه‌ی این هفته ثبت شده است ✅' : 'برنامه هنوز ثبت نشده است.' }));
      if (data.supervisorComment) card.appendChild(planEl('div', { class: 'plan-meta', text: 'یادداشت سرپرست: ' + data.supervisorComment }));
      body.appendChild(card);
      body.appendChild(planReadonlyBoard(data));
      if (!readonly) body.appendChild(planEl('button', { type: 'button', class: 'btn secondary', text: 'ویرایش برنامه', on: { click: () => go('tasks') } }));
      return;
    }

    if (planUi.step === 'carry') {
      body.appendChild(planEl('div', { class: 'card' }, planEl('div', { text: 'تسک‌های ناتمام هفته‌ی قبل — هر کدام را که می‌خواهید به این هفته منتقل شود، تیک بزنید.' })));
      data.carryOver.forEach((t) => {
        const cb = planEl('input', { type: 'checkbox', checked: planUi.carry.has(t.id), on: { change: (e) => { if (e.target.checked) planUi.carry.add(t.id); else planUi.carry.delete(t.id); } } });
        body.appendChild(planEl('label', { class: 'list-item plan-carry' }, cb, planEl('span', { text: t.title })));
      });
      body.appendChild(planEl('button', {
        type: 'button', class: 'btn primary', text: 'ادامه',
        on: { click: () => {
          data.carryOver.filter((t) => planUi.carry.has(t.id) && !planUi.tasks.some((x) => x.carriedFromTaskId === t.id))
            .forEach((t) => planUi.tasks.push({ title: t.title, description: t.description, plannedDate: null, priority: t.priority, carriedFromTaskId: t.id }));
          go('tasks');
        } },
      }));
      return;
    }

    if (planUi.step === 'tasks') {
      const days = planDays(data);
      const dayDates = new Set(days.map((d) => d.date));
      const label = (el, text) => { el.setAttribute('aria-label', text); return el; };
      const addTask = (init) => { planUi.tasks.push({ title: '', description: '', plannedDate: null, priority: 'normal', ...init }); renderPlan(); };
      const tools = planEl('div', { class: 'plan-chips' });
      if (data.previousWeekTasks.length) {
        tools.appendChild(planEl('button', { type: 'button', class: 'plan-chip', text: 'کپی از هفته‌ی قبل', on: { click: () => {
          data.previousWeekTasks.forEach((t) => { if (!mine().some((x) => x.title === t.title)) planUi.tasks.push({ title: t.title, description: t.description, plannedDate: null, priority: t.priority }); });
          renderPlan();
        } } }));
      }
      (data.frequentTitles || []).forEach((title) => tools.appendChild(planEl('button', { type: 'button', class: 'plan-chip', text: '+ ' + title, on: { click: () => addTask({ title }) } })));
      body.appendChild(tools);
      if (!mine().length) body.appendChild(planEl('div', { class: 'empty plan-empty', role: 'status', text: `هنوز تسکی برای این هفته ننوشته‌اید. از کارت هر روز شروع کنید${data.minTasks ? ` (حداقل ${data.minTasks} تسک لازم است)` : ''}.` }));
      body.appendChild(planEl('div', { class: 'plan-note' }, planEl('strong', { text: 'اولویت تسک‌ها' }), planEl('div', { text: PLAN_PRIORITY_NOTE })));

      // افزودن از فیلد بالای هر کارت؛ متن نیمه‌نوشته‌ی کارت‌ها بین رندرها در planUi.drafts می‌ماند
      const addFromDraft = (key, plannedDate) => {
        const title = String(planUi.drafts[key] || '').trim();
        planUi.focus = key;
        if (!title) { planUi.msg = 'عنوان تسک را بنویسید.'; renderPlan(); return; }
        if (title.length > 120) { planUi.msg = 'عنوان تسک حداکثر ۱۲۰ نویسه است.'; renderPlan(); return; }
        if (mine().length >= data.maxTasks) { planUi.msg = `حداکثر ${data.maxTasks} تسک مجاز است.`; renderPlan(); return; }
        planUi.drafts[key] = '';
        planUi.msg = '';
        planUi.tasks.push({ title, description: '', plannedDate, priority: 'normal' });
        renderPlan();
      };

      const taskRow = (t, idx, key, pos, dayText) => {
        const where = `${pos} — ${dayText}`;
        const badge = prioBadge(t.priority);
        const title = label(planEl('input', { type: 'text', dir: 'auto', class: 'day-task-title', maxLength: 120, value: t.title, placeholder: 'عنوان تسک', on: { input: (e) => { t.title = e.target.value; } } }), `عنوان تسک ${where}`);
        const rm = label(planEl('button', { type: 'button', class: 'day-task-del', text: 'حذف', on: { click: () => { planUi.tasks.splice(idx, 1); planUi.focus = key; renderPlan(); } } }), `حذف تسک ${where}`);
        const desc = label(planEl('textarea', { dir: 'auto', rows: 2, maxLength: 500, value: t.description || '', placeholder: 'توضیح (اختیاری)', on: { input: (e) => { t.description = e.target.value; } } }), `توضیح تسک ${where}`);
        // انتخاب اولویت: سه گزینه‌ی رادیویی (بالا/عادی/کم)؛ تغییر در همان‌جا اعمال می‌شود تا فوکوس کیبورد نپرد
        const help = planEl('p', { class: 'prio-help', text: PLAN_PRIORITY_HELP[planPrio(t.priority)] });
        help.setAttribute('aria-live', 'polite');
        const opts = PLAN_PRIORITY_ORDER.map((v) => {
          const input = planEl('input', { type: 'radio', name: `plan-prio-${idx}`, value: v, checked: planPrio(t.priority) === v });
          const opt = planEl('label', { class: `prio-opt prio-${v}${planPrio(t.priority) === v ? ' on' : ''}` }, input, planEl('span', { text: PLAN_PRIORITY[v] }));
          return { v, input, opt };
        });
        opts.forEach(({ v, input }) => input.addEventListener('change', () => {
          t.priority = v;
          opts.forEach((o) => { o.opt.className = `prio-opt prio-${o.v}${o.v === v ? ' on' : ''}`; });
          badge.className = 'prio-badge prio-' + v;
          badge.textContent = PLAN_PRIORITY[v];
          help.textContent = PLAN_PRIORITY_HELP[v];
        }));
        const group = planEl('fieldset', { class: 'prio-group' }, planEl('legend', { class: 'prio-legend', text: 'اولویت' }), planEl('div', { class: 'prio-opts' }, opts.map((o) => o.opt)), help);
        group.setAttribute('aria-label', `اولویت تسک ${where}`);
        const day = label(planEl('select', { on: { change: (e) => { t.plannedDate = e.target.value || null; renderPlan(); } } },
          [planEl('option', { value: '', text: 'بدون روز مشخص', selected: !t.plannedDate }), ...days.map((d) => planEl('option', { value: d.date, text: fmtPlanDay(d.date), selected: t.plannedDate === d.date }))]), `روز تسک ${where}`);
        const more = planEl('details', { class: 'day-task-more' }, planEl('summary', { text: 'توضیح و جابه‌جایی روز' }), desc, planEl('div', { class: 'row' }, day));
        return planEl('li', { class: 'day-task' }, planEl('div', { class: 'day-task-main' }, badge, title, rm), group, more);
      };

      const dayCard = (key, titleText, badge, plannedDate, matches, extra) => {
        const items = planUi.tasks.map((t, idx) => [t, idx]).filter(([t]) => !t.isSystem && matches(t));
        const list = planEl('ul', { class: 'day-list' }, (extra || []), items.map(([t, idx], pos) => taskRow(t, idx, key, pos + 1, titleText)));
        const add = label(planEl('input', {
          type: 'text', dir: 'auto', class: 'day-add-input', maxLength: 120, value: planUi.drafts[key] || '', placeholder: 'تسک جدید…',
          on: { input: (e) => { planUi.drafts[key] = e.target.value; }, keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromDraft(key, plannedDate); } } },
        }), `تسک جدید برای ${titleText}`);
        if (planUi.focus === key) { planUi.focus = null; setTimeout(() => { if (typeof add.focus === 'function') add.focus(); }, 0); }
        const head = planEl('div', { class: 'day-card-head' }, planEl('h4', { class: 'day-card-title', id: 'plan-card-' + key, text: titleText }), badge ? planEl('span', { class: 'day-badge', text: badge }) : null);
        const section = planEl('section', { class: 'day-card' }, head,
          planEl('div', { class: 'day-add' }, add, planEl('button', { type: 'button', class: 'btn primary day-add-btn', text: '+ افزودن', on: { click: () => addFromDraft(key, plannedDate) } })),
          items.length || (extra || []).length ? list : planEl('p', { class: 'day-empty', text: 'هنوز تسکی ندارد.' }));
        section.setAttribute('aria-labelledby', 'plan-card-' + key);
        return section;
      };

      const sysRows = planUi.tasks.filter((t) => t.isSystem).map((t) => planEl('li', { class: 'day-task plan-sys', text: 'تسک خودکار: ' + t.title }));
      const cards = [dayCard('any', 'هر روز / بدون روز مشخص', '', null, (t) => !t.plannedDate || !dayDates.has(t.plannedDate), sysRows)];
      days.forEach((d) => {
        const has = planUi.tasks.some((t) => !t.isSystem && t.plannedDate === d.date);
        if ((d.kind === 'weekend' || d.kind === 'holiday') && !has) return; // روز تعطیلِ بدون تسک کارت ندارد
        cards.push(dayCard(d.date, fmtPlanDay(d.date), PLAN_DAY_BADGE[d.kind] || '', d.date, (t) => t.plannedDate === d.date));
      });
      body.appendChild(planEl('div', { class: 'plan-board' }, planEl('div', { class: 'plan-days' }, cards)));
      body.appendChild(msg);
      body.appendChild(planEl('button', {
        type: 'button', class: 'btn primary', text: 'مرور',
        on: { click: () => { const e = planValidate(planUi.tasks, data); if (e) { planUi.msg = e; renderPlan(); return; } if (mine().length < data.minTasks) { planUi.msg = `حداقل ${data.minTasks} تسک لازم است.`; renderPlan(); return; } go('review'); } },
      }));
      return;
    }

    // review
    body.appendChild(planEl('div', { class: 'card' }, planEl('div', { text: `${mine().length} تسک برای این هفته ثبت می‌شود:` })));
    mine().forEach((t) => body.appendChild(planEl('div', { class: 'list-item' }, planEl('div', { class: 'day-task-main' }, prioBadge(t.priority), planEl('span', { text: t.title })), planEl('div', { class: 'plan-meta', text: t.plannedDate ? fmtDate(t.plannedDate) : 'هر روز' }))));
    const submitBtn = planEl('button', { type: 'button', class: 'btn primary', text: 'ثبت برنامه' });
    submitBtn.addEventListener('click', async () => {
      try {
        await withBusy(submitBtn, async () => {
          await api('/plan', { method: 'PUT', body: { week: planUi.week, tasks: planPayload() } });
          return api('/plan/submit', { method: 'POST', body: { week: planUi.week } });
        });
        showToast('برنامه‌ی هفتگی ثبت شد.');
        planUi.focusTop = true;
        await openPlanWizard(planUi.week);
        if (typeof planUi.onSubmitted === 'function') { const cb = planUi.onSubmitted; planUi.onSubmitted = null; cb(); }
      } catch (err) {
        const code = err.data && err.data.code;
        if (code === 'PLAN_LOCKED' || code === 'MONTH_CLOSED') {
          // هفته بین ویرایش و ثبت شروع شد/ماه بسته شد ⇒ وضعیت تازه را بگیر (فقط‌خواندنی) و پیام سرور را نشان بده
          await openPlanWizard(planUi.week);
          planUi.msg = err.message;
          renderPlan();
          return;
        }
        planUi.msg = err.message; renderPlan();
      }
    });
    body.appendChild(planEl('button', { type: 'button', class: 'btn secondary', text: 'بازگشت به ویرایش', on: { click: () => go('tasks') } }));
    body.appendChild(submitBtn);
    body.appendChild(msg);
  }

  const planBack = $('#plan-back');
  if (planBack && typeof planBack.addEventListener === 'function') planBack.addEventListener('click', () => switchView('today'));

  // ---------- گزارش روزانه‌ی تسک‌ها (D7-ب): ویزارد «یک‌سؤال‌یک‌صفحه» ----------
  // دو حالت: checkout (قبل از خروج؛ پاسخ‌ها همراه /check-out می‌روند) و late (بعد از خروج/backfill؛ /daily-report با date).
  // سرور تا رد شدن همه‌ی گیت‌ها چیزی ذخیره نمی‌کند ⇒ UI پاسخ‌ها را در حافظه نگه می‌دارد و همان بدنه را دوباره می‌فرستد.
  const DR = window.DailyReport;
  const reportUi = { mode: 'checkout', date: '', today: '', tasks: [], answers: new Map(), extras: [], step: 'q', idx: 0, allowLater: false, body: null, msg: '', busy: false, teamReview: null, team: null, reviewDraft: new Map() };

  function dEl(tag, props, ...kids) {
    const e = planEl(tag, props, ...kids);
    if (props && props.attrs) Object.entries(props.attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }

  function reportAnswer(taskId) {
    if (!reportUi.answers.has(taskId)) reportUi.answers.set(taskId, DR.emptyAnswer());
    return reportUi.answers.get(taskId);
  }

  function hasReportBody(body) { return !!body && (Array.isArray(body.answers) && body.answers.length > 0 || Array.isArray(body.extra) && body.extra.length > 0); }

  function openReportWizard({ mode, date, today, tasks, body, allowLater, teamReview }) {
    const same = reportUi.date === date && reportUi.mode === mode;
    const kept = same ? reportUi.answers : new Map();
    reportUi.mode = mode; reportUi.date = date; reportUi.today = today || date;
    reportUi.tasks = tasks || [];
    reportUi.answers = new Map([...kept, ...DR.seedFromBody(reportUi.tasks, body)]);
    if (body && Array.isArray(body.extra) && body.extra.length) reportUi.extras = body.extra.map((e) => ({ title: e.title || '', description: e.description || '' }));
    else if (!same) reportUi.extras = [];
    reportUi.allowLater = !!allowLater;
    reportUi.body = body || null;
    reportUi.msg = '';
    reportUi.busy = false;
    reportUi.teamReview = teamReview || null; // D9: مشاهده‌نشده‌ها/گزارش‌نداده‌ها برای تسک سیستمیِ سرپرست
    reportUi.team = null;
    // اول اولین تسکِ «مانع» (الزامی بدون پاسخ معتبر)؛ اگر نبود، اولین اختیاریِ دیده‌نشده تا کاربر بتواند پاسخش بدهد یا رد کند
    const blockIdx = reportUi.tasks.findIndex((t) => DR.unanswered([t], reportUi.answers, { today: reportUi.today }).length > 0);
    const optIdx = reportUi.tasks.findIndex((t) => DR.isOptional(t) && !reportUi.answers.has(t.id));
    const firstOpen = blockIdx >= 0 ? blockIdx : optIdx;
    reportUi.idx = firstOpen < 0 ? 0 : firstOpen;
    reportUi.step = !reportUi.tasks.length ? 'extra' : (firstOpen < 0 ? 'review' : 'q');
    switchView('dreport');
    renderReport();
  }

  function openReportConfirm(body) {
    reportUi.step = 'confirm'; reportUi.body = body; reportUi.msg = '';
    switchView('dreport');
    renderReport();
  }

  // checkout: اگر تسکِ پاسخ‌نداده هست و حالت soft است، اول ویزارد با «بعداً پر می‌کنم»؛ در enforce سرور با 409 ویزارد را باز می‌کند
  async function startCheckout() {
    try {
      const d = await api('/daily-tasks');
      if (d && d.mode === 'soft' && !d.fullDayOff && d.tasks && d.tasks.length) {
        openReportWizard({ mode: 'checkout', date: d.date, today: d.today, tasks: d.tasks, body: null, allowLater: true, teamReview: d.teamReview });
        return;
      }
    } catch (_) { /* پیش‌بررسی اختیاری است؛ تصمیم نهایی با /check-out */ }
    doAction('/check-out', {}, 'خروج ثبت شد.');
  }

  async function openLateReport(date) {
    try {
      const d = await api('/daily-tasks?date=' + encodeURIComponent(date));
      if (!d.tasks || !d.tasks.some((t) => !t.optional)) { showToast('تسک بدون پاسخی برای این روز نمانده است.'); loadReportBanner(); return; } // A2: اختیاری‌ها «بدون پاسخ» حساب نمی‌شوند
      openReportWizard({ mode: 'late', date: d.date, today: d.today, tasks: d.tasks, body: null, allowLater: false, teamReview: d.teamReview });
    } catch (err) { showToast(err.message, true); }
  }

  // بنر «گزارش‌های تکمیل‌نشده» (backfill/soft)؛ خطای آن هرگز نمای امروز را نمی‌شکند
  async function loadReportBanner() {
    const box = $('#report-banner');
    if (!box) return;
    try {
      const g = await api('/report-backfill');
      box.textContent = '';
      if (!g || !g.days || !g.days.length) { box.classList.add('hidden'); return; }
      g.days.forEach((d) => {
        const msg = d.source === 'backfill'
          ? `خروج ${fmtDate(d.date)} به‌صورت خودکار بسته شد و گزارش ${d.pendingCount.toLocaleString('fa-IR')} تسک ثبت نشده است. تا ${(g.backfillDays || 0).toLocaleString('fa-IR')} روز می‌توانید تکمیل کنید.`
          : `گزارش ${d.pendingCount.toLocaleString('fa-IR')} تسکِ ${fmtDate(d.date)} هنوز ثبت نشده است؛ تا ۲۴ ساعت بعد از خروج می‌توانید تکمیل کنید.`;
        box.appendChild(dEl('div', { text: msg }));
        box.appendChild(dEl('button', { type: 'button', class: 'btn primary', text: 'تکمیل گزارش', on: { click: () => openLateReport(d.date) } }));
      });
      box.classList.remove('hidden');
    } catch (_) { box.classList.add('hidden'); }
  }

  // ---- D9: بررسی گزارش تیم (تسک سیستمیِ سرپرست) ----
  const reviewDraftOf = (userId) => {
    if (!reportUi.reviewDraft.has(userId)) reportUi.reviewDraft.set(userId, { comment: '', reaction: '' });
    return reportUi.reviewDraft.get(userId);
  };

  // بعد از مشاهده‌ی همه: سرور تسک را done کرده؛ فهرست تازه می‌گیریم و ویزارد را با همان پاسخ‌های قبلی دوباره باز می‌کنیم
  async function refreshAfterReview() {
    const ui = reportUi;
    const q = ui.mode === 'late' ? '?date=' + encodeURIComponent(ui.date) : '';
    const d = await api('/daily-tasks' + q);
    showToast('گزارش همه‌ی اعضای دارای گزارش مشاهده شد.');
    openReportWizard({ mode: ui.mode, date: d.date, today: d.today, tasks: d.tasks || [], body: null, allowLater: ui.allowLater, teamReview: d.teamReview });
  }

  // «الان بررسی می‌کنم»: وضعیت تازه‌ی تیم را (با خلاصه‌ی گزارش‌ها) می‌گیرد؛ چیزی برای بررسی نمانده ⇒ مستقیم ادامه‌ی ویزارد
  async function openTeamStep() {
    const ui = reportUi;
    try {
      const q = ui.teamReview && ui.teamReview.reviewDate ? '&date=' + encodeURIComponent(ui.teamReview.reviewDate) : '';
      const r = await api('/team-review?detail=1' + q);
      const members = r.members || [];
      ui.team = { reviewDate: r.reviewDate, unreviewed: members.filter((m) => m.status === 'unreviewed'), noReport: members.filter((m) => m.status === 'no_report') };
      if (!r.reviewDate || !ui.team.unreviewed.length) { await refreshAfterReview(); return; }
      ui.step = 'team'; ui.msg = '';
      renderReport();
    } catch (err) { ui.msg = err.message; renderReport(); }
  }

  function radioChip(name, value, label, checked, onChange, extraClass) {
    const input = dEl('input', { type: 'radio', name, value, checked: !!checked, on: { change: () => onChange(value) } });
    return dEl('label', { class: 'dr-opt' + (extraClass ? ' ' + extraClass : '') + (checked ? ' on' : '') }, input, dEl('span', { text: label }));
  }

  function renderReport() {
    const body = $('#dreport-body');
    if (!body) return;
    body.innerHTML = '';
    const ui = reportUi;
    const opts = { today: ui.today };
    const total = ui.tasks.length;
    const heading = (text) => dEl('h4', { class: 'dr-q', id: 'dr-heading', text, attrs: { tabindex: '-1' } });
    const msg = dEl('div', { class: 'form-msg' + (ui.msg ? ' err' : ''), text: ui.msg, attrs: { role: 'status', 'aria-live': 'polite' } });
    $('#dreport-title').textContent = ui.mode === 'late' ? `تکمیل گزارش ${fmtDate(ui.date)}` : 'گزارش تسک‌های امروز';
    const focusHeading = () => { const h = $('#dr-heading'); if (h && h.focus) h.focus(); };
    const fail = (m) => { ui.msg = m; renderReport(); };
    // soft: «بعداً پر می‌کنم» از هر مرحله؛ فقط پاسخ‌های معتبرِ تا اینجا همراه خروج می‌رود و بقیه تا ۲۴ ساعت قابل تکمیل است
    const laterBtn = () => {
      const b = dEl('button', { type: 'button', class: 'btn warning', text: 'بعداً پر می‌کنم' });
      b.addEventListener('click', () => withBusy(b, () => doAction('/check-out', DR.buildBody({ tasks: ui.tasks, answers: ui.answers, extras: ui.extras }, opts), 'خروج ثبت شد.')));
      return b;
    };

    if (ui.step === 'q') {
      const t = ui.tasks[ui.idx];
      const a = reportAnswer(t.id);
      const card = dEl('div', { class: 'card dr-card' });
      card.appendChild(dEl('div', { class: 'dr-progress', text: `سؤال ${(ui.idx + 1).toLocaleString('fa-IR')} از ${total.toLocaleString('fa-IR')}`, attrs: { role: 'status' } }));
      const isReview = DR.isReviewTask(t); // D9: تسک سیستمیِ سرپرست؛ «انجام شد» فقط با مشاهده‌ی واقعی گزارش‌ها
      const optional = DR.isOptional(t); // A2: تسک اولویت کم؛ مانع خروج نیست و جدا از الزامی‌ها (آخر فهرست) می‌آید
      if (optional && !(ui.idx > 0 && DR.isOptional(ui.tasks[ui.idx - 1]))) card.appendChild(dEl('div', { class: 'dr-sep', text: 'تسک‌های اختیاری (جدا از الزامی‌ها)' }));
      card.appendChild(heading(isReview ? 'گزارش روز قبلِ تیم را بررسی کرده‌اید؟' : `امروز تسک «${t.title}» انجام شد؟`));
      if (t.priority === 'high') card.appendChild(dEl('span', { class: 'chip chip-orange', text: 'اولویت بالا' }));
      if (optional) {
        card.appendChild(dEl('span', { class: 'dr-tag', text: 'اختیاری' }));
        card.appendChild(dEl('div', { class: 'plan-meta', text: 'اولویتِ این تسک کم است و ثبت خروج را مسدود نمی‌کند؛ اگر نخواستید پاسخ بدهید رد کنید.' }));
      }
      if (t.description && !isReview) card.appendChild(dEl('div', { class: 'plan-meta', text: t.description }));

      if (isReview) {
        const info = ui.teamReview;
        if (info) {
          const un = info.unreviewed || [];
          const nr = info.noReport || [];
          card.appendChild(dEl('div', { class: 'plan-meta', text: `گزارش‌های ${fmtDate(info.reviewDate)}` }));
          card.appendChild(dEl('div', { class: 'rv-group', text: `مشاهده‌نشده (${un.length.toLocaleString('fa-IR')}): ${un.map((m) => m.fullName).join('، ') || '—'}` }));
          if (nr.length) card.appendChild(dEl('div', { class: 'plan-meta', text: `گزارش نداده‌اند (شرط تکمیل نیست): ${nr.map((m) => m.fullName).join('، ')}` }));
        }
        const choice = dEl('div', { class: 'dr-nav' });
        choice.appendChild(dEl('button', { type: 'button', class: 'btn primary', text: 'الان بررسی می‌کنم', on: { click: () => { openTeamStep(); } } }));
        choice.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: '❌ انجام نشد + علت', attrs: { 'aria-pressed': a.status === 'not_done' ? 'true' : 'false' }, on: { click: () => { a.status = 'not_done'; ui.msg = ''; renderReport(); } } }));
        card.appendChild(choice);
      } else {
        const st = dEl('fieldset', { class: 'dr-fieldset dr-status' }, dEl('legend', { class: 'sr-only', text: 'وضعیت تسک' }));
        DR.STATUS.forEach((s) => st.appendChild(radioChip('dr-status', s.value, `${s.icon} ${s.label}`, a.status === s.value, (v) => { a.status = v; ui.msg = ''; renderReport(); }, 'dr-opt-' + s.value)));
        card.appendChild(st);
      }

      if (a.status && a.status !== 'done') {
        const rs = dEl('fieldset', { class: 'dr-fieldset' }, dEl('legend', { text: 'علت' }));
        const chips = dEl('div', { class: 'dr-chips' });
        DR.REASONS.forEach((r) => chips.appendChild(radioChip('dr-reason', r.value, r.label, a.reasonCode === r.value, (v) => { a.reasonCode = v; ui.msg = ''; renderReport(); })));
        rs.appendChild(chips);
        card.appendChild(rs);
        const otherNeeded = a.reasonCode === 'other';
        card.appendChild(dEl('label', { class: 'dr-label', htmlFor: 'dr-reason-text', text: otherNeeded ? `توضیح علت (الزامی، حداقل ${DR.LIMITS.otherMin.toLocaleString('fa-IR')} نویسه)` : 'توضیح بیشتر (اختیاری)' }));
        card.appendChild(dEl('textarea', {
          id: 'dr-reason-text', rows: 3, maxLength: DR.LIMITS.reasonText, value: a.reasonText,
          on: { input: (e) => { a.reasonText = e.target.value; } },
        }));
        if (!isReview) { // تسک سیستمی انتقال/حذف ندارد
          const rsch = dEl('fieldset', { class: 'dr-fieldset' }, dEl('legend', { text: 'این تسک چه شود؟' }));
          const rchips = dEl('div', { class: 'dr-chips' });
          DR.RESCHEDULE.forEach((r) => rchips.appendChild(radioChip('dr-res', r.value, r.label, a.resType === r.value, (v) => { a.resType = v; ui.msg = ''; renderReport(); })));
          rsch.appendChild(rchips);
          if (a.resType === 'date') {
            const sel = dEl('select', { id: 'dr-res-date', on: { change: (e) => { a.resDate = e.target.value; } }, attrs: { 'aria-label': 'تاریخ انتقال' } });
            sel.appendChild(dEl('option', { value: '', text: 'انتخاب تاریخ…' }));
            DR.futureDates(ui.today, 30).forEach((d) => sel.appendChild(dEl('option', { value: d, text: fmtDate(d), selected: a.resDate === d })));
            rsch.appendChild(sel);
          }
          card.appendChild(rsch);
        }
      }
      card.appendChild(msg);
      const nav = dEl('div', { class: 'dr-nav' });
      if (ui.idx > 0) nav.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'قبلی', on: { click: () => { ui.idx -= 1; ui.msg = ''; renderReport(); } } }));
      const skipping = optional && !a.status; // اختیاریِ دست‌نخورده: «رد کردن» بدون اعتبارسنجی؛ اگر وضعیتی زده شده، اعتبارسنجیِ معمول
      const lastOne = ui.idx === total - 1;
      nav.appendChild(dEl('button', {
        type: 'button', class: 'btn primary', text: skipping ? (lastOne ? 'رد کردن و ادامه' : 'رد کردن') : (lastOne ? 'ادامه' : 'بعدی'),
        on: { click: () => { if (!skipping) { const e = DR.validateAnswer(a, DR.taskOpts(t, opts)); if (e) { fail(e); return; } } ui.msg = ''; if (lastOne) ui.step = 'extra'; else ui.idx += 1; renderReport(); } },
      }));
      if (ui.allowLater) nav.appendChild(laterBtn());
      card.appendChild(nav);
      body.appendChild(card);
      focusHeading();
      return;
    }

    if (ui.step === 'team') { // D9: «الان بررسی می‌کنم» — هر گزارش جدا «مشاهده شد» می‌خورد (کامنت/واکنش اختیاری)
      const team = ui.team || { reviewDate: '', unreviewed: [], noReport: [] };
      const card = dEl('div', { class: 'card dr-card' });
      card.appendChild(heading(`گزارش‌های ${fmtDate(team.reviewDate)} تیم`));
      card.appendChild(dEl('div', { class: 'plan-meta', text: `${team.unreviewed.length.toLocaleString('fa-IR')} گزارش مشاهده‌نشده · کامنت و واکنش اختیاری است.` }));
      team.unreviewed.forEach((m) => {
        const draft = reviewDraftOf(m.userId);
        const row = dEl('div', { class: 'list-item rv-member' });
        row.appendChild(dEl('strong', { text: m.fullName }));
        const line = DR.reportLine(m.report);
        if (line) row.appendChild(dEl('div', { class: 'plan-meta', text: line }));
        const items = (m.report && m.report.items) || [];
        if (items.length) {
          const det = dEl('details', { class: 'rv-items' }, dEl('summary', { text: 'جزئیات گزارش' }));
          items.forEach((it) => {
            const s = DR.STATUS.find((x) => x.value === it.status);
            const reason = DR.REASONS.find((x) => x.value === it.reasonCode);
            det.appendChild(dEl('div', { class: 'plan-meta', text: [`${s ? s.icon : '⚪'} ${it.title}${it.outOfPlan ? ' (خارج از برنامه)' : ''}`, reason && it.status !== 'done' ? reason.label : '', it.reasonText || ''].filter(Boolean).join(' — ') }));
          });
          row.appendChild(det);
        }
        const chips = dEl('div', { class: 'dr-chips', attrs: { role: 'radiogroup', 'aria-label': `واکنش به گزارش ${m.fullName}` } });
        [{ value: '', label: 'بدون واکنش', icon: '' }, ...DR.REVIEW_REACTIONS].forEach((r) => chips.appendChild(radioChip(`rv-react-${m.userId}`, r.value, `${r.icon} ${r.label}`.trim(), draft.reaction === r.value, (v) => {
          draft.reaction = v; // بدون رندر مجدد تا فوکوس/متنِ تایپ‌شده نپرد
          chips.querySelectorAll('.dr-opt').forEach((el) => { const inp = el.querySelector('input'); el.classList.toggle('on', !!inp && inp.value === v); });
        })));
        row.appendChild(chips);
        row.appendChild(dEl('textarea', { rows: 2, maxLength: DR.LIMITS.reviewComment, value: draft.comment, placeholder: 'کامنت برای همکار (اختیاری؛ برایش ارسال می‌شود)', on: { input: (e) => { draft.comment = e.target.value; } }, attrs: { 'aria-label': `کامنت برای ${m.fullName}` } }));
        const seen = dEl('button', { type: 'button', class: 'btn primary', text: '✔ مشاهده شد' });
        seen.addEventListener('click', () => withBusy(seen, async () => {
          const bad = DR.validateReview(draft);
          if (bad) { fail(bad); return; }
          try {
            const hadComment = !!String(draft.comment || '').trim();
            const res = await api('/report-reviews', { method: 'POST', body: DR.buildReviewBody({ subjectUserId: m.userId, reportDate: team.reviewDate, comment: draft.comment, reaction: draft.reaction }) });
            team.unreviewed = team.unreviewed.filter((x) => x.userId !== m.userId);
            ui.reviewDraft.delete(m.userId);
            if (res && res.state && res.state.complete || !team.unreviewed.length) { await refreshAfterReview(); return; }
            showToast(hadComment ? 'مشاهده شد؛ کامنت برای همکار ارسال می‌شود.' : 'مشاهده شد.');
            ui.msg = '';
            renderReport();
          } catch (err) { ui.msg = err.message; renderReport(); }
        }));
        row.appendChild(seen);
        card.appendChild(row);
      });
      if (team.noReport.length) card.appendChild(dEl('div', { class: 'plan-meta', text: `گزارش نداده‌اند (شرط تکمیل نیست): ${team.noReport.map((m) => m.fullName).join('، ')}` }));
      card.appendChild(msg);
      const nav = dEl('div', { class: 'dr-nav' });
      nav.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'بازگشت', on: { click: () => { ui.step = 'q'; ui.msg = ''; renderReport(); } } }));
      card.appendChild(nav);
      body.appendChild(card);
      focusHeading();
      return;
    }

    if (ui.step === 'extra') {
      const card = dEl('div', { class: 'card dr-card' });
      card.appendChild(heading('کار خارج از برنامه'));
      card.appendChild(dEl('div', { class: 'plan-meta', text: 'کاری انجام دادید که در برنامه نبود؟ (اختیاری)' }));
      ui.extras.forEach((x, i) => {
        const row = dEl('div', { class: 'plan-task' });
        row.appendChild(dEl('input', { type: 'text', value: x.title, maxLength: DR.LIMITS.extraTitle, placeholder: 'عنوان کار', on: { input: (e) => { x.title = e.target.value; } }, attrs: { 'aria-label': `عنوان کار خارج از برنامه ${i + 1}` } }));
        row.appendChild(dEl('textarea', { rows: 2, value: x.description, maxLength: DR.LIMITS.extraDesc, placeholder: 'توضیح (اختیاری)', on: { input: (e) => { x.description = e.target.value; } }, attrs: { 'aria-label': `توضیح کار خارج از برنامه ${i + 1}` } }));
        row.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'حذف', on: { click: () => { ui.extras.splice(i, 1); renderReport(); } } }));
        card.appendChild(row);
      });
      if (ui.extras.length < DR.LIMITS.maxExtra) card.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: '+ افزودن کار', on: { click: () => { ui.extras.push({ title: '', description: '' }); renderReport(); } } }));
      card.appendChild(msg);
      const nav = dEl('div', { class: 'dr-nav' });
      if (total) nav.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'قبلی', on: { click: () => { ui.step = 'q'; ui.idx = total - 1; ui.msg = ''; renderReport(); } } }));
      nav.appendChild(dEl('button', {
        type: 'button', class: 'btn primary', text: 'مرور',
        on: { click: () => {
          ui.extras = ui.extras.filter((x) => String(x.title || '').trim() || String(x.description || '').trim());
          const bad = ui.extras.map((x) => DR.validateExtra(x)).find(Boolean);
          if (bad) { fail(bad); return; }
          ui.msg = ''; ui.step = 'review'; renderReport();
        } },
      }));
      if (ui.allowLater) nav.appendChild(laterBtn());
      card.appendChild(nav);
      body.appendChild(card);
      focusHeading();
      return;
    }

    if (ui.step === 'confirm') {
      const card = dEl('div', { class: 'card dr-card' });
      card.appendChild(heading('تأیید خروج'));
      card.appendChild(dEl('div', { text: 'گزارش امروز و برنامه‌ی هفته‌ی بعد آماده است. خروج را تأیید می‌کنید؟' }));
      card.appendChild(msg);
      const nav = dEl('div', { class: 'dr-nav' });
      nav.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'انصراف', on: { click: () => switchView('today') } }));
      const ok = dEl('button', { type: 'button', class: 'btn primary', text: 'تأیید خروج' });
      ok.addEventListener('click', () => withBusy(ok, async () => { await doAction('/check-out', ui.body || {}, 'خروج ثبت شد.'); }));
      nav.appendChild(ok);
      card.appendChild(nav);
      body.appendChild(card);
      focusHeading();
      return;
    }

    // review
    const sum = DR.summarize(ui.tasks, ui.answers);
    const missing = DR.unanswered(ui.tasks, ui.answers, opts);
    const card = dEl('div', { class: 'card dr-card' });
    card.appendChild(heading('مرور گزارش'));
    const skippedOpt = DR.skippedOptional(ui.tasks, ui.answers);
    card.appendChild(dEl('div', { class: 'plan-meta', text: `${sum.done.toLocaleString('fa-IR')} انجام شد · ${sum.partial.toLocaleString('fa-IR')} نیمه‌کاره · ${sum.not_done.toLocaleString('fa-IR')} انجام نشد${sum.missing ? ' · ' + sum.missing.toLocaleString('fa-IR') + ' بدون پاسخ' : ''}${skippedOpt ? ' · ' + skippedOpt.toLocaleString('fa-IR') + ' اختیاری رد شد' : ''}` }));
    ui.tasks.forEach((t, i) => {
      const a = ui.answers.get(t.id);
      const s = a && DR.STATUS.find((x) => x.value === a.status);
      if (DR.isOptional(t) && !(i > 0 && DR.isOptional(ui.tasks[i - 1]))) card.appendChild(dEl('div', { class: 'dr-sep', text: 'اختیاری' })); // A2: جدا از الزامی‌ها
      const row = dEl('div', { class: 'list-item dr-review-row' });
      row.appendChild(dEl('div', { text: `${s ? s.icon : '⚪'} ${t.title}${DR.isOptional(t) ? ' (اختیاری)' : ''}` }));
      if (a && a.status && a.status !== 'done') {
        const r = DR.REASONS.find((x) => x.value === a.reasonCode);
        row.appendChild(dEl('div', { class: 'plan-meta', text: [r ? r.label : '', String(a.reasonText || '').trim()].filter(Boolean).join(' — ') }));
      }
      row.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'ویرایش', on: { click: () => { ui.step = 'q'; ui.idx = i; ui.msg = ''; renderReport(); } } }));
      card.appendChild(row);
    });
    if (ui.extras.length) card.appendChild(dEl('div', { class: 'plan-meta', text: `${ui.extras.length.toLocaleString('fa-IR')} کار خارج از برنامه` }));
    card.appendChild(msg);
    const nav = dEl('div', { class: 'dr-nav' });
    nav.appendChild(dEl('button', { type: 'button', class: 'btn secondary', text: 'قبلی', on: { click: () => { ui.step = 'extra'; ui.msg = ''; renderReport(); } } }));
    const bodyOf = () => DR.buildBody({ tasks: ui.tasks, answers: ui.answers, extras: ui.extras, date: ui.mode === 'late' ? ui.date : undefined }, opts);
    if (ui.mode === 'checkout') {
      const go = dEl('button', { type: 'button', class: 'btn primary', text: 'ثبت گزارش و خروج', disabled: missing.length > 0 });
      go.addEventListener('click', () => withBusy(go, () => doAction('/check-out', bodyOf(), 'خروج ثبت شد.')));
      nav.appendChild(go);
      if (ui.allowLater) nav.appendChild(laterBtn());
    } else {
      const b = bodyOf();
      const send = dEl('button', { type: 'button', class: 'btn primary', text: 'ثبت گزارش', disabled: !(b.answers.length || b.extra.length) });
      send.addEventListener('click', () => withBusy(send, async () => {
        try {
          const res = await api('/daily-report', { method: 'POST', body: bodyOf() });
          const cheer = DR.encouragementOf(res);
          const left = res && res.tasks ? res.tasks.filter((t) => !t.optional).length : 0; // A2: اختیاری‌ها «هنوز بدون پاسخ» حساب نمی‌شوند
          showToast([left ? `گزارش ثبت شد؛ ${left.toLocaleString('fa-IR')} تسک هنوز بدون پاسخ است.` : 'گزارش ثبت شد.', cheer].filter(Boolean).join(' '));
          reportUi.answers = new Map(); reportUi.extras = [];
          switchView('today');
          loadReportBanner();
        } catch (err) { ui.msg = err.message; renderReport(); }
      }));
      nav.appendChild(send);
    }
    card.appendChild(nav);
    body.appendChild(card);
    focusHeading();
  }

  const dreportBack = $('#dreport-back');
  if (dreportBack && typeof dreportBack.addEventListener === 'function') dreportBack.addEventListener('click', () => switchView('today'));

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
      await withBusy(form.querySelector('[type="submit"]'), () => api('/dispute', {
        method: 'POST',
        body: { message: form.message.value },
      }));
      msg.textContent = 'اعتراض شما برای ادمین ارسال شد.';
      msg.classList.add('ok');
      form.reset();
      loadDisputeList();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('err');
    }
  });

  // ---------- «اعتراض‌های من» و گفت‌وگو (D5) ----------
  // قواعد (چه کسی می‌تواند پیام بدهد/ادامه دهد/ببندد، سقف ادامه، ماه بسته) فقط سمت سرور است (GET/POST /miniapp/dispute*)؛
  // این بخش فقط flagهای can_reply / can_reopen / can_close پاسخ را نشان می‌دهد و پیام خطای سرور را بی‌تغییر نمایش می‌دهد.
  // «پیام خوانده‌نشده» سمت کلاینت است (سرور وضعیت خواندن ندارد): اثرانگشتِ آخرین وضعیتِ دیده‌شده‌ی هر اعتراض در localStorage.
  const DISPUTE_SEEN_PREFIX = 'attendance_dispute_seen:';
  const DISPUTE_MSG_MAX = 500; // همان سقف سرور (disputeService.MESSAGE_MAX)
  const DISPUTE_PHASES = {
    open: ['باز', 'dsp-open'],
    answered: ['پاسخ داده شده', 'dsp-answered'],
    resolved: ['حل‌شده', 'dsp-resolved'],
    closed_by_user: ['خاتمه‌یافته', 'dsp-closed'],
  };
  // بعد از این خطاها وضعیت اعتراض سمت سرور فرق کرده؛ thread را تازه می‌گیریم و پیام سرور می‌ماند
  const DISPUTE_STALE_CODES = ['DISPUTE_CLOSED', 'DISPUTE_NOT_CLOSED', 'DISPUTE_ALREADY_CLOSED'];
  const disputeUi = { id: null, data: null, mode: 'idle', draft: '', msg: '', listSeq: 0, threadSeq: 0 }; // mode: idle | confirmClose | reopen

  function dEl(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function dBtn(text, cls, onClick) {
    const b = dEl('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');

  // «YYYY-MM-DD HH:MM:SS» (UTC دیتابیس) ⇒ «۱۵ مهر ۱۴۰۵ ۱۴:۳۰» به وقت دستگاه
  function fmtDateTime(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s == null ? '' : s));
    if (!m) return s ? String(s) : '—';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    if (Number.isNaN(d.getTime())) return String(s);
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return `${fmtDate(iso)} ${fmtClock(d.toISOString())}`;
  }

  // اثرانگشت آخرین وضعیت؛ با هر پیام/بستن/بازشدن عوض می‌شود
  const disputeFingerprint = (d) => [d.message_count, d.last_message_at, d.status, d.closed_by || '', d.closed_at || ''].join('|');
  // آخرین رویداد از طرف ادمین بوده؟ باز: آخرین پیام ادمین؛ بسته: closed_by === 'admin' (NULL/user ⇒ نه)
  const disputeFromAdmin = (d) => (d.status === 'open' ? d.last_sender_role === 'admin' : d.closed_by === 'admin');
  const disputeIsUnread = (d, seen) => disputeFromAdmin(d) && seen[d.id] !== disputeFingerprint(d);

  function disputeSeenKey() { return DISPUTE_SEEN_PREFIX + (state.me && state.me.id != null ? state.me.id : '0'); }
  // ⇒ { map, fresh }؛ fresh = هنوز هیچ‌چیز ذخیره نشده. حافظه‌ی در دسترس نبود ⇒ { map: {}, fresh: false } (بدون نوشتن)
  function readDisputeSeen() {
    try {
      const raw = window.localStorage.getItem(disputeSeenKey());
      if (raw === null || raw === undefined) return { map: {}, fresh: true };
      const parsed = JSON.parse(raw);
      return { map: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}, fresh: false };
    } catch (_) { return { map: {}, fresh: false }; }
  }
  function writeDisputeSeen(map) {
    try { window.localStorage.setItem(disputeSeenKey(), JSON.stringify(map)); } catch (_) { /* حالت خصوصی/محدود */ }
  }
  function markDisputeSeen(d) {
    if (!d || d.id == null) return;
    const { map } = readDisputeSeen();
    map[d.id] = disputeFingerprint(d);
    writeDisputeSeen(map);
  }

  function disputeBadge(phase) {
    const [label, cls] = DISPUTE_PHASES[phase] || DISPUTE_PHASES.open;
    return dEl('span', `badge ${cls}`, label);
  }

  function disputeListItem(d, unread) {
    const b = dEl('button', 'list-item dispute-item');
    b.type = 'button';
    const top = dEl('div', 'li-top');
    top.appendChild(dEl('span', 'dsp-title', d.record_date ? `اعتراض به رکورد ${fmtDate(d.record_date)}` : 'اعتراض'));
    const tags = dEl('span', 'dsp-tags');
    if (unread) tags.appendChild(dEl('span', 'dsp-unread', 'پیام جدید'));
    tags.appendChild(disputeBadge(d.phase));
    top.appendChild(tags);
    b.appendChild(top);
    const preview = dEl('p', 'dsp-preview', d.message);
    preview.setAttribute('dir', 'auto');
    b.appendChild(preview);
    const bottom = dEl('div', 'li-bottom');
    bottom.appendChild(dEl('span', null, `${faNum(d.message_count)} پیام`));
    bottom.appendChild(dEl('span', null, fmtDateTime(d.last_message_at)));
    b.appendChild(bottom);
    b.addEventListener('click', () => openDispute(d.id));
    return b;
  }

  async function loadDisputeList() {
    const list = $('#dispute-list');
    if (!list) return;
    const seq = ++disputeUi.listSeq;
    renderLoading(list, 'list');
    try {
      const items = await api('/dispute');
      if (seq !== disputeUi.listSeq) return; // پاسخ کهنه (درخواست تازه‌تری در راه است)
      if (!Array.isArray(items) || !items.length) { renderEmpty(list, 'هنوز اعتراضی ثبت نکرده‌اید.'); return; }
      const seen = readDisputeSeen();
      if (seen.fresh) { // اولین بار روی این دستگاه: اعتراض‌های از قبل بسته‌شده «جدید» حساب نشوند
        items.forEach((d) => { if (d.status !== 'open') seen.map[d.id] = disputeFingerprint(d); });
        writeDisputeSeen(seen.map);
      }
      list.removeAttribute('aria-busy');
      list.innerHTML = '';
      items.forEach((d) => list.appendChild(disputeListItem(d, disputeIsUnread(d, seen.map))));
    } catch (err) {
      if (seq !== disputeUi.listSeq) return;
      renderError(list, err, loadDisputeList, 'retry-dispute-list');
    }
  }

  function openDispute(id) {
    disputeUi.id = id; disputeUi.data = null; disputeUi.mode = 'idle'; disputeUi.draft = ''; disputeUi.msg = '';
    switchView('dispute');
  }

  async function loadDisputeThread() {
    const box = $('#dispute-thread');
    const id = disputeUi.id;
    if (!box || id == null) return;
    const seq = ++disputeUi.threadSeq;
    renderLoading(box, 'list');
    try {
      const data = await api('/dispute/' + encodeURIComponent(String(id)));
      if (seq !== disputeUi.threadSeq) return;
      disputeUi.data = data;
      markDisputeSeen(data.dispute);
      renderDisputeThread({ focus: 'title' });
    } catch (err) {
      if (seq !== disputeUi.threadSeq) return;
      renderError(box, err, loadDisputeThread, 'retry-dispute-thread');
    }
  }

  function disputeBubble(m) {
    const wrap = dEl('div', `dsp-msg ${m.is_mine ? 'mine' : 'theirs'}`);
    const who = m.is_mine ? ((state.me && state.me.fullName) || 'شما') : 'ادمین';
    const meta = dEl('div', 'dsp-meta');
    meta.appendChild(dEl('span', 'dsp-who', who));
    meta.appendChild(dEl('span', 'dsp-time', fmtDateTime(m.created_at)));
    wrap.appendChild(meta);
    const text = dEl('div', 'dsp-text', m.message);
    text.setAttribute('dir', 'auto');
    wrap.appendChild(text);
    return wrap;
  }

  // فیلد نوشتن با label، شمارنده‌ی نویسه و دکمه‌ی ارسال؛ پیش‌نویس در disputeUi.draft می‌ماند تا با خطا از دست نرود
  function disputeComposer({ sendText, onSend, onCancel }) {
    const wrap = dEl('div', 'dsp-composer form');
    const label = dEl('label', null, 'پیام شما');
    label.setAttribute('for', 'dispute-msg-input');
    const ta = dEl('textarea');
    ta.id = 'dispute-msg-input';
    ta.rows = 3;
    ta.maxLength = DISPUTE_MSG_MAX;
    ta.value = disputeUi.draft;
    ta.setAttribute('dir', 'auto');
    ta.setAttribute('placeholder', 'پیام خود را بنویسید…');
    const count = dEl('span', 'dsp-count', `${faNum(ta.value.length)} / ${faNum(DISPUTE_MSG_MAX)}`);
    ta.addEventListener('input', () => { disputeUi.draft = ta.value; count.textContent = `${faNum(ta.value.length)} / ${faNum(DISPUTE_MSG_MAX)}`; });
    label.appendChild(ta);
    wrap.appendChild(label);
    const row = dEl('div', 'dsp-actions');
    row.appendChild(count);
    if (onCancel) row.appendChild(dBtn('انصراف', 'btn ghost', onCancel));
    const send = dBtn(sendText, 'btn primary', () => onSend(send, ta));
    row.appendChild(send);
    wrap.appendChild(row);
    return { node: wrap, input: ta };
  }

  async function sendDisputeMessage(btn, ta) {
    const d = disputeUi.data && disputeUi.data.dispute;
    if (!d) return;
    const reopening = disputeUi.mode === 'reopen';
    disputeUi.draft = ta.value;
    try {
      const res = await withBusy(btn, () => api(`/dispute/${encodeURIComponent(String(d.id))}/${reopening ? 'reopen' : 'messages'}`, { method: 'POST', body: { message: ta.value } }));
      disputeUi.data = { dispute: res.dispute, messages: res.messages };
      disputeUi.draft = ''; disputeUi.msg = ''; disputeUi.mode = 'idle';
      markDisputeSeen(res.dispute);
      renderDisputeThread({ focus: reopening ? 'title' : 'composer' });
      showToast(reopening ? 'اعتراض دوباره باز شد.' : 'پیام ارسال شد.');
    } catch (err) { handleDisputeError(err); }
  }

  async function closeDisputeByUser(btn) {
    const d = disputeUi.data && disputeUi.data.dispute;
    if (!d) return;
    try {
      const res = await withBusy(btn, () => api(`/dispute/${encodeURIComponent(String(d.id))}/close`, { method: 'POST', body: {} }));
      disputeUi.data = { dispute: res.dispute, messages: res.messages };
      disputeUi.draft = ''; disputeUi.msg = ''; disputeUi.mode = 'idle';
      markDisputeSeen(res.dispute);
      renderDisputeThread({ focus: 'title' });
      showToast('اعتراض خاتمه یافت.');
    } catch (err) { handleDisputeError(err); }
  }

  async function handleDisputeError(err) {
    disputeUi.msg = err.message;
    const code = err.data && err.data.code;
    if (err.status === 404) { showToast(err.message, true); switchView('profile'); return; }
    if (DISPUTE_STALE_CODES.includes(code)) { // وضعیت عوض شده: thread تازه، پیام سرور می‌ماند، حالت به idle
      disputeUi.mode = 'idle';
      try {
        const data = await api('/dispute/' + encodeURIComponent(String(disputeUi.id)));
        disputeUi.data = data; markDisputeSeen(data.dispute);
      } catch (_) { /* همان نمای قبلی با پیام خطا */ }
    }
    renderDisputeThread({ focus: 'msg' });
  }

  function disputeNote(text) { return dEl('p', 'plan-note dsp-note', text); }

  function renderDisputeThread(opts) {
    const o = opts || {};
    const box = $('#dispute-thread');
    const data = disputeUi.data;
    if (!box || !data) return;
    const d = data.dispute;
    if (d.can_reply && disputeUi.mode === 'reopen') disputeUi.mode = 'idle'; // وضعیت سمت سرور عوض شده (مثلاً ادمین بازگشایی کرده)
    if (!d.can_reply && disputeUi.mode === 'confirmClose') disputeUi.mode = 'idle';
    box.removeAttribute('aria-busy');
    box.innerHTML = '';

    // سرآیند: رکورد، وضعیت، شمارنده‌ی ادامه
    const head = dEl('div', 'card dsp-head');
    const line = dEl('div', 'li-top');
    line.appendChild(dEl('span', 'dsp-title', d.record_date ? `اعتراض به رکورد ${fmtDate(d.record_date)}` : 'اعتراض'));
    line.appendChild(disputeBadge(d.phase));
    head.appendChild(line);
    if (d.max_reopens > 0) head.appendChild(dEl('div', 'plan-meta', `ادامه‌ی اعتراض: ${faNum(d.reopen_count)} از ${faNum(d.max_reopens)} بار`));
    box.appendChild(head);

    // پیام‌ها (حباب)
    const log = dEl('div', 'dsp-messages');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-label', 'پیام‌های گفت‌وگو');
    (data.messages || []).forEach((m) => log.appendChild(disputeBubble(m)));
    box.appendChild(log);

    // پیام خطا/وضعیت عملیات
    const msg = dEl('div', `form-msg${disputeUi.msg ? ' err' : ''}`, disputeUi.msg || '');
    msg.id = 'dispute-thread-msg';
    msg.setAttribute('role', 'alert');
    msg.tabIndex = -1;
    box.appendChild(msg);

    let composerInput = null;
    if (d.can_reply) {
      // باز: نوشتن + «مشکلم حل شد، خاتمه» (با تأیید)
      const c = disputeComposer({ sendText: 'ارسال', onSend: sendDisputeMessage });
      composerInput = c.input;
      box.appendChild(c.node);
      if (disputeUi.mode === 'confirmClose') {
        const confirm = dEl('div', 'card dsp-confirm');
        confirm.setAttribute('role', 'group');
        confirm.setAttribute('aria-label', 'تأیید خاتمه‌ی اعتراض');
        confirm.appendChild(dEl('p', null, 'با خاتمه دادن، این اعتراض بسته می‌شود.' + (d.max_reopens > 0 && d.reopen_count < d.max_reopens
          ? ' اگر لازم شد، بعداً می‌توانید آن را ادامه دهید.' : ' بعد از خاتمه امکان ادامه‌ی این اعتراض نیست.')));
        const row = dEl('div', 'dsp-actions');
        row.appendChild(dBtn('انصراف', 'btn ghost', () => { disputeUi.mode = 'idle'; disputeUi.msg = ''; renderDisputeThread({ focus: 'composer' }); }));
        const yes = dBtn('بله، خاتمه بده', 'btn danger', () => closeDisputeByUser(yes));
        row.appendChild(yes);
        confirm.appendChild(row);
        box.appendChild(confirm);
      } else if (d.can_close) {
        box.appendChild(dBtn('مشکلم حل شد، خاتمه', 'btn secondary dsp-close', () => { disputeUi.mode = 'confirmClose'; disputeUi.msg = ''; renderDisputeThread({ focus: 'confirm' }); }));
      }
    } else {
      // بسته: توضیح وضعیت + «ادامه‌ی اعتراض» (اگر سقف پر نشده)
      box.appendChild(disputeNote(d.closed_by === 'user' ? 'شما این اعتراض را خاتمه داده‌اید.' : 'این اعتراض توسط ادمین بسته شده است.'));
      if (d.can_reopen && disputeUi.mode === 'reopen') {
        const c = disputeComposer({
          sendText: 'ارسال و ادامه‌ی اعتراض',
          onSend: sendDisputeMessage,
          onCancel: () => { disputeUi.mode = 'idle'; disputeUi.msg = ''; disputeUi.draft = ''; renderDisputeThread({ focus: 'title' }); },
        });
        composerInput = c.input;
        box.appendChild(c.node);
      } else if (d.can_reopen) {
        const left = d.max_reopens - d.reopen_count;
        box.appendChild(dBtn('ادامه‌ی اعتراض', 'btn primary dsp-reopen', () => { disputeUi.mode = 'reopen'; disputeUi.msg = ''; renderDisputeThread({ focus: 'composer' }); }));
        box.appendChild(dEl('div', 'plan-meta', `${faNum(left)} بار دیگر می‌توانید این اعتراض را ادامه دهید.`));
      } else {
        box.appendChild(disputeNote(d.max_reopens > 0 ? `سقف دفعات ادامه‌ی اعتراض (${faNum(d.max_reopens)} بار) پر شده است.` : 'ادامه‌ی اعتراضِ بسته‌شده فعال نیست.'));
      }
    }

    // فوکوس و اسکرول
    if (o.focus === 'composer' && composerInput) composerInput.focus();
    else if (o.focus === 'msg' && disputeUi.msg) msg.focus();
    else if (o.focus === 'confirm') { const y = box.querySelector && box.querySelector('.dsp-confirm .btn.danger'); if (y) y.focus(); }
    else if (o.focus === 'title') { const t = $('#dispute-title'); if (t && typeof t.focus === 'function') t.focus(); }
    const last = log.lastChild;
    if (last && typeof last.scrollIntoView === 'function' && o.focus !== 'title') last.scrollIntoView({ block: 'end' });
  }

  const disputeBack = $('#dispute-back');
  if (disputeBack && typeof disputeBack.addEventListener === 'function') disputeBack.addEventListener('click', () => switchView('profile'));

  // ---------- بوت‌استرپ ----------

  // دسترسی مستقیم (D4): ?view=plan یا start_param=plan (دکمه‌ی بات)
  function openDeepLink() {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('view');
      const sp = initDataUnsafe && initDataUnsafe.start_param;
      const target = q || sp;
      if (target === 'plan') switchView('plan');
      else if (target === 'dispute') { // ?view=dispute&id=N (دکمه‌ی پیام تلگرام پاسخ ادمین) ⇒ مستقیم باز شدن همان گفت‌وگو
        const id = parseInt(params.get('id'), 10);
        if (Number.isInteger(id) && id > 0) openDispute(id);
      }
    } catch (_) { /* نادیده */ }
  }

  async function boot() {
    initBreakSheet();
    getDeviceId(); // S2-3: از همین ابتدا آماده شود تا لمس «ثبت ورود» معطل نماند
    const errBox = $('#app-error');
    errBox.classList.add('hidden');
    if (!initData) {
      // اجرای خارج از تلگرام (مثلاً باز کردن مستقیم در مرورگر) - initData وجود ندارد
      $('#not-registered').classList.remove('hidden');
      $('#not-registered .card').innerHTML =
        '<h2>این صفحه باید داخل تلگرام باز شود</h2><p>لطفاً از طریق دکمه منوی بات وارد شوید.</p>';
      return;
    }

    try {
      state.me = await api('/me');
      syncResetEpoch(state.me.reset_epoch);
      $('#user-name').textContent = state.me.fullName;
      try {
        $('#header-date').textContent = fmtTodayShort();
      } catch (_) { /* ignore */ }
      $('#app').classList.remove('hidden');
      showTodaySkeleton(true);
      try { await loadToday(); } finally { showTodaySkeleton(false); }
      openDeepLink();
    } catch (err) {
      if (err.status === 403) {
        const id = (err.data && err.data.telegramUserId) || (initDataUnsafe.user && initDataUnsafe.user.id) || '-';
        $('#tg-id-box').textContent = id;
        $('#not-registered').classList.remove('hidden');
      } else {
        // بدون این، برنامه خالی می‌ماند و فقط یک توست زودگذر دیده می‌شد
        showToast(err.message, true);
        errBox.innerHTML = '<div class="card center-card"><h2>بارگذاری ناموفق بود</h2><p id="app-error-msg"></p><button type="button" class="btn primary" id="retry-boot">تلاش دوباره</button></div>';
        $('#app-error-msg').textContent = err.message;
        $('#retry-boot').addEventListener('click', boot);
        errBox.classList.remove('hidden');
      }
    }
  }

  boot();
})();
