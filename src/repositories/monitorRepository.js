// وضعیت هشدارهای watchdog و نوشتن آزمایشی سلامت دیتابیس (بخش ۲-ج۱). SQL فقط اینجاست.

const Database = require('better-sqlite3');
const { getDb } = require('../db/connection');
const { nowIso } = require('../utils/serverTime');

function getAlert(key) {
  return getDb().prepare('SELECT * FROM monitor_alerts WHERE alert_key = ?').get(key) || null;
}

function listAlerts() {
  return getDb().prepare('SELECT * FROM monitor_alerts ORDER BY alert_key').all();
}

// هشدار تازه یا ادامه‌ی هشدار: state=firing. first_seen_at فقط بار اول ثبت می‌شود.
function markFiring(key, detail, now = nowIso()) {
  getDb()
    .prepare(
      `INSERT INTO monitor_alerts (alert_key, state, first_seen_at, updated_at, detail)
       VALUES (@key, 'firing', @now, @now, @detail)
       ON CONFLICT(alert_key) DO UPDATE SET
         first_seen_at = CASE WHEN monitor_alerts.state = 'ok' THEN @now ELSE monitor_alerts.first_seen_at END,
         last_sent_at = CASE WHEN monitor_alerts.state = 'ok' THEN NULL ELSE monitor_alerts.last_sent_at END,
         state = 'firing', updated_at = @now, detail = @detail`
    )
    .run({ key, now, detail: detail ? String(detail).slice(0, 500) : null });
}

function markSent(key, now = nowIso()) {
  getDb().prepare('UPDATE monitor_alerts SET last_sent_at = ? WHERE alert_key = ?').run(now, key);
}

function markOk(key, now = nowIso()) {
  getDb().prepare("UPDATE monitor_alerts SET state = 'ok', updated_at = ?, detail = NULL WHERE alert_key = ?").run(now, key);
}

// نوشتن آزمایشی: اگر دیتابیس قفل/فقط‌خواندنی/پر باشد، همین‌جا خطا می‌دهد.
function writeProbe(now = nowIso()) {
  getDb()
    .prepare(
      `INSERT INTO monitor_state (key, value, updated_at) VALUES ('db_write_probe', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(now, now);
}

function readProbe() {
  return getDb().prepare('SELECT 1 AS ok').get().ok === 1;
}

// PRAGMA quick_check سبک‌تر از integrity_check است؛ فقط وقتی صریحاً خواسته شود (دیتابیس بزرگ → کند)
function quickCheck() {
  const rows = getDb().pragma('quick_check');
  const first = rows && rows[0] ? Object.values(rows[0])[0] : null;
  return { ok: first === 'ok', result: first };
}

// PRAGMA integrity_check کامل روی «یک فایل دیتابیس» (نه دیتابیس زنده) با اتصال جدا و فقط‌خواندنی (S2-1c).
// فایل خراب/غیر SQLite (مثلاً «file is not a database») استثنا نمی‌دهد؛ نتیجه‌ی ok=false می‌گیرد.
// اتصال همیشه بسته می‌شود تا روی ویندوز فایل قفل نماند (وگرنه rename به .suspect شکست می‌خورد).
function integrityCheckFile(filePath) {
  let conn = null;
  try {
    conn = new Database(filePath, { readonly: true, fileMustExist: true });
    const rows = conn.pragma('integrity_check'); // حداکثر ۱۰۰ ردیف خطا؛ سالم = یک ردیف «ok»
    const messages = rows.map((r) => String(Object.values(r)[0]));
    const ok = messages.length === 1 && messages[0] === 'ok';
    return { ok, result: messages.slice(0, 5).join(' | ') };
  } catch (err) {
    return { ok: false, result: err.message };
  } finally {
    try { if (conn) conn.close(); } catch (_) { /* بسته شده/باز نشده */ }
  }
}

module.exports = { getAlert, listAlerts, markFiring, markSent, markOk, writeProbe, readProbe, quickCheck, integrityCheckFile };
