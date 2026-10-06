// قواعد تشخیص «نشانه‌ی مشکوک» (S2-4). همه‌ی توابع این فایل خالص‌اند:
// بدون DB، بدون زمان سیستم، بدون تغییر ورودی. ثبت نتیجه در suspiciousRepository و اتصال به
// ثبت تردد/nightlyReview کار S2-4e است.
//
// ⚠️ device_id سمت کلاینت ساخته می‌شود و قابل جعل است؛ خروجی فقط «نشانه» است، نه مدرک.

const { normalizeDeviceId } = require('./deviceInfo');

const EVENT_SHARED_DEVICE = 'shared_device';
const EVENT_SAME_IP_CLOSE = 'same_ip_close';
const EVENT_DEVICE_CHANGE = 'device_change';
// پیش‌فرض N قاعده‌ی ب (ثانیه). مقدار واقعی را فراخواننده از config.fraud.sameIpWindowSeconds می‌دهد.
const DEFAULT_SAME_IP_WINDOW_SECONDS = 60;
// پیش‌فرض‌های قاعده‌ی ج (مقدار واقعی را فراخواننده از config.fraud می‌دهد):
// پنجره‌ی «الگوی اخیر» بر حسب روز تقویمی، و حداقل تعداد روزِ دارای device در آن پنجره
const DEFAULT_DEVICE_CHANGE_LOOKBACK_DAYS = 7;
const DEFAULT_DEVICE_CHANGE_MIN_HISTORY_DAYS = 3;

// قاعده‌ی الف: یک device_id معتبر برای دو (یا بیشتر) کاربر مختلف در یک روز.
// ورودی: records = [{ id, user_id, record_date, check_in_device, check_out_device }]
//   (هر ردیف attendance_records؛ هر دو device ورود و خروج بررسی می‌شود.)
// خروجی: آرایه‌ی کاندیدای رویداد با همان شکل ورودی suspiciousRepository.create،
//   مرتب‌شده بر اساس (تاریخ، device) تا نتیجه قطعی باشد. یک کاربر که با یک device
//   چند بار ثبت کند، یا ردیف بدون device/با device نامعتبر ⇒ هیچ نشانه‌ای نمی‌سازد.
function detectSharedDevice(records) {
  if (!Array.isArray(records)) return [];

  // کلید گروه: تاریخ + device ⇒ { users: Set, recordIds: Set }
  const groups = new Map();
  for (const rec of records) {
    if (!rec || !Number.isInteger(rec.user_id) || typeof rec.record_date !== 'string') continue;
    const devices = new Set(
      [rec.check_in_device, rec.check_out_device].map(normalizeDeviceId).filter(Boolean)
    );
    for (const deviceId of devices) {
      const key = `${rec.record_date}\u0000${deviceId}`;
      let g = groups.get(key);
      if (!g) {
        g = { eventDate: rec.record_date, deviceId, users: new Set(), recordIds: new Set() };
        groups.set(key, g);
      }
      g.users.add(rec.user_id);
      if (Number.isInteger(rec.id)) g.recordIds.add(rec.id);
    }
  }

  const byNum = (a, b) => a - b;
  return [...groups.values()]
    .filter((g) => g.users.size >= 2)
    .map((g) => ({
      eventType: EVENT_SHARED_DEVICE,
      userIds: [...g.users].sort(byNum),
      recordIds: [...g.recordIds].sort(byNum),
      eventDate: g.eventDate,
      details: { rule: 'A', deviceId: g.deviceId, userCount: g.users.size },
    }))
    .sort((a, b) => (a.eventDate < b.eventDate ? -1 : a.eventDate > b.eventDate ? 1
      : a.details.deviceId < b.details.deviceId ? -1 : a.details.deviceId > b.details.deviceId ? 1 : 0));
}

// نرمال‌سازی IP برای مقایسه: حذف فاصله و پیشوند IPv6-mapped (::ffff:)، حروف کوچک؛ خالی/غیررشته ⇒ null
function normalizeIp(raw) {
  if (typeof raw !== 'string') return null;
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip || null;
}

