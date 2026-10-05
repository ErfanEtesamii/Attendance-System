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

/** کیبورد ثابت پایین چت برای همه‌ی کاربران ثبت‌شده: [پنل] [ثبت تردد] */
function persistentKeyboard() {
  const panel = panelUrl();
  const miniApp = config.miniAppUrl;
  const row = [];
  if (canUseWebApp(panel)) row.push({ text: '🖥 پنل', web_app: { url: panel } });
  if (canUseWebApp(miniApp)) row.push({ text: '🕒 ثبت تردد', web_app: { url: miniApp } });
  if (row.length === 0) return null;
  return { keyboard: [row], resize_keyboard: true, is_persistent: true };
}

module.exports = { ROLE_LABELS, ROLE_ACCESS, panelUrl, panelWebAppButton, persistentKeyboard, canUseWebApp };
