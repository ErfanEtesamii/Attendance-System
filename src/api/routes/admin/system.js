// سیستم: پیام گروهی، وضعیت سیستم و پشتیبان‌گیری (فقط ادمین کل).
// (تقسیم‌شده از admin.js/adminPanel.js؛ URLها و رفتار بدون تغییر. احراز هویت در index.js یک‌بار اعمال می‌شود.)

const express = require('express');
const router = express.Router();

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../config');
const { getDb } = require('../../../db/connection');
const { requireFullAdmin } = require('../../../middleware/adminAuth');
const usersRepository = require('../../../repositories/usersRepository');
const { nowIso } = require('../../../utils/serverTime');
const { sendMessage } = require('../../../bot/notifier');
const settingsRepository = require('../../../repositories/settingsRepository');
const { buildClearCookie } = require('../../../utils/sessionCookie');
const { audit, requireReason } = require('./common');
const systemHealth = require('../../../utils/systemHealth');
const jobRunsRepository = require('../../../repositories/jobRunsRepository');
const monitorRepository = require('../../../repositories/monitorRepository');

// S3-8c: cron «مؤثر» هر Job (تنظیم ذخیره‌شده در پنل ⇒ وگرنه .env/پیش‌فرض)، نه فقط مقدار config که با reload کهنه می‌شود
function effectiveCrons() {
  const all = settingsRepository.getCronExpressions();
  return Object.fromEntries(Object.keys(config.cron).map((name) => [name, all[name] || config.cron[name]]));
}

// ---------- ارسال پیام گروهی (فقط ادمین کل) ----------

router.post('/admin/broadcast', requireFullAdmin, async (req, res) => {
  const { scope, department, userIds, text } = req.body || {};
  const message = (text || '').trim();
  if (!message) return res.status(400).json({ error: 'متن پیام خالی است.' });

  let targets = usersRepository.listUsers({ onlyActive: true });
  if (scope === 'department') targets = targets.filter((u) => (u.department || '') === (department || ''));
  else if (scope === 'users') {
    const set = new Set((userIds || []).map(Number));
    targets = targets.filter((u) => set.has(u.id));
  } else if (scope !== 'all') {
    return res.status(400).json({ error: 'scope نامعتبر است.' });
  }
  targets = targets.filter((u) => u.telegram_user_id);
  if (!targets.length) return res.status(400).json({ error: 'گیرنده‌ای با آیدی تلگرام پیدا نشد.' });
  if (targets.length > 500) return res.status(400).json({ error: 'حداکثر ۵۰۰ گیرنده در هر ارسال.' });

  let delivered = 0;
  for (const u of targets) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await sendMessage(u.telegram_user_id, `📢 اطلاعیه:\n\n${message}`);
    if (ok) delivered += 1;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50)); // احترام به rate limit تلگرام
  }
  audit(req, 'broadcast_sent', { scope, department: department || null, recipients: targets.length, delivered });
  res.json({ recipients: targets.length, delivered, failed: targets.length - delivered });
});

// ---------- خروج همه‌ی کاربران (فقط ادمین کل، با دلیل اجباری) ----------
// epoch سراسری را زیاد می‌کند؛ همه‌ی نشست‌های موجود در درخواست بعدی ۴۰۱ می‌شوند.
// به‌صورت پیش‌فرض نشست خود ادمینِ اجراکننده حفظ می‌شود (کوکی تازه می‌گیرد)؛ با includeSelf=true او هم خارج می‌شود.
router.post('/admin/system/revoke-all-sessions', requireFullAdmin, (req, res) => {
  const reason = requireReason(req, res);
  if (!reason) return;
  const includeSelf = !!(req.body && req.body.includeSelf);

  const epoch = settingsRepository.bumpGlobalSessionEpoch();
  audit(req, 'all_sessions_revoked', { reason, epoch, includeSelf });

  if (includeSelf) {
    res.setHeader('Set-Cookie', buildClearCookie(req));
  } else {
    // کاربر تازه از دیتابیس خوانده می‌شود تا نسخه‌ی فعلی‌اش در توکن جدید بیاید
    require('../adminAuth').startSession(req, res, usersRepository.findById(req.adminUser.id));
  }
  res.json({ ok: true, selfLoggedOut: includeSelf });
});