const byNum = (a, b) => a - b;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// قاعده‌ی ب: دو کاربر مختلف با یک IP، که ثبت‌هایشان (ورود یا خروج، هر ترکیبی) در همان روز و
// با فاصله‌ی «کمتر از N ثانیه» باشد. فاصله‌ی دقیقاً برابر N نشانه نمی‌سازد.
// ورودی: records = [{ id, user_id, record_date, check_in_time, check_in_ip, check_out_time, check_out_ip }]
//   (هر ردیف attendance_records؛ زمان‌ها ISO سمت سرور).
// options.windowSeconds: همان N (ثانیه)؛ عدد نامعتبر/غیرمثبت ⇒ پیش‌فرض ۶۰.
// خروجی: کاندیدای رویداد با شکل ورودی suspiciousRepository.create؛ برای هر (روز، IP) هر گروه از
//   کاربرانِ «زنجیره‌ایِ نزدیک به هم» یک رویداد. مرتب و قطعی. ثبت‌های بدون IP/زمان معتبر یا ردیف خراب
//   نادیده گرفته می‌شوند و چند ثبت پشت‌سرهم از یک کاربر هرگز نشانه نمی‌سازد.
function detectSameIpClose(records, options) {
  if (!Array.isArray(records)) return [];
  const n = Number(options && options.windowSeconds);
  const windowSeconds = Number.isFinite(n) && n > 0 ? n : DEFAULT_SAME_IP_WINDOW_SECONDS;
  const windowMs = windowSeconds * 1000;

  // کلید گروه: تاریخ + IP ⇒ فهرست ثبت‌ها { t (ms), userId, recordId }
  const groups = new Map();
  for (const rec of records) {
    if (!rec || !Number.isInteger(rec.user_id) || typeof rec.record_date !== 'string') continue;
    const regs = [
      [rec.check_in_time, rec.check_in_ip],
      [rec.check_out_time, rec.check_out_ip],
    ];
    for (const [time, rawIp] of regs) {
      const ip = normalizeIp(rawIp);
      const t = typeof time === 'string' ? Date.parse(time) : NaN;
      if (!ip || !Number.isFinite(t)) continue;
      const key = `${rec.record_date}\u0000${ip}`;
      let g = groups.get(key);
      if (!g) {
        g = { eventDate: rec.record_date, ip, regs: [] };
        groups.set(key, g);
      }
      g.regs.push({ t, userId: rec.user_id, recordId: Number.isInteger(rec.id) ? rec.id : null });
    }
  }

  const events = [];
  for (const g of groups.values()) {
    const regs = g.regs.slice().sort((a, b) => a.t - b.t || a.userId - b.userId
      || (a.recordId ?? 0) - (b.recordId ?? 0));
    // union-find روی ثبت‌ها: دو ثبت از دو کاربر متفاوت با فاصله‌ی < N هم‌گروه می‌شوند
    const parent = regs.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const pairs = [];
    for (let i = 0; i < regs.length; i += 1) {
      for (let j = i + 1; j < regs.length && regs[j].t - regs[i].t < windowMs; j += 1) {
        if (regs[i].userId === regs[j].userId) continue;
        parent[find(i)] = find(j);
        pairs.push([i, j]);
      }
    }
    const comps = new Map(); // ریشه ⇒ { users, recordIds, minGapMs }
    for (const [i, j] of pairs) {
      const root = find(i);
      let c = comps.get(root);
      if (!c) {
        c = { users: new Set(), recordIds: new Set(), minGapMs: Infinity };
        comps.set(root, c);
      }
      for (const r of [regs[i], regs[j]]) {
        c.users.add(r.userId);
        if (r.recordId !== null) c.recordIds.add(r.recordId);
      }
      c.minGapMs = Math.min(c.minGapMs, regs[j].t - regs[i].t);
    }
    for (const c of comps.values()) {
      events.push({
        eventType: EVENT_SAME_IP_CLOSE,
        userIds: [...c.users].sort(byNum),
        recordIds: [...c.recordIds].sort(byNum),
        eventDate: g.eventDate,
        details: { rule: 'B', ip: g.ip, windowSeconds, minGapSeconds: c.minGapMs / 1000, userCount: c.users.size },
      });
    }
  }

  return events.sort((a, b) => cmpStr(a.eventDate, b.eventDate) || cmpStr(a.details.ip, b.details.ip)
    || cmpStr(a.userIds.join(','), b.userIds.join(',')));
}

// شماره‌ی روز (از epoch) برای رشته‌ی تاریخ میلادی YYYY-MM-DD؛ نامعتبر ⇒ null
function dayNumber(dateStr) {
  const m = typeof dateStr === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 86400000;
}

const positiveIntOr = (raw, fallback) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

