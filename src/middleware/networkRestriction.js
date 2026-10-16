// middleware واقعی فاز ۲: بررسی IP مبدأ هر درخواست ثبت تردد در برابر رنج شبکه داخلی شرکت.
//
// طبق سند پروژه این چک به‌عنوان «لایه دوم دفاعی» (Defense in Depth) عمل می‌کند:
// حتی اگر سرور خودش فقط با IP داخلی در دسترس باشد، این middleware مستقل و همیشه فعال است
// تا اگر در آینده هر مسیر دیگری (VPN و مشابه آن) به شبکه اضافه شد، بدون تغییر دستی این کد
// آن مسیر به‌طور خودکار مسدود بماند مگر صراحتاً به ALLOWED_NETWORK_CIDR اضافه شود.

const config = require('../config');
const auditRepository = require('../repositories/auditRepository');
const leaveRepository = require('../repositories/leaveRepository');
const { todayDateString } = require('../utils/serverTime');

// تبدیل IPv4 به عدد صحیح ۳۲ بیتی برای مقایسه سریع در محدوده CIDR
function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// تجزیه یک رشته CIDR مثل "192.168.10.0/24" به { base, mask }
function parseCidr(cidr) {
  const [base, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const baseInt = ipv4ToInt(base);
  if (baseInt === null || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`مقدار ALLOWED_NETWORK_CIDR نامعتبر است: ${cidr}`);
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { baseInt: baseInt & mask, mask };
}

// نرمال‌سازی IP خروجی Express/Node.
// وقتی سرور روی IPv4 خالص گوش می‌دهد، اتصال‌های محلی/IPv4 گاهی با پیشوند IPv6-mapped
// مثل "::ffff:192.168.10.5" گزارش می‌شوند؛ این پیشوند را برای مقایسه صحیح حذف می‌کنیم.
function normalizeIp(rawIp) {
  if (!rawIp) return rawIp;
  if (rawIp.startsWith('::ffff:')) return rawIp.slice(7);
  return rawIp;
}

function isIpInCidr(ip, cidr) {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false; // IPv6 خالص یا فرمت نامعتبر: در این فاز مجاز شمرده نمی‌شود
  const { baseInt, mask } = parseCidr(cidr);
  return (ipInt & mask) === baseInt;
}

// منطق مشترک و بدون اثر جانبی (R2، فاز ۱۴): وضعیتِ شبکه‌ی یک درخواست. هم middleware پایین و هم endpoint کلاینت
// (network-state) فقط از همین استفاده می‌کنند تا «داخل/خارج شبکه» همیشه یک تعریف داشته باشد. تصمیم فقط از req.ip (و هویت
// امضاشده‌ی req.miniAppUser) گرفته می‌شود؛ هیچ پرچمی از query/body/header کلاینت خوانده نمی‌شود.
//   missionKind: 'approved' (ماموریتِ تأییدشده‌ی امروز) | 'pending' (ماموریتِ در انتظار با تنظیم روشن) | null
function resolveNetworkAccess(req) {
  const ip = normalizeIp(req.ip);
  const userId = req.miniAppUser?.id;
  if (isIpInCidr(ip, config.allowedNetworkCidr)) return { ip, userId, inNetwork: true, missionKind: null, pendingId: null };

  // استثنای فاز ۷: مأموریت تأییدشده برای همین کاربر و همین تاریخ.
  // فقط هویت امضاشده‌ی Mini App (req.miniAppUser از telegramAuth) پذیرفته می‌شود؛ userId خام body/query
  // دیگر خوانده نمی‌شود (بخش ۱-ب): مسیر قدیمی /api/attendance که بدون احراز هویت userId را از body می‌گرفت
  // حذف شد، و تا وقتی این middleware فقط بعد از telegramAuth قرار دارد، نیازی به آن نیست.
  // (اگر روزی جایی بدون telegramAuth استفاده شود، userId=null و فقط رد + ثبت audit رخ می‌دهد: fail-closed)
  if (userId && leaveRepository.hasApprovedMissionOnDate(userId, todayDateString())) {
    return { ip, userId, inNetwork: false, missionKind: 'approved', pendingId: null };
  }

  // C5: ماموریتِ در انتظارِ امروز (و تنظیم allowCheckinWithPendingMission) ⇒ عبور با پرچم؛ route رکورد و «نشانه» را ثبت می‌کند
  const pendingId = require('../services/pendingMissionService').pendingMissionPass(userId, todayDateString());
  if (pendingId) return { ip, userId, inNetwork: false, missionKind: 'pending', pendingId };

  return { ip, userId, inNetwork: false, missionKind: null, pendingId: null };
}

// وضعیت شبکه برای کلاینت: { inNetwork, viaMission }. viaMission فقط بیرون از شبکه معنا دارد (داخل شبکه ماموریت بررسی نمی‌شود).
function getNetworkState(req) {
  const a = resolveNetworkAccess(req);
  return { inNetwork: a.inNetwork, viaMission: !a.inNetwork && a.missionKind !== null };
}

// دورکاری فقط وقتی مجاز است که: بیرون از شبکه، بدون ماموریت (تأییدشده یا در انتظار)، کاربرِ فعالِ ثبت‌نام‌شده (هویت امضاشده)
// و تنظیم remoteWorkEnabled روشن باشد. کاربر داخل شبکه هرگز دورکاری ندارد. fail-closed: هر ابهامی ⇒ false.
function isRemoteAllowed(req, state = getNetworkState(req)) {
  const u = req.miniAppUser;
  if (!u || !u.id || !u.is_active) return false;
  if (state.inNetwork || state.viaMission) return false;
  return require('../repositories/settingsRepository').getAll().remoteWorkEnabled === true;
}

// پاسخ endpoint کلاینت و مبنای گیت مسیرهای دورکاری (R3)
function getRemoteAccess(req) {
  const state = getNetworkState(req);
  return { ...state, remoteAllowed: isRemoteAllowed(req, state) };
}

// middleware اصلی: اگر IP در رنج مجاز نبود و کاربر هم مأموریت تأییدشده برای امروز نداشت، رد می‌کند.
function networkRestriction(req, res, next) {
  const access = resolveNetworkAccess(req);
  if (access.inNetwork) return next();

  if (access.missionKind === 'approved') {
    auditRepository.logEvent({
      userId: access.userId,
      action: 'attendance_allowed_via_mission',
      ipAddress: access.ip,
      details: { path: req.originalUrl },
    });
    return next();
  }

  if (access.missionKind === 'pending') {
    req.viaPendingMission = access.pendingId;
    return next();
  }

  auditRepository.logEvent({
    userId: access.userId || null,
    action: 'attendance_rejected_ip',
    ipAddress: access.ip,
    details: { path: req.originalUrl, allowedCidr: config.allowedNetworkCidr },
  });

  // code: برای اینکه کلاینت هنگام خطا هم بتواند دیالوگ دورکاری را نشان دهد (R2)؛ متن فارسی و status مثل قبل
  return res.status(403).json({
    error: 'این عملیات فقط از داخل شبکه شرکت قابل انجام است.',
    code: 'OUT_OF_NETWORK',
  });
}

module.exports = { networkRestriction, isIpInCidr, ipv4ToInt, normalizeIp, getNetworkState, isRemoteAllowed, getRemoteAccess };
