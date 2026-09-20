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

// middleware اصلی: اگر IP در رنج مجاز نبود و کاربر هم مأموریت تأییدشده برای امروز نداشت، رد می‌کند.
function networkRestriction(req, res, next) {
  const rawIp = req.ip;
  const ip = normalizeIp(rawIp);
  const allowed = isIpInCidr(ip, config.allowedNetworkCidr);

  if (allowed) {
    return next();
  }

  // استثنای فاز ۷: مأموریت تأییدشده برای همین کاربر و همین تاریخ.
  // چون این middleware زودتر از هندلر اصلی اجرا می‌شود، userId را همینجا از body/query می‌خوانیم.
  const userId = req.body?.userId || req.query.userId;
  if (userId) {
    const onMission = leaveRepository.hasApprovedMissionOnDate(userId, todayDateString());
    if (onMission) {
      auditRepository.logEvent({
        userId,
        action: 'attendance_allowed_via_mission',
        ipAddress: ip,
        details: { path: req.originalUrl },
      });
      return next();
    }
  }

  auditRepository.logEvent({
    userId: userId || null,
    action: 'attendance_rejected_ip',
    ipAddress: ip,
    details: { path: req.originalUrl, allowedCidr: config.allowedNetworkCidr },
  });

  return res.status(403).json({
    error: 'این عملیات فقط از داخل شبکه شرکت قابل انجام است.',
  });
}

module.exports = { networkRestriction, isIpInCidr, ipv4ToInt, normalizeIp };
