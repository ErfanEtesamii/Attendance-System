(function (root) {
  'use strict';
  const token = Symbol('SafeHtml');
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const raw = (value) => ({ [token]: true, value: String(value == null ? '' : value) });
  function html(parts, ...values) { let value = parts[0]; values.forEach((item, i) => { value += item && item[token] ? item.value : esc(item); value += parts[i + 1]; }); return { [token]: true, value }; }
  html.raw = raw;
  function setHtml(el, safe) { if (!safe || !safe[token]) throw new TypeError('setHtml فقط SafeHtml می‌پذیرد.'); el.innerHTML = safe.value; }
  root.SafeHtml = { esc, html, setHtml };
}(window));
