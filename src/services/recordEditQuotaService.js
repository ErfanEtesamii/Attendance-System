// مرحله ۲ (فاز A): سقف ماهانه‌ی اصلاح رکورد توسط سرپرست.
// • فقط برای role === 'manager'؛ admin/owner/hr/employee معاف‌اند (برای ممنوع‌کردن کامل: مجوز records.edit در ماتریس).
// • مبنای شمارش: audit_log «خودِ همان سرپرست» و actionهای موفقِ اصلاح (منبع حقیقتِ جدا نداریم تا با ممیزی ناسازگار نشود).
// • ماه = ماه شمسی در منطقه‌ی زمانی تنظیمات. limit=0 ⇒ بدون سقف. تنظیم نامعتبر/خطای خواندن ⇒ پیش‌فرض ۳ (نه «بدون سقف»).
// • تنظیمات هر بار از DB خوانده می‌شود ⇒ تغییر از پنل بدون ری‌استارت اثر می‌کند.
// • روت‌های اصلاح همگی همگام‌اند (better-sqlite3): بررسی (assertCanEdit) و نوشتنِ همان درخواست در یک «تیک» اجرا می‌شود،
//   پس دو درخواست هم‌زمان نمی‌توانند هر دو از سقف رد شوند. درخواستِ ردشده audit نمی‌شود و شمرده نمی‌شود.

const settingsRepository = require('../repositories/settingsRepository');
const supervisorOverrides = require('./supervisorOverrideService');
const auditRepository = require('../repositories/auditRepository');
const { getDb } = require('../db/connection');
const { todayInZone, zonedTimeToUtc } = require('../utils/time');
const { jalaliPartsOfDateString, jalaliMonthRangeOf } = require('../utils/jalali');

const DEFAULT_LIMIT = 3;
const DEFAULT_MODE = 'operation';
const EDIT_ACTIONS = [
  'attendance_record_manually_fixed', 'attendance_record_manually_created', 'attendance_record_deleted',
  'attendance_segment_manually_created', 'attendance_segment_manually_edited', 'attendance_segment_deleted',
  'break_record_manually_created', 'break_record_manually_edited', 'break_record_deleted',
  'remote_work_adjust',
];
const BLOCKED_ACTION = 'record_edit_limit_blocked';
const CODE = 'RECORD_EDIT_LIMIT_REACHED';

const has = (v) => v !== null && v !== undefined;
const isManager = (actor) => !!actor && actor.role === 'manager';

function readConfig(actor = null) {
  let limit = DEFAULT_LIMIT;
  let mode = DEFAULT_MODE;
  let timezone = 'Asia/Tehran';
  try {
    const all = settingsRepository.getAll();
    const n = all.supervisorRecordEditMonthlyLimit;
    if (Number.isInteger(n) && n >= 0 && n <= 100) limit = n;
    if (all.supervisorRecordEditCountMode === 'record' || all.supervisorRecordEditCountMode === 'operation') mode = all.supervisorRecordEditCountMode;
    if (typeof all.timezone === 'string' && all.timezone) timezone = all.timezone;
  } catch (_) { /* پیش‌فرض‌ها */ }
  // فاز D: استثنای همین سرپرست (supervisor_overrides) روی سقف سراسری اولویت دارد؛ فقط برای role=manager
  limit = supervisorOverrides.effective(actor, 'supervisorRecordEditMonthlyLimit', limit);
  return { limit, mode, timezone };
}

const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

// بازه‌ی [start, end) ماه شمسیِ «اکنون» به لحظه‌های UTC و قالب audit_log
function monthWindow(now, timezone) {
  const parts = jalaliPartsOfDateString(todayInZone(timezone, now));
  const cur = jalaliMonthRangeOf(parts.jy, parts.jm);
  const ny = parts.jm === 12 ? parts.jy + 1 : parts.jy;
  const nm = parts.jm === 12 ? 1 : parts.jm + 1;
  const next = jalaliMonthRangeOf(ny, nm);
  const start = zonedTimeToUtc(cur.from, '00:00', timezone);
  const end = zonedTimeToUtc(next.from, '00:00', timezone);
  return { jy: parts.jy, jm: parts.jm, start, end };
}

