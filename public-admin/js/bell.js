// زنگوله‌ی اعلان در نوار بالای پنل (S4-6a). فقط UI: API اعلان‌ها در S4-5b ساخته شده و اتصال رویدادها جداست (S4-6b).
//   • شمارنده‌ی خوانده‌نشده روی زنگوله   • پنل کشویی با فهرست اعلان‌ها (صفحه‌بندی «نمایش بیشتر»)
//   • علامت خوانده‌شدن (تکی / همه)        • لینک عمیق: کلیک روی اعلان ⇒ رفتن به صفحه‌ی مقصد در همین پنل
//   • polling هر ۴۵ ثانیه (بازه‌ی مجاز ۳۰ تا ۶۰)؛ وقتی تب پنهان است متوقف می‌شود و با برگشتن فوراً ادامه می‌یابد.
//
// امنیت:
//   • title/body از دیتابیس می‌آیند ⇒ همه با AP.esc وارد HTML می‌شوند؛ هیچ handler درون‌خطی (onclick=…) نداریم (CSP).
//   • مقصد لینک فقط hash-route داخلی پنل است (`#/leave` ، `#/profile/12` ، `/admin/#/leave`)؛ javascript: ، آدرس خارجی ،
//     `//host` و هر چیز دیگری ردّ می‌شود. صفحه‌ی مقصد هم باید برای کاربر مجاز باشد (AP.viewAllowed).
//   • مجوزها فقط تصمیم نمایش‌اند؛ اسکوپ «فقط اعلان‌های خودِ کاربر» سمت سرور اعمال می‌شود (S4-5b).

