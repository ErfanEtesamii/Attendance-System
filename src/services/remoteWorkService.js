// R3 (فاز ۱۴): سرویس دورکاری کارمند — ثبت ورود، خروج و استراحت وقتی کاربر بیرون از شبکه‌ی شرکت است.
//
// اصول (پرامپت فاز):
//  • زمان و روز کاری فقط سمت سرور تعیین می‌شود (کلاینت هیچ زمان/تاریخی نمی‌فرستد).
//  • ثبت‌ها «در انتظار بررسی»اند (status = pending) و فقط در remote_work_sessions / remote_work_breaks می‌نشینند؛
//    تا تأیید سرپرست (R5) به attendance_records / break_records نمی‌روند و هیچ گزارش/محاسبه‌ای آن‌ها را نمی‌خواند.
//  • گیت «بیرون از شبکه + بدون ماموریت + تنظیم روشن» در لایه‌ی route است (getRemoteAccess)؛ اینجا فقط قواعد ثبت.
//
// قواعد:
//  • ورودِ دوم بدون خروجِ قبلی رد می‌شود؛ خروج بدون ورود رد می‌شود.
//  • استراحت فقط داخل نشست باز و یک استراحت باز در هر لحظه.
//  • تصمیم (مستند): ثبت خروج وقتی استراحت باز است، خطا نمی‌دهد؛ استراحت باز در همان لحظه‌ی خروج بسته می‌شود و در audit
//    با autoClosedByEnd=true می‌آید (برخلاف خروج حضوری که خطا می‌دهد: اینجا ساعت‌ها هرحال بررسی سرپرست دارند و خطا فقط
//    کارمند را بی‌دلیل گیر می‌اندازد).
//  • نشستی که بیش از remoteWorkMaxOpenHours باز بماند را job شبانه (autoCloseStale) می‌بندد: پایان = شروع + سقف (نه لحظه‌ی اجرا،
//    تا ساعتِ فراموش‌شده اعتبار نگیرد)، با auto_closed = 1 تا سرپرست دقیق‌تر بررسی کند.
const { getDb } = require('../db/connection');
const repo = require('../repositories/remoteWorkRepository');
const auditRepository = require('../repositories/auditRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const settingsRepository = require('../repositories/settingsRepository');

const fail = (status, code, error) => ({ ok: false, status, code, error });

const ERR = {
  ALREADY_OPEN: () => fail(400, 'REMOTE_ALREADY_OPEN', 'یک ورود دورکاری باز دارید؛ ابتدا خروج دورکاری را ثبت کنید.'),
  NOT_STARTED: () => fail(400, 'REMOTE_NOT_STARTED', 'ورود دورکاری باز ندارید؛ ابتدا ورود دورکاری را ثبت کنید.'),
  BREAK_OPEN: () => fail(400, 'REMOTE_BREAK_ALREADY_OPEN', 'یک استراحت باز از قبل فعال است.'),
  NO_BREAK: () => fail(400, 'REMOTE_NO_OPEN_BREAK', 'استراحت باز فعالی وجود ندارد.'),
};

const isoMax = (a, b) => (a >= b ? a : b); // مقایسه‌ی ISO/UTC؛ پایان هرگز قبل از شروع نمی‌افتد (CHECK جدول) حتی با ساعت سرورِ عقب‌رفته
const isUnique = (err) => err && /UNIQUE/i.test(String(err.message || err.code || ''));

function publicSession(session, breaks) {
  return { ...session, breaks };
}

// وضعیت امروز: نشست‌های روز کاری (و نشستِ بازِ مانده از روز قبل) با استراحت‌هایشان و وضعیت هر کدام
function getToday(userId, { now = new Date() } = {}) {
  const workDate = attendanceRepository.currentRecordDate(userId, now);
  const sessions = repo.listForUserDate(userId, workDate).map((s) => publicSession(s, repo.listBreaks(s.id)));
  const openSession = sessions.find((s) => s.end_at === null) || null;
  const openBreak = openSession ? openSession.breaks.find((b) => b.end_at === null) || null : null;
  return { workDate, openSession, openBreak, sessions, maxOpenHours: settingsRepository.getAll().remoteWorkMaxOpenHours };
}

// تاریخچه‌ی خود کارمند (R4): نشست‌های N روز اخیر (پیش‌فرض ۳۰، سقف ۹۰) با استراحت‌ها و وضعیت هر کدام؛ فقط ستون‌های عمومی (بدون IP)
function getHistory(userId, { days = 30, now = new Date() } = {}) {
  const n = Math.min(Math.max(parseInt(days, 10) || 30, 1), 90);
  const to = attendanceRepository.currentRecordDate(userId, now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  const sessions = repo.listForUserRange(userId, from, to).map((s) => publicSession(s, repo.listBreaks(s.id)));
  return { from, to, sessions };
}

function start(user, { ip = null, now = new Date(), source = 'miniapp' } = {}) {
  const nowIso = now.toISOString();
  try {
    return getDb().transaction(() => {
      if (repo.findOpenSession(user.id)) return ERR.ALREADY_OPEN();
      const workDate = attendanceRepository.currentRecordDate(user.id, now);
      const session = repo.insertSession({ userId: user.id, workDate, startAt: nowIso, ip, source });
      auditRepository.logEvent({ userId: user.id, action: 'remote_work_start', ipAddress: ip, details: { source, sessionId: session.id, workDate } });
      return { ok: true, session: publicSession(session, []) };
    })();
  } catch (err) {
    if (isUnique(err)) return ERR.ALREADY_OPEN(); // دو درخواست هم‌زمان: ایندکس یکتای «یک نشست باز» جلوی دومی را می‌گیرد
    throw err;
  }
}

// پیام «دورکاری جدید برای بررسی» برای سرپرست/ادمین؛ بعد از commit، fire-and-forget و بدون شکستن جریان اصلی (require تنبل: چرخه‌ی ماژول پیش نیاید).
function notifySubmitted(sessionId) {
  try {
    require('./notificationEvents').remoteWorkSubmitted(sessionId).catch(() => {});
  } catch (err) {
    console.error('[remoteWork] اعلان ثبت دورکاری ناموفق (نادیده گرفته شد):', err && err.message);
  }
}

function end(user, { ip = null, now = new Date(), source = 'miniapp' } = {}) {
  const nowIso = now.toISOString();
  const result = getDb().transaction(() => {
    const open = repo.findOpenSession(user.id);
    if (!open) return ERR.NOT_STARTED();
    const endAt = isoMax(nowIso, open.start_at);
    let closedBreak = null;
    const openBreak = repo.findOpenBreak(open.id);
    if (openBreak) {
      closedBreak = repo.closeBreak(openBreak.id, isoMax(endAt, openBreak.start_at));
      auditRepository.logEvent({ userId: user.id, action: 'remote_break_end', ipAddress: ip, details: { source, sessionId: open.id, breakId: openBreak.id, autoClosedByEnd: true } });
    }
    const session = repo.closeSession(open.id, endAt);
    auditRepository.logEvent({ userId: user.id, action: 'remote_work_end', ipAddress: ip, details: { source, sessionId: open.id, workDate: open.work_date, autoClosedBreak: Boolean(closedBreak) } });
    return { ok: true, session: publicSession(session, repo.listBreaks(open.id)), autoClosedBreak: closedBreak };
  })();
  if (result.ok) notifySubmitted(result.session.id); // پایان ثبت شد ⇒ پیام برای سرپرست (بعد از commit)
  return result;
}

function breakStart(user, { ip = null, now = new Date(), source = 'miniapp' } = {}) {
  const nowIso = now.toISOString();
  try {
    return getDb().transaction(() => {
      const open = repo.findOpenSession(user.id);
      if (!open) return ERR.NOT_STARTED();
      if (repo.findOpenBreak(open.id)) return ERR.BREAK_OPEN();
      const brk = repo.insertBreak(open.id, isoMax(nowIso, open.start_at));
      auditRepository.logEvent({ userId: user.id, action: 'remote_break_start', ipAddress: ip, details: { source, sessionId: open.id, breakId: brk.id } });
      return { ok: true, break: brk };
    })();
  } catch (err) {
    if (isUnique(err)) return ERR.BREAK_OPEN();
    throw err;
  }
}

function breakEnd(user, { ip = null, now = new Date(), source = 'miniapp' } = {}) {
  const nowIso = now.toISOString();
  return getDb().transaction(() => {
    const open = repo.findOpenSession(user.id);
    if (!open) return ERR.NOT_STARTED();
    const openBreak = repo.findOpenBreak(open.id);
    if (!openBreak) return ERR.NO_BREAK();
    const brk = repo.closeBreak(openBreak.id, isoMax(nowIso, openBreak.start_at));
    auditRepository.logEvent({ userId: user.id, action: 'remote_break_end', ipAddress: ip, details: { source, sessionId: open.id, breakId: openBreak.id, autoClosedByEnd: false } });
    return { ok: true, break: brk };
  })();
}

// job شبانه: نشست‌های بازِ قدیمی‌تر از remoteWorkMaxOpenHours را می‌بندد (وضعیت pending می‌ماند، auto_closed = 1) ⇒ تعداد بسته‌شده‌ها
function autoCloseStale({ now = new Date() } = {}) {
  const maxHours = settingsRepository.getAll().remoteWorkMaxOpenHours;
  const cutoff = new Date(now.getTime() - maxHours * 3600 * 1000).toISOString();
  let closed = 0;
  for (const s of repo.listStaleOpenSessions(cutoff)) {
    getDb().transaction(() => {
      const openBreak = repo.findOpenBreak(s.id);
      const endAt = isoMax(new Date(new Date(s.start_at).getTime() + maxHours * 3600 * 1000).toISOString(), openBreak ? openBreak.start_at : s.start_at);
      if (openBreak) repo.closeBreak(openBreak.id, endAt);
      repo.closeSession(s.id, endAt, { autoClosed: true });
      auditRepository.logEvent({ userId: s.user_id, action: 'remote_work_auto_closed', details: { sessionId: s.id, workDate: s.work_date, endAt, maxOpenHours: maxHours, autoClosedBreak: Boolean(openBreak) } });
    })();
    closed += 1;
    notifySubmitted(s.id); // بستن خودکار هم برای بررسی دقیق‌تر به سرپرست خبر می‌دهد (با هشدار «بسته‌شده‌ی خودکار»)
  }
  return closed;
}

module.exports = { getToday, getHistory, start, end, breakStart, breakEnd, autoCloseStale };
