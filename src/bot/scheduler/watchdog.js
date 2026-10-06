// Watchdog (بخش ۲-ج۱): هر چند دقیقه سلامت سیستم را می‌سنجد و برای مشکل‌ها به ادمین‌ها در تلگرام هشدار می‌دهد.
//
// قواعد:
//   • هر «نوع هشدار» (db_error، bot_polling، disk_low، backup_stale، job_failed:<job>) وضعیت جدا دارد.
//   • اولین بار که مشکل دیده شد ⇒ فوراً هشدار. تا وقتی ادامه دارد: حداکثر یک هشدار در هر alertThrottleMinutes
//     (برای شکست Job: هر ۲۴ ساعت، چون Jobهای هفتگی/ماهانه تا اجرای بعدی «شکست‌خورده» می‌مانند).
//   • وقتی مشکل رفع شد ⇒ یک پیام «رفع شد».
//   • وضعیت هشدارها در دیتابیس است (monitor_alerts) تا با ری‌استارت هشدار تکراری/گم‌شده نداشته باشیم؛
//     اگر خودِ دیتابیس خراب باشد، به نگهداری در حافظه برمی‌گردیم تا هشدار «خرابی دیتابیس» حداقل یک‌بار برود.
//   • هشدار فقط وقتی «ارسال‌شده» حساب می‌شود که حداقل یک ادمین پیام را دریافت کرده باشد (وگرنه چرخه‌ی بعد دوباره تلاش می‌کند).
//   • متن هشدار هیچ راز/توکنی ندارد (خطاها sanitize می‌شوند).

const config = require('../../config');
const systemHealth = require('../../utils/systemHealth');
const monitorRepository = require('../../repositories/monitorRepository');
const usersRepository = require('../../repositories/usersRepository');
const { sanitizeText } = require('../../utils/sanitize');

const JOB_REMINDER_MS = 24 * 3600 * 1000;

// وضعیت حافظه‌ای (فقط وقتی DB در دسترس نیست استفاده می‌شود) و آخرین فهرست گیرنده‌ها
const memoryAlerts = new Map();
let cachedRecipients = [];

// منبع حقیقت: دیتابیس. فقط اگر یک هشدار در زمان خرابی دیتابیس در حافظه ثبت شده باشد، تا «رفع شد» همان‌جا می‌ماند
// (وگرنه بعد از برگشتن دیتابیس، هشدار فعال دوباره «جدید» حساب می‌شد و پیام تکراری می‌رفت).
function loadAlert(key) {
  if (memoryAlerts.has(key)) return memoryAlerts.get(key);
  try {
    return monitorRepository.getAlert(key);
  } catch (_) {
    return null;
  }
}

function saveFiring(key, detail, nowIso) {
  const mem = memoryAlerts.get(key);
  if (mem) {
    memoryAlerts.set(key, { ...mem, detail });
    return;
  }
  try {
    monitorRepository.markFiring(key, detail, nowIso);
  } catch (_) {
    memoryAlerts.set(key, { alert_key: key, state: 'firing', first_seen_at: nowIso, last_sent_at: null, detail });
  }
}

function saveSent(key, nowIso) {
  const mem = memoryAlerts.get(key);
  if (mem) {
    memoryAlerts.set(key, { ...mem, last_sent_at: nowIso });
    return;
  }
  try {
    monitorRepository.markSent(key, nowIso);
  } catch (_) {
    /* ثبت نشد؛ بدترین حالت یک هشدار تکراری در چرخه‌ی بعد */
  }
}

function saveOk(key, nowIso) {
  memoryAlerts.delete(key);
  try {
    monitorRepository.markOk(key, nowIso);
  } catch (_) {
    /* دیتابیس در دسترس نیست؛ حافظه پاک شد */
  }
}

function listFiringKeys() {
  const keys = new Set([...memoryAlerts.values()].filter((a) => a.state === 'firing').map((a) => a.alert_key));
  try {
    monitorRepository.listAlerts().filter((a) => a.state === 'firing').forEach((a) => keys.add(a.alert_key));
  } catch (_) {
    /* فقط حافظه */
  }
  return [...keys];
}

function adminRecipients() {
  try {
    cachedRecipients = usersRepository
      .listUsers({ onlyActive: true })
      .filter((u) => u.role === 'admin' && u.telegram_user_id)
      .map((u) => u.telegram_user_id);
  } catch (_) {
    /* دیتابیس در دسترس نیست: از آخرین فهرست موفق استفاده می‌شود */
  }
  return cachedRecipients;
}

