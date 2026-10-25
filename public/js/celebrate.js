// Celebration is intentionally small, self-cleaning and opt-out. It never changes business state.
(function (root) {
  'use strict';
  const enabled = () => { try { return root.localStorage.getItem('celebrationsEnabled') !== 'false'; } catch (_) { return true; } };
  root.celebrate = function celebrate(kind) {
    if (!enabled() || !root.document) return;
    const reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const host = document.createElement('div'); host.className = `celebrate celebrate-${kind}`; host.setAttribute('aria-hidden', 'true');
    const count = reduced ? 1 : (kind === 'confetti' ? 30 : 1);
    for (let i = 0; i < count; i += 1) { const bit = document.createElement('i'); bit.style.setProperty('--i', i); host.appendChild(bit); }
    document.body.appendChild(host); setTimeout(() => host.remove(), reduced ? 500 : 1200);
  };
}(window));
