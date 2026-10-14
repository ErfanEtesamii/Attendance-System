// لینک‌ها و دکمه‌های ورود به پنل از داخل بات.
// آدرس پایه از MINI_APP_URL گرفته می‌شود (فقط origin آن؛ پنل همیشه روی /admin/ است).

const config = require('../config');

const ROLE_LABELS = { admin: 'ادمین کل', manager: 'سرپرست', employee: 'کارمند' };

const ROLE_ACCESS = {
  admin: 'همه‌ی کارمندان را می‌بینید و کنترل می‌کنید.',
  manager: 'فقط اعضای تیم خودتان را می‌بینید و کنترل می‌کنید.',
  employee: 'فقط اطلاعات خودتان را می‌بینید.',
};

function baseOrigin() {
  if (!config.miniAppUrl) return null;
  try {
    return new URL(config.miniAppUrl).origin;
  } catch (_) {
    return null;
  }
}

/** آدرس پنل. view = شناسه‌ی صفحه‌ای که بعد از ورود باز شود (مثلاً nightly). */
function panelUrl({ view, token } = {}) {
  const origin = baseOrigin();
  if (!origin) return null;
  const u = new URL('/admin/', origin);
  if (view) u.searchParams.set('go', view);
  if (token) u.searchParams.set('t', token);
  return u.toString();
}

// دکمه‌ی web_app تلگرام فقط روی https کار می‌کند
function canUseWebApp(url) {
  return !!url && url.startsWith('https://');
}

/** دکمه‌ی اینلاینِ «ورود به پنل» (Web App: ورود خودکار با initData، بدون کد و رمز) */
function panelWebAppButton(opts = {}) {
  const url = panelUrl(opts);
  return canUseWebApp(url) ? { text: opts.text || '🖥 ورود به پنل', web_app: { url } } : null;
}

/** آدرس Mini App (ثبت تردد). view = صفحه‌ی بازشونده (مثلاً plan ⇒ ?view=plan). */
function miniAppLink({ view, params } = {}) {
  const base = config.miniAppUrl;
  if (!base) return null;
  if (!view) return base;
  try {
    const u = new URL(base);
    u.searchParams.set('view', view);
    Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
    return u.toString();
  } catch (_) {
    return null;
  }
}

/** دکمه‌ی اینلاینِ باز کردن مستقیم گفت‌وگوی یک اعتراض در Mini App (?view=dispute&id=N)؛ روی http/بدون آدرس null. */
function disputeButton(disputeId, text = '💬 مشاهده‌ی گفت‌وگو') {
  const url = miniAppLink({ view: 'dispute', params: { id: disputeId } });
  return canUseWebApp(url) ? { text, web_app: { url } } : null;
}

/** کیبورد ثابت پایین چت برای کاربر ثبت‌شده — منوی نقش‌محور (E1)؛ برای کاربر ثبت‌نشده/چت غیرخصوصی null. */
function persistentKeyboard(user, opts) {
  return require('./menu/menuRouter').buildMainKeyboard(user, opts); // lazy: menuRouter خودش panelLinks را می‌خواهد
}

module.exports = { ROLE_LABELS, ROLE_ACCESS, panelUrl, panelWebAppButton, persistentKeyboard, miniAppLink, canUseWebApp, disputeButton };
