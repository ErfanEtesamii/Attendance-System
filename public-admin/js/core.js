// هسته‌ی پنل مدیریتی: ابزارها، API، مودال، روتر. بدون فریم‌ورک و بدون بیلد.
// هر «صفحه» (view) در فایل‌های views-*.js با AP.view(...) ثبت می‌شود.

(function () {
  'use strict';

  const AP = (window.AP = {
    // perms: مجوزهای کاربر جاری (S4-4b؛ از /admin/me/permissions). فقط برای نمایش UI است؛ سرور هر درخواست را جداگانه چک می‌کند.
    state: { me: null, perms: new Set(), users: null, counts: { leave: 0, disputes: 0 } },
    views: {},
    nav: [],
    onLeave: null,
  });

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  AP.$ = $;
  AP.$$ = $$;

  // ---------- مجوزها (S4-4b) ----------
  // AP.can('records.edit') ⇒ true اگر کاربر جاری آن مجوز را دارد؛ چند مجوز ⇒ همه‌ی آن‌ها لازم است.
  // default-deny: بدون آرگومان، آرگومان نامعتبر یا مجوزهای بارگذاری‌نشده ⇒ false.
  // این فقط تصمیم نمایش است (منو/دکمه)؛ امنیت واقعی سمت سرور است و پنهان‌بودن یک دکمه جای گارد route را نمی‌گیرد.
  AP.can = function can(...required) {
    if (!required.length) return false;
    const perms = AP.state.perms;
    return required.every((p) => typeof p === 'string' && perms.has(p));
  };
  // کاربری که فهرست کاربران را نمی‌بیند (کارمند): فقط پروفایل/داده‌ی خودش
  AP.selfOnly = () => !AP.can('users.read');
  // هر صفحه باید perm داشته باشد؛ صفحه‌ی بدون perm برای هیچ‌کس نمایش داده نمی‌شود (default-deny).
  // perm می‌تواند آرایه هم باشد (S4-13b): «هرکدام» از مجوزها کافی است (مثل requireAnyPermission سرور)؛ آرایه‌ی خالی ⇒ بسته.
  AP.viewAllowed = (def) => !!(def && def.perm && (Array.isArray(def.perm) ? def.perm.some((p) => AP.can(p)) : AP.can(def.perm)));
  AP.loadPermissions = async function loadPermissions() {
    try {
      const r = await AP.api('/admin/me/permissions');
      AP.state.perms = new Set(Array.isArray(r.permissions) ? r.permissions.filter((p) => typeof p === 'string') : []);
      return true;
    } catch (err) {
      AP.state.perms = new Set(); // خطا ⇒ هیچ مجوزی فرض نمی‌شود
      AP.toast('بارگذاری مجوزها ناموفق بود؛ صفحه را تازه کنید.', true);
      return false;
    }
  };

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
    calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
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

  AP.ROLE = { employee: 'کارمند', manager: 'سرپرست', admin: 'ادمین کل', hr: 'منابع انسانی' };
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
  const toastQueue = [];
  let toastActive = false;
  function showNextToast() {
    if (toastActive || !toastQueue.length) return;
    toastActive = true;
    const { msg, isErr } = toastQueue.shift();
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.setAttribute('role', isErr ? 'alert' : 'status'); // خطا فوراً اعلام شود (S5-9c)
    el.classList.remove('hidden');
    setTimeout(() => {
      el.classList.add('hidden');
      setTimeout(() => { toastActive = false; showNextToast(); }, 180);
    }, isErr ? 3000 : 2200);
  }
  AP.toast = function toast(msg, isErr) {
    toastQueue.push({ msg: String(msg || ''), isErr: !!isErr });
    showNextToast();
  };

  // ---------- API ----------
  AP.api = async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      method: options.method || 'GET',
      credentials: 'include',
      // X-Requested-With: لایه‌ی دوم محافظت CSRF (سرور برای متدهای نوشتنی آن را الزام می‌کند)
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AttendancePanel', ...(options.headers || {}) },
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
  // آخرین دکمه‌ی کلیک‌شده بیرون از مودال؛ AP.attempt آن را تا پایان درخواست غیرفعال می‌کند تا دوبار ارسال نشود (S5-9c).
  // دکمه‌ی دلخواه: AP.attempt(fn, msg, btn)؛ بدون غیرفعال‌سازی: AP.attempt(fn, msg, null) یا data-no-busy روی دکمه.
  let lastBtn = null; let lastBtnAt = 0;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.closest('.modal') && !b.hasAttribute('data-no-busy')) { lastBtn = b; lastBtnAt = Date.now(); }
  }, true);
  AP.attempt = async function attempt(fn, okMsg, btn) {
    const b = btn !== undefined ? btn : (lastBtn && lastBtn.isConnected && Date.now() - lastBtnAt < 120000 ? lastBtn : null);
    lastBtn = null; // هر کلیک فقط یک‌بار مصرف می‌شود
    const lock = !!b && !b.disabled;
    if (lock) { b.disabled = true; b.setAttribute('aria-busy', 'true'); }
    try {
      const r = await fn();
      if (okMsg) AP.toast(okMsg);
      return r === undefined ? true : r;
    } catch (err) {
      AP.toast(err.message, true);
      return false;
    } finally {
      if (lock) { b.disabled = false; b.removeAttribute('aria-busy'); }
    }
  };

  AP.formData = function formData(form) {
    const out = {};
    $$('[name]', form).forEach((el) => {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.classList && el.classList.contains('time-in') && window.TimeInput) {
        // H4: ساعت تایپی همیشه «HH:MM» می‌رود (مثلاً «1:30»/«15:3» که هنوز blur نشده)؛ نامعتبر همان متن خام می‌ماند تا سرور/اعتبارسنجی رد کند
        const t = window.TimeInput.parse(el.value);
        out[el.name] = t.ok ? t.value : el.value;
      } else out[el.name] = el.value;
    });
    return out;
  };

  // ---------- تاریخ شمسی در فرم‌ها (S3-11) ----------
  // AP.dates.mount(root) — هر صفحه/مودال صراحتاً صدایش می‌زند (اعمال تدریجی روی صفحه‌ها):
  //   <input type="date">           ⇒ datepicker شمسی؛ مقدار فرم (AP.formData) همچنان میلادی «YYYY-MM-DD» است
  //   <input type="datetime-local"> ⇒ جفت «تاریخ شمسی + ساعت HH:MM(LTR)»؛ input اصلی (name/data-f) پنهان می‌شود و
  //                                   همان قالب قبلی «YYYY-MM-DDTHH:MM» را نگه می‌دارد (fmt.fromLocalInput/AP.formData بدون تغییر)
  //   <input type="time">           ⇒ (H4) ورودی متنی قابل‌تایپ با کیبورد عددی، ماسک HH:MM، ارقام فارسی و پیام خطای فارسی (TimeInput)؛
  //                                   مقدار همیشه «HH:MM» لاتین؛ بدون timeinput.js همان type=time با dir=ltr می‌ماند
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
      const TI = window.TimeInput;
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
        const tin = TI ? TI.attach(timeEl) : null; // H4: ساعت قابل‌تایپ؛ پیام خطا داخل همین جفت می‌آید
        const timeVal = () => (tin ? tin.getValue() : timeEl.value);
        let dp = null;
        const combined = () => AP.dates.combine(dp ? dp.getValue() : init.date, timeVal());
        const sync = () => {
          const iso = dp ? dp.getValue() : init.date;
          const t = timeVal();
          el.value = AP.dates.combine(iso, t);
          // نیمه‌کاره (فقط تاریخ یا فقط ساعت) ⇒ مقدار خالی می‌ماند؛ خانه‌ی خالی قرمز می‌شود تا بی‌صدا حذف نشود
          if (iso && !t) timeEl.setAttribute('aria-invalid', 'true'); else if (!(tin && tin.invalid())) timeEl.removeAttribute('aria-invalid');
          if (!iso && t && !dateEl.value) dateEl.setAttribute('aria-invalid', 'true');
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        dp = DP.attach(dateEl, { value: init.date, onChange: sync });
        timeEl.addEventListener('change', (e) => { e.stopPropagation(); sync(); });
        if (tin) {
          // H4: ISO پنهان بدون انتظار برای blur به‌روز شود (ذخیره‌ی بلافاصله بعد از تایپ)؛ فقط وقتی مقدار واقعاً فرق کرده تا change اضافه نرود
          const keepFresh = () => { if (combined() !== el.value) sync(); };
          timeEl.addEventListener('input', keepFresh);
          timeEl.addEventListener('blur', keepFresh);
        }
        out.push(dp);
      });
      $$('input[type="time"]', root).forEach((el) => {
        if (TI) TI.attach(el); // H4: ساعت‌های تکی هم متنیِ قابل‌تایپ
        else { el.setAttribute('dir', 'ltr'); el.classList.add('ltr-in'); }
      });
      return out;
    },
  };

  AP.loadUsers = async function loadUsers(force) {
    if (AP.selfOnly()) {
      // کاربر بدون users.read (کارمند) به لیست کارمندان دسترسی ندارد؛ فقط خودش
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
  let modalSeq = 0;

  AP.modal = function openModal({ title, body, wide, top, onMount }) {
    const bd = document.createElement('div');
    const mid = `modal-${++modalSeq}`;
    const opener = document.activeElement; // بعد از بستن فوکوس به همین‌جا برمی‌گردد (S5-9a)
    bd.className = `modal-backdrop${top ? ' top' : ''}`;
    bd.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${mid}-t" tabindex="-1">
        <div class="modal-head"><h3 id="${mid}-t">${esc(title)}</h3>
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
        if (opener && opener.focus && document.contains(opener) && !modalStack.length) opener.focus({ preventScroll: true });
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
    else { const dlg = $('.modal', bd); if (dlg) dlg.focus({ preventScroll: true }); } // بدون فیلد: فوکوس روی خودِ دیالوگ (خوانشگر عنوان را اعلام می‌کند)
    return handle;
  };

  // پرونده‌ی کنارصفحه‌ای زمینه‌ی جدول را برای بررسی حفظ می‌کند.
  let employeeDrawer = null;
  const drawerFocusables = (el) => [...el.querySelectorAll('a[href],button:not([disabled]),textarea,input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
  const closeEmployeeDrawer = () => {
    if (!employeeDrawer) return;
    const { backdrop, opener, onKeydown } = employeeDrawer;
    document.removeEventListener('keydown', onKeydown, true); backdrop.remove(); employeeDrawer = null;
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  async function openEmployeeDrawer(id, opener) {
    closeEmployeeDrawer();
    const data = await AP.api(`/admin/users/${id}/details`); const u = data.user || {};
    const backdrop = document.createElement('div'); backdrop.className = 'employee-drawer-backdrop';
    backdrop.innerHTML = `<aside class="employee-drawer" role="dialog" aria-modal="true" aria-labelledby="employee-drawer-title" tabindex="-1"><div class="employee-drawer-head"><div>${AP.avatar(u.fullName || '?')}<h3 id="employee-drawer-title">${esc(u.fullName || 'کارمند')}</h3><p>${esc(AP.ROLE[u.role] || u.role || '')} · ${esc(u.department || 'بدون دپارتمان')}</p></div><button type="button" class="icon-btn" data-close aria-label="بستن">${AP.icon('x')}</button></div><div class="employee-drawer-body"><div class="kv"><div class="kv-row"><span>ساعت مفید ماه</span><strong>${fmt.min(data.stats?.totalEffective || data.stats?.effectiveMinutes || 0)}</strong></div><div class="kv-row"><span>تأخیر</span><strong>${fmt.num(data.stats?.lateCount || 0)}</strong></div><div class="kv-row"><span>مرخصی</span><strong>${fmt.num((data.leaves || []).filter((x) => x.status === 'approved').length)}</strong></div></div><h4>۵ رکورد آخر</h4><div class="kv">${(data.records || []).slice(0, 5).map((r) => `<div class="kv-row"><span>${esc(fmt.date(r.record_date))}</span><span>${fmt.min(r.summary?.effectiveMinutes || r.effective_minutes || 0)}</span></div>`).join('') || '<p class="muted">رکوردی ثبت نشده است.</p>'}</div><div class="employee-drawer-actions">${AP.can('leave.edit') ? '<button class="btn primary" data-drawer-leave>ثبت مرخصی</button>' : ''}${AP.can('reviews.read') ? `<a class="btn ghost" href="#/profile/${u.id}" data-drawer-report>مشاهده گزارش</a>` : ''}${AP.can('users.message') ? '<button class="btn ghost" data-drawer-message>پیام به کارمند</button>' : ''}</div></div></aside>`;
    const drawer = $('.employee-drawer', backdrop);
    const onKeydown = (event) => { if (event.key === 'Escape') { event.preventDefault(); closeEmployeeDrawer(); return; } if (event.key !== 'Tab') return; const all = drawerFocusables(drawer); if (!all.length) { event.preventDefault(); drawer.focus(); return; } if (event.shiftKey && document.activeElement === all[0]) { event.preventDefault(); all.at(-1).focus(); } else if (!event.shiftKey && document.activeElement === all.at(-1)) { event.preventDefault(); all[0].focus(); } };
    employeeDrawer = { backdrop, opener, onKeydown }; backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeEmployeeDrawer(); });
    $('[data-close]', backdrop).addEventListener('click', closeEmployeeDrawer);
    $('[data-drawer-leave]', backdrop)?.addEventListener('click', () => { closeEmployeeDrawer(); AP.go('leave'); });
    $('[data-drawer-report]', backdrop)?.addEventListener('click', () => closeEmployeeDrawer());
    $('[data-drawer-message]', backdrop)?.addEventListener('click', async () => { const text = await AP.askReason({ title: 'پیام به کارمند', label: 'متن پیام', confirmText: 'ارسال', required: true }); if (text !== null) await AP.attempt(() => AP.api(`/admin/users/${u.id}/message`, { method: 'POST', body: { text } }), 'پیام ارسال شد.'); });
    document.body.appendChild(backdrop); document.addEventListener('keydown', onKeydown, true); (drawerFocusables(drawer)[0] || drawer).focus({ preventScroll: true });
  }
  document.addEventListener('click', async (event) => {
    const link = event.target.closest && event.target.closest('a[href^="#/profile/"]');
    if (!link || event.ctrlKey || event.metaKey) return;
    const id = /^#\/profile\/(\d+)$/.exec(link.getAttribute('href') || ''); if (!id) return;
    event.preventDefault();
    try {
      await openEmployeeDrawer(id[1], link);
    } catch (err) { AP.toast(err.message, true); }
  });

  document.addEventListener('keydown', (e) => {
    if (!modalStack.length) {
      // منوی جمع‌شده‌ی موبایل: Esc می‌بندد و فوکوس به دکمه‌ی منو برمی‌گردد (S5-9b)
      if (e.key === 'Escape' && $('#sidebar').classList.contains('open')) { closeSidebar(); const mb = $('#menu-btn'); if (mb) mb.focus(); }
      return;
    }
    const topModal = modalStack[modalStack.length - 1];
    if (e.key === 'Escape') { topModal.close(); return; }
    if (e.key === 'Tab' && window.A11y) window.A11y.trapTab(e, $('.modal', topModal.el), document.activeElement); // فوکوس در مودال می‌ماند (S5-9a)
  });

  AP.askReason = function askReason({ title, label = 'دلیل (اجباری)', confirmText = 'تأیید', danger = false, message = '', required = true, placeholder = '' }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const m = AP.modal({
        title, top: true,
        body: `<form class="form">
          ${message ? `<p class="muted u-copy">${esc(message)}</p>` : ''}
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
        body: `<p class="u-copy-gap">${esc(message)}</p>
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

  // صفحه‌ی اول: داشبورد (اگر مجوزش را دارد) ← پروفایل خودش ← اولین صفحه‌ی مجاز ← null (هیچ صفحه‌ای مجاز نیست)
  AP.homeRoute = function homeRoute() {
    if (AP.viewAllowed(AP.views.dashboard)) return { id: 'dashboard', param: null };
    if (AP.selfOnly() && AP.viewAllowed(AP.views.mystatus)) return { id: 'mystatus', param: null }; // M2: کارمند بعد از ورود مستقیم به «وضعیت من»
    if (AP.viewAllowed(AP.views.profile)) return { id: 'profile', param: AP.state.me.id };
    const first = AP.nav.find((n) => AP.viewAllowed(AP.views[n.id]));
    return first ? { id: first.id, param: null } : null;
  };

  // انیمیشن count-up سبک برای عددهای ساده‌ی .stat-value (متن نهایی دقیقاً همان متن اصلی می‌ماند؛ با reduced-motion خاموش)
  let lastRouteKey = null;
  function countUp(root) {
    if (!window.requestAnimationFrame || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const FA = '۰۱۲۳۴۵۶۷۸۹';
    $$('.stat-value', root).forEach((el) => {
      if (el.children.length) return;
      const text = el.textContent.trim();
      if (!/^[0-9۰-۹٬,]+$/.test(text)) return;
      const target = Number(text.replace(/[٬,]/g, '').replace(/[۰-۹]/g, (d) => FA.indexOf(d)));
      if (!Number.isFinite(target) || target < 2 || target > 1e9) return;
      const show = (n) => (AP.fmt && AP.fmt.num ? AP.fmt.num(Math.round(n)) : String(Math.round(n)));
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 450);
        if (p >= 1 || !el.isConnected) { el.textContent = text; return; }
        el.textContent = show(target * (1 - (1 - p) * (1 - p)));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  async function route() {
    if (!AP.state.me) return;
    let { id, param } = parseHash();
    let def = AP.views[id];
    // صفحه فقط با مجوزِ تعریف‌شده در perm باز می‌شود (امن‌به‌صورت‌پیش‌فرض)؛ در غیر این صورت صفحه‌ی اول
    if (!AP.viewAllowed(def)) {
      const home = AP.homeRoute();
      if (!home) {
        AP.currentRoute = { id: null, param: null };
        $$('.nav-item').forEach((b) => b.classList.remove('active'));
        $('#page').innerHTML = `<div class="card"><div class="empty">${AP.icon('alert')}برای حساب شما هیچ بخشی در پنل فعال نیست. با ادمین تماس بگیرید.</div></div>`;
        return;
      }
      id = home.id;
      param = home.param;
      def = AP.views[id];
    }
    if (AP.selfOnly() && id === 'profile') param = AP.state.me.id; // بدون users.read فقط پروفایل خودش
    if (AP.onLeave) { try { AP.onLeave(); } catch (_) {} AP.onLeave = null; }
    AP.currentRoute = { id, param };
    const token = ++routeToken;

    // وضعیت فعال ناوبری
    const navKey = AP.selfOnly() && id === 'profile' ? 'profile' : (def.navId || id);
    AP.setActiveNav(navKey);
    closeSidebar();

    const page = $('#page');
    page.setAttribute('aria-busy', 'true');
    page.innerHTML = window.UiStates ? window.UiStates.skeletonHtml(def.skeleton || 'page') : '<div class="loading"><div class="spinner"></div>در حال بارگذاری…</div>'; // S5-9c
    try {
      const result = await def.render(param);
      if (token !== routeToken) return; // کاربر وسط بارگذاری صفحه عوض کرد
      page.innerHTML = result.html;
      $$('[data-progress]', page).forEach((el) => el.style.setProperty('--progress', `${Math.max(0, Math.min(100, Number(el.dataset.progress) || 0))}%`));
      window.scrollTo({ top: 0 });
      if (result.mount) result.mount(page);
      page.removeAttribute('aria-busy');
      const routeKey = `${id}:${param == null ? '' : param}`;
      if (routeKey !== lastRouteKey) countUp(page); // فقط هنگام ورود به صفحه، نه در رفرش‌های خودکار
      lastRouteKey = routeKey;
      if (window.A11y) window.A11y.enhance(page); // ردیف‌های کلیک‌پذیر/سرستون‌های مرتب‌سازی با کیبورد (S5-9a)
    } catch (err) {
      if (token !== routeToken) return;
      page.removeAttribute('aria-busy');
      page.innerHTML = window.UiStates
        ? window.UiStates.errorHtml(err.message, { icon: AP.icon('alert'), retryId: 'retry-btn', esc })
        : `<div class="card"><div class="empty" role="alert">${AP.icon('alert')}${esc(err.message)}
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
    const mb = $('#menu-btn'); if (mb) mb.setAttribute('aria-expanded', 'false');
  }

  // نشان عددیِ یک آیتم منو (data-view = k) از AP.state.counts[k]؛ عدد کامل در aria-label/title
  function paintCount(k) {
    const el = $(`.nav-item[data-view="${k}"] .nav-count`);
    if (!el) return;
    const n = (AP.state.counts && AP.state.counts[k]) || 0;
    el.textContent = n > 9 ? `${fmt.num(9)}+` : fmt.num(n); // نشان کوتاه (۹+)؛ عدد کامل در aria-label
    el.classList.toggle('hidden', !n);
    const btn = el.closest ? el.closest('.nav-item') : null;
    const lab = btn && btn.querySelector ? btn.querySelector('.nav-label') : null;
    if (btn && lab) {
      const full = n ? `${lab.textContent} (${fmt.num(n)} مورد)` : lab.textContent;
      btn.setAttribute('aria-label', full);
      btn.setAttribute('title', full);
    }
  }

  AP.refreshCounts = async function refreshCounts() {
    AP.refreshMyTasksCount(); // مستقل از بقیه؛ شکستِ هرکدام دیگری را خراب نمی‌کند
    try {
      // فقط شمارنده‌هایی که مجوزشان را دارد؛ بقیه صفر (درخواستِ بی‌مجوز ۴۰۳ می‌گیرد)
      const [leave, disputes] = await Promise.all([
        AP.can('leave.read') ? AP.api('/admin/leave-requests?status=pending') : [],
        AP.can('disputes.read') ? AP.api('/admin/disputes?status=open') : [],
      ]);
      // شکست موارد مشکوک شمارنده‌های دیگر را خراب نمی‌کند
      let suspicious = [];
      if (AP.can('suspicious.read')) {
        try { suspicious = await AP.api('/admin/suspicious?status=open'); } catch (_) { suspicious = []; }
      }
      // D3: درخواست‌های اجازه‌ی ورودِ در انتظار (فقط با مجوز؛ شکست شمارنده‌های دیگر را خراب نمی‌کند)
      let checkinPerms = [];
      if (AP.can('checkin_permissions.read')) {
        try { checkinPerms = (await AP.api('/admin/checkin-permissions?status=pending')).items || []; } catch (_) { checkinPerms = []; }
      }
      // R6 (فاز ۱۴): دورکاریِ منتظر بررسی (فقط با مجوز؛ شکست شمارنده‌های دیگر را خراب نمی‌کند)
      let remotePending = 0;
      if (AP.can('remote_work.read')) {
        try { remotePending = (await AP.api('/admin/remote-work/count')).pending || 0; } catch (_) { remotePending = 0; }
      }
      AP.state.counts = { ...AP.state.counts, leave: leave.length, disputes: disputes.length, nightly: leave.length + disputes.length, suspicious: suspicious.length, checkin_permissions: checkinPerms.length, remote: remotePending };
      ['leave', 'disputes', 'nightly', 'suspicious', 'checkin_permissions', 'remote'].forEach(paintCount);
    } catch (_) { /* غیرحیاتی */ }
  };

  // M4: نشان «تسک‌های بی‌پاسخِ امروز» کنار «وضعیت من». فقط یک GET سبک (بدون بقیه‌ی شمارنده‌ها)؛
  // بعد از هر تیک/برداشتن تیک در صفحه‌ی «وضعیت من» هم صدا زده می‌شود. شکست/نبودن مجوز ⇒ نشان پنهان (هرگز خطا به کاربر نمی‌رسد).
  AP.refreshMyTasksCount = async function refreshMyTasksCount() {
    let n = 0;
    if (AP.can('me.read')) {
      try { n = Number((await AP.api('/admin/me/tasks/pending-count')).pending) || 0; } catch (_) { n = 0; }
    }
    AP.state.counts = { ...AP.state.counts, mystatus: n };
    paintCount('mystatus');
  };

  function buildNav() {
    const groups = {};
    // فقط صفحه‌هایی که مجوزشان را دارد؛ کاربر بدون users.read (کارمند) به‌جای فهرست کارمندان «پروفایل من» می‌بیند
    const items = AP.nav.filter((n) => AP.viewAllowed(AP.views[n.id]));
    if (AP.selfOnly() && AP.viewAllowed(AP.views.profile)) {
      items.unshift({ id: 'profile', icon: 'employees', label: 'پروفایل من', group: 'پنل من', param: AP.state.me.id });
    }
    // M2/M4: «وضعیت من» با نشان تسک‌های بی‌پاسخِ امروز. کارمند: اولین آیتم «پنل من» (بالاتر از «پروفایل من»)؛
    // سرپرست/منابع انسانی/ادمین: یک آیتم در گروه «پنل من» انتهای منو (ترتیب و جای بقیه‌ی گروه‌ها دست نمی‌خورد)
    if (AP.viewAllowed(AP.views.mystatus)) {
      const mine = { id: 'mystatus', icon: 'attendance', label: 'وضعیت من', group: 'پنل من', counter: true };
      if (AP.selfOnly()) items.unshift(mine); else items.push(mine);
    }
    items.forEach((n) => { (groups[n.group] = groups[n.group] || []).push(n); });
    $('#side-nav').innerHTML = Object.keys(groups)
      .map((g) => `<div class="nav-group">${esc(g)}</div>${groups[g].map(AP.navItemHtml).join('')}`)
      .join('');
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => AP.go(b.dataset.view, b.dataset.param)));
  }

  // T3: هر آیتم ریل aria-label و title (برچسب فارسی) دارد؛ در حالت آیکنی متنِ .nav-label فقط برای صفحه‌خوان است
  AP.navItemHtml = function navItemHtml(n) {
    const label = esc(n.label);
    return `<button class="nav-item" type="button" data-view="${n.id}"${n.param != null ? ` data-param="${n.param}"` : ''} aria-label="${label}" title="${label}">${AP.icon(n.icon)}<span class="nav-label">${label}</span>${n.counter ? '<span class="nav-count hidden"></span>' : ''}</button>`;
  };

  // آیتم فعال: فقط یکی aria-current="page" دارد؛ در لیست اسکرول‌دار (۲۶ آیتم) دیده می‌شود
  AP.setActiveNav = function setActiveNav(navKey) {
    $$('.nav-item').forEach((b) => {
      const on = b.dataset.view === navKey;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const act = $('.nav-item.active');
    if (act && typeof act.scrollIntoView === 'function') { try { act.scrollIntoView({ block: 'nearest' }); } catch (_) { /* غیرحیاتی */ } }
  };

  // ---------- ریل: حالت آیکنی/بازشده (T3) ----------
  const RAIL_KEY = 'adminRail'; // 'rail' | 'expanded'؛ پیش‌فرض rail؛ localStorage مسدود/ناقص ⇒ بدون خطا
  AP.rail = {
    read() {
      try { return window.localStorage.getItem(RAIL_KEY) === 'expanded' ? 'expanded' : 'rail'; } catch (_) { return 'rail'; }
    },
    apply(mode, persist) {
      const expanded = mode === 'expanded';
      const shell = $('#app-shell');
      if (shell) shell.classList.toggle('rail-expanded', expanded);
      const btn = $('#rail-toggle');
      if (btn) {
        const text = expanded ? 'جمع کردن منو به حالت آیکنی' : 'نمایش برچسب‌های منو';
        btn.setAttribute('aria-expanded', String(expanded));
        btn.setAttribute('aria-label', text);
        btn.setAttribute('title', text);
      }
      if (persist) { try { window.localStorage.setItem(RAIL_KEY, expanded ? 'expanded' : 'rail'); } catch (_) { /* غیرحیاتی */ } }
      return expanded ? 'expanded' : 'rail';
    },
    toggle() {
      const shell = $('#app-shell');
      const now = shell && shell.classList.contains('rail-expanded');
      return AP.rail.apply(now ? 'rail' : 'expanded', true);
    },
  };

  // تولتیپ فارسی (فقط دسکتاپِ حالت آیکنی): با hover و فوکوسِ کیبورد؛ title بومی در حین نمایش برداشته می‌شود تا دوبار دیده نشود
  function setupRailTip() {
    const sidebar = $('#sidebar');
    const tip = $('#rail-tip');
    if (!sidebar || !tip) return;
    let cur = null;
    const railOn = () => {
      const shell = $('#app-shell');
      if (!shell || shell.classList.contains('rail-expanded')) return false;
      return !!(window.matchMedia && window.matchMedia('(min-width: 901px)').matches);
    };
    const targetOf = (e) => (e.target && e.target.closest ? e.target.closest('.nav-item, #rail-toggle, #logout-btn') : null);
    const hide = () => {
      if (cur && cur.dataset && cur.dataset.tipTitle != null) { cur.setAttribute('title', cur.dataset.tipTitle); delete cur.dataset.tipTitle; }
      cur = null;
      tip.classList.remove('show');
      tip.setAttribute('aria-hidden', 'true');
    };
    const show = (el) => {
      if (!railOn()) return;
      const text = el.getAttribute('aria-label');
      if (!text) return;
      hide();
      cur = el;
      if (el.hasAttribute('title')) { el.dataset.tipTitle = el.getAttribute('title'); el.removeAttribute('title'); }
      tip.textContent = text;
      tip.classList.add('show');
      tip.setAttribute('aria-hidden', 'true'); // نام قابل‌دسترس همان aria-label خودِ کنترل است
      const r = el.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.round(r.left - 10 - tip.offsetWidth))}px`;
      tip.style.top = `${Math.round(r.top + (r.height - tip.offsetHeight) / 2)}px`;
    };
    sidebar.addEventListener('mouseover', (e) => { const t = targetOf(e); if (t && t !== cur) show(t); });
    sidebar.addEventListener('mouseout', (e) => { if (cur && !(e.relatedTarget && cur.contains && cur.contains(e.relatedTarget))) hide(); });
    sidebar.addEventListener('focusin', (e) => {
      const t = targetOf(e);
      let kb = true;
      try { kb = !!(t && t.matches(':focus-visible')); } catch (_) { kb = true; }
      if (t && kb) show(t);
    });
    sidebar.addEventListener('focusout', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) hide(); });
    const nav = $('#side-nav');
    if (nav) nav.addEventListener('scroll', hide);
    window.addEventListener('resize', hide);
  }
  AP.setupRailTip = setupRailTip; // برای تست

  function setupSearch() {
    const input = $('#global-search');
    const box = $('#search-results');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', 'search-results');
    input.setAttribute('aria-expanded', 'false');
    box.setAttribute('role', 'listbox');
    let active = -1;
    const hide = () => { box.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); };
    const commands = () => [
      ...AP.nav.filter((n) => AP.viewAllowed(AP.views[n.id])).map((n) => ({ type: 'page', id: n.id, label: n.label, detail: n.group || 'صفحه' })),
      { type: 'action', id: 'refresh', label: 'تازه‌سازی صفحه', detail: 'اقدام سریع' },
      { type: 'action', id: 'theme', label: 'تغییر تم روشن یا تیره', detail: 'اقدام سریع' },
      { type: 'action', id: 'density', label: 'تغییر تراکم نمایش', detail: 'اقدام سریع' },
    ];
    const paintActive = () => {
      const items = $$('.search-item', box);
      items.forEach((el, i) => el.classList.toggle('active', i === active));
      if (items[active]) { items[active].id = items[active].id || `cmd-${active}`; input.setAttribute('aria-activedescendant', items[active].id); items[active].scrollIntoView({ block: 'nearest' }); }
    };
    const render = async () => {
      const q = input.value.trim().toLowerCase();
      const pages = commands().filter((x) => !q || x.label.toLowerCase().includes(q));
      const users = q && AP.can('users.read') ? await AP.loadUsers().catch(() => []) : [];
      const hits = users
        .filter((u) => (u.fullName || '').toLowerCase().includes(q) || (u.personnelCode || '').toLowerCase().includes(q))
        .slice(0, 8);
      const pageHtml = pages.slice(0, q ? 8 : 12).map((x) => `<button type="button" role="option" class="search-item" ${x.type === 'action' ? `data-action="${esc(x.id)}"` : `data-view="${esc(x.id)}"`}>${AP.icon(x.type === 'action' ? 'settings' : 'dashboard')}<span>${esc(x.label)}</span><small>${esc(x.detail)}</small></button>`).join('');
      const userHtml = hits.map((u) => `<button type="button" role="option" class="search-item" data-id="${u.id}">${AP.avatar(u.fullName, 'sm')}<span>${esc(u.fullName)}</span><small>${esc(u.department || '')}</small></button>`).join('');
      box.innerHTML = pageHtml + userHtml || '<div class="empty u-empty-compact">موردی پیدا نشد.</div>';
      box.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
      const items = $$('.search-item', box);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (box.classList.contains('hidden')) render(); active = items.length ? (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length : -1; paintActive(); }
      else if (e.key === 'Enter' && active >= 0 && items[active]) { e.preventDefault(); items[active].click(); }
      else if (e.key === 'Escape') { hide(); input.blur(); }
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('.search-item');
      if (!b) return;
      hide();
      input.value = '';
      if (b.dataset.action === 'refresh') $('#refresh-btn').click();
      else if (b.dataset.action === 'theme') $('#theme-btn').click();
      else if (b.dataset.action === 'density') $('#density-btn').click();
      else AP.go(b.dataset.view || 'profile', b.dataset.id || null);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) hide(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.focus(); input.select(); render(); }
    });
  }

  function setupDensity() {
    const btn = $('#density-btn');
    if (!btn) return;
    const apply = (value) => {
      const compact = value === 'compact';
      if (document.body && document.body.dataset) document.body.dataset.density = compact ? 'compact' : 'comfortable';
      btn.setAttribute('aria-pressed', compact ? 'true' : 'false');
      btn.title = compact ? 'نمایش راحت' : 'نمایش فشرده';
    };
    let stored = 'comfortable';
    try { stored = localStorage.getItem('adminDensity') || stored; } catch (_) {}
    apply(stored);
    btn.addEventListener('click', () => {
      const next = document.body && document.body.dataset && document.body.dataset.density === 'compact' ? 'comfortable' : 'compact';
      apply(next);
      try { localStorage.setItem('adminDensity', next); } catch (_) {}
    });
  }

  async function enterApp() {
    $('#login-screen').classList.add('hidden');
    $('#app-shell').classList.remove('hidden');
    const me = AP.state.me;
    await AP.loadPermissions(); // قبل از ساخت منو؛ بدون آن همه‌چیز بسته می‌ماند
    // فقط برچسب نمایشی زیر لوگو (کنترل دسترسی نیست)
    $('.brand-sub').textContent = { admin: 'پنل مدیریتی', manager: 'پنل سرپرست', hr: 'پنل منابع انسانی', employee: 'پنل کارمند' }[me.role] || 'پنل';
    if (AP.selfOnly()) $('#global-search').placeholder = 'جستجوی صفحه یا اقدام…'; // بدون users.read فقط فرمان‌ها/صفحه‌ها، نه افراد
    $('#me-avatar').textContent = AP.initials(me.fullName);
    $('#me-name').textContent = me.fullName;
    $('#me-role').textContent = AP.ROLE[me.role] || me.role;
    $('#topbar-date').textContent = fmt.dateFull(fmt.today());
    $('.me-box').setAttribute('title', me.fullName);
    AP.rail.apply(AP.rail.read(), false);
    buildNav();
    setupSearch();
    setupDensity();
    setupRailTip();
    $('#rail-toggle').addEventListener('click', () => { AP.rail.toggle(); const t = $('#rail-tip'); if (t) t.classList.remove('show'); });
    $('#menu-btn').addEventListener('click', () => {
      $('#sidebar').classList.add('open');
      $('#sidebar-backdrop').classList.add('open');
      $('#menu-btn').setAttribute('aria-expanded', 'true');
    });
    $('#sidebar-backdrop').addEventListener('click', closeSidebar);
    $('#refresh-btn').addEventListener('click', () => { AP.state.users = null; AP.refresh(); AP.refreshCounts(); if (AP.bell) AP.bell.refresh(); });
    $('#logout-btn').addEventListener('click', async () => {
      try { await AP.api('/admin/auth/logout', { method: 'POST' }); } catch (_) {}
      location.reload();
    });
    AP.refreshCounts();
    if (AP.bell) AP.bell.init(); // زنگوله‌ی اعلان (S4-6a؛ js/bell.js) — بعد از loadPermissions تا default-deny درست کار کند
    // ?go=<صفحه> از دکمه‌های بات (مثلاً دکمه‌ی پیام شبانه → مرور شبانه)
    // H5-ب: go می‌تواند «صفحه/پارامتر» باشد (مثلاً teamreports/2026-10-14)؛ پارامتر فقط حروف/عدد/خط‌تیره/زیرخط
    const [goView, goParam] = String((AP.launch && AP.launch.go) || '').split('/');
    if (goView && AP.viewAllowed(AP.views[goView])) {
      history.replaceState(null, '', `#/${goView}${goParam && /^[A-Za-z0-9_-]{1,32}$/.test(goParam) ? `/${goParam}` : ''}`);
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

  // ---------- ورود با کد یک‌بارمصرف بات (منوی بات ← «🖥 پنل») ----------
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
      : launch.initData ? ['/admin/auth/webapp', null, { 'X-Telegram-Init-Data': launch.initData }] : null;
    if (viaBot) {
      try {
        const result = await AP.api(viaBot[0], { method: 'POST', body: viaBot[1], headers: viaBot[2] });
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
      // بدون initData، بدون توکن و بدون نشست معتبر: راهنمای روشن به‌جای صفحه‌ی خالی/خطای فنی
      $('#login-error').textContent = 'برای ورود، از دکمه‌ی 📂 منو در بات باز کنید.';
      setupLoginWidget();
    }
  };
})();
