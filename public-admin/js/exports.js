// دکمه‌های دانلود Excel / CSV / چاپ برای همه‌ی گزارش‌های پنل (S5-5b).
// قرارداد: لینک‌ها همیشه با «فیلتر فعال همان صفحه» ساخته می‌شوند (پارامترهای خالی حذف می‌شوند)؛ خود فایل را سرور با همان اسکوپ نقش می‌سازد.
// چاپ: print:'window' ⇒ دکمه‌ی window.print() (استایل چاپ جدول‌ها در پنل) | print:{href} ⇒ لینک صفحه‌ی چاپ مستقل (مثل print.html) | false ⇒ بدون چاپ.
// رویداد کلیک با event delegation است (CSP پنل on* درون‌خطی را اجازه نمی‌دهد).
(function (root) {
  'use strict';

  const FORMATS = [['xlsx', 'Excel'], ['csv', 'CSV']];

  const clean = (params) => Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);

  // path + پارامترهای غیرخالی (+ format اختیاری) ⇒ آدرس
  function buildUrl(path, params, format) {
    const q = new URLSearchParams(clean(params).map(([k, v]) => [k, String(v)]));
    if (format) q.set('format', format);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  }

  /**
   * @param {{path: string, params?: object, print?: 'window'|{href: string}|false}} spec
   * @param {{esc?: Function, icon?: Function}} [deps]
   * @returns {string} HTML ‌ی گروه دکمه‌ها
   */
  function exportBarHtml(spec, deps = {}) {
    const esc = deps.esc || ((v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const icon = deps.icon || (() => '');
    const formats = spec.formats || FORMATS;
    const parts = formats.map(([fmt, label]) => `<a class="btn ghost small" data-export="${fmt}" href="${esc(buildUrl(spec.path, spec.params, fmt))}" download>${icon('download')} ${label}</a>`);
    const print = spec.print === undefined ? 'window' : spec.print;
    if (print === 'window') parts.push(`<button type="button" class="btn ghost" data-print>${icon('download')} چاپ</button>`);
    else if (print && print.href) parts.push(`<a class="btn ghost" data-export="print" href="${esc(print.href)}" target="_blank" rel="noopener">${icon('download')} چاپ</a>`);
    return parts.join('');
  }

  const api = { FORMATS, buildUrl, exportBarHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (root && root.AP && root.document) {
    const AP = root.AP;
    AP.exportBar = (spec) => exportBarHtml(spec, { esc: AP.esc, icon: (n) => AP.icon(n) });
    AP.buildExportUrl = buildUrl;
    root.document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-print]')) root.print();
    });

    // دانلود Excel/CSV با fetch: اگر سرور خطا بدهد (۴xx/۵xx) پیام واقعی در توست دیده می‌شود، نه یک فایل «export.json» بی‌معنی.
    // اگر سرور به‌جای xlsx، CSV داده باشد (exceljs نصب نیست) هم اعلام می‌شود. کلیک‌های غیر-fetch (مرورگر قدیمی) همان لینک عادی می‌مانند.
    const fileName = (res, fallback) => {
      const cd = res.headers.get('Content-Disposition') || '';
      const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
      if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch (_) { /* ادامه */ } }
      const plain = /filename="?([^";]+)"?/i.exec(cd);
      return plain ? plain[1] : fallback;
    };
    root.document.addEventListener('click', async (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[data-export="xlsx"], a[data-export="csv"]') : null;
      if (!a || typeof root.fetch !== 'function') return;
      e.preventDefault();
      if (a.getAttribute('aria-busy') === 'true') return;
      a.setAttribute('aria-busy', 'true');
      try {
        const res = await root.fetch(a.href, { credentials: 'include', headers: { 'X-Requested-With': 'AttendancePanel' } });
        if (!res.ok) {
          let msg = '';
          try { msg = (await res.json()).error || ''; } catch (_) { /* بدنه JSON نبود */ }
          AP.toast(`دریافت خروجی ناموفق بود (${res.status})${msg ? `: ${msg}` : ''}`, true);
          return;
        }
        const notice = res.headers.get('X-Export-Notice');
        if (notice) { try { AP.toast(decodeURIComponent(notice), true); } catch (_) { /* نادیده */ } }
        const blob = await res.blob();
        const url = root.URL.createObjectURL(blob);
        const link = root.document.createElement('a');
        link.href = url;
        link.download = fileName(res, `export.${a.dataset.export}`);
        root.document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => root.URL.revokeObjectURL(url), 10000);
      } catch (err) {
        AP.toast(`دریافت خروجی ناموفق بود: ${err && err.message ? err.message : 'خطای شبکه'}`, true);
      } finally {
        a.removeAttribute('aria-busy');
      }
    });
  }
}(typeof window !== 'undefined' ? window : undefined));
