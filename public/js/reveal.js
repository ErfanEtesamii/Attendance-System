/* UX v2: safe, one-time entrance cues and a keyboard-accessible return control. */
(() => {
  'use strict';

  try {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const selector = '.status-card, .earnings-card, .work-hours-card, .history-calendar, #report-card, .stat-grid, .chart-grid, .chart-fig, .week-grid, .schedule-grid';
    const processed = new WeakSet();
    const revealed = new WeakSet();
    const isVisible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };
    const isEligible = (el) => {
      if (!el || processed.has(el) || el.closest('form, [role="alert"], .sheet, .modal, .table-wrap')) return false;
      return !el.parentElement || !el.parentElement.closest(selector);
    };
    const reveal = (el) => {
      if (!el || revealed.has(el)) return;
      revealed.add(el);
      el.classList.remove('ux-reveal');
      el.classList.add('is-revealed');
    };
    const observer = !reduceMotion && 'IntersectionObserver' in window
      ? new window.IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          reveal(entry.target);
        }
      }), { threshold: 0.08 })
      : null;
    const stage = (root) => {
      if (!root || reduceMotion) return;
      const candidates = root.matches && root.matches(selector) ? [root] : Array.from(root.querySelectorAll ? root.querySelectorAll(selector) : []);
      candidates.forEach((el, index) => {
        if (!isEligible(el)) return;
        processed.add(el);
        if (isVisible(el)) return;
        el.classList.add('ux-reveal');
        el.style.transitionDelay = `${Math.min(index * 55, 275)}ms`;
        if (observer) observer.observe(el); else reveal(el);
      });
    };

    stage(document.body);
    if (!reduceMotion && 'MutationObserver' in window) {
      const mutations = new window.MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) stage(node);
      })));
      mutations.observe(document.body, { childList: true, subtree: true });
    }

    const backToTop = document.getElementById('ux-back-to-top');
    if (backToTop) {
      const update = () => { backToTop.hidden = window.scrollY < 480; };
      window.addEventListener('scroll', update, { passive: true });
      backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
      update();
    }
  } catch {
    /* Optional UX must never interfere with the attendance panels. */
  }
})();
