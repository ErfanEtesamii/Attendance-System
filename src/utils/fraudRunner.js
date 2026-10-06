// اجرای قاعده‌های تشخیص «مورد مشکوک» روی داده‌ی واقعی و ثبت نتیجه (S2-4e-1).
// این ماژول فقط «هسته» است: هنوز به ثبت تردد/nightlyReview وصل نشده (S2-4e-2) و block اختیاری هم
// ندارد (S2-4e-3).
//
// اصل مهم: runFraudChecks هرگز استثنا نمی‌دهد. هر خطا (بارگذاری داده، یکی از قاعده‌ها، ثبت یک مورد)
// جدا گرفته و در خروجی گزارش می‌شود تا فراخواننده بتواند آن را ببلعد و ثبت تردد هیچ‌وقت نشکند.
// ⚠️ خروجی فقط «نشانه» است نه اتهام؛ device_id قابل جعل است.

const config = require('../config');
const attendanceRepository = require('../repositories/attendanceRepository');
const suspiciousRepository = require('../repositories/suspiciousRepository');
const settingsRepository = require('../repositories/settingsRepository');
const { normalizeDeviceId } = require('./deviceInfo');
const { todayDateString } = require('./serverTime');
const fraud = require('./fraudDetection');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

// جابجایی تاریخ میلادی YYYY-MM-DD به تعداد روز (بدون وابستگی به منطقه‌ی زمانی)
function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * اجرای هر سه قاعده برای «یک روز» و ثبت موارد جدید (با dedupe خودِ repository).
 * - قاعده‌ی الف و ب فقط روی ردیف‌های همان روز اجرا می‌شوند.
 * - قاعده‌ی ج ردیف‌های `lookbackDays` روز قبل را هم می‌بیند ولی فقط همان روز را ارزیابی می‌کند.
 * - اجرای دوباره‌ی همان روز مورد تکراری نمی‌سازد.
 * @param {{date?: string}} [options] date: YYYY-MM-DD؛ پیش‌فرض «امروز» سرور.
 * @returns {{ok: boolean, date: string|null, scanned: number, found: number,
 *            created: object[], duplicates: number, errors: {stage: string, message: string}[]}}
 *   created: رکوردهای suspicious_events که همین اجرا ساخته؛ errors خالی ⇔ ok.
 */
function runFraudChecks(options) {
  const summary = { ok: true, date: null, scanned: 0, found: 0, created: [], duplicates: 0, errors: [] };
  const fail = (stage, err) => {
    const message = err && err.message ? String(err.message) : String(err);
    summary.errors.push({ stage, message });
    console.error(`[fraud] خطا در مرحله‌ی ${stage}:`, message);
  };

  try {
    const date = options && options.date !== undefined ? options.date : todayDateString();
    if (!isValidDate(date)) {
      fail('input', new Error('date باید تاریخ معتبر YYYY-MM-DD باشد.'));
      summary.ok = false;
      return summary;
    }
    summary.date = date;

    const cfg = config.fraud || {};
    const lookbackDays = positiveInt(cfg.deviceChangeLookbackDays, fraud.DEFAULT_DEVICE_CHANGE_LOOKBACK_DAYS);
    const minHistoryDays = positiveInt(cfg.deviceChangeMinHistoryDays, fraud.DEFAULT_DEVICE_CHANGE_MIN_HISTORY_DAYS);
    const windowSeconds = positiveInt(cfg.sameIpWindowSeconds, fraud.DEFAULT_SAME_IP_WINDOW_SECONDS);

    let records;
    try {
      records = attendanceRepository.listForFraud(shiftDate(date, -lookbackDays), date);
    } catch (err) {
      fail('load', err);
      summary.ok = false;
      return summary;
    }
    summary.scanned = records.length;
    const todayRecords = records.filter((r) => r.record_date === date);

    // قاعده‌ها از طریق شیء ماژول صدا زده می‌شوند و هرکدام جدا try/catch دارد؛ خرابی یکی جلوی بقیه را نمی‌گیرد
    const rules = [
      ['rule_A', () => fraud.detectSharedDevice(todayRecords)],
      ['rule_B', () => fraud.detectSameIpClose(todayRecords, { windowSeconds })],
      ['rule_C', () => fraud.detectDeviceChange(records, { lookbackDays, minHistoryDays, targetDate: date })],
    ];
    for (const [stage, detect] of rules) {
      let candidates;
      try {
        candidates = detect();
        if (!Array.isArray(candidates)) candidates = [];
      } catch (err) {
        fail(stage, err);
        continue;
      }
      for (const candidate of candidates) {
        summary.found += 1;
        try {
          const res = suspiciousRepository.create(candidate);
          if (res.created) summary.created.push(res.event);
          else summary.duplicates += 1;
        } catch (err) {
          fail(`${stage}_save`, err);
        }
      }
    }
  } catch (err) {
    fail('unexpected', err);
  }

  summary.ok = summary.errors.length === 0;
  return summary;
}

