// اعتبارسنجی و کوتاه‌سازی «نشانه‌ی دستگاه» ثبت تردد (S2-3).
//
// اصل مهم: این ماژول هرگز نباید ثبت تردد را مختل کند. ورودی نامعتبر ⇒ null (نادیده گرفته می‌شود)،
// و هیچ تابعی اینجا استثنا نمی‌دهد. زمان و اعتبار ثبت فقط از سرور و منطق قبلی می‌آید، نه از این‌ها.

// device_id: رشته‌ی تصادفی (UUID یا hex) با حروف/ارقام/خط‌تیره/زیرخط، ۱۶ تا ۶۴ نویسه
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const USER_AGENT_MAX = 200;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

function normalizeDeviceId(raw) {
  if (typeof raw !== 'string') return null;
  return DEVICE_ID_RE.test(raw) ? raw : null;
}

function normalizeUserAgent(raw, max = USER_AGENT_MAX) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(CONTROL_CHARS_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

// از درخواست Express: device_id از body.deviceId (کلاینت)، UA از هدر واقعی درخواست.
// هر خطای غیرمنتظره ⇒ { null, null } تا ثبت تردد ادامه پیدا کند.
function extractDeviceInfo(req) {
  try {
    return {
      deviceId: normalizeDeviceId(req && req.body ? req.body.deviceId : undefined),
      userAgent: normalizeUserAgent(req && typeof req.get === 'function' ? req.get('user-agent') : undefined),
    };
  } catch (_) {
    return { deviceId: null, userAgent: null };
  }
}

module.exports = { normalizeDeviceId, normalizeUserAgent, extractDeviceInfo, DEVICE_ID_RE, USER_AGENT_MAX };
