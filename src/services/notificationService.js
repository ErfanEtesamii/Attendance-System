// سرویس اعلان (S4-5a): notify(userId, {...}) — اعلان درون‌پنلی همیشه؛ تلگرام فقط وقتی خواسته شده.
//
//   await notify(userId, {
//     type: 'leave_requested',        // الزامی، snake_case انگلیسی
//     title: 'درخواست مرخصی جدید',     // الزامی
//     body, link, data,               // اختیاری (link = لینک عمیق پنل، data = آبجکت JSON-پذیر)
//     dedupeKey: 'leave_requested:42',// اختیاری؛ همان کلید برای همان کاربر ⇒ اعلان دوم ساخته/ارسال نمی‌شود
//     telegram: true,                 // اختیاری، پیش‌فرض false (هنوز ترجیح per-user وجود ندارد؛ فراخواننده تصمیم می‌گیرد)
//   });
//   ⇒ { created, notification }
//
// • ردیف پنل «منبع حقیقت» است و قبل از هر کار async ثبت می‌شود؛ شکست تلگرام هرگز ثبت را خراب نمی‌کند (فقط telegram_status=failed).
// • dedupe: در تکراری هیچ ردیف جدیدی ساخته و هیچ پیام تلگرامی دوباره فرستاده نمی‌شود؛ رکورد قبلی بدون تغییر برمی‌گردد.
//   اگر اعلان باید «هر روز/هر بار» تازه باشد، تاریخ/شناسه را داخل dedupeKey بگذارید.
// • ورودی نامعتبر خطا می‌دهد (TypeError/RangeError)؛ فراخواننده‌های جریان‌های اصلی (تردد/مرخصی) باید خطا را بگیرند.

const notificationsRepository = require('../repositories/notificationsRepository');
const usersRepository = require('../repositories/usersRepository');
const { sendMessage } = require('../bot/notifier');
const { sanitizeText } = require('../utils/sanitize');

const TYPE_RE = /^[a-z][a-z0-9_]{1,63}$/;
const MAX_TITLE = 200;
const MAX_BODY = 2000;
const MAX_LINK = 300;
const MAX_KEY = 200;

function optionalText(value, label, max) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(`${label} باید متن باشد.`);
  return sanitizeText(value.trim(), max) || null;
}

function validate(userId, input) {
  if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('userId باید شناسه‌ی عددی مثبت باشد.');
  if (!input || typeof input !== 'object') throw new TypeError('notify: ورودی الزامی است.');
  const { type, title, body, link, data, dedupeKey } = input;
  if (typeof type !== 'string' || !TYPE_RE.test(type)) throw new RangeError('type نامعتبر است (snake_case انگلیسی).');
  if (typeof title !== 'string' || !title.trim()) throw new RangeError('title الزامی است.');
  if (dedupeKey != null && (typeof dedupeKey !== 'string' || !dedupeKey.trim() || dedupeKey.length > MAX_KEY)) {
    throw new RangeError(`dedupeKey باید متن غیرخالی حداکثر ${MAX_KEY} نویسه باشد.`);
  }
  if (data != null && (typeof data !== 'object' || JSON.stringify(data) === undefined)) {
    throw new TypeError('data باید آبجکت یا آرایه‌ی JSON-پذیر باشد.');
  }
  return {
    type,
    title: sanitizeText(title.trim(), MAX_TITLE),
    body: optionalText(body, 'body', MAX_BODY),
    link: optionalText(link, 'link', MAX_LINK),
    data: data == null ? null : data,
    dedupeKey: dedupeKey == null ? null : dedupeKey.trim(),
  };
}

function telegramText(n) {
  return n.body ? `${n.title}\n\n${n.body}` : n.title;
}

/**
 * @param {number} userId
 * @param {{type: string, title: string, body?: string, link?: string, data?: object, dedupeKey?: string, telegram?: boolean}} input
 * @param {{sendTelegram?: (telegramUserId: string, text: string) => Promise<boolean>}} [deps] برای تست
 * @returns {Promise<{created: boolean, notification: object}>}
 */
async function notify(userId, input, deps = {}) {
  const fields = validate(userId, input);
  const user = usersRepository.findById(userId);
  if (!user) throw new RangeError('کاربر گیرنده یافت نشد.');

  const res = notificationsRepository.insert({ userId, ...fields });
  if (!res.created || !input.telegram) return res;

  // فقط برای ردیف «تازه» و فقط وقتی خواسته شده؛ کاربر غیرفعال/بدون آیدی تلگرام ⇒ skipped
  let status = 'skipped';
  if (user.is_active && user.telegram_user_id) {
    const send = deps.sendTelegram || sendMessage;
    try {
      status = (await send(String(user.telegram_user_id), telegramText(res.notification))) ? 'sent' : 'failed';
    } catch (err) {
      console.error('[notify] ارسال تلگرام ناموفق:', sanitizeText(err && err.message, 200));
      status = 'failed';
    }
  }
  return { created: true, notification: notificationsRepository.setTelegramStatus(res.notification.id, status) };
}

module.exports = { notify };
