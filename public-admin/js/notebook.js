// سیستم طراحی «دفترچه» (فاز ۱۳ — C1): فقط کمک‌تابع‌های ساخت DOM زیر AP.notebook. وابستگی خارجی ندارد.
// امنیت: متن همیشه با textContent/createTextNode ساخته می‌شود؛ هیچ‌جا HTML خام از داده‌ی کاربر ساخته نمی‌شود.
// همه‌ی عناصر کلاس‌های .nb-* دارند و باید داخل یک ریشه‌ی .nb (AP.notebook.root) قرار بگیرند. استایل: css/notebook.css.
(function () {
  'use strict';
  const AP = (window.AP = window.AP || {}); // دموی مستقل (nb-demo.html) core.js را بارگذاری نمی‌کند

  const TAPE_TONES = ['rose', 'sage', 'sand', 'lilac', 'sky'];
  const CHIP_TONES = ['work', 'half', 'off', 'holiday', 'leave', 'mission', 'warn', 'urgent', 'locked'];

  /** h('div', { class: 'x', text: '…', attrs: { role: 'list' }, on: { click: fn } }, child, 'text', …) */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text != null) node.textContent = String(props.text);
    for (const [k, v] of Object.entries(props.attrs || {})) if (v != null && v !== false) node.setAttribute(k, v === true ? '' : String(v));
    for (const [ev, fn] of Object.entries(props.on || {})) node.addEventListener(ev, fn);
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }

  const pick = (list, v, fallback) => (list.includes(v) ? v : fallback);

  /** ریشه‌ی اسکوپ‌شده؛ هر چیدمان دفترچه داخل آن قرار می‌گیرد. */
  const root = (...children) => h('div', { class: 'nb' }, ...children);

  /** نوار چسب دکوراتیو. label اختیاری (برای کارت روز: آیکون + متن، تا فقط به رنگ متکی نباشد). */
  const tape = (tone = 'rose', label = '') => h('span', { class: `nb-tape nb-tape--${pick(TAPE_TONES, tone, 'rose')}`, text: label });

  /** خط‌دار: لیست خط‌دار؛ items = Node[] ؛ بدون آیتم ⇒ پیام خالی. */
  function lines(items, { emptyText = '' } = {}) {
    const list = h('ul', { class: 'nb-lines' });
    const nodes = (items || []).filter(Boolean);
    if (!nodes.length) {
      list.classList.add('nb-lines--empty');
      list.appendChild(h('li', { text: emptyText }));
      return list;
    }
    for (const n of nodes) list.appendChild(h('li', {}, n));
    return list;
  }

  /** چیپ وضعیت: tone یکی از CHIP_TONES؛ icon متنی/ایموجی اختیاری (aria-hidden)؛ متن همیشه کنار رنگ است. */
  const chip = (text, { tone = 'off', icon = '' } = {}) =>
    h('span', { class: `nb-chip nb-chip--${pick(CHIP_TONES, tone, 'off')}` }, icon ? h('span', { attrs: { 'aria-hidden': 'true' }, text: icon }) : null, text);

  /** دکمه: variant = 'solid' | 'ghost'. */
  const btn = (text, { onClick, variant = 'solid', type = 'button', disabled = false, label } = {}) =>
    h('button', {
      class: `nb-btn${variant === 'ghost' ? ' nb-btn--ghost' : ''}`, text,
      attrs: { type, disabled: disabled || null, 'aria-label': label || null }, on: onClick ? { click: onClick } : {},
    });

  /** کارت: { title, subtitle, tape: {tone,label}|null } + children. */
  function card({ title = '', subtitle = '', tape: t = null, className = '' } = {}, ...children) {
    return h('section', { class: `nb-card${className ? ` ${className}` : ''}` },
      t ? tape(t.tone, t.label) : null,
      title ? h('h3', { class: 'nb-card__title', text: title }) : null,
      subtitle ? h('p', { class: 'nb-card__sub', text: subtitle }) : null,
      ...children);
  }

  /** صفحه‌ی دفترچه (یکی از دو صفحه). */
  const page = ({ title = '' } = {}, ...children) =>
    h('div', { class: 'nb-page' }, title ? h('h2', { class: 'nb-page-title', text: title }) : null, ...children);

  /**
   * دو صفحه‌ی کنار هم با فنر وسط. در RTL صفحه‌ی اول سمت راست است.
   * زیر ~۹۰۰px یک صفحه نشان داده می‌شود و دکمه‌های «صفحه‌ی قبل/بعد» ظاهر می‌شوند (فقط CSS پنهان/نمایان می‌کند؛ منطق اینجاست).
   */
  function spread(pages, { label = 'دفترچه‌ی برنامه‌ریزی', initialPage = 1 } = {}) {
    const [first, second] = pages;
    first.setAttribute('data-nb-page', '1');
    second.setAttribute('data-nb-page', '2');
    const el = h('div', { class: 'nb-spread', attrs: { role: 'group', 'aria-label': label, 'data-page': String(initialPage === 2 ? 2 : 1) } },
      first, h('div', { class: 'nb-spring', attrs: { 'aria-hidden': 'true' } }), second);

    const status = h('span', { class: 'nb-pager__label', attrs: { 'aria-live': 'polite' } });
    const prev = btn('صفحه‌ی قبل', { variant: 'ghost', onClick: () => go(1) });
    const next = btn('صفحه‌ی بعد', { variant: 'ghost', onClick: () => go(2) });
    function go(n) {
      el.setAttribute('data-page', String(n));
      status.textContent = `صفحه‌ی ${n === 1 ? 'اول' : 'دوم'} از ۲`;
      prev.disabled = n === 1;
      next.disabled = n === 2;
    }
    go(initialPage === 2 ? 2 : 1);
    const pager = h('div', { class: 'nb-pager' }, prev, status, next); // در RTL اولین عنصر (قبل) سمت راست است
    return h('div', { class: 'nb-spread-wrap' }, el, pager);
  }

  AP.notebook = { h, root, tape, lines, chip, btn, card, page, spread, TAPE_TONES, CHIP_TONES };
})();