(function () {
  'use strict';

  const AP = window.AP;
  if (!AP) return; // core.js لود نشده؛ بی‌صدا کنار می‌رویم

  const POLL_MS = 45000; // بین ۳۰ تا ۶۰ ثانیه
  const PAGE_SIZE = 20;
  const MAX_BADGE = 99;
  // شناسه‌ی صفحه (حروف کوچک/عدد/_) و پارامتر اختیاری ساده؛ نقطه، اسلش اضافه، دونقطه و … مجاز نیست
  const LINK_RE = /^(?:\/admin\/)?#\/([a-z][a-z0-9_]{0,40})(?:\/([A-Za-z0-9_-]{1,40}))?$/;

  // ---------- توابع خالص (قابل تست) ----------

  // لینک اعلان ⇒ { id, param } یا null (نامعتبر)
  function parseLink(link) {
    if (typeof link !== 'string') return null;
    const m = LINK_RE.exec(link.trim());
    return m ? { id: m[1], param: m[2] || null } : null;
  }

  // عدد روی زنگوله: ارقام فارسی؛ بیش از ۹۹ ⇒ «۹۹+»
  function formatCount(n) {
    const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return v > MAX_BADGE ? `${AP.fmt.num(MAX_BADGE)}+` : AP.fmt.num(v);
  }

  // زمان‌بند polling: tick را بلافاصله اجرا می‌کند، سپس هر intervalMs؛ بدون هم‌پوشانی (دور بعد بعد از پایان tick قبلی)؛
  // وقتی isHidden() درست است زمان‌بند قطع می‌شود و با visibilityChanged() (تب دوباره دیده شد) فوراً ادامه می‌یابد.
  function createPoller({ tick, intervalMs = POLL_MS, isHidden, setTimer = setTimeout, clearTimer = clearTimeout }) {
    let timer = null;
    let running = false;
    let busy = false;

    const cancel = () => { if (timer !== null) { clearTimer(timer); timer = null; } };

    async function run() {
      timer = null;
      if (!running || busy || isHidden()) return;
      busy = true;
      try { await tick(); } catch (_) { /* خطای گذرا: دور بعد دوباره */ }
      busy = false;
      if (running && !isHidden() && timer === null) timer = setTimer(run, intervalMs);
    }

    return {
      start() { if (running) return; running = true; run(); },
      stop() { running = false; cancel(); },
      visibilityChanged() {
        if (!running) return;
        if (isHidden()) cancel();
        else if (timer === null) run(); // اگر tick در جریان باشد، busy مانع اجرای دوم می‌شود و پایان آن دور بعد را می‌چیند
      },
      isScheduled: () => timer !== null,
    };
  }

  // ---------- وضعیت و DOM ----------

  const state = { unread: 0, open: false, items: [], nextBefore: null, loading: false, error: null, listToken: 0 };
  let els = null;
  let poller = null;
  let inited = false;

  const esc = (v) => AP.esc(v);
  const canMark = () => AP.can('notifications.mark');

  function itemHtml(n, mark) {
    const link = parseLink(n.link);
    const hasLink = !!(link && AP.viewAllowed(AP.views[link.id]));
    const unread = !n.isRead;
    return `<li class="bell-item${unread ? ' unread' : ''}${hasLink ? ' has-link' : ''}">
      <button type="button" class="bell-main" data-act="open" data-id="${esc(n.id)}">
        <span class="bell-dot" aria-hidden="true"></span>
        <span class="bell-text">
          <span class="bell-title">${unread ? '<span class="bell-sr">خوانده‌نشده: </span>' : ''}${esc(n.title)}</span>
          ${n.body ? `<span class="bell-body">${esc(n.body)}</span>` : ''}
          <small class="bell-time muted">${esc(AP.fmt.dateTime(n.createdAt))}</small>
        </span>
      </button>
      ${unread && mark ? `<button type="button" class="bell-read icon-btn" data-act="read" data-id="${esc(n.id)}" title="علامت به‌عنوان خوانده‌شده" aria-label="علامت به‌عنوان خوانده‌شده">${AP.icon('check')}</button>` : ''}
    </li>`;
  }

  function setUnread(n) {
    state.unread = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    if (!els) return;
    els.count.textContent = formatCount(state.unread);
    els.count.classList.toggle('hidden', state.unread === 0);
    els.btn.setAttribute('aria-label', state.unread ? `اعلان‌ها، ${AP.fmt.num(state.unread)} خوانده‌نشده` : 'اعلان‌ها');
    els.markAll.disabled = state.unread === 0;
  }

  function renderList() {
    if (!els) return;
    let html;
    if (!state.items.length && state.error) {
      html = `<div class="empty">${AP.icon('alert')}${esc(state.error)}<div class="mt"><button type="button" class="btn ghost small" data-act="retry">تلاش دوباره</button></div></div>`;
    } else if (!state.items.length && state.loading) {
      html = '<div class="loading"><div class="spinner"></div>در حال بارگذاری…</div>';
    } else if (!state.items.length) {
      html = `<div class="empty">${AP.icon('inbox')}اعلانی ندارید.</div>`;
    } else {
      const mark = canMark();
      html = `<ul class="bell-items">${state.items.map((n) => itemHtml(n, mark)).join('')}</ul>`;
    }
    els.list.innerHTML = html;
    els.more.classList.toggle('hidden', state.nextBefore == null || !state.items.length);
    els.more.disabled = state.loading;
  }

  // append=false ⇒ از اول (جدیدترین‌ها)؛ append=true ⇒ صفحه‌ی بعد با before=<nextBefore>
  async function loadList(append) {
    const token = ++state.listToken; // پاسخ کهنه (درخواست قدیمی‌تر که دیرتر برگشت) نادیده گرفته می‌شود
    state.loading = true;
    state.error = null;
    renderList();
    try {
      const before = append && state.nextBefore != null ? `&before=${encodeURIComponent(state.nextBefore)}` : '';
      const r = await AP.api(`/admin/notifications?limit=${PAGE_SIZE}${before}`);
      if (token !== state.listToken) return;
      const items = Array.isArray(r.items) ? r.items : [];
      if (append) {
        const seen = new Set(state.items.map((x) => x.id));
        state.items = state.items.concat(items.filter((x) => !seen.has(x.id)));
      } else {
        state.items = items;
      }
      state.nextBefore = r.nextBefore == null ? null : r.nextBefore;
    } catch (err) {
      if (token !== state.listToken) return;
      state.error = err.message || 'بارگذاری اعلان‌ها ناموفق بود.';
      if (state.items.length) AP.toast(state.error, true); // فهرست قبلی سر جایش می‌ماند
    } finally {
      if (token === state.listToken) { state.loading = false; renderList(); }
    }
  }

  // ---------- اکشن‌ها ----------

  async function markRead(id) {
    const item = state.items.find((n) => n.id === id);
    if (!item || item.isRead || !canMark()) return false;
    try {
      const r = await AP.api(`/admin/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
      const cur = state.items.find((n) => n.id === id); // ممکن است وسط درخواست فهرست تازه شده باشد
      if (cur) { cur.isRead = true; cur.readAt = (r.notification && r.notification.readAt) || cur.readAt; }
      if (Number.isFinite(r.unread)) setUnread(r.unread);
      renderList();
      return true;
    } catch (err) {
      AP.toast(err.message, true);
      return false;
    }
  }

  async function markAll() {
    if (!canMark() || !state.unread) return false;
    try {
      const r = await AP.api('/admin/notifications/read-all', { method: 'POST' });
      state.items.forEach((n) => { n.isRead = true; });
      setUnread(Number.isFinite(r.unread) ? r.unread : 0);
      renderList();
      return true;
    } catch (err) {
      AP.toast(err.message, true);
      return false;
    }
  }

  // کلیک روی یک اعلان: خوانده می‌شود (شکستش مانع ناوبری نیست) و اگر لینک معتبر و مجاز دارد به آن می‌رود
  function openItem(id) {
    const item = state.items.find((n) => n.id === id);
    if (!item) return false;
    if (!item.isRead) markRead(id); // عمداً await نمی‌شود؛ خطایش را خودش توست می‌کند
    if (!item.link) return true;
    const link = parseLink(item.link);
    if (!link) { AP.toast('لینک این اعلان نامعتبر است.', true); return false; }
    if (!AP.viewAllowed(AP.views[link.id])) { AP.toast('به صفحه‌ی این اعلان دسترسی ندارید.', true); return false; }
    close(false);
    AP.go(link.id, link.param);
    return true;
  }

  function open() {
    if (!els || state.open) return;
    state.open = true;
    els.drawer.classList.add('open');
    els.backdrop.classList.add('open');
    els.drawer.setAttribute('aria-hidden', 'false');
    els.btn.setAttribute('aria-expanded', 'true');
    els.markAll.classList.toggle('hidden', !canMark());
    loadList(false);
    els.close.focus();
  }

  function close(restoreFocus = true) {
    if (!els || !state.open) return;
    state.open = false;
    els.drawer.classList.remove('open');
    els.backdrop.classList.remove('open');
    els.drawer.setAttribute('aria-hidden', 'true');
    els.btn.setAttribute('aria-expanded', 'false');
    if (restoreFocus) els.btn.focus();
  }

  // ---------- polling ----------

  async function pollTick() {
    try {
      const r = await AP.api('/admin/notifications/unread-count');
      const prev = state.unread;
      setUnread(r.unread);
      if (state.open && state.unread !== prev) loadList(false); // پنل باز است و چیزی عوض شده ⇒ فهرست هم تازه شود
    } catch (err) {
      if (err && err.status === 403) disable(); // مجوز اعلان از کاربر گرفته شد ⇒ زنگوله جمع می‌شود
      // سایر خطاها (شبکه/۵xx): شمارنده‌ی قبلی می‌ماند و دور بعد دوباره امتحان می‌شود
    }
  }

  function disable() {
    if (poller) poller.stop();
    close(false);
    if (els) els.btn.classList.add('hidden');
  }

  function stop() { if (poller) poller.stop(); }

  // ---------- راه‌اندازی ----------

  function init() {
    if (inited) return;
    if (!AP.can('notifications.read')) return; // default-deny: بدون مجوز زنگوله اصلاً نمایش داده نمی‌شود
    const found = {
      btn: AP.$('#bell-btn'), count: AP.$('#bell-count'), drawer: AP.$('#bell-drawer'), backdrop: AP.$('#bell-backdrop'),
      list: AP.$('#bell-list'), more: AP.$('#bell-more'), markAll: AP.$('#bell-mark-all'), close: AP.$('#bell-close'),
    };
    if (!Object.values(found).every(Boolean)) return;
    els = found;
    inited = true;

    els.btn.classList.remove('hidden');
    els.btn.addEventListener('click', () => (state.open ? close() : open()));
    els.close.addEventListener('click', () => close());
    els.backdrop.addEventListener('click', () => close());
    els.markAll.addEventListener('click', markAll);
    els.more.addEventListener('click', () => loadList(true));
    els.list.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!t) return;
      const act = t.getAttribute('data-act');
      const id = Number(t.getAttribute('data-id'));
      if (act === 'open') openItem(id);
      else if (act === 'read') markRead(id);
      else if (act === 'retry') loadList(false);
    });
    document.addEventListener('keydown', (e) => {
      // وقتی مودال باز است Escape مال مودال است
      if (e.key === 'Escape' && state.open && !AP.$('.modal-backdrop')) close();
    });

    poller = createPoller({ tick: pollTick, isHidden: () => !!document.hidden });
    document.addEventListener('visibilitychange', () => poller.visibilityChanged());
    setUnread(0);
    poller.start();
  }

  AP.bell = {
    init, open, close, stop, markRead, markAll, openItem,
    refresh: pollTick,
    loadMore: () => loadList(true),
    parseLink, formatCount, itemHtml, createPoller,
    state, POLL_MS,
  };
})();
