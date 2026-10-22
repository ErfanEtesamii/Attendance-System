// تم پنل و Mini App (S5-8a): روشن/تیره/خودکار با localStorage و هماهنگی با Telegram.WebApp.
// ترتیب اولویت: انتخاب کاربر (light|dark) ⇒ رنگ‌طرح تلگرام (colorScheme، فقط داخل Mini App) ⇒ prefers-color-scheme ⇒ پیش‌فرض صفحه (T1: <meta name="default-theme">؛ نبودنش ⇒ تیره، یعنی ظاهر فعلی Mini App).
// T1 (فاز ۱۶): هر صفحه می‌تواند رنگ نوار/تلگرام هر تم را با <meta name="theme-bg-dark|theme-bg-light"> بدهد (پنل مدیریتی)؛ نبودنشان ⇒ BG ثابت زیر (Mini App).
// پالت صفحه از CSS (data-theme) می‌آید و با رنگ‌های دلخواه themeParams بازنویسی نمی‌شود (تا کنتراست AA تضمین بماند)؛
// از themeParams/colorScheme فقط برای انتخاب روشن/تیره و رنگ نوار بالا/پایین خودِ تلگرام استفاده می‌شود.
// این فایل باید در <head> و همگام (بدون defer) بیاید تا صفحه قبل از رنگ‌شدن تم درست را بگیرد (بدون «فلش»).
(function (root) {
  'use strict';
  const KEY = 'theme';
  const BG = { dark: '#17143a', light: '#f4f3fb' }; // باید با --bg هر تم در CSS یکی باشد (تست)
  const LABEL = { auto: 'خودکار', light: 'روشن', dark: 'تیره' };
  const NEXT = { auto: 'light', light: 'dark', dark: 'auto' };

  function normalize(v) { return v === 'light' || v === 'dark' ? v : 'auto'; }

  // خالص: ورودی‌ها را می‌گیرد و «light|dark» برمی‌گرداند
  function resolveTheme({ stored, prefersDark, tgScheme, fallback } = {}) {
    const pref = normalize(stored);
    if (pref !== 'auto') return pref;
    if (tgScheme === 'light' || tgScheme === 'dark') return tgScheme;
    if (prefersDark === true) return 'dark';
    if (prefersDark === false) return 'light';
    return fallback === 'light' ? 'light' : 'dark'; // سیستم نامعلوم ⇒ پیش‌فرض صفحه (بدون متا: تیره)
  }

  const api = { KEY, BG, LABEL, NEXT, normalize, resolveTheme };
  // توجه: BG همیشه مقدار ثابت Mini App است؛ مقدار مؤثر صفحه (با متاها) فقط داخل apply محاسبه می‌شود.

  if (root && root.document) {
    const doc = root.document;
    const tg = root.Telegram && root.Telegram.WebApp ? root.Telegram.WebApp : null;
    const read = () => { try { return normalize(root.localStorage.getItem(KEY)); } catch (_) { return 'auto'; } };
    const metaContent = (name) => { try { const m = doc.querySelector(`meta[name="${name}"]`); const v = m && m.getAttribute ? m.getAttribute('content') : null; return v || null; } catch (_) { return null; } };
    const HEX = /^#[0-9a-f]{6}$/i;
    const bgOf = (t) => { const v = metaContent(`theme-bg-${t}`); return v && HEX.test(v) ? v : BG[t]; };
    const pageDefault = () => (metaContent('default-theme') === 'light' ? 'light' : 'dark');
    const fixedDefault = () => metaContent('theme-default-mode') === 'fixed';
    const mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
    let pref = read();

    const effective = () => (pref === 'auto' && fixedDefault()
      ? pageDefault()
      : resolveTheme({ stored: pref, prefersDark: mq ? mq.matches : undefined, tgScheme: tg && tg.colorScheme, fallback: pageDefault() }));

    function apply() {
      const t = effective();
      doc.documentElement.setAttribute('data-theme', t);
      doc.documentElement.setAttribute('data-theme-pref', pref);
      const meta = doc.querySelector('meta[name="theme-color"]');
      const bg = bgOf(t);
      if (meta) meta.setAttribute('content', bg);
      if (tg) {
        try { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); if (tg.setBottomBarColor) tg.setBottomBarColor(bg); } catch (_) { /* نسخه‌های قدیمی تلگرام */ }
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
    api.cycle = () => set(pref === 'auto' && fixedDefault() ? 'dark' : NEXT[pref]);

    apply();
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (pref === 'auto') apply(); });
    if (tg && tg.onEvent) tg.onEvent('themeChanged', () => { if (pref === 'auto') apply(); });
    doc.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-theme-toggle]'); if (b) api.cycle(); });
    doc.addEventListener('DOMContentLoaded', apply); // دکمه‌هایی که بعد از head ساخته می‌شوند برچسب بگیرند
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Theme = api;
}(typeof window !== 'undefined' ? window : undefined));
