// بررسی سلامت سیستم (بخش ۲-ج۱): دیتابیس، polling بات، فضای دیسک، سن بک‌آپ، شکست Jobها.
// هم /api/health (فقط ok/degraded)، هم صفحه‌ی «وضعیت سیستم» ادمین، هم watchdog از همین یک تابع استفاده می‌کنند.

const fs = require('fs');
const path = require('path');
const config = require('../config');
const monitorRepository = require('../repositories/monitorRepository');
const jobRunsRepository = require('../repositories/jobRunsRepository');
const { getPollingStatus } = require('./botHealth');
const { sanitizeText } = require('./sanitize');

const HOUR_MS = 3600 * 1000;

function checkDb({ deep = false } = {}) {
  try {
    monitorRepository.writeProbe();
    monitorRepository.readProbe();
    if (deep) {
      const q = monitorRepository.quickCheck();
      if (!q.ok) return { ok: false, detail: `quick_check: ${sanitizeText(q.result, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: sanitizeText(err.message, 200) };
  }
}

function checkBot(now) {
  const status = getPollingStatus({ staleSeconds: config.monitor.pollingStaleSeconds, now });
  return status;
}

function checkDisk() {
  const dir = path.dirname(config.dbPath);
  try {
    if (typeof fs.statfsSync !== 'function') return { applicable: false, ok: true, detail: 'statfs در این نسخه‌ی Node نیست' };
    const s = fs.statfsSync(dir);
    const freeMb = Math.floor((Number(s.bavail) * Number(s.bsize)) / 1048576);
    const totalMb = Math.floor((Number(s.blocks) * Number(s.bsize)) / 1048576);
    return { applicable: true, ok: freeMb >= config.monitor.diskMinFreeMb, freeMb, totalMb, minFreeMb: config.monitor.diskMinFreeMb };
  } catch (err) {
    // نتوانستن بررسی دیسک، خودش «خرابی» نیست (مثلاً مجوز/پشتیبانی نشدن)؛ فقط گزارش می‌شود
    return { applicable: false, ok: true, detail: sanitizeText(err.message, 200) };
  }
}

// آخرین بک‌آپ غیر pre-migration در BACKUP_DIR. فایل‌های .db و .db.gz (فشرده) و .zip حساب می‌شوند.
function latestBackup() {
  const dir = config.monitor.backupDir;
  let best = null;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const e of entries) {
    if (!e.isFile() || e.name.startsWith('pre-migration-') || !/\.(db|db\.gz|zip)$/i.test(e.name)) continue;
    const st = fs.statSync(path.join(dir, e.name));
    if (!best || st.mtimeMs > best.mtimeMs) best = { name: e.name, mtimeMs: st.mtimeMs, sizeBytes: st.size };
  }
  return best;
}

function checkBackup(now) {
  const last = latestBackup();
  const base = {
    applicable: config.monitor.backupCheck,
    maxAgeHours: config.monitor.backupMaxAgeHours,
    lastBackupAt: last ? new Date(last.mtimeMs).toISOString() : null,
    lastBackupFile: last ? last.name : null,
    ageHours: last ? Math.round(((now - last.mtimeMs) / HOUR_MS) * 10) / 10 : null,
  };
  if (!config.monitor.backupCheck) return { ...base, ok: true };
  if (!last) return { ...base, ok: false, detail: 'هیچ بک‌آپی در پوشه‌ی بک‌آپ پیدا نشد' };
  return { ...base, ok: now - last.mtimeMs <= config.monitor.backupMaxAgeHours * HOUR_MS };
}

function checkJobs(now) {
  const windowMs = config.monitor.jobFailureWindowHours * HOUR_MS;
  const results = jobRunsRepository.latestResultPerJob();
  const lastSuccess = new Map(jobRunsRepository.lastSuccessPerJob().map((r) => [r.job_name, r.last_success_at]));
  const failing = results
    .filter((r) => r.status === 'error' && now - Date.parse(r.finished_at || r.started_at) <= windowMs)
    .map((r) => ({ job: r.job_name, at: r.finished_at || r.started_at, error: r.error, lastSuccessAt: lastSuccess.get(r.job_name) || null }));
  return { ok: failing.length === 0, failing, latest: results.map((r) => ({ job: r.job_name, status: r.status, at: r.finished_at || r.started_at, durationMs: r.duration_ms })) };
}

/**
 * @param {{now?:number, deep?:boolean}} [opts]  deep=true: PRAGMA quick_check هم اجرا شود
 */
function collect({ now = Date.now(), deep = false } = {}) {
  const db = checkDb({ deep });
  const checks = { db, bot: checkBot(now), disk: checkDisk(), backup: checkBackup(now) };
  // اگر دیتابیس خراب است، خواندن job_runs هم خطا می‌دهد؛ آن را «خطای دیتابیس» حساب می‌کنیم نه Jobها
  checks.jobs = db.ok ? safeJobs(now) : { ok: true, failing: [], latest: [], skipped: true };
  const degraded = Object.values(checks).some((c) => c.ok === false);
  return { status: degraded ? 'degraded' : 'ok', checkedAt: new Date(now).toISOString(), checks };
}

function safeJobs(now) {
  try {
    return checkJobs(now);
  } catch (err) {
    return { ok: false, failing: [], latest: [], detail: sanitizeText(err.message, 200) };
  }
}

module.exports = { collect, latestBackup };
