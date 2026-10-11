// تم پنل و Mini App (S5-8a): روشن/تیره/خودکار با localStorage و هماهنگی با Telegram.WebApp.
// ترتیب اولویت: انتخاب کاربر (light|dark) ⇒ رنگ‌طرح تلگرام (colorScheme، فقط داخل Mini App) ⇒ prefers-color-scheme ⇒ تیره (ظاهر فعلی).
// پالت صفحه از CSS (data-theme) می‌آید و با رنگ‌های دلخواه themeParams بازنویسی نمی‌شود (تا کنتراست AA تضمین بماند)؛
// از themeParams/colorScheme فقط برای انتخاب روشن/تیره و رنگ نوار بالا/پایین خودِ تلگرام استفاده می‌شود.
// این فایل باید در <head> و همگام (بدون defer) بیاید تا صفحه قبل از رنگ‌شدن تم درست را بگیرد (بدون «فلش»).
(function (root) {
  'use strict';
  const KEY = 'theme';
  const BG = { dark: '#1b1c2c', light: '#f3f4f9' }; // باید با --bg هر تم در CSS یکی باشد (تست)
  const LABEL = { auto: 'خودکار', light: 'روشن', dark: 'تیره' };
  const NEXT = { auto: 'light', light: 'dark', dark: 'auto' };

  function normalize(v) { return v === 'light' || v === 'dark' ? v : 'auto'; }

  // خالص: ورودی‌ها را می‌گیرد و «light|dark» برمی‌گرداند
  function resolveTheme({ stored, prefersDark, tgScheme } = {}) {
    const pref = normalize(stored);
    if (pref !== 'auto') return pref;
    if (tgScheme === 'light' || tgScheme === 'dark') return tgScheme;
    return prefersDark === false ? 'light' : 'dark';
  }

  const api = { KEY, BG, LABEL, NEXT, normalize, resolveTheme };

  if (root && root.document) {
    const doc = root.document;
    const tg = root.Telegram && root.Telegram.WebApp ? root.Telegram.WebApp : null;
    const read = () => { try { return normalize(root.localStorage.getItem(KEY)); } catch (_) { return 'auto'; } };
    const mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
    let pref = read();

    const effective = () => resolveTheme({ stored: pref, prefersDark: mq ? mq.matches : undefined, tgScheme: tg && tg.colorScheme });

    function apply() {
      const t = effective();
      doc.documentElement.setAttribute('data-theme', t);
      doc.documentElement.setAttribute('data-theme-pref', pref);
      const meta = doc.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', BG[t]);
      if (tg) {
        try { tg.setHeaderColor(BG[t]); tg.setBackgroundColor(BG[t]); if (tg.setBottomBarColor) tg.setBottomBarColor(BG[t]); } catch (_) { /* نسخه‌های قدیمی تلگرام */ }
      }
      doc.querySelectorAll('[data-theme-toggle]').forEach((b) => {
        b.setAttribute('title', `تم: ${LABEL[pref]} (برای تغییر بزنید)`);
        b.setAttribute('aria-label', `تغییر تم؛ حالت فعلی: ${LABEL[pref]}`);
        b.setAttribute('data-state', pref);
      });
      return t;
    }

    function set(next) {
      pref = normalize(next);
      try { if (pref === 'auto') root.localStorage.removeItem(KEY); else root.localStorage.setItem(KEY, pref); } catch (_) { /* حالت خصوصی/مسدود */ }
      return apply();
    }

    api.get = () => pref;
    api.effective = effective;
    api.apply = apply;
    api.set = set;
    api.cycle = () => set(NEXT[pref]);

    apply();
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (pref === 'auto') apply(); });
    if (tg && tg.onEvent) tg.onEvent('themeChanged', () => { if (pref === 'auto') apply(); });
    doc.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-theme-toggle]'); if (b) api.cycle(); });
    doc.addEventListener('DOMContentLoaded', apply); // دکمه‌هایی که بعد از head ساخته می‌شوند برچسب بگیرند
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Theme = api;
}(typeof window !== 'undefined' ? window : undefined));
