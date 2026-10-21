// یکپارچگی بی‌خطر Mini App با Telegram WebApp؛ بدون وابستگی به DOM برنامه.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MiniAppTelegram = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const insetNames = ['top', 'right', 'bottom', 'left'];

  function create(tg, documentRef) {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    let backHandler = null;
    let backBound = false;

    const safe = (fn, fallback) => {
      try { return fn(); } catch (_) { return fallback; }
    };

    function setInsets(prefix, value) {
      const style = doc && doc.documentElement && doc.documentElement.style;
      if (!style || typeof style.setProperty !== 'function') return;
      insetNames.forEach((name) => {
        const n = Number(value && value[name]);
        style.setProperty(`--tg-${prefix}-${name}`, `${Number.isFinite(n) && n > 0 ? n : 0}px`);
      });
    }

    function syncInsets() {
      setInsets('safe', tg && tg.safeAreaInset);
      setInsets('content-safe', tg && tg.contentSafeAreaInset);
    }

    function init() {
      if (!tg) { syncInsets(); return; }
      safe(() => { if (typeof tg.ready === 'function') tg.ready(); });
      safe(() => { if (typeof tg.expand === 'function') tg.expand(); });
      safe(() => {
        if (typeof tg.disableVerticalSwipes === 'function' && tg.isVerticalSwipesEnabled !== false) tg.disableVerticalSwipes();
      });
      syncInsets();
      safe(() => {
        if (typeof tg.onEvent === 'function') {
          tg.onEvent('safeAreaChanged', syncInsets);
          tg.onEvent('contentSafeAreaChanged', syncInsets);
        }
      });
    }

    function impact(style = 'light') {
      safe(() => {
        const h = tg && tg.HapticFeedback;
        if (h && typeof h.impactOccurred === 'function') h.impactOccurred(style);
      });
    }

    function notify(type) {
      safe(() => {
        const h = tg && tg.HapticFeedback;
        if (h && typeof h.notificationOccurred === 'function') h.notificationOccurred(type);
      });
    }

    function setBackHandler(handler) {
      backHandler = typeof handler === 'function' ? handler : null;
      const button = tg && tg.BackButton;
      if (!button) return;
      if (!backBound && typeof button.onClick === 'function') {
        safe(() => button.onClick(() => { if (backHandler) backHandler(); }));
        backBound = true;
      }
      safe(() => {
        if (backHandler && typeof button.show === 'function') button.show();
        else if (!backHandler && typeof button.hide === 'function') button.hide();
      });
    }

    function ask(message, fallback) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (answer) => { if (!settled) { settled = true; resolve(Boolean(answer)); } };
        if (tg && typeof tg.showConfirm === 'function') {
          try { tg.showConfirm(message, done); return; } catch (_) { /* fallback داخلی */ }
        }
        try {
          const result = typeof fallback === 'function' ? fallback() : false;
          Promise.resolve(result).then(done, () => done(false));
        } catch (_) { done(false); }
      });
    }

    return { init, syncInsets, impact, notify, setBackHandler, ask };
  }

  return { create };
});
