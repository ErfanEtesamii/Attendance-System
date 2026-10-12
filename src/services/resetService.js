// ریست برنامه — فقط ادمین (B1: پیش‌نمایش؛ B2: اجرا). SQL در resetRepository است؛ این‌جا اعتبارسنجی و ترکیب.

const resetRepository = require('../repositories/resetRepository');
const maintenanceRepository = require('../repositories/maintenanceRepository');
const settingsRepository = require('../repositories/settingsRepository');
const auditRepository = require('../repositories/auditRepository');
const attachmentService = require('./attachmentService');
const maintenanceMode = require('../utils/maintenanceMode');
const botSession = require('../bot/session');
const { analyticsCache } = require('../utils/analyticsCache');
const { getDb } = require('../db/connection');
const backup = require('../bot/scheduler/backup');
const panelLoginCodes = require('../utils/panelLoginCodes');
const usersRepository = require('../repositories/usersRepository');
const notifier = require('../bot/notifier');
const config = require('../config');

class ResetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResetError';
    this.code = code;
  }
}

// ورودی را نرمال و اعتبارسنجی می‌کند. groups پیش‌فرض = گروه‌های پیش‌فرض (الف).
function normalizeOptions({ groups, beforeDate } = {}) {
  let list = groups;
  if (list === undefined || list === null) {
    list = Object.keys(resetRepository.GROUPS).filter((g) => resetRepository.GROUPS[g].defaultSelected);
  }
  if (!Array.isArray(list) || list.length === 0) throw new ResetError('INVALID_GROUPS', 'حداقل یک گروه برای پاک‌سازی انتخاب کنید.');
  const unique = [...new Set(list.map(String))];
  const unknown = unique.filter((g) => !Object.prototype.hasOwnProperty.call(resetRepository.GROUPS, g));
  if (unknown.length) throw new ResetError('INVALID_GROUPS', `گروه ناشناخته: ${unknown.join('، ')}`);

  let cut = null;
  if (beforeDate !== undefined && beforeDate !== null && beforeDate !== '') {
    if (typeof beforeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
      throw new ResetError('INVALID_DATE', 'تاریخ برش باید YYYY-MM-DD (میلادی) باشد.');
    }
    const d = new Date(`${beforeDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== beforeDate) {
      throw new ResetError('INVALID_DATE', 'تاریخ برش معتبر نیست.');
    }
    cut = beforeDate;
  }
  return { groups: unique, beforeDate: cut };
}

// فقط می‌شمارد؛ هیچ داده‌ای تغییر نمی‌کند.
function previewReset(options = {}) {
  const { groups, beforeDate } = normalizeOptions(options);
  const tables = resetRepository.entriesFor(groups).map((e) => ({
    table: e.table,
    group: e.group,
    label: e.label,
    count: resetRepository.countRows(e, beforeDate),
  }));
  return {
    groups,
    beforeDate,
    tables,
    total: tables.reduce((s, t) => s + t.count, 0),
    protectedTables: [...resetRepository.PROTECTED_TABLES],
  };
}

function listGroups() {
  return Object.entries(resetRepository.GROUPS).map(([key, g]) => ({ key, label: g.label, defaultSelected: g.defaultSelected }));
}

// ---------- لایه‌ی ایمنی (B3) ----------

const CONFIRM_WORDS = ['RESET', 'ریست'];
const normalizeFa = (s) => String(s || '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').trim();

// Go-Live روشن و بدون ALLOW_DATA_RESET=true ⇒ قفل
function isResetLocked() {
  return settingsRepository.getAll().systemGoLive === true && config.allowDataReset !== true;
}

const deny = (status, code, error) => ({ ok: false, status, code, error });

/**
 * همه‌ی گیت‌های ریست (سمت سرور). ترتیب: نقش ⇒ Go-Live ⇒ ورودی ⇒ متن تأیید ⇒ re-auth (کد تلگرام همین ادمین؛ مصرف می‌شود).
 * @returns {{ok: true, options: object} | {ok: false, status: number, code: string, error: string}}
 */
function checkResetRequest(body, adminUser) {
  if (!adminUser || adminUser.role !== 'admin') return deny(403, 'forbidden', 'فقط ادمین کل می‌تواند برنامه را ریست کند.');
  if (isResetLocked()) return deny(403, 'go_live_locked', 'سیستم در حالت Go-Live است و ریست قفل است (فقط با ALLOW_DATA_RESET=true در .env).');
  const b = body || {};
  let options;
  try { options = normalizeOptions({ groups: b.groups, beforeDate: b.beforeDate }); } catch (err) {
    if (err instanceof ResetError) return deny(400, err.code, err.message);
    throw err;
  }
  if (!CONFIRM_WORDS.includes(normalizeFa(b.confirmText))) return deny(400, 'confirm_required', 'برای تأیید باید عبارت RESET (یا «ریست») را دقیقاً بنویسید.');
  if (!b.reauthCode) return deny(400, 'reauth_required', 'کد ۸ رقمی ورود را از بات تلگرام بگیرید و وارد کنید (تأیید مجدد هویت).');
  if (!panelLoginCodes.consumeCodeForUser(b.reauthCode, adminUser.id)) return deny(403, 'reauth_invalid', 'کد تأیید نامعتبر یا منقضی است؛ کد تازه بگیرید.');
  return { ok: true, options };
}

// اعلان تلگرام به همه‌ی ادمین‌های فعال بعد از ریست موفق (best-effort؛ هرگز خطا نمی‌دهد)
async function notifyAdminsOfReset(result, actorUser) {
  const lines = [
    '⚠️ ریست برنامه انجام شد.',
    `انجام‌دهنده: ${actorUser ? actorUser.full_name : '—'}`,
    `ردیف حذف‌شده: ${result.total}${result.beforeDate ? ` (قبل از ${result.beforeDate})` : ''}`,
    `بک‌آپ پیش از ریست: ${result.backup.file}`,
  ];
  const admins = usersRepository.listUsers({ onlyActive: true }).filter((u) => u.role === 'admin' && u.telegram_user_id);
  let sent = 0;
  for (const a of admins) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await notifier.sendMessage(a.telegram_user_id, lines.join('\n'))) sent += 1;
    } catch (_) { /* best-effort */ }
  }
  return sent;
}

// ---------- اجرا (B2) ----------

let running = false; // همزمانی: فقط یک ریست در لحظه

function clearProcessMemory() {
  try { botSession.clearAll(); } catch (_) { /* بات بالا نیامده */ }
  try { analyticsCache.clear(); } catch (_) { /* کش خالی */ }
}

/**
 * ترتیب: ۱) بک‌آپ (شکست ⇒ ریست نمی‌شود) ۲) حالت نگهداری ۳) یک تراکنش حذف ۴) ریست sqlite_sequence جدول‌های خالی
 * ۵) بیرون تراکنش: checkpoint/VACUUM ۶) پاک‌کردن حافظه‌ی پروسه ۷) افزایش reset_epoch ۸) خاموش‌کردن حالت نگهداری (finally).
 * خطا در تراکنش ⇒ rollback کامل و آزادشدن حالت نگهداری.
 * @returns {Promise<{deleted: object, total: number, backup: object, resetEpoch: number, groups: string[], beforeDate: string|null}>}
 */
async function executeReset(options = {}, { actor = null, ip = null } = {}) {
  const { groups, beforeDate } = normalizeOptions(options);
  if (running) throw new ResetError('BUSY', 'یک ریست دیگر در حال اجراست.');
  running = true;
  try {
    // ۱) بک‌آپ پیش از هر تغییری
    let backupInfo;
    try {
      backupInfo = await backup.runPreResetBackup();
    } catch (err) {
      throw new ResetError('BACKUP_FAILED', `بک‌آپ پیش از ریست ناموفق بود؛ ریست انجام نشد: ${err.message}`);
    }

    maintenanceMode.enter('system_reset'); // ۲)
    try {
      const entries = resetRepository.entriesFor(groups);
      const db = getDb();
      let attachmentIds = [];
      let deleted = {};
      let sequencesReset = [];
      db.transaction(() => { // ۳)
        attachmentIds = groups.includes('operational') ? resetRepository.listAttachmentIds(beforeDate, db) : [];
        deleted = {};
        for (const e of entries) deleted[e.table] = resetRepository.deleteRows(e, beforeDate, db);
        sequencesReset = resetRepository.resetSequencesForEmptyTables(entries.map((e) => e.table), db); // ۴)
      }).immediate();

      // ۵) خارج از تراکنش؛ شکست این مرحله ریست را باطل نمی‌کند
      try { maintenanceRepository.checkpointTruncate(); maintenanceRepository.vacuum(); maintenanceRepository.checkpointTruncate(); } catch (err) {
        console.error(`[reset] VACUUM/checkpoint ناموفق (ریست انجام شده است): ${err.message}`);
      }
      // فایل پیوست‌های حذف‌شده (بعد از commit)
      await Promise.all(attachmentIds.map((id) => attachmentService.remove(id)));

      clearProcessMemory(); // ۶)
      const resetEpoch = settingsRepository.bumpResetEpoch(); // ۷)
      const total = Object.values(deleted).reduce((s, n) => s + n, 0);

      try {
        auditRepository.logEvent({
          userId: actor,
          action: 'system_reset',
          ipAddress: ip,
          details: { groups, beforeDate, deleted, total, sequencesReset, attachmentsRemoved: attachmentIds.length, backupFile: backupInfo.file, resetEpoch },
        });
      } catch (err) {
        console.error(`[reset] ثبت audit ناموفق: ${err.message}`);
      }
      return { deleted, total, backup: backupInfo, resetEpoch, groups, beforeDate };
    } catch (err) {
      try {
        auditRepository.logEvent({ userId: actor, action: 'system_reset_failed', ipAddress: ip, details: { groups, beforeDate, error: String(err.message).slice(0, 300), backupFile: backupInfo.file } });
      } catch (_) { /* ثبت best-effort */ }
      throw err;
    } finally {
      maintenanceMode.leave(); // ۸)
    }
  } finally {
    running = false;
  }
}

module.exports = { ResetError, normalizeOptions, previewReset, listGroups, executeReset, checkResetRequest, isResetLocked, notifyAdminsOfReset, CONFIRM_WORDS };