// از نتیجه‌ی systemHealth.collect فهرست هشدارهای «فعال» را می‌سازد: Map<key, {title, detail}>
function evaluate(report) {
  const out = new Map();
  const c = report.checks;
  if (!c.db.ok) out.set('db_error', { title: 'خطا در دیتابیس', detail: c.db.detail || 'خواندن/نوشتن آزمایشی دیتابیس ناموفق بود.' });
  if (c.bot.applicable && !c.bot.ok) {
    const secs = c.bot.secondsSinceLastSuccess;
    out.set('bot_polling', {
      title: 'ارتباط بات با تلگرام (polling) قطع است',
      detail: `${secs != null ? `آخرین ارتباط موفق ${Math.round(secs / 60)} دقیقه پیش` : 'از زمان بالا آمدن هنوز ارتباط موفقی نبوده'}${c.bot.lastError ? `؛ آخرین خطا: ${c.bot.lastError}` : ''}`,
    });
  }
  if (c.disk.applicable && !c.disk.ok) {
    out.set('disk_low', { title: 'فضای آزاد دیسک کم است', detail: `${c.disk.freeMb} مگابایت آزاد (حداقل مجاز ${c.disk.minFreeMb})` });
  }
  if (c.backup.applicable && !c.backup.ok) {
    out.set('backup_stale', {
      title: 'بک‌آپ دیتابیس قدیمی است',
      detail: c.backup.lastBackupAt ? `آخرین بک‌آپ ${Math.round(c.backup.ageHours)} ساعت پیش (حداکثر مجاز ${c.backup.maxAgeHours})` : c.backup.detail,
    });
  }
  for (const f of c.jobs.failing || []) {
    out.set(`job_failed:${f.job}`, { title: `Job «${f.job}» شکست خورد`, detail: sanitizeText(f.error || 'بدون جزئیات', 300) });
  }
  return out;
}

function titleForRecovered(key) {
  if (key === 'db_error') return 'خطای دیتابیس';
  if (key === 'bot_polling') return 'ارتباط بات با تلگرام';
  if (key === 'disk_low') return 'فضای دیسک';
  if (key === 'backup_stale') return 'بک‌آپ دیتابیس';
  if (key.startsWith('job_failed:')) return `Job «${key.slice('job_failed:'.length)}»`;
  return key;
}

async function broadcast(bot, text) {
  let delivered = 0;
  for (const chatId of adminRecipients()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await bot.sendMessage(chatId, text);
      delivered += 1;
    } catch (err) {
      console.error('[watchdog] ارسال هشدار ناموفق:', sanitizeText(err.message, 200));
    }
  }
  return delivered;
}

/**
 * یک چرخه‌ی بررسی. bot فقط باید sendMessage داشته باشد (در تست ماک می‌شود).
 * @returns {Promise<{status:string, firing:string[], alertsSent:string[], recovered:string[]}>}
 */
async function runWatchdog({ bot, now = Date.now(), collect = systemHealth.collect } = {}) {
  const nowIso = new Date(now).toISOString();
  const report = collect({ now });
  // وقتی دیتابیس سالم است فهرست ادمین‌ها را تازه نگه می‌داریم تا اگر بعداً خودِ دیتابیس خراب شد، هشدار «خرابی دیتابیس»
  // هنوز بتواند به آخرین فهرست شناخته‌شده‌ی ادمین‌ها برود.
  if (report.checks.db.ok) adminRecipients();
  const active = evaluate(report);
  const alertsSent = [];
  const recovered = [];
  const throttleMs = config.monitor.alertThrottleMinutes * 60 * 1000;

  for (const [key, info] of active) {
    const existing = loadAlert(key);
    const wasFiring = existing && existing.state === 'firing';
    saveFiring(key, info.detail, nowIso);

    const lastSentMs = wasFiring && existing.last_sent_at ? Date.parse(existing.last_sent_at) : null;
    const interval = key.startsWith('job_failed:') ? JOB_REMINDER_MS : throttleMs;
    const due = lastSentMs === null || now - lastSentMs >= interval;
    if (!due || !bot) continue;

    const text = `🔴 هشدار سیستم حضور و غیاب\n${info.title}\n${info.detail}\nزمان: ${nowIso}`;
    if ((await broadcast(bot, text)) > 0) {
      saveSent(key, nowIso);
      alertsSent.push(key);
    }
  }

  // هشدارهایی که قبلاً فعال بودند و دیگر مشکل ندارند ⇒ «رفع شد» (یک‌بار)
  for (const key of listFiringKeys()) {
    if (active.has(key)) continue;
    saveOk(key, nowIso);
    recovered.push(key);
    if (bot) {
      // eslint-disable-next-line no-await-in-loop
      await broadcast(bot, `✅ رفع شد: ${titleForRecovered(key)}\nزمان: ${nowIso}`);
    }
  }

  return { status: report.status, firing: [...active.keys()], alertsSent, recovered };
}

// فقط برای تست
function _resetMemory() {
  memoryAlerts.clear();
  cachedRecipients = [];
}

module.exports = { runWatchdog, evaluate, _resetMemory };
