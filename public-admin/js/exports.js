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
    const parts = FORMATS.map(([fmt, label]) => `<a class="btn ghost" data-export="${fmt}" href="${esc(buildUrl(spec.path, spec.params, fmt))}" download>${icon('download')} ${label}</a>`);
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
  }
}(typeof window !== 'undefined' ? window : undefined));
