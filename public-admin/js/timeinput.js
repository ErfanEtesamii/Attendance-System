// ورودی ساعت قابل‌تایپ برای پنل (H4) — بدون وابستگی. در مرورگر `window.TimeInput`، در Node با require (برای تست).
// مشکل: <input type="time"> روی موبایل/WebView تلگرام به‌جای کیبورد، چرخ ساعت بومی باز می‌کند (و روی بعضی گوشی‌ها اصلاً باز نمی‌شود).
// راه‌حل: ورودی متنی با inputmode=numeric، ماسک خودکار «HH:MM»، پذیرش ارقام فارسی/عربی و قالب‌های 1530 / 15.30 / 15:3 و پیام خطای فارسی.
// مقدار نهایی همیشه «HH:MM» (۲۴ ساعته، لاتین) است؛ مقدار ناقص/نامعتبر در el.value می‌ماند تا خطا دیده شود و بی‌صدا ذخیره نشود.
//
// قرارداد تفسیر (parse): «1530»/«930» ⇒ دو رقم آخر دقیقه؛ «15.30» و «15:30» و «۱۵:۳۰» ⇒ 15:30؛ «15:3» ⇒ 15:03؛ «9» یا «15» ⇒ ساعتِ تمام (09:00 / 15:00).
// ساعت ۰–۲۳ و دقیقه ۰–۵۹؛ «24:00» نامعتبر است.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimeInput = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FA = '۰۱۲۳۴۵۶۷۸۹';
  var AR = '٠١٢٣٤٥٦٧٨٩';
  var MSG_FORMAT = 'ساعت نامعتبر است؛ مثل 15:30 وارد کنید.';
  var MSG_HOUR = 'ساعت باید بین ۰ تا ۲۳ باشد.';
  var MSG_MIN = 'دقیقه باید بین ۰ تا ۵۹ باشد.';

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /** ارقام فارسی (۰-۹) و عربی (٠-٩) ⇒ لاتین؛ بقیه‌ی نویسه‌ها دست‌نخورده. */
  function toLatinDigits(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[۰-۹٠-٩]/g, function (c) {
      var i = FA.indexOf(c);
      if (i < 0) i = AR.indexOf(c);
      return String(i);
    });
  }

  // رقم لاتین + جداکننده‌ها (نقطه، «٫» عربی، «：» تمام‌عرض) ⇒ «:»؛ فاصله و نویسه‌های جهت‌نما حذف می‌شود.
  function clean(raw) {
    return toLatinDigits(raw)
      .replace(/[\s\u200b-\u200f\u202a-\u202e]/g, '')
      .replace(/[.٫：]/g, ':');
  }

  /**
   * تفسیر کامل مقدار (هنگام blur/ثبت).
   * ⇒ { ok: true, value: 'HH:MM' } | { ok: false, empty: true, error: '' } | { ok: false, error: '<پیام فارسی>' }
   */
  function parse(raw) {
    var s = clean(raw);
    if (s === '') return { ok: false, empty: true, error: '' };
    var h; var m;
    var mm = /^(\d{1,2}):(\d{1,2})$/.exec(s);
    if (mm) { h = mm[1]; m = mm[2]; }
    else if (/^\d{3,4}$/.test(s)) { h = s.slice(0, s.length - 2); m = s.slice(-2); }
    else if (/^\d{1,2}$/.test(s)) { h = s; m = '0'; }
    else return { ok: false, error: MSG_FORMAT };
    h = parseInt(h, 10);
    m = parseInt(m, 10);
    if (h > 23) return { ok: false, error: MSG_HOUR };
    if (m > 59) return { ok: false, error: MSG_MIN };
    return { ok: true, value: pad(h) + ':' + pad(m) };
  }

  /**
   * ماسک هنگام تایپ (رویداد input): ارقام فارسی/عربی ⇒ لاتین، نویسه‌های غیرمجاز حذف، «:» خودکار بعد از دو رقم، حداکثر ۵ نویسه.
   * «153» ⇒ «15:3»، «1530» ⇒ «15:30»، «930» ⇒ «9:30»، «15.30» ⇒ «15:30»، «9:5» دست‌نخورده می‌ماند (تا blur).
   */
  function mask(raw) {
    var s = clean(raw).replace(/[^\d:]/g, '');
    var i = s.indexOf(':');
    if (i >= 0) {
      var h = s.slice(0, i).slice(0, 2);
      var m = s.slice(i + 1).replace(/:/g, '').slice(0, 2);
      return h + ':' + m;
    }
    s = s.slice(0, 4);
    if (s.length < 3) return s;
    // «930» ⇒ «9:30» (فقط سه رقمی و دو رقم اول بیش از ۲۳ ⇒ ساعت تک‌رقمی)؛ وگرنه بعد از دو رقم «:» — «2500» ⇒ «25:00» (خطای ساعت، نه ۰۲:۵۰ بی‌صدا)
    var cut = s.length === 3 && parseInt(s.slice(0, 2), 10) > 23 ? 1 : 2;
    return s.slice(0, cut) + ':' + s.slice(cut, cut + 2);
  }

  var uid = 0;

  // ---- کیبورد گوشی و دیده‌شدن فیلد (H4) ----
  // روی موبایل کیبورد روی صفحه می‌افتد و visualViewport کوچک می‌شود؛ ارتفاع کیبورد را در --kb می‌گذاریم (CSS مودال از آن استفاده می‌کند)
  // و فیلدِ فوکوس‌شده را با scrollIntoView به مرکز ناحیه‌ی دیدنی می‌آوریم (داخل مودال، خودِ مودال اسکرول می‌خورد).
  var watching = false;
  function reveal(el) {
    if (!el || !el.scrollIntoView) return;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); } catch (_) { el.scrollIntoView(); }
  }
  function watchViewport(win) {
    if (watching || !win || !win.visualViewport) return;
    watching = true;
    var vv = win.visualViewport;
    var update = function (doReveal) {
      var kb = Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop));
      var open = kb > 80; // کمتر از ~۸۰px معمولاً نوار آدرس است نه کیبورد
      win.document.documentElement.style.setProperty('--kb', open ? kb + 'px' : '0px');
      var a = win.document.activeElement;
      if (doReveal && open && a && a.__timeInput) reveal(a);
    };
    vv.addEventListener('resize', function () { update(true); });
    vv.addEventListener('scroll', function () { update(false); }); // فقط --kb؛ reveal از اینجا حلقه می‌سازد
  }

  /**
   * el را به ورودی ساعت قابل‌تایپ تبدیل می‌کند (type=text، inputmode=numeric، pattern، ماسک، پیام خطای فارسی زیر فیلد).
   * ⇒ { el, getValue(): 'HH:MM' یا '' (خالی/نامعتبر)، invalid(): boolean، commit() }
   * opts.errorHost: عنصری که پیام خطا بعد از آن درج می‌شود (پیش‌فرض: خودِ el).
   */
  function attach(el, opts) {
    opts = opts || {};
    if (el.__timeInput) return el.__timeInput;
    var initial = /^\d{2}:\d{2}/.test(el.value || '') ? el.value.slice(0, 5) : (el.value || '');
    el.type = 'text';
    el.value = initial;
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('pattern', '[0-9]{2}:[0-9]{2}');
    el.setAttribute('maxlength', '5');
    el.setAttribute('dir', 'ltr');
    el.setAttribute('placeholder', 'HH:MM');
    el.setAttribute('autocomplete', 'off');
    if (el.classList) { el.classList.add('time-in'); el.classList.add('ltr-in'); }

    var host = opts.errorHost || el;
    var err = el.ownerDocument.createElement('small');
    uid += 1;
    err.id = 'time-err-' + uid;
    err.className = 'time-err';
    err.setAttribute('role', 'alert');
    err.hidden = true;
    host.after(err);

    var bad = false;
    function setError(msg) {
      bad = !!msg;
      if (msg) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', err.id);
        if (el.setCustomValidity) el.setCustomValidity(msg);
        err.textContent = msg;
        err.hidden = false;
      } else {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
        if (el.setCustomValidity) el.setCustomValidity('');
        err.textContent = '';
        err.hidden = true;
      }
    }

    function commit() {
      var r = parse(el.value);
      if (r.ok) { el.value = r.value; setError(''); return; }
      if (r.empty) { el.value = ''; setError(''); return; }
      setError(r.error);
    }

    el.addEventListener('input', function () {
      var masked = mask(el.value);
      if (masked !== el.value) el.value = masked;
      if (bad) setError(''); // کاربر در حال اصلاح است؛ خطا تا blur بعدی پنهان می‌ماند
    });
    el.addEventListener('blur', commit);
    el.addEventListener('change', commit);
    var win = el.ownerDocument.defaultView;
    watchViewport(win);
    el.addEventListener('focus', function () {
      // کیبورد با تأخیر بالا می‌آید؛ بعد از انیمیشنش فیلد را نشان بده (resize هم دوباره صدا می‌زند)
      setTimeout(function () { if (el.ownerDocument.activeElement === el) reveal(el); }, 300);
    });

    var api = {
      el: el,
      getValue: function () { var r = parse(el.value); return r.ok ? r.value : ''; },
      invalid: function () { return bad; },
      commit: commit,
    };
    el.__timeInput = api;
    return api;
  }

  return { toLatinDigits: toLatinDigits, parse: parse, mask: mask, attach: attach, MESSAGES: { format: MSG_FORMAT, hour: MSG_HOUR, minute: MSG_MIN } };
}));