// قاعده‌ی ج: تغییر ناگهانی دستگاه یک کاربر نسبت به الگوی چند روز اخیرش.
// برای هر روز D از هر کاربر: «الگو» = اجتماع device_idهای معتبر او در `lookbackDays` روز تقویمیِ قبل از D.
//   - اگر الگو حداقل `minHistoryDays` روزِ دارای device داشته باشد (تاریخچه‌ی کافی) و
//   - روز D حداقل یک device معتبر داشته باشد و هیچ‌کدام در الگو نباشد (حتی یکی مشترک ⇒ نشانه نیست)
//   ⇒ یک نشانه. روز بعدی که همان device جدید دوباره دیده شود، چون الگو را به‌روز کرده، نشانه نمی‌سازد
//   (فقط «اولین روزِ تغییر» گزارش می‌شود).
// ورودی: records = [{ id, user_id, record_date, check_in_device, check_out_device }]
// options.lookbackDays (پیش‌فرض ۷) / options.minHistoryDays (پیش‌فرض ۳): عدد صحیح مثبت؛ نامعتبر ⇒ پیش‌فرض.
// options.targetDate (اختیاری، YYYY-MM-DD): فقط همان روز ارزیابی شود (برای اجرای لحظه‌ای/شبانه)؛ نامعتبر ⇒ همه‌ی روزها.
// خروجی: کاندیدای رویداد با شکل ورودی suspiciousRepository.create، مرتب و قطعی. ردیف بدون device/با
//   device نامعتبر (بات، ثبت دستی، کلاینت قدیمی) نه تاریخچه حساب می‌شود نه نشانه می‌سازد.
function detectDeviceChange(records, options) {
  if (!Array.isArray(records)) return [];
  const opts = options || {};
  const lookbackDays = positiveIntOr(opts.lookbackDays, DEFAULT_DEVICE_CHANGE_LOOKBACK_DAYS);
  const minHistoryDays = positiveIntOr(opts.minHistoryDays, DEFAULT_DEVICE_CHANGE_MIN_HISTORY_DAYS);
  const targetDay = dayNumber(opts.targetDate);
  const onlyTarget = typeof opts.targetDate === 'string' && targetDay !== null;

  // کاربر ⇒ روز ⇒ { date, devices: Set, recordIds: Set }
  const users = new Map();
  for (const rec of records) {
    if (!rec || !Number.isInteger(rec.user_id)) continue;
    const dn = dayNumber(rec.record_date);
    if (dn === null) continue;
    const devices = [rec.check_in_device, rec.check_out_device].map(normalizeDeviceId).filter(Boolean);
    if (devices.length === 0) continue;
    let days = users.get(rec.user_id);
    if (!days) { days = new Map(); users.set(rec.user_id, days); }
    let day = days.get(dn);
    if (!day) { day = { date: rec.record_date, devices: new Set(), recordIds: new Set() }; days.set(dn, day); }
    devices.forEach((d) => day.devices.add(d));
    if (Number.isInteger(rec.id)) day.recordIds.add(rec.id);
  }

  const events = [];
  for (const [userId, days] of users) {
    for (const [dn, day] of days) {
      if (onlyTarget && dn !== targetDay) continue;
      const baseline = new Set();
      let historyDays = 0;
      for (const [otherDn, other] of days) {
        if (otherDn < dn - lookbackDays || otherDn >= dn) continue;
        historyDays += 1;
        other.devices.forEach((d) => baseline.add(d));
      }
      if (historyDays < minHistoryDays) continue;
      if ([...day.devices].some((d) => baseline.has(d))) continue;
      events.push({
        eventType: EVENT_DEVICE_CHANGE,
        userIds: [userId],
        recordIds: [...day.recordIds].sort(byNum),
        eventDate: day.date,
        details: {
          rule: 'C',
          newDevices: [...day.devices].sort(cmpStr),
          baselineDevices: [...baseline].sort(cmpStr),
          historyDays,
          lookbackDays,
          minHistoryDays,
        },
      });
    }
  }

  return events.sort((a, b) => cmpStr(a.eventDate, b.eventDate) || (a.userIds[0] - b.userIds[0]));
}

module.exports = {
  EVENT_SHARED_DEVICE,
  EVENT_SAME_IP_CLOSE,
  EVENT_DEVICE_CHANGE,
  DEFAULT_SAME_IP_WINDOW_SECONDS,
  DEFAULT_DEVICE_CHANGE_LOOKBACK_DAYS,
  DEFAULT_DEVICE_CHANGE_MIN_HISTORY_DAYS,
  detectSharedDevice,
  detectSameIpClose,
  detectDeviceChange,
};
