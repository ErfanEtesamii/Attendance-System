// کش کوتاه‌مدت در حافظه‌ی پروسه برای پاسخ تحلیل‌ها (S5-6c).
//
// چرا ساده؟ تحلیل‌ها فقط‌خواندنی‌اند و روی هزاران رکورد محاسبه می‌شوند؛ پنل معمولاً چند بار پشت‌سرهم همان URL را می‌زند
// (تعویض تب، فیلتر، بازکردن دوباره). یک TTL کوتاه + پاک‌سازی روی هر نوشتن پنل، بدون وابستگی جدید، کافی است.
//
// قراردادها:
//   • TTL از config.analyticsCacheTtlSeconds می‌آید (env: ANALYTICS_CACHE_TTL_SECONDS، پیش‌فرض ۶۰ ثانیه؛ ۰ = کش خاموش).
//   • سقف تعداد ورودی‌ها (پیش‌فرض ۲۰۰)؛ با پرشدن، اول ورودی‌های منقضی و بعد قدیمی‌ترین‌ها حذف می‌شوند (حافظه کراندار).
//   • خطا هرگز کش نمی‌شود (اگر compute پرتاب کند، چیزی ذخیره نمی‌شود).
//   • مقدارهای کش‌شده باید فقط «خوانده» شوند (پاسخ JSON)؛ فراخواننده نباید آن‌ها را تغییر دهد.
//   • کلید باید همه‌ی ورودی‌های مؤثر بر نتیجه را در خود داشته باشد (مجموعه‌ی کاربران مجاز، پارامترها، روز جاری) — به‌ویژه «اسکوپ نقش»:
//     دو درخواست‌دهنده‌ی با مجموعه‌ی کاربرِ متفاوت هرگز یک ورودی را به اشتراک نمی‌گذارند (analyticsCacheKey).

const crypto = require('crypto');

function createTtlCache({ ttlMs = 60000, maxEntries = 200, now = Date.now } = {}) {
  const store = new Map(); // key → { value, expiresAt }؛ ترتیب درج = قدیمی‌ترین اول
  const stats = { hits: 0, misses: 0, evictions: 0 };
  const enabled = () => ttlMs > 0 && maxEntries > 0;

  function prune() {
    const t = now();
    for (const [k, e] of store) if (e.expiresAt <= t) { store.delete(k); stats.evictions += 1; }
  }

  function get(key) {
    const e = store.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= now()) { store.delete(key); stats.evictions += 1; return undefined; }
    return e.value;
  }

  function set(key, value) {
    if (!enabled()) return;
    store.delete(key);
    if (store.size >= maxEntries) {
      prune();
      while (store.size >= maxEntries) { store.delete(store.keys().next().value); stats.evictions += 1; }
    }
    store.set(key, { value, expiresAt: now() + ttlMs });
  }

  /** @returns {{ value: any, hit: boolean, enabled: boolean }} */
  function memo(key, compute) {
    if (!enabled()) return { value: compute(), hit: false, enabled: false };
    const cached = get(key);
    if (cached !== undefined) { stats.hits += 1; return { value: cached, hit: true, enabled: true }; }
    stats.misses += 1;
    const value = compute(); // پرتاب ⇒ چیزی ذخیره نمی‌شود
    set(key, value);
    return { value, hit: false, enabled: true };
  }

  function clear() { store.clear(); }

  return { get, set, memo, clear, stats, enabled, get size() { return store.size; } };
}

// کلید پایدار: نام تحلیل + هش مجموعه‌ی (مرتب‌شده‌ی) شناسه‌ی کاربران + پارامترها (به ترتیب کلید) + «امروز»
function analyticsCacheKey(name, userIds, params, today) {
  const ids = [...userIds].map(Number).sort((a, b) => a - b).join(',');
  const idsHash = crypto.createHash('sha1').update(ids).digest('hex').slice(0, 16);
  const sorted = {};
  for (const k of Object.keys(params || {}).sort()) sorted[k] = params[k];
  return `${name}|${userIds.length}:${idsHash}|${JSON.stringify(sorted)}|${today}`;
}

const config = require('../config');
const analyticsCache = createTtlCache({ ttlMs: config.analyticsCacheTtlSeconds * 1000, maxEntries: 200 });

module.exports = { createTtlCache, analyticsCacheKey, analyticsCache };