/**
 * نسخه‌ی «ضدخطا» برای فراخواننده‌هایی که نباید به هیچ قیمتی بشکنند (مسیر ثبت ورود/خروج، Job شبانه).
 * حتی اگر خود runFraudChecks (یا هر چیز زیر آن) استثنا بدهد، فقط لاگ می‌شود و خلاصه‌ی ok:false برمی‌گردد.
 * runFraudChecks عمداً از روی module.exports صدا زده می‌شود تا در تست بتوان خرابی عمدی تزریق کرد.
 */
function runFraudChecksSafe(options) {
  try {
    return module.exports.runFraudChecks(options);
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err);
    console.error('[fraud] خطای پیش‌بینی‌نشده (نادیده گرفته شد، ثبت تردد ادامه دارد):', message);
    return { ok: false, date: null, scanned: 0, found: 0, created: [], duplicates: 0, errors: [{ stage: 'unexpected', message }] };
  }
}

/**
 * بلوک اختیاری (S2-4e-3): آیا این ثبت باید رد شود؟ فقط قاعده‌ی الف (یک device برای کاربر دیگر در همان روز)
 * و فقط وقتی تنظیم `blockOnSharedDevice` روشن است (پیش‌فرض خاموش). فراخواننده باید قبل از نوشتن رکورد صدا بزند.
 * ضدخطا و fail-open: هر خطا/تنظیم خراب/device نامعتبر یا خالی ⇒ { blocked: false } تا ثبت هرگز به‌خاطر تشخیص نشکند.
 * @returns {{blocked: boolean, event?: object, otherUserIds?: number[], date?: string, deviceId?: string}}
 */
function evaluateSharedDeviceBlock({ userId, deviceId, date } = {}) {
  const none = { blocked: false };
  try {
    if (!settingsRepository.isBlockOnSharedDeviceEnabled()) return none;
    const device = normalizeDeviceId(deviceId);
    const day = date !== undefined ? date : todayDateString();
    if (!device || !Number.isInteger(userId) || !isValidDate(day)) return none;
    // همان قاعده‌ی خالص الف، روی ردیف‌های امروز + ثبتِ فرضیِ همین درخواست
    const probe = { id: null, user_id: userId, record_date: day, check_in_device: device, check_out_device: null };
    const records = attendanceRepository.listForFraud(day, day);
    const hit = fraud.detectSharedDevice([...records, probe])
      .find((e) => e.details.deviceId === device && e.userIds.includes(userId));
    if (!hit) return none;
    return { blocked: true, event: hit, otherUserIds: hit.userIds.filter((id) => id !== userId), date: day, deviceId: device };
  } catch (err) {
    console.error('[fraud] خطا در ارزیابی بلوک (نادیده گرفته شد، ثبت ادامه می‌یابد):', err && err.message ? err.message : err);
    return none;
  }
}

/**
 * ثبت «نشانه» برای تلاشِ ردشده (رکوردی ساخته نشده، پس runFraudChecks آن را نمی‌بیند). ضدخطا؛ dedupe با repository.
 * @param {{event: object, date: string}} block خروجی evaluateSharedDeviceBlock با blocked=true
 * @param {'check_in'|'check_out'} action
 */
function recordBlockedAttempt(block, action) {
  try {
    const { event, date } = block;
    return suspiciousRepository.create({
      eventType: event.eventType,
      userIds: event.userIds,
      recordIds: event.recordIds,
      eventDate: date,
      details: { ...event.details, blocked: true, blockedAction: action },
    });
  } catch (err) {
    console.error('[fraud] ثبت نشانه‌ی تلاش ردشده ناموفق بود (نادیده گرفته شد):', err && err.message ? err.message : err);
    return null;
  }
}

module.exports = { runFraudChecks, runFraudChecksSafe, evaluateSharedDeviceBlock, recordBlockedAttempt, isValidDate, shiftDate };
