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
  const weekdayName = (d) => WEEKDAY_NAMES[d.weekday] || '';

  // E1: edit = { enabled, onAdd(date, slotEl), onEdit(task, rowEl), onDelete(task, rowEl), onRow(id, el, ctrls)?, onSlot(date, el)?, onZone(date, el)?, dnd? } (فقط وقتی ویرایش مجاز است)
  // E2-الف: + onMove(task, date|null, rowEl) و onShift(task, dir(-1|+1), rowEl) (مسیر بدون drag)؛ days (برای منوی «انتقال…») را renderWeek اضافه می‌کند.
  const NON_WORK = ['off', 'holiday', 'leave', 'mission']; // انتقال به این روزها مجاز است ولی در منو برچسب می‌خورد (هشدار نرم)
  const WHY = (t) => (t.isSystem ? 'سیستمی؛ قابل ویرایش نیست' : t.isUrgent ? 'فوری؛ فقط از مسیر تسک فوری' : 'فقط‌خواندنی');

  /** منوی «انتقال به روز…» (E2-الف): دکمه‌ی باز/بسته‌کننده + پنل دکمه‌های روز. کیبوردی (Tab/Enter؛ Escape می‌بندد و فوکوس را برمی‌گرداند). */
  function moveMenu(t, edit, row) {
    const panel = h('div', { class: 'nb-move', attrs: { role: 'group', 'aria-label': `انتقال «${t.title}» به روز…` } });
    panel.hidden = true;
    const toggle = btn('انتقال…', { variant: 'ghost', small: true, label: `انتقال «${t.title}» به روز دیگر`, onClick: () => setOpen(panel.hidden) });
    toggle.setAttribute('aria-expanded', 'false');
    function setOpen(on, refocus) {
      panel.hidden = !on;
      toggle.setAttribute('aria-expanded', String(on));
      if (on) { const f = panel.children[0]; if (f && f.focus) f.focus(); } else if (refocus && toggle.focus) toggle.focus();
    }
    const cur = t.plannedDate || null;
    const targets = [{ date: null, label: 'هر روز' }, ...(edit.days || []).map((d) => ({
      date: d.date,
      label: `${weekdayName(d)} ${fa(d.jalali)}${NON_WORK.includes(d.kind) ? ` — ${d.kindLabel || (KIND[d.kind] || {}).label || ''}` : ''}`,
    }))].filter((x) => x.date !== cur);
    for (const x of targets) panel.appendChild(btn(x.label, { variant: 'ghost', small: true, onClick: () => { setOpen(false); return edit.onMove(t, x.date, row); } }));
    panel.addEventListener('keydown', (e) => { if (e && e.key === 'Escape') { if (e.stopPropagation) e.stopPropagation(); setOpen(false, true); } });
    return { toggle, panel };
  }

  // یک منوی سه‌نقطه‌ی باز در هر لحظه؛ کلیک بیرون از آن (یا Escape) آن را می‌بندد.
  // شنونده‌ی document فقط تا وقتی منو باز است ثبت می‌ماند (تا حالت استراحت هیچ شنونده‌ی سراسری‌ای نباشد).
  let openKebab = null;
  const hasDoc = () => typeof document !== 'undefined' && typeof document.addEventListener === 'function' && typeof document.removeEventListener === 'function';
  const outsideClick = (e) => {
    if (!openKebab) return;
    const wrap = openKebab.menuEl.parentNode;
    if (wrap && e && e.target && typeof wrap.contains === 'function' && wrap.contains(e.target)) return;
    openKebab.close(false);
  };
  function setOpenKebab(v) {
    const was = !!openKebab; openKebab = v;
    if (!hasDoc()) return;
    if (v && !was) document.addEventListener('click', outsideClick);
    else if (!v && was) document.removeEventListener('click', outsideClick);
  }

  function taskRow(t, edit, group = [], zone = null, num = 0) {
    const pr = PRIORITY[t.priority];
    // E2-ج: دستگیره‌ی لمسی (فقط با لمس/قلم کار می‌کند؛ CSS فقط روی نشانگر درشت/عرض کم نشانش می‌دهد؛ aria-hidden چون جایگزین کیبوردی دارد)
    const handle = edit && edit.dnd && edit.dnd.pStart && t.canEdit ? h('span', { class: 'nb-task__handle', attrs: { 'aria-hidden': 'true' }, text: '⠿' }) : null;
    const row = h('div', { class: 'nb-task', attrs: { 'data-task-id': t.id } },
      handle,
      num ? h('span', { class: 'nb-task__num', attrs: { 'aria-hidden': 'true' }, text: `${fa(num)}.` }) : null,
      pr ? h('span', { class: `nb-task__prio nb-task__prio--${t.priority}` }, h('span', { attrs: { 'aria-hidden': 'true' }, text: pr.icon }), h('span', { class: 'nb-sr-only', text: pr.text })) : null,
      h('span', { class: 'nb-task__title', text: t.title }),
      t.isUrgent ? chip('فوری', { tone: 'urgent', icon: '⚡' }) : null,
      t.isSystem ? chip('سیستمی', { tone: 'locked', icon: '🔒' }) : (t.managerLocked ? chip('از طرف سرپرست', { tone: 'locked', icon: '🔒' }) : null));
    if (edit) {
      if (edit.dnd && t.canEdit) { // E2-ب: drag & drop بومی (رویدادهای dragstart/dragover/drop)؛ فقط تسک قابل‌ویرایش؛ جایگزین کیبوردی همان منوی «انتقال…» و ▲▼ است
        const dnd = edit.dnd;
        row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', (e) => dnd.start(t, row, e));
        row.addEventListener('dragend', () => dnd.end());
        row.addEventListener('dragover', (e) => { if (e.stopPropagation) e.stopPropagation(); dnd.over(zone, e, t); });
        row.addEventListener('drop', (e) => { if (e.stopPropagation) e.stopPropagation(); return dnd.drop(zone, e, t); });
        if (handle) handle.addEventListener('pointerdown', (e) => dnd.pStart(t, row, e));
      }
      const ctrls = {}; // E2-الف: دکمه‌های حرکت (برای بازگرداندن فوکوس بعد از رسم دوباره)
      if (t.canEdit) {
        const acts = h('span', { class: 'nb-task__actions' });
        const items = []; // آیتم‌های منوی سه‌نقطه (دکمه‌ها همان قبلی‌اند؛ فقط داخل منو قرار می‌گیرند)
        const movable = group.filter((x) => x.canEdit && !x.isSystem && !x.isUrgent); // همان تسک‌هایی که reorder سرور می‌پذیرد
        const idx = movable.findIndex((x) => x.id === t.id);
        const kebab = btn('⋮', { variant: 'ghost', small: true, label: `گزینه‌های تسک «${t.title}»` });
        kebab.className += ' nb-task__kebab';
        kebab.setAttribute('aria-haspopup', 'true');
        kebab.setAttribute('aria-expanded', 'false');
        const menuEl = h('div', { class: 'nb-task__menu', attrs: { role: 'group', 'aria-label': `گزینه‌های تسک «${t.title}»` } });
        menuEl.hidden = true;
        const closeMenu = (refocus) => { menuEl.hidden = true; kebab.setAttribute('aria-expanded', 'false'); if (openKebab && openKebab.menuEl === menuEl) setOpenKebab(null); if (refocus && kebab.focus) kebab.focus(); };
        const wrapAction = (fn) => (e) => { closeMenu(false); return fn(e); };
        const addItem = (b) => { b.className += ' nb-menu__item'; items.push(b); return b; };
        if (edit.onShift && movable.length > 1 && idx >= 0) {
          ctrls.up = addItem(btn('▲', { variant: 'ghost', small: true, label: `بردن تسک «${t.title}» یک جایگاه بالاتر`, disabled: idx === 0, onClick: wrapAction(() => edit.onShift(t, -1, row)) }));
          ctrls.down = addItem(btn('▼', { variant: 'ghost', small: true, label: `بردن تسک «${t.title}» یک جایگاه پایین‌تر`, disabled: idx === movable.length - 1, onClick: wrapAction(() => edit.onShift(t, 1, row)) }));
        }
        let menu = null;
        if (edit.onMove && edit.days && edit.days.length) {
          menu = moveMenu(t, edit, row); ctrls.move = menu.toggle; addItem(menu.toggle);
          menu.toggle.addEventListener('click', () => closeMenu(false)); // پنل انتقال زیر ردیف باز می‌شود؛ منوی سه‌نقطه بسته می‌شود
        }
        addItem(btn('ویرایش', { variant: 'ghost', small: true, label: `ویرایش تسک «${t.title}»`, onClick: wrapAction(() => edit.onEdit(t, row)) }));
        addItem(btn('حذف', { variant: 'ghost', small: true, label: `حذف تسک «${t.title}»`, onClick: wrapAction(() => edit.onDelete(t, row)) }));
        for (const b of items) menuEl.appendChild(b);
        kebab.addEventListener('click', (e) => {
          if (e && e.stopPropagation) e.stopPropagation();
          const open = menuEl.hidden;
          if (openKebab && openKebab.menuEl !== menuEl) openKebab.close(false);
          menuEl.hidden = !open;
          kebab.setAttribute('aria-expanded', String(open));
          setOpenKebab(open ? { menuEl, kebab, close: closeMenu } : null);
          if (open) { const f = items.find((b) => !b.disabled); if (f && f.focus) f.focus(); }
        });
        menuEl.addEventListener('keydown', (e) => { if (e && e.key === 'Escape') { if (e.stopPropagation) e.stopPropagation(); closeMenu(true); } });
        acts.appendChild(kebab); acts.appendChild(menuEl);
        row.appendChild(acts);
        if (menu) row.appendChild(menu.panel);
      } else {
        row.appendChild(h('span', { class: 'nb-why', text: WHY(t) }));
      }
      if (edit.onRow) edit.onRow(t.id, row, ctrls);
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

  // E2-ب: کارت = ناحیه‌ی رها کردن (date = null ⇒ «هر روز»)؛ رها کردن روی فضای خالی کارت ⇒ انتقال به آن روز
  function dropZone(el, date, edit) {
    if (!edit || !edit.dnd) return;
    el.setAttribute('data-zone', date || ''); // E2-ج: تشخیص ناحیه از روی نقطه‌ی لمس (elementFromPoint)
    el.addEventListener('dragover', (e) => edit.dnd.over(date, e, null));
    el.addEventListener('drop', (e) => edit.dnd.drop(date, e, null));
    if (edit.onZone) edit.onZone(date, el);
  }

  function dayCard(d, collapsible, edit, manage) {
    const k = KIND[d.kind] || KIND.off;
    const s = d.schedule || {};
    const chips = [];
    if ((d.kind === 'working' || d.kind === 'half') && s.start && s.end) chips.push(chip(`${fa(s.start)} تا ${fa(s.end)}`, { tone: k.chip, icon: '🕒' }));
    if (s.source === 'override') chips.push(chip('برنامه‌ی ویژه‌ی این روز', { tone: 'half', icon: '✎' }));
    if (d.holidayTitle) chips.push(chip(d.holidayTitle, { tone: 'holiday' }));
    if (d.monthClosed) chips.push(chip('ماه بسته', { tone: 'locked', icon: '🔒' }));
    const el = card({ title: dayTitle(d), tape: { tone: k.tape, label: `${k.icon} ${d.kindLabel || k.label}` }, className: `nb-day nb-day--${KIND[d.kind] ? d.kind : 'off'}`, collapsible },
      chips.length ? h('div', { class: 'nb-day-chips' }, ...chips) : null,
      manageActions(d, manage),
      lines((d.tasks || []).map((t, i) => taskRow(t, edit, d.tasks, d.date, i + 1)), { emptyText: 'تسکی ثبت نشده' }),
      edit ? addSlot(d.date, dayTitle(d), edit) : null);
    el.setAttribute('data-date', d.date || '');
    dropZone(el, d.date, edit);
    return el;
  }

  // E3: اقدام‌های مدیریتی هر روز، مستقل از قفل ویرایش دفترچه (تسک فوری و ساعت کاری در هفته‌ی شروع‌شده هم مجازند؛ گیت واقعی سمت سرور است).
  // manage = { onHours(day)?, onUrgent(day)?, comment?: { onSave(text) } } — هر کلید فقط وقتی کاربر مجوز دارد ساخته می‌شود. روز در ماه بسته دکمه ندارد (سرور هم رد می‌کند).
  function manageActions(d, manage) {
    if (!manage || d.monthClosed || !(manage.onHours || manage.onUrgent)) return null;
    const t = dayTitle(d);
    return h('div', { class: 'nb-day-actions' },
      manage.onHours ? btn('🕒 ویرایش ساعت کاری این روز', { variant: 'ghost', small: true, label: `ویرایش ساعت کاری ${t}`, onClick: () => manage.onHours(d) }) : null,
      manage.onUrgent ? btn('⚡ تسک فوری', { variant: 'ghost', small: true, label: `ثبت تسک فوری برای ${t}`, onClick: () => manage.onUrgent(d) }) : null);
  }

  const NOTE_MAX = 500; // همان سقف سرور (setSupervisorComment)؛ فقط راهنمای UI

  /** کارت «یادداشت سرپرست». بدون مجوز ویرایش (manage.comment) دقیقاً همان نمای فقط‌خواندنیِ C2؛ با مجوز: فرم درجا (ذخیره‌ی صریح، خطا کنار فرم). */
  function noteCard(comment, collapsible, manage) {
    const m = manage && manage.comment ? manage.comment : null;
    const opts = { title: 'یادداشت سرپرست', tape: { tone: 'rose', label: '✎ یادداشت' }, className: 'nb-note', collapsible };
    if (!m) return comment ? card(opts, h('p', { class: 'nb-note__text', text: comment })) : null;

    const body = h('div', { class: 'nb-note__body' });
    const view = () => {
      const openBtn = btn(comment ? 'ویرایش یادداشت' : '＋ افزودن یادداشت', { variant: 'ghost', small: true, label: comment ? 'ویرایش یادداشت سرپرست' : 'افزودن یادداشت سرپرست', onClick: openForm });
      body.replaceChildren(h('p', { class: `nb-note__text${comment ? '' : ' nb-note__text--empty'}`, text: comment || 'یادداشتی ثبت نشده است.' }), openBtn);
      return openBtn;
    };
    function openForm() {
      const id = `nb-note-${Math.random().toString(36).slice(2, 8)}`;
      const ta = h('textarea', { class: 'nb-input', attrs: { id, rows: 4, maxlength: NOTE_MAX, 'aria-describedby': `${id}-err` } });
      ta.value = comment || '';
      const err = h('span', { class: 'nb-field-error', attrs: { id: `${id}-err`, role: 'alert' } });
      const save = btn('ذخیره', { type: 'submit' });
      const cancel = btn('انصراف', { variant: 'ghost', onClick: () => { const b = view(); if (b.focus) b.focus(); } });
      const form = h('form', { class: 'nb-form', attrs: { novalidate: true, 'aria-label': 'یادداشت سرپرست' } },
        h('label', { class: 'nb-field', attrs: { for: id } }, h('span', { class: 'nb-field-label', text: `یادداشت برای کارمند (حداکثر ${fa(NOTE_MAX)} نویسه؛ خالی = پاک کردن)` }), ta, err),
        h('div', { class: 'nb-form-actions' }, save, cancel));
      form.addEventListener('submit', async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        err.textContent = ''; save.disabled = true; cancel.disabled = true;
        try { await m.onSave(String(ta.value || '')); } catch (ex) { // موفقیت ⇒ والد دفترچه را دوباره می‌سازد؛ خطا ⇒ فرم باز می‌ماند
          err.textContent = (ex && ex.message) || 'ذخیره نشد.'; save.disabled = false; cancel.disabled = false; if (ta.focus) ta.focus();
        }
      });
      body.replaceChildren(form);
      if (ta.focus) ta.focus();
    }
    view();
    return card(opts, body);
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
   * @param {object} [opts] { label, initialPage, collapsible (پیش‌فرض true؛ دکمه‌ی جمع‌شدن کارت‌ها در موبایل), manage (E3: { onHours?, onUrgent?, comment?: { onSave } }), edit (E1: { enabled, onAdd, onEdit, onDelete, onRow?, onSlot? }) }
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
    const manage = opts.manage || null; // E3: ساعت روز / تسک فوری / یادداشت سرپرست (مستقل از opts.edit)
    const edit = opts.edit && opts.edit.enabled ? { ...opts.edit, days } : null; // E1: ابزار ویرایش فقط با opts.edit.enabled (days برای منوی انتقال E2)

    const right = page({ title: `هفته‌ی ${fa(days[0].jalali)} تا ${fa(days[days.length - 1].jalali)}` }, ...first.map((d) => dayCard(d, collapsible, edit, manage)));
    const left = page({ title: rest.length ? 'ادامه‌ی هفته' : 'خلاصه و یادداشت‌ها' },
      ...rest.map((d) => dayCard(d, collapsible, edit, manage)),
      m.summary ? summaryCard(m.summary, collapsible) : null,
      highlightsCard(days, anyDay, collapsible),
      noteCard(comment, collapsible, manage),
      warnings.length ? card({ title: 'هشدارهای برنامه', tape: { tone: 'sand', label: '⚠ هشدارها' }, className: 'nb-warnings', collapsible },
        lines(warnings.map((w) => textLine(w.message, '⚠')))) : null,
      anyDay.length ? (() => {
        const c = card({ title: 'هر روز', subtitle: 'تسک‌های بدون تاریخ', tape: { tone: 'sky', label: '🔁 هر روز' }, className: 'nb-anyday', collapsible }, lines(anyDay.map((t, i) => taskRow(t, edit, anyDay, null, i + 1))), edit ? addSlot(null, 'هر روز', edit) : null);
        dropZone(c, null, edit);
        return c;
      })() : null);
    return root(spread([right, left], { label: opts.label || 'دفترچه‌ی برنامه‌ی هفته', initialPage: opts.initialPage }));
  }

  AP.notebook = { h, root, tape, lines, chip, btn, card, page, spread, renderWeek, dayTitle, weekdayName, fa, NON_WORK, TAPE_TONES, CHIP_TONES };
})();
