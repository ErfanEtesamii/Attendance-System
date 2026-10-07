// هسته‌ی پنل مدیریتی: ابزارها، API، مودال، روتر. بدون فریم‌ورک و بدون بیلد.
// هر «صفحه» (view) در فایل‌های views-*.js با AP.view(...) ثبت می‌شود.

(function () {
  'use strict';

  const AP = (window.AP = {
    state: { me: null, isAdmin: false, isStaff: false, isEmployee: false, users: null, counts: { leave: 0, disputes: 0 } },
    views: {},
    nav: [],
    onLeave: null,
  });

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  AP.$ = $;
  AP.$$ = $$;

  // ---------- امنیت خروجی HTML ----------
  AP.esc = function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  const esc = AP.esc;

  // ---------- آیکن‌ها ----------
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    live: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    employees: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    attendance: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
    leave: '<path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    disputes: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    reports: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
    broadcast: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    audit: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    system: '<rect x="2" y="3" width="20" height="7" rx="2"/><rect x="2" y="14" width="20" height="7" rx="2"/><path d="M6 6.5h.01M6 17.5h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    in: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/>',
  };
  AP.icon = (name, size) =>
    `<svg viewBox="0 0 24 24" ${size ? `width="${size}" height="${size}"` : ''} aria-hidden="true">${P[name] || ''}</svg>`;

  // ---------- فرمت‌ها ----------
  const J = window.Jalali; // jalali.js (S3-10a)؛ قبل از core.js لود می‌شود
  const nf = new Intl.NumberFormat('fa-IR');
  const pad2 = (n) => String(n).padStart(2, '0');
  const localIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const isoPart = (s) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s == null ? '' : s)); return m && J.parseIso(m[1]) ? m[1] : null; };
  const safeJalali = (iso) => { try { return J.isoToJalali(iso); } catch (_) { return null; } };
  const fmt = (AP.fmt = {
    num: (n) => (n == null || Number.isNaN(n) ? '—' : nf.format(n)),
    parse(v) {
      if (!v) return null;
      // sqlite datetime('now') => "YYYY-MM-DD HH:MM:SS" به‌وقت UTC (بدون Z)
      const s = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    },
    clock(iso) {
      const d = fmt.parse(iso);
      return d ? d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '—';
    },
    // تاریخ‌ها همه شمسی‌اند و با jalali.js (نه ICU مرورگر) ساخته می‌شوند تا خروجی در همه‌ی مرورگرها یکسان و قابل تست باشد.
    // ورودی «YYYY-MM-DD» میلادی (یا رشته‌ای که با آن شروع شود)؛ نامعتبر ⇒ همان ورودی برمی‌گردد.
    date(dateStr) {
      if (!dateStr) return '—';
      const iso = isoPart(dateStr);
      const j = iso && safeJalali(iso);
      if (!j) return dateStr;
      const cur = safeJalali(localIso(new Date()));
      const year = cur && cur.jy === j.jy ? '' : ` ${J.toFaDigits(j.jy)}`;
      return `${J.weekdayName(iso)}، ${J.toFaDigits(j.jd)} ${J.MONTH_NAMES[j.jm - 1]}${year}`;
    },
    dateLong(dateStr) {
      if (!dateStr) return '—';
      const iso = isoPart(dateStr);
      return (iso && safeJalali(iso) && J.formatIso(iso, { long: true })) || dateStr;
    },
    // «پنجشنبه، ۱۵ مهر ۱۴۰۵» (نوار بالا، سرتیتر داشبورد)
    dateFull(dateStr) {
      if (!dateStr) return '—';
      const iso = isoPart(dateStr);
      return (iso && safeJalali(iso) && `${J.weekdayName(iso)}، ${J.formatIso(iso, { long: true })}`) || dateStr;
    },
    // لحظه‌ی UTC دیتابیس ⇒ «۱۴۰۵/۰۷/۱۵ ۱۴:۳۰» به وقت محلی مرورگر
    dateTime(v) {
      const d = fmt.parse(v);
      if (!d) return '—';
      const iso = localIso(d);
      if (!safeJalali(iso)) return '—';
      return `${J.formatIso(iso)} ${J.toFaDigits(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`)}`;
    },
    min(m) {
      if (m == null || Number.isNaN(m)) return '—';
      const abs = Math.abs(Math.round(m));
      const h = Math.floor(abs / 60);
      const r = abs % 60;
      if (!h) return `${nf.format(r)} دقیقه`;
      return r ? `${nf.format(h)} ساعت و ${nf.format(r)} دقیقه` : `${nf.format(h)} ساعت`;
    },
    toLocalInput(iso) {
      const d = fmt.parse(iso);
      if (!d) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    fromLocalInput(v) {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    },
    // «امروز» به وقت محلی (نه UTC)؛ همان مبنایی که «امروز»ِ datepicker شمسی دارد
    today() {
      return localIso(new Date());
    },
    daysAgo(n) {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return localIso(d);
    },
  });

  AP.ROLE = { employee: 'کارمند', manager: 'سرپرست', admin: 'ادمین کل' };
  AP.STATE_LABEL = {
    present: 'حاضر', on_break: 'در استراحت', checked_out: 'خارج شده', absent: 'غایب / نیامده',
    leave: 'مرخصی', holiday: 'تعطیل', incomplete: 'ناقص',
  };
  AP.STATUS_LABEL = { normal: 'عادی', late: 'تأخیر', incomplete: 'ناقص', leave: 'مرخصی', holiday: 'تعطیل' };
  AP.LEAVE_STATUS = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' };
  AP.LEAVE_TYPE = { leave: 'مرخصی', mission: 'مأموریت' };
  AP.badge = (cls, text, dot) => `<span class="badge ${esc(cls)}${dot ? ' dot' : ''}">${esc(text)}</span>`;
  AP.stateBadge = (s) => AP.badge(s, AP.STATE_LABEL[s] || s, true);
  AP.statusBadge = (s) => AP.badge(s, AP.STATUS_LABEL[s] || s);

  AP.initials = (name) => {
    const parts = String(name || '?').trim().split(/\s+/);
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  };
  AP.avatar = (name, cls = '') => `<span class="avatar ${cls}">${esc(AP.initials(name))}</span>`;

  // ---------- توست ----------
  AP.toast = function toast(msg, isErr) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), isErr ? 4200 : 2600);
  };

  // ---------- API ----------
  AP.api = async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      credentials: 'include',
      // X-Requested-With: لایه‌ی دوم محافظت CSRF (سرور برای متدهای نوشتنی آن را الزام می‌کند)
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AttendancePanel' },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && AP.state.me) {
        AP.toast('نشست شما منقضی شده است؛ دوباره وارد شوید.', true);
        setTimeout(() => location.reload(), 1200);
      }
      const err = new Error(data.error || 'خطای ناشناخته');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  // اجرای یک اکشن با توست خطا؛ true اگر موفق بود
  AP.attempt = async function attempt(fn, okMsg) {
    try {
      const r = await fn();
      if (okMsg) AP.toast(okMsg);
      return r === undefined ? true : r;
    } catch (err) {
      AP.toast(err.message, true);
      return false;
    }
  };

  AP.formData = function formData(form) {
    const out = {};
    $$('[name]', form).forEach((el) => {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  };

  // ---------- تاریخ شمسی در فرم‌ها (S3-11) ----------
  // AP.dates.mount(root) — هر صفحه/مودال صراحتاً صدایش می‌زند (اعمال تدریجی روی صفحه‌ها):
  //   <input type="date">           ⇒ datepicker شمسی؛ مقدار فرم (AP.formData) همچنان میلادی «YYYY-MM-DD» است
  //   <input type="datetime-local"> ⇒ جفت «تاریخ شمسی + ساعت HH:MM(LTR)»؛ input اصلی (name/data-f) پنهان می‌شود و
  //                                   همان قالب قبلی «YYYY-MM-DDTHH:MM» را نگه می‌دارد (fmt.fromLocalInput/AP.formData بدون تغییر)
  //   <input type="time">           ⇒ dir=ltr (ساعت در صفحه‌ی RTL برعکس نمایش داده نشود)
  // قرارداد: قبل از بستن listenerهای خود صفحه صدا زده شود، چون تغییر تایپی input ظاهری (متن شمسی) با
  // stopImmediatePropagation بلعیده می‌شود و فقط change input مخفیِ حامل ISO به صفحه می‌رسد.
  // خروجی: آرایه‌ی نمونه‌های datepicker (برای getValue/setValue).
  AP.dates = {
    combine(iso, time) { return iso && /^\d{2}:\d{2}$/.test(time || '') ? `${iso}T${time}` : ''; },
    split(local) {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(local || '');
      return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
    },
    mount(root) {
      const DP = window.JalaliDatepicker;
      const out = [];
      if (!DP) return out;
      $$('input[type="date"]', root).forEach((el) => {
        const opts = { value: el.value, min: el.getAttribute('min') || '', max: el.getAttribute('max') || '' };
        el.removeAttribute('min');
        el.removeAttribute('max');
        el.type = 'text';
        el.addEventListener('change', (e) => e.stopImmediatePropagation());
        out.push(DP.attach(el, opts));
      });
      $$('input[type="datetime-local"]', root).forEach((el) => {
        const init = AP.dates.split(el.value);
        const wrap = document.createElement('span');
        wrap.className = 'dt-pair';
        wrap.innerHTML = '<input type="text" class="dt-date" aria-label="تاریخ" /><input type="time" class="dt-time" dir="ltr" aria-label="ساعت" />';
        const dateEl = wrap.firstChild;
        const timeEl = wrap.lastChild;
        if (el.required) { dateEl.required = true; timeEl.required = true; }
        timeEl.value = init.time;
        el.type = 'hidden';
        el.after(wrap);
        let dp = null;
        const sync = () => {
          const iso = dp ? dp.getValue() : init.date;
          el.value = AP.dates.combine(iso, timeEl.value);
          // نیمه‌کاره (فقط تاریخ یا فقط ساعت) ⇒ مقدار خالی می‌ماند؛ خانه‌ی خالی قرمز می‌شود تا بی‌صدا حذف نشود
          if (iso && !timeEl.value) timeEl.setAttribute('aria-invalid', 'true'); else timeEl.removeAttribute('aria-invalid');
          if (!iso && timeEl.value && !dateEl.value) dateEl.setAttribute('aria-invalid', 'true');
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        dp = DP.attach(dateEl, { value: init.date, onChange: sync });
        timeEl.addEventListener('change', (e) => { e.stopPropagation(); sync(); });
        out.push(dp);
      });
      $$('input[type="time"]', root).forEach((el) => { el.setAttribute('dir', 'ltr'); el.classList.add('ltr-in'); });
      return out;
    },
  };

  AP.loadUsers = async function loadUsers(force) {
    if (AP.state.isEmployee) {
      // کارمند به لیست کارمندان دسترسی ندارد؛ فقط خودش
      const m = AP.state.me;
      AP.state.users = [{ id: m.id, fullName: m.fullName, personnelCode: null, department: m.department, role: m.role, isActive: true, managerId: null, telegramUserId: null }];
      return AP.state.users;
    }
    if (!AP.state.users || force) AP.state.users = await AP.api('/admin/users');
    return AP.state.users;
  };

  // ---------- مودال ----------
  const modalRoot = () => $('#modal-root');
  const modalStack = [];

  AP.modal = function openModal({ title, body, wide, top, onMount }) {
    const bd = document.createElement('div');
    bd.className = `modal-backdrop${top ? ' top' : ''}`;
    bd.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${esc(title)}</h3>
          <button type="button" class="icon-btn" data-close aria-label="بستن">${AP.icon('x')}</button></div>
        <div class="modal-body">${body}</div>
      </div>`;
    const handle = {
      el: bd,
      body: $('.modal-body', bd),
      close() {
        const i = modalStack.indexOf(handle);
        if (i >= 0) modalStack.splice(i, 1);
        bd.remove();
        if (handle.onClose) handle.onClose();
      },
    };
    let downOnBackdrop = false;
    bd.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === bd; });
    bd.addEventListener('click', (e) => { if (e.target === bd && downOnBackdrop) handle.close(); });
    $('[data-close]', bd).addEventListener('click', () => handle.close());
    modalRoot().appendChild(bd);
    modalStack.push(handle);
    if (onMount) onMount(handle.body, handle);
    const first = $('input:not([type=hidden]), select, textarea', handle.body);
    if (first && !top) first.focus({ preventScroll: true });
    return handle;
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
  });

  AP.askReason = function askReason({ title, label = 'دلیل (اجباری)', confirmText = 'تأیید', danger = false, message = '', required = true, placeholder = '' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = AP.modal({
        title, top: true,
        body: `<form class="form">
          ${message ? `<p class="muted" style="margin:0;line-height:1.9">${esc(message)}</p>` : ''}
          <label class="field"><span>${esc(label)}</span><textarea name="reason" rows="3" ${required ? 'required' : ''} placeholder="${esc(placeholder)}"></textarea></label>
          <div class="modal-actions">
            <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(confirmText)}</button>
            <button type="button" class="btn ghost" data-cancel>انصراف</button>
          </div></form>`,
        onMount(body, h) {
          $('textarea', body).focus();
          $('[data-cancel]', body).addEventListener('click', () => h.close());
          $('form', body).addEventListener('submit', (e) => {
            e.preventDefault();
            const v = $('textarea', body).value.trim();
            if (required && !v) return;
            finish(v);
            h.close();
          });
        },
      });
      m.onClose = () => finish(null);
    });
  };

  AP.confirmBox = function confirmBox({ title, message, confirmText = 'تأیید', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = AP.modal({
        title, top: true,
        body: `<p style="margin:0 0 18px;line-height:1.9">${esc(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmText)}</button>
            <button type="button" class="btn ghost" data-cancel>انصراف</button></div>`,
        onMount(body, h) {
          $('[data-ok]', body).addEventListener('click', () => { finish(true); h.close(); });
          $('[data-cancel]', body).addEventListener('click', () => h.close());
        },
      });
      m.onClose = () => finish(false);
    });
  };

  // ---------- روتر (hash) ----------
  AP.view = function view(id, def) {
    AP.views[id] = def;
    if (def.nav) AP.nav.push({ id, ...def.nav });
  };

  let routeToken = 0;
  AP.currentRoute = { id: null, param: null };

  AP.go = function go(id, param) {
    const h = `#/${id}${param != null ? `/${param}` : ''}`;
    if (location.hash === h) AP.refresh();
    else location.hash = h;
  };

  AP.refresh = function refresh() { return route(); };

  function parseHash() {
    const m = location.hash.replace(/^#\/?/, '').split('/');
    return { id: m[0] || 'dashboard', param: m[1] || null };
  }

  // صفحه‌ی اول هر نقش: کارمند → پروفایل خودش، سرپرست/ادمین → داشبورد
  AP.homeRoute = function homeRoute() {
    return AP.state.isEmployee ? { id: 'profile', param: AP.state.me.id } : { id: 'dashboard', param: null };
  };

  async function route() {
    if (!AP.state.me) return;
    let { id, param } = parseHash();
    let def = AP.views[id];
    // کارمند فقط به صفحه‌هایی که صریحاً employee:true دارند می‌رسد (امن‌به‌صورت‌پیش‌فرض)
    if (!def || (def.admin && !AP.state.isAdmin) || (AP.state.isEmployee && !def.employee)) {
      const home = AP.homeRoute();
      id = home.id;
      param = home.param;
      def = AP.views[id];
    }
    if (AP.state.isEmployee && id === 'profile') param = AP.state.me.id; // فقط پروفایل خودش
    if (AP.onLeave) { try { AP.onLeave(); } catch (_) {} AP.onLeave = null; }
    AP.currentRoute = { id, param };
    const token = ++routeToken;

    // وضعیت فعال ناوبری
    const navKey = AP.state.isEmployee && id === 'profile' ? 'profile' : (def.navId || id);
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === navKey));
    closeSidebar();

    const page = $('#page');
    page.innerHTML = '<div class="loading"><div class="spinner"></div>در حال بارگذاری…</div>';
    try {
      const result = await def.render(param);
      if (token !== routeToken) return; // کاربر وسط بارگذاری صفحه عوض کرد
      page.innerHTML = result.html;
      window.scrollTo({ top: 0 });
      if (result.mount) result.mount(page);
    } catch (err) {
      if (token !== routeToken) return;
      page.innerHTML = `<div class="card"><div class="empty">${AP.icon('alert')}${esc(err.message)}
        <div class="mt"><button class="btn ghost" id="retry-btn">تلاش دوباره</button></div></div></div>`;
      const retry = $('#retry-btn');
      if (retry) retry.addEventListener('click', route);
    }
  }
  window.addEventListener('hashchange', route);

  // ---------- ناوبری و قاب ----------
  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-backdrop').classList.remove('open');
  }

  AP.refreshCounts = async function refreshCounts() {
    try {
      const [leave, disputes] = await Promise.all([
        AP.api('/admin/leave-requests?status=pending'),
        AP.api('/admin/disputes?status=open'),
      ]);
      // موارد مشکوک فقط برای سرپرست/ادمین (کارمند ۴۰۳ می‌گیرد)؛ شکستش شمارنده‌های دیگر را خراب نمی‌کند
      let suspicious = [];
      if (AP.state.isStaff) {
        try { suspicious = await AP.api('/admin/suspicious?status=open'); } catch (_) { suspicious = []; }
      }
      AP.state.counts = { leave: leave.length, disputes: disputes.length, nightly: leave.length + disputes.length, suspicious: suspicious.length };
      ['leave', 'disputes', 'nightly', 'suspicious'].forEach((k) => {
        const el = $(`.nav-item[data-view="${k}"] .nav-count`);
        if (!el) return;
        el.textContent = fmt.num(AP.state.counts[k]);
        el.classList.toggle('hidden', !AP.state.counts[k]);
      });
    } catch (_) { /* غیرحیاتی */ }
  };

  function buildNav() {
    const groups = {};
    const items = AP.state.isEmployee
      ? [{ id: 'profile', icon: 'employees', label: 'پروفایل من', group: 'پنل من', param: AP.state.me.id },
         ...AP.nav.filter((n) => AP.views[n.id] && AP.views[n.id].employee)]
      : AP.nav.filter((n) => !n.admin || AP.state.isAdmin);
    items.forEach((n) => { (groups[n.group] = groups[n.group] || []).push(n); });
    $('#side-nav').innerHTML = Object.keys(groups)
      .map((g) => `<div class="nav-group">${esc(g)}</div>${groups[g]
        .map((n) => `<button class="nav-item" data-view="${n.id}"${n.param != null ? ` data-param="${n.param}"` : ''}>${AP.icon(n.icon)}<span>${esc(n.label)}</span>${n.counter ? '<span class="nav-count hidden"></span>' : ''}</button>`)
        .join('')}`)
      .join('');
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.view, b.dataset.param)));
  }

  function setupSearch() {
    const input = $('#global-search');
    const box = $('#search-results');
    const hide = () => box.classList.add('hidden');
    input.addEventListener('input', async () => {
      const q = input.value.trim().toLowerCase();
      if (!q) return hide();
      const users = await AP.loadUsers().catch(() => []);
      const hits = users
        .filter((u) => (u.fullName || '').toLowerCase().includes(q) || (u.personnelCode || '').toLowerCase().includes(q))
        .slice(0, 8);
      box.innerHTML = hits.length
        ? hits.map((u) => `<button class="search-item" data-id="${u.id}">${AP.avatar(u.fullName, 'sm')}<span>${esc(u.fullName)}</span><small>${esc(u.department || '')}</small></button>`).join('')
        : '<div class="empty" style="padding:14px">موردی پیدا نشد.</div>';
      box.classList.remove('hidden');
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.search-item');
      if (!b) return;
      hide();
      input.value = '';
      AP.go('profile', b.dataset.id);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) hide(); });
  }

  async function enterApp() {
    $('#login-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    const me = AP.state.me;
    AP.state.isAdmin = me.role === 'admin';
    AP.state.isStaff = me.role === 'admin' || me.role === 'manager';
    AP.state.isEmployee = me.role === 'employee';
    $('.brand-sub').textContent = AP.state.isAdmin ? 'پنل مدیریتی' : AP.state.isStaff ? 'پنل سرپرست' : 'پنل کارمند';
    if (AP.state.isEmployee) $('.search-box').classList.add('hidden'); // کارمند کس دیگری را جستجو نمی‌کند
    $('#me-avatar').textContent = AP.initials(me.fullName);
    $('#me-name').textContent = me.fullName;
    $('#me-role').textContent = AP.ROLE[me.role] || me.role;
    $('#topbar-date').textContent = fmt.dateFull(fmt.today());
    buildNav();
    setupSearch();
    $('#menu-btn').addEventListener('click', () => {
      $('#sidebar').classList.add('open');
      $('#sidebar-backdrop').classList.add('open');
    });
    $('#sidebar-backdrop').addEventListener('click', closeSidebar);
    $('#refresh-btn').addEventListener('click', () => { AP.state.users = null; AP.refresh(); AP.refreshCounts(); });
    $('#logout-btn').addEventListener('click', async () => {
      try { await AP.api('/admin/auth/logout', { method: 'POST' }); } catch (_) {}
      location.reload();
    });
    AP.refreshCounts();
    // ?go=<صفحه> از دکمه‌های بات (مثلاً دکمه‌ی پیام شبانه → مرور شبانه)
    const go = AP.launch && AP.launch.go;
    if (go && AP.views[go] && !(AP.views[go].admin && !AP.state.isAdmin) && !(AP.state.isEmployee && !AP.views[go].employee)) {
      history.replaceState(null, '', `#/${go}`);
    }
    await route();
  }

  // ---------- ورود با تلگرام ----------
  window.onTelegramAuth = async function (user) {
    try {
      const result = await AP.api('/admin/auth/telegram', { method: 'POST', body: user });
      AP.state.me = result.user;
      enterApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  };

  // ---------- ورود با کد یک‌بارمصرف بات (/panel) ----------
  async function loginWithCode() {
    const errEl = $('#login-error');
    errEl.textContent = '';
    try {
      const result = await AP.api('/admin/auth/code', { method: 'POST', body: { code: $('#code-input').value.trim() } });
      AP.state.me = result.user;
      enterApp();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }
  $('#code-login-btn').addEventListener('click', loginWithCode);
  $('#code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') loginWithCode(); });

  async function setupLoginWidget() {
    try {
      const cfg = await AP.api('/admin/public-config');
      if (!cfg.botUsername) {
        $('#login-error').textContent = 'TELEGRAM_BOT_USERNAME روی سرور تنظیم نشده است؛ ویجت ورود قابل نمایش نیست.';
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

  // پارامترهای ورود از بات: ?t=<توکن یک‌بارمصرف> ، #tgWebAppData=<initData تلگرام> ، ?go=<صفحه>
  function takeLaunchParams() {
    const url = new URL(location.href);
    const token = url.searchParams.get('t');
    const go = url.searchParams.get('go');
    const hash = location.hash.replace(/^#/, '');
    // initData را مستقیم از hash می‌خوانیم (نیازی به telegram-web-app.js نیست که روی شبکه‌های فیلتر لود نمی‌شود)
    const initData = hash.includes('tgWebAppData=') ? new URLSearchParams(hash).get('tgWebAppData') : null;
    if (token || go || initData) {
      url.searchParams.delete('t');
      url.searchParams.delete('go');
      history.replaceState(null, '', url.pathname + url.search); // توکن/initData از آدرس پاک شود
    }
    return { token, go, initData };
  }

  AP.boot = async function boot() {
    const launch = takeLaunchParams();
    AP.launch = launch;

    // ورود تازه از بات همیشه بر کوکی قدیمی ارجح است (مثلاً حساب تلگرام دیگری روی همین دستگاه کوکی گذاشته)
    const viaBot = launch.token
      ? ['/admin/auth/token', { token: launch.token }]
      : launch.initData ? ['/admin/auth/webapp', { initData: launch.initData }] : null;
    if (viaBot) {
      try {
        const result = await AP.api(viaBot[0], { method: 'POST', body: viaBot[1] });
        AP.state.me = result.user;
        return enterApp();
      } catch (err) {
        $('#login-error').textContent = err.message;
        return setupLoginWidget(); // با کوکی قدیمی وارد نمی‌کنیم؛ کاربر باید دوباره از بات وارد شود
      }
    }

    try {
      const me = await AP.api('/admin/me');
      AP.state.me = { id: me.id, fullName: me.fullName, role: me.role, department: me.department };
      enterApp();
    } catch (_) {
      setupLoginWidget();
    }
  };
})();
