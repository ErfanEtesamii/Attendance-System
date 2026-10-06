// تاریخچه‌ی اجرای Jobهای زمان‌بندی‌شده (بخش ۲-ج۱). SQL فقط اینجاست.

const { getDb } = require('../db/connection');
const { nowIso } = require('../utils/serverTime');

const MAX_ERROR_LENGTH = 500;

function start(jobName, startedAt = nowIso()) {
  return getDb()
    .prepare("INSERT INTO job_runs (job_name, started_at, status) VALUES (?, ?, 'running')")
    .run(jobName, startedAt).lastInsertRowid;
}

function finish(id, { status, error = null, durationMs = null, finishedAt = nowIso() }) {
  const err = error ? String(error).slice(0, MAX_ERROR_LENGTH) : null;
  getDb()
    .prepare('UPDATE job_runs SET status = ?, error = ?, duration_ms = ?, finished_at = ? WHERE id = ?')
    .run(status, err, durationMs, finishedAt, id);
}

// هنگام بالا آمدن: اجراهایی که وسط کار پروسه مرده (ری‌استارت/crash) «interrupted» می‌شوند، نه خطا.
function markInterrupted(finishedAt = nowIso()) {
  return getDb()
    .prepare(
      `UPDATE job_runs SET status = 'interrupted', finished_at = ?, error = 'پروسه قبل از پایان این Job متوقف شد'
       WHERE status = 'running'`
    )
    .run(finishedAt).changes;
}

// آخرین اجرای «تمام‌شده‌ی موفق یا خطادار» هر Job (running/interrupted نتیجه‌ی Job حساب نمی‌شوند)
function latestResultPerJob() {
  return getDb()
    .prepare(
      `SELECT j.* FROM job_runs j
       JOIN (SELECT job_name, MAX(id) AS mid FROM job_runs WHERE status IN ('success','error') GROUP BY job_name) m
         ON j.id = m.mid
       ORDER BY j.job_name`
    )
    .all();
}

function lastSuccessPerJob() {
  return getDb()
    .prepare("SELECT job_name, MAX(finished_at) AS last_success_at FROM job_runs WHERE status = 'success' GROUP BY job_name")
    .all();
}

function recentErrors(limit = 20) {
  return getDb()
    .prepare("SELECT * FROM job_runs WHERE status = 'error' ORDER BY id DESC LIMIT ?")
    .all(limit);
}

function recent(limit = 50) {
  return getDb().prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT ?').all(limit);
}

function countsSince(sinceIso) {
  return getDb()
    .prepare('SELECT status, COUNT(*) AS n FROM job_runs WHERE started_at >= ? GROUP BY status')
    .all(sinceIso);
}

module.exports = { start, finish, markInterrupted, latestResultPerJob, lastSuccessPerJob, recentErrors, recent, countsSince };
