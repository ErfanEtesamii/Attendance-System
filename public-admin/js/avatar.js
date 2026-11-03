// عکس پروفایل در پنل: نمایش در نوار کناری؛ کلیک روی آواتار ⇒ منوی افزودن/تغییر/حذف؛ قبل از ارسال، ویرایشگر برش (کشیدن + بزرگ‌نمایی).
// همه‌ی عناصر با DOM API ساخته می‌شوند (CSP: بدون innerHTML/style inline). خروجی همیشه JPEG ۲۵۶×۲۵۶.
(function () {
  'use strict';
  const AP = window.AP;
  if (!AP) return;
  let me = null; let hasPhoto = false; let menu = null;

  // ویرایشگر برش: کشیدن = جابه‌جایی، اسلایدر/چرخ ماوس = بزرگ‌نمایی. خروجی Blob (JPEG ۲۵۶×۲۵۶) یا null (انصراف).
  function openCropper(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('خواندن فایل ممکن نشد.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('فایل انتخاب‌شده تصویر معتبری نیست.'));
        img.onload = () => buildCropper(img, resolve);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function buildCropper(img, done) {
    const S = 256;
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    const back = mk('div', 'av-crop-back');
    const box = mk('div', 'av-crop');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'تنظیم عکس پروفایل');
    const stage = mk('div', 'av-crop-stage');
    const canvas = mk('canvas', 'av-crop-canvas'); canvas.width = S; canvas.height = S;
    stage.append(canvas, mk('div', 'av-crop-grid'), mk('div', 'av-crop-ring'));
    const zoom = mk('input', 'av-crop-zoom'); zoom.type = 'range'; zoom.min = '1'; zoom.max = '3'; zoom.step = '0.01'; zoom.value = '1'; zoom.setAttribute('aria-label', 'بزرگ‌نمایی');
    const tool = (txt, label) => { const t = mk('button', 'av-tool', txt); t.type = 'button'; t.setAttribute('aria-label', label); t.title = label; return t; };
    const minus = tool('−', 'کوچک‌نمایی'); const plus = tool('+', 'بزرگ‌نمایی'); const rotL = tool('⟲', 'چرخش به چپ'); const rotR = tool('⟳', 'چرخش به راست');
    const zoomRow = mk('div', 'av-crop-zoomrow'); zoomRow.append(rotL, minus, zoom, plus, rotR);
    const ok = mk('button', 'av-btn av-btn-primary', 'ذخیره'); ok.type = 'button';
    const no = mk('button', 'av-btn', 'انصراف'); no.type = 'button';
    box.append(mk('div', 'av-crop-title', 'تنظیم عکس پروفایل'), stage, zoomRow, mk('div', 'av-crop-hint', 'عکس را بکشید تا جایش تنظیم شود؛ با نوار بزرگ‌نمایی و با دکمه‌های کناری بچرخانید.'), (() => { const a = mk('div', 'av-crop-actions'); a.append(ok, no); return a; })());
    back.appendChild(box);
    const base = S / Math.min(img.width, img.height);
    let z = 1; let ox = 0; let oy = 0; let rot = 0;
    function draw() {
      const w = img.width * base * z; const h = img.height * base * z;
      const odd = rot % 2 !== 0;
      const mx = Math.max(0, ((odd ? h : w) - S) / 2); const my = Math.max(0, ((odd ? w : h) - S) / 2);
      ox = Math.min(mx, Math.max(-mx, ox)); oy = Math.min(my, Math.max(-my, oy));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, S, S);
      ctx.save(); ctx.translate(S / 2 + ox, S / 2 + oy); ctx.rotate((rot * Math.PI) / 2);
      ctx.drawImage(img, -w / 2, -h / 2, w, h); ctx.restore();
    }
    let drag = null;
    stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; try { stage.setPointerCapture(e.pointerId); } catch (_) { /* قدیمی */ } });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = S / stage.getBoundingClientRect().width;
      ox += (e.clientX - drag.x) * k; oy += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY }; draw();
    });
    const endDrag = () => { drag = null; };
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
    const setZoom = (v) => { z = Math.min(3, Math.max(1, v)); zoom.value = String(z); draw(); };
    zoom.addEventListener('input', () => setZoom(Number(zoom.value) || 1));
    minus.addEventListener('click', () => setZoom(z - 0.2)); plus.addEventListener('click', () => setZoom(z + 0.2));
    rotL.addEventListener('click', () => { rot = (rot + 3) % 4; ox = 0; oy = 0; draw(); }); rotR.addEventListener('click', () => { rot = (rot + 1) % 4; ox = 0; oy = 0; draw(); });
    stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(z - e.deltaY * 0.002); }, { passive: false });
    function close(result) { document.removeEventListener('keydown', onKey); back.remove(); done(result); }
    function onKey(e) { if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => { if (e.target === back) close(null); });
    no.addEventListener('click', () => close(null));
    ok.addEventListener('click', () => canvas.toBlob((b) => close(b), 'image/jpeg', 0.88));
    document.body.appendChild(back);
    draw();
    ok.focus();
  }

  // ---------- عکس دیگران در لیست‌ها و پروفایل‌ها ----------
  // AP.avatar(name, cls, userId) برچسب data-uid می‌گذارد؛ این‌جا فقط برای کاربرانِ دارای عکس تصویر بارگذاری می‌شود.
  let have = new Map(); // userId → نسخه
  function enhance(el) {
    if (el.id === 'me-avatar') return;
    const id = Number(el.dataset.uid);
    const v = have.get(id);
    const existing = el.querySelector('img.avatar-photo');
    if (!v) { if (existing) existing.remove(); el.classList.remove('has-photo'); return; }
    if (existing && existing.dataset.v === v) return;
    if (existing) existing.remove();
    const img = document.createElement('img');
    img.className = 'avatar-photo'; img.alt = ''; img.dataset.v = v;
    img.addEventListener('error', () => img.remove());
    img.src = '/api/admin/avatar/' + id + '?v=' + encodeURIComponent(v);
    el.appendChild(img); el.classList.add('has-photo');
  }
  function enhanceAll() { document.querySelectorAll('.avatar[data-uid]').forEach(enhance); }
  async function loadSet() {
    try {
      const d = await AP.api('/admin/avatars');
      have = new Map(Object.entries(d.versions || {}).map(([k, v]) => [Number(k), v]));
      enhanceAll();
    } catch (_) { /* بدون عکس: حروف اول نام */ }
  }
  new MutationObserver((muts) => {
    if (!have.size) return;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches && n.matches('.avatar[data-uid]')) enhance(n);
        if (n.querySelectorAll) n.querySelectorAll('.avatar[data-uid]').forEach(enhance);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) loadSet(); });

  function box() { return document.getElementById('me-avatar'); }

  function paint() {
    const b = box();
    if (!b || !me) return;
    const old = b.querySelector('img.avatar-photo');
    if (old) old.remove();
    b.classList.remove('has-photo');
    const img = document.createElement('img');
    img.className = 'avatar-photo'; img.alt = '';
    img.addEventListener('load', () => { hasPhoto = true; b.classList.add('has-photo'); });
    img.addEventListener('error', () => { hasPhoto = false; img.remove(); });
    img.src = '/api/admin/avatar/' + encodeURIComponent(me.id) + '?v=' + Date.now();
    b.appendChild(img);
  }

  async function upload(file) {
    const b = box();
    try {
      const blob = await openCropper(file);
      if (!blob) return;
      b.classList.add('is-busy');
      const res = await fetch('/api/admin/avatar', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'image/jpeg', 'X-Requested-With': 'AttendancePanel' }, body: blob });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'ذخیره‌ی عکس ناموفق بود.');
      AP.toast('عکس پروفایل ذخیره شد.');
      if (window.celebrate) window.celebrate('confetti');
      paint(); loadSet();
      b.classList.add('avatar-pop');
      setTimeout(() => b.classList.remove('avatar-pop'), 600);
    } catch (err) { AP.toast(err.message || 'خطا', true); } finally { b.classList.remove('is-busy'); }
  }

  async function removePhoto() {
    try { await AP.api('/admin/avatar', { method: 'DELETE' }); AP.toast('عکس حذف شد.'); hasPhoto = false; paint(); loadSet(); } catch (err) { AP.toast(err.message || 'خطا', true); }
  }

  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  function openMenu(anchor, input) {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'avatar-menu'; menu.setAttribute('role', 'menu');
    const head = document.createElement('div'); head.className = 'avatar-menu-head';
    const pv = document.createElement('div'); pv.className = 'avatar-menu-pv';
    if (hasPhoto) { const pi = document.createElement('img'); pi.alt = ''; pi.src = '/api/admin/avatar/' + encodeURIComponent(me.id) + '?v=' + Date.now(); pv.appendChild(pi); } else { pv.textContent = AP.initials(me.fullName); }
    const nm = document.createElement('div'); nm.className = 'avatar-menu-name'; nm.textContent = me.fullName;
    head.append(pv, nm); menu.appendChild(head);
    const item = (icon, label, fn, danger) => {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
      if (danger) b.className = 'is-danger';
      const i = document.createElement('span'); i.className = 'avatar-menu-ico'; i.textContent = icon;
      b.append(i, document.createTextNode(label));
      b.addEventListener('click', () => { closeMenu(); fn(); });
      menu.appendChild(b);
    };
    item('📷', hasPhoto ? 'تغییر عکس' : 'افزودن عکس', () => input.click());
    if (hasPhoto) item('🗑', 'حذف عکس', removePhoto, true);
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = Math.max(8, r.top - menu.offsetHeight - 10) + 'px';
    menu.style.insetInlineStart = Math.max(8, r.left) + 'px';
    menu.querySelector('button').focus();
  }

  AP.profilePhoto = {
    mount(user) {
      me = user;
      loadSet();
      if (!AP.profilePhoto.timer) AP.profilePhoto.timer = setInterval(loadSet, 5 * 60 * 1000);
      const b = box();
      if (!b || b.dataset.avatarReady) { paint(); return; }
      b.dataset.avatarReady = '1';
      b.classList.add('avatar-editable');
      b.setAttribute('role', 'button'); b.setAttribute('tabindex', '0'); b.setAttribute('aria-label', 'عکس پروفایل'); b.setAttribute('title', 'عکس پروفایل');
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
      input.addEventListener('change', () => {
        const f = input.files && input.files[0]; input.value = '';
        if (!f) return;
        if (!/^image\//.test(f.type)) { AP.toast('فقط فایل تصویری انتخاب کنید.', true); return; }
        upload(f);
      });
      document.body.appendChild(input);
      const toggle = (e) => { e.preventDefault(); e.stopPropagation(); if (menu) closeMenu(); else openMenu(b, input); };
      b.addEventListener('click', toggle);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); });
      document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
      paint();
    },
  };
})();
