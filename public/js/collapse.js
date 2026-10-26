/* UX v2: preserve native disclosure state through safe, independent re-renders. */
(() => {
  'use strict';
  try {
    const keyFor = (el) => `ux-collapse:${el.getAttribute('data-ux-collapse') || el.id}`;
    const restore = (el) => {
      if (!el || !el.matches || !el.matches('details[data-ux-collapse]')) return;
      try { if (window.sessionStorage.getItem(keyFor(el)) === 'open') el.open = true; } catch { /* Optional. */ }
    };
    const scan = (root) => {
      if (!root) return;
      if (root.matches && root.matches('details[data-ux-collapse]')) restore(root);
      if (root.querySelectorAll) root.querySelectorAll('details[data-ux-collapse]').forEach(restore);
    };
    document.addEventListener('toggle', (event) => {
      const el = event.target;
      if (!el || !el.matches || !el.matches('details[data-ux-collapse]')) return;
      try { window.sessionStorage.setItem(keyFor(el), el.open ? 'open' : 'closed'); } catch { /* Private mode. */ }
    }, true);
    scan(document);
    if ('MutationObserver' in window) new window.MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => { if (node.nodeType === 1) scan(node); }))).observe(document.body, { childList: true, subtree: true });
  } catch { /* Native <details> remains usable without enhancement. */ }
})();
