// بهبود تجربه‌ی کاربری پنل — گروه‌های جمع‌شونده‌ی منوی کناری
//   • عنوان هر گروه (.nav-group) با کلیک/Enter/Space باز و بسته می‌شود؛ وضعیت در localStorage می‌ماند.
//   • گروهی که آیتم فعال دارد هیچ‌وقت بسته نمی‌ماند.
//   • منو را کد core.js می‌سازد؛ این فایل فقط بعد از رسم، ویژگی و کلاس می‌گذارد (HTML منو دست نمی‌خورد).
//   • همه‌چیز defensive است (نبودن localStorage/MutationObserver ⇒ بی‌اثر).
(function () {
  'use strict';
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  const nav = document.getElementById('side-nav');
  if (!nav || typeof nav.querySelectorAll !== 'function') return;

  const KEY = 'ap.navCollapsed';
  const load = () => {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (_) { return new Set(); }
  };
  const save = (set) => { try { localStorage.setItem(KEY, JSON.stringify(Array.from(set))); } catch (_) { /* حالت خصوصی/نبود storage */ } };
  let collapsed = load();
  let busy = false;

  const headers = () => Array.from(nav.querySelectorAll('.nav-group'));
  const itemsOf = (header) => {
    const out = [];
    let el = header.nextElementSibling;
    while (el && !(el.classList && el.classList.contains('nav-group'))) {
      if (el.classList && el.classList.contains('nav-item')) out.push(el);
      el = el.nextElementSibling;
    }
    return out;
  };

  function apply() {
    busy = true;
    try {
      headers().forEach((h) => {
        const name = h.dataset ? h.dataset.group : h.getAttribute('data-group');
        if (!name) return;
        const items = itemsOf(h);
        const hasActive = items.some((b) => b.classList.contains('active'));
        const isCollapsed = collapsed.has(name) && !hasActive;
        h.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        items.forEach((b) => b.classList.toggle('is-group-collapsed', isCollapsed));
      });
    } finally { busy = false; }
  }

  function enhance() {
    busy = true;
    try {
      headers().forEach((h) => {
        if (h.getAttribute('data-group')) return;
        const name = String(h.textContent || '').trim();
        if (!name) return;
        h.setAttribute('data-group', name);
        h.setAttribute('role', 'button');
        h.setAttribute('tabindex', '0');
        h.setAttribute('aria-label', `گروه «${name}»؛ باز و بسته کردن`);
      });
    } finally { busy = false; }
    apply();
  }

  function toggle(h) {
    const name = h.getAttribute('data-group');
    if (!name) return;
    if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
    save(collapsed);
    apply();
  }

  nav.addEventListener('click', (e) => {
    const h = e.target && typeof e.target.closest === 'function' ? e.target.closest('.nav-group[data-group]') : null;
    if (h) toggle(h);
  });
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const h = e.target && typeof e.target.closest === 'function' ? e.target.closest('.nav-group[data-group]') : null;
    if (!h) return;
    e.preventDefault();
    toggle(h);
  });

  if (typeof MutationObserver === 'function') {
    // رسم دوباره‌ی منو (childList) و عوض‌شدن آیتم فعال (class) ⇒ دوباره اعمال شود
    new MutationObserver(() => { if (!busy) enhance(); }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  enhance();
})();
