// سیستم طراحی «دفترچه» (فاز ۱۳ — C1): فقط کمک‌تابع‌های ساخت DOM زیر AP.notebook. وابستگی خارجی ندارد.
// امنیت: متن همیشه با textContent/createTextNode ساخته می‌شود؛ هیچ‌جا HTML خام از داده‌ی کاربر ساخته نمی‌شود.
// C2: AP.notebook.renderWeek(model, opts) — دفترچه‌ی دوصفحه‌ای هفته از خروجی GET /admin/users/:id/plan (فقط‌خواندنی).
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

  /** دکمه: variant = 'solid' | 'ghost'؛ small = دکمه‌ی کوچک (ردیف تسک). */
  const btn = (text, { onClick, variant = 'solid', type = 'button', disabled = false, label, small = false } = {}) =>
    h('button', {
      class: `nb-btn${variant === 'ghost' ? ' nb-btn--ghost' : ''}${small ? ' nb-btn--small' : ''}`, text,
      attrs: { type, disabled: disabled || null, 'aria-label': label || null }, on: onClick ? { click: onClick } : {},
    });

  /** کارت: { title, subtitle, tape: {tone,label}|null, collapsible } + children. collapsible ⇒ دکمه‌ی جمع/باز (فقط زیر ~۹۰۰px دیده می‌شود؛ CSS). */
  function card({ title = '', subtitle = '', tape: t = null, className = '', collapsible = false } = {}, ...children) {
    const el = h('section', { class: `nb-card${className ? ` ${className}` : ''}` });
    const toggle = collapsible && title
      ? h('button', {
        class: 'nb-card__toggle', text: '▾',
        attrs: { type: 'button', 'aria-expanded': 'true', 'aria-label': `جمع/باز کردن کارت ${title}` },
        on: { click: () => { const collapsed = el.classList.toggle('is-collapsed'); toggle.setAttribute('aria-expanded', String(!collapsed)); } },
      })
      : null;
    for (const c of [
      t ? tape(t.tone, t.label) : null,
      title ? h('h3', { class: 'nb-card__title', text: title }) : null,
      toggle,
      subtitle ? h('p', { class: 'nb-card__sub', text: subtitle }) : null,
      ...children,
    ]) if (c) el.appendChild(c);
    return el;
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

  // ───────────── C2: چیدمان «دو صفحه»ی برنامه‌ی هفته ─────────────
  const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // ۰ = یکشنبه (همان weekday سرور)
  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (v) => String(v == null ? '' : v).replace(/\d/g, (d) => FA_DIGITS[d]).replace(/\./g, '٫');
  // نوع روز ⇒ رنگ نوار چسب + آیکون + برچسب (هر نوع هم رنگ دارد هم آیکون و متن؛ فقط به رنگ متکی نیست)
  const KIND = {
    working: { tape: 'sage', icon: '✔', label: 'روز کاری', chip: 'work' },
    half: { tape: 'sand', icon: '◐', label: 'نیم‌روز', chip: 'half' },
    off: { tape: 'sand', icon: '☾', label: 'آف', chip: 'off' },
    holiday: { tape: 'rose', icon: '🎉', label: 'تعطیل', chip: 'holiday' },
    leave: { tape: 'sky', icon: '🌴', label: 'مرخصی', chip: 'leave' },
    mission: { tape: 'lilac', icon: '🧳', label: 'مأموریت', chip: 'mission' },
  };
  const PRIORITY = { high: { icon: '▲', text: 'اولویت بالا' }, low: { icon: '▽', text: 'اولویت کم' } };
  const FIRST_PAGE_DAYS = 4; // شنبه تا سه‌شنبه روی صفحه‌ی راست؛ بقیه روی صفحه‌ی چپ (برای هفته‌ی غیر ۷ روزه هم همین تقسیم)
  const dayTitle = (d) => `${WEEKDAY_NAMES[d.weekday] || ''} ${fa(d.jalali)}`.trim();

  // E1: edit = { enabled, onAdd(date, slotEl), onEdit(task, rowEl), onDelete(task, rowEl), onRow(id, el)?, onSlot(date, el)? } (فقط وقتی ویرایش مجاز است)
  const WHY = (t) => (t.isSystem ? 'سیستمی؛ قابل ویرایش نیست' : t.isUrgent ? 'فوری؛ فقط از مسیر تسک فوری' : 'فقط‌خواندنی');

  function taskRow(t, edit) {
    const pr = PRIORITY[t.priority];
    const row = h('div', { class: 'nb-task', attrs: { 'data-task-id': t.id } },
      pr ? h('span', { class: `nb-task__prio nb-task__prio--${t.priority}` }, h('span', { attrs: { 'aria-hidden': 'true' }, text: pr.icon }), h('span', { class: 'nb-sr-only', text: pr.text })) : null,
      h('span', { class: 'nb-task__title', text: t.title }),
      t.isUrgent ? chip('فوری', { tone: 'urgent', icon: '⚡' }) : null,
      t.isSystem ? chip('سیستمی', { tone: 'locked', icon: '🔒' }) : (t.managerLocked ? chip('از طرف سرپرست', { tone: 'locked', icon: '🔒' }) : null));
    if (edit) {
      if (t.canEdit) {
        row.appendChild(h('span', { class: 'nb-task__actions' },
          btn('ویرایش', { variant: 'ghost', small: true, label: `ویرایش تسک «${t.title}»`, onClick: () => edit.onEdit(t, row) }),
          btn('حذف', { variant: 'ghost', small: true, label: `حذف تسک «${t.title}»`, onClick: () => edit.onDelete(t, row) })));
      } else {
        row.appendChild(h('span', { class: 'nb-why', text: WHY(t) }));
      }
      if (edit.onRow) edit.onRow(t.id, row);
    }
    return row;
  }

  // جای افزودن تسک زیر هر کارت روز (date = null ⇒ «هر روز»)؛ فرم درجا داخل همین slot باز می‌شود
  function addSlot(date, title, edit) {
    const slot = h('div', { class: 'nb-edit-slot', attrs: { 'data-date': date || '' } },
      btn('＋ افزودن تسک', { variant: 'ghost', small: true, label: `افزودن تسک به ${title}`, onClick: () => edit.onAdd(date, slot) }));
    if (edit.onSlot) edit.onSlot(date, slot);
    return slot;
  }

  function dayCard(d, collapsible, edit) {
    const k = KIND[d.kind] || KIND.off;
    const s = d.schedule || {};
    const chips = [];
    if ((d.kind === 'working' || d.kind === 'half') && s.start && s.end) chips.push(chip(`${fa(s.start)} تا ${fa(s.end)}`, { tone: k.chip, icon: '🕒' }));
    if (s.source === 'override') chips.push(chip('برنامه‌ی ویژه‌ی این روز', { tone: 'half', icon: '✎' }));
    if (d.holidayTitle) chips.push(chip(d.holidayTitle, { tone: 'holiday' }));
    if (d.monthClosed) chips.push(chip('ماه بسته', { tone: 'locked', icon: '🔒' }));
    const el = card({ title: dayTitle(d), tape: { tone: k.tape, label: `${k.icon} ${d.kindLabel || k.label}` }, className: `nb-day nb-day--${KIND[d.kind] ? d.kind : 'off'}`, collapsible },
      chips.length ? h('div', { class: 'nb-day-chips' }, ...chips) : null,
      lines((d.tasks || []).map((t) => taskRow(t, edit)), { emptyText: 'تسکی ثبت نشده' }),
      edit ? addSlot(d.date, dayTitle(d), edit) : null);
    el.setAttribute('data-date', d.date || '');
    return el;
  }

  const textLine = (text, icon) => h('span', {}, icon ? h('span', { attrs: { 'aria-hidden': 'true' }, text: `${icon} ` }) : null, text);

  function summaryCard(sm, collapsible) {
    const t = sm.tasks || {};
    const rows = [
      textLine(`${fa(sm.workingDays)} روز کاری`),
      textLine(`${fa(sm.plannedHours)} ساعت برنامه‌ریزی‌شده`),
      textLine(`${fa(t.total)} تسک (عادی ${fa(t.ordinary)}، فوری ${fa(t.urgent)}، سیستمی ${fa(t.system)})`),
    ];
    if (t.undated) rows.push(textLine(`${fa(t.undated)} تسک بدون تاریخ («هر روز»)`));
    return card({ title: 'خلاصه‌ی هفته', tape: { tone: 'lilac', label: '📋 خلاصه' }, className: 'nb-summary', collapsible }, lines(rows));
  }

  function highlightsCard(days, anyDay, collapsible) {
    const items = [];
    for (const d of days) {
      if (d.kind === 'holiday') items.push(textLine(`${dayTitle(d)}: تعطیل${d.holidayTitle ? ` (${d.holidayTitle})` : ''}`, '🎉'));
      else if (d.kind === 'leave') items.push(textLine(`${dayTitle(d)}: مرخصی`, '🌴'));
      else if (d.kind === 'mission') items.push(textLine(`${dayTitle(d)}: مأموریت`, '🧳'));
    }
    for (const t of [...days.flatMap((d) => d.tasks || []), ...anyDay]) if (t.isUrgent) items.push(textLine(t.title, '⚡'));
    return items.length ? card({ title: 'مهم‌های هفته', tape: { tone: 'rose', label: '★ مهم‌ها' }, className: 'nb-highlights', collapsible }, lines(items)) : null;
  }

  /**
   * @param {object} model خروجی GET /admin/users/:id/plan: { days[], anyDay[], summary?, warnings?, plan?: { supervisorComment } }
   * @param {object} [opts] { label, initialPage, collapsible (پیش‌فرض true؛ دکمه‌ی جمع‌شدن کارت‌ها در موبایل), edit (E1: { enabled, onAdd, onEdit, onDelete, onRow?, onSlot? }) }
   * @returns {HTMLElement} ریشه‌ی .nb؛ صفحه‌ی راست = اولین ۴ روز، صفحه‌ی چپ = بقیه‌ی روزها + کارت‌های جانبی (هرکدام فقط با وجود داده)
   */
  function renderWeek(model, opts = {}) {
    const m = model || {};
    const days = Array.isArray(m.days) ? m.days : [];
    const anyDay = Array.isArray(m.anyDay) ? m.anyDay : [];
    if (!days.length) return root(card({ title: 'برنامه‌ی هفته', tape: { tone: 'rose', label: '📓 دفترچه' } }, lines([], { emptyText: 'اطلاعات این هفته در دسترس نیست.' })));

    const first = days.slice(0, FIRST_PAGE_DAYS);
    const rest = days.slice(FIRST_PAGE_DAYS);
    const comment = m.plan && m.plan.supervisorComment ? String(m.plan.supervisorComment) : '';
    const warnings = Array.isArray(m.warnings) ? m.warnings : [];
    const collapsible = opts.collapsible !== false;
    const edit = opts.edit && opts.edit.enabled ? opts.edit : null; // E1: ابزار ویرایش فقط با opts.edit.enabled

    const right = page({ title: `هفته‌ی ${fa(days[0].jalali)} تا ${fa(days[days.length - 1].jalali)}` }, ...first.map((d) => dayCard(d, collapsible, edit)));
    const left = page({ title: rest.length ? 'ادامه‌ی هفته' : 'خلاصه و یادداشت‌ها' },
      ...rest.map((d) => dayCard(d, collapsible, edit)),
      m.summary ? summaryCard(m.summary, collapsible) : null,
      highlightsCard(days, anyDay, collapsible),
      comment ? card({ title: 'یادداشت سرپرست', tape: { tone: 'rose', label: '✎ یادداشت' }, className: 'nb-note', collapsible }, h('p', { class: 'nb-note__text', text: comment })) : null,
      warnings.length ? card({ title: 'هشدارهای برنامه', tape: { tone: 'sand', label: '⚠ هشدارها' }, className: 'nb-warnings', collapsible },
        lines(warnings.map((w) => textLine(w.message, '⚠')))) : null,
      anyDay.length ? card({ title: 'هر روز', subtitle: 'تسک‌های بدون تاریخ', tape: { tone: 'sky', label: '🔁 هر روز' }, className: 'nb-anyday', collapsible }, lines(anyDay.map((t) => taskRow(t, edit))), edit ? addSlot(null, 'هر روز', edit) : null) : null);
    return root(spread([right, left], { label: opts.label || 'دفترچه‌ی برنامه‌ی هفته', initialPage: opts.initialPage }));
  }

  AP.notebook = { h, root, tape, lines, chip, btn, card, page, spread, renderWeek, dayTitle, fa, TAPE_TONES, CHIP_TONES };
})();