// ---------- سیستم و پشتیبان‌گیری (فقط ادمین کل) ----------

router.get('/admin/system', requireFullAdmin, (req, res) => {
  const db = getDb();
  const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  const fileSize = (p) => {
    try { return fs.statSync(p).size; } catch (_) { return 0; }
  };
  res.json({
    serverTime: nowIso(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()}`,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    environment: config.nodeEnv,
    database: {
      path: path.basename(config.dbPath),
      sizeBytes: fileSize(config.dbPath) + fileSize(`${config.dbPath}-wal`),
      tables: {
        users: count('users'),
        attendance_records: count('attendance_records'),
        break_records: count('break_records'),
        leave_requests: count('leave_requests'),
        holidays: count('holidays'),
        record_disputes: count('record_disputes'),
        audit_log: count('audit_log'),
        settings: count('settings'),
      },
    },
    integration: {
      botConfigured: !!config.telegramBotToken,
      botUsername: config.telegramBotUsername || null,
      miniAppUrl: config.miniAppUrl || null,
      httpsDirect: !!(config.sslCertPath && config.sslKeyPath),
      allowedNetworkCidr: config.allowedNetworkCidr,
      trustProxy: config.trustProxy,
      sessionMaxAgeDays: config.adminSessionMaxAgeDays,
    },
    cron: effectiveCrons(),
  });
});

// ---------- وضعیت سیستم (بخش ۲-ج۱؛ فقط ادمین کل) ----------
// سلامت دیتابیس/بات/دیسک/بک‌آپ/Jobها + تاریخچه‌ی اجراها و آخرین خطاها + هشدارهای فعال.
// ?deep=1 ⇒ PRAGMA quick_check هم اجرا می‌شود (روی دیتابیس بزرگ کند است؛ پیش‌فرض خاموش).
router.get('/admin/system/status', requireFullAdmin, (req, res) => {
  const report = systemHealth.collect({ deep: req.query.deep === '1' });
  const cronMap = effectiveCrons();
  const watchdogCron = settingsRepository.getCronExpressions().watchdog || config.monitor.watchdogCron;
  const latest = new Map((report.checks.jobs.latest || []).map((j) => [j.job, j]));
  const lastSuccess = new Map();
  try {
    jobRunsRepository.lastSuccessPerJob().forEach((r) => lastSuccess.set(r.job_name, r.last_success_at));
  } catch (_) { /* خطای دیتابیس در report.checks.db دیده می‌شود */ }

  const jobNames = [...Object.keys(cronMap), ...(config.monitor.watchdogEnabled ? ['watchdog'] : [])];
  const jobs = jobNames.map((name) => ({
    name,
    cron: name === 'watchdog' ? watchdogCron : cronMap[name],
    lastResult: latest.get(name) || null,
    lastSuccessAt: lastSuccess.get(name) || null,
  }));

  let recentErrors = [];
  let recentRuns = [];
  let alerts = [];
  try {
    recentErrors = jobRunsRepository.recentErrors(20);
    recentRuns = jobRunsRepository.recent(30);
    alerts = monitorRepository.listAlerts().filter((a) => a.state === 'firing');
  } catch (_) { /* همان */ }

  res.json({ ...report, jobs, recentErrors, recentRuns, activeAlerts: alerts, watchdog: { enabled: config.monitor.watchdogEnabled, cron: watchdogCron, throttleMinutes: config.monitor.alertThrottleMinutes } });
});

router.get('/admin/system/backup', requireFullAdmin, async (req, res) => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(os.tmpdir(), `attendance-backup-${stamp}.db`);
  try {
    await getDb().backup(dest);
  } catch (err) {
    return res.status(500).json({ error: `پشتیبان‌گیری ناموفق بود: ${err.message}` });
  }
  audit(req, 'database_backup_downloaded', { file: path.basename(dest) });
  res.download(dest, `attendance-backup-${stamp}.db`, () => {
    fs.unlink(dest, () => {});
  });
});

module.exports = router;