function keyOf(action, details, rowId) {
  if (action === 'remote_work_adjust' && details && has(details.sessionId)) return `s${details.sessionId}`;
  if (details && has(details.recordId)) return `r${details.recordId}`;
  return `a${rowId}`;
}

function usedKeys(actorId, win) {
  const marks = EDIT_ACTIONS.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT id, action, details FROM audit_log WHERE user_id = ? AND action IN (${marks}) AND occurred_at >= ? AND occurred_at < ?`
  ).all(actorId, ...EDIT_ACTIONS, sqlTime(win.start), sqlTime(win.end));
  return rows.map((r) => {
    let d = null;
    try { d = JSON.parse(r.details); } catch (_) { /* قدیمی/غیر JSON */ }
    return keyOf(r.action, d, r.id);
  });
}

function usageOf(actor, now, cfg) {
  const win = monthWindow(now, cfg.timezone);
  const keys = usedKeys(actor.id, win);
  const used = cfg.mode === 'record' ? new Set(keys).size : keys.length;
  return { win, keys, used };
}

// ⇒ { exempt, limit, used, remaining, monthStart, monthEnd, jalaliYear, jalaliMonth, mode }
function getUsage(actor, now = new Date()) {
  const cfg = readConfig(actor);
  const win = monthWindow(now, cfg.timezone);
  const base = { monthStart: win.start.toISOString(), monthEnd: new Date(win.end.getTime() - 1000).toISOString(), jalaliYear: win.jy, jalaliMonth: win.jm, mode: cfg.mode };
  if (!isManager(actor)) return { ...base, exempt: true, limit: null, used: 0, remaining: null };
  const { used } = usageOf(actor, now, cfg);
  const unlimited = cfg.limit === 0;
  return { ...base, exempt: false, limit: cfg.limit, used, remaining: unlimited ? null : Math.max(0, cfg.limit - used), unlimited };
}

function limitMessage(limit) {
  return `سقف اصلاح رکورد در این ماه (${limit} بار) تمام شده است؛ برای اصلاح بیشتر با ادمین هماهنگ کنید.`;
}

// recordId: برای mode=record (رکوردی که اصلاح می‌شود)؛ sessionId: دورکاری؛ targetUserId فقط برای رویداد blocked.
// ⇒ { ok: true } | { ok: false, status: 409, code, error, limit, used }
function assertCanEdit(actor, { recordId = null, sessionId = null, targetUserId = null, ip = null } = {}, { now = new Date() } = {}) {
  if (!isManager(actor)) return { ok: true };
  const cfg = readConfig(actor);
  if (cfg.limit === 0) return { ok: true };
  const { keys, used } = usageOf(actor, now, cfg);
  if (used < cfg.limit) return { ok: true };
  if (cfg.mode === 'record') {
    const key = has(sessionId) ? `s${sessionId}` : (has(recordId) ? `r${recordId}` : null);
    if (key && keys.includes(key)) return { ok: true }; // همین رکورد قبلاً در این ماه شمرده شده
  }
  try {
    auditRepository.logEvent({
      userId: actor.id, action: BLOCKED_ACTION, ipAddress: ip,
      details: { source: 'admin_panel', targetUserId, recordId, sessionId, used, limit: cfg.limit, mode: cfg.mode },
    });
  } catch (_) { /* ثبت رویداد نباید مانع پاسخ شود */ }
  return { ok: false, status: 409, code: CODE, error: limitMessage(cfg.limit), limit: cfg.limit, used };
}

module.exports = { getUsage, assertCanEdit, limitMessage, EDIT_ACTIONS, BLOCKED_ACTION, CODE, DEFAULT_LIMIT, DEFAULT_MODE };
