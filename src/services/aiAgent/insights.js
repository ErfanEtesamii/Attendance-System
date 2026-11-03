// تشخیص ناهنجاری بر پایه‌ی قانون (بدون مدل ⇒ رایگان و قطعی). خروجی: [{ key, text }]؛ key برای dedupe روزانه.
const { getDb } = require('../../db/connection');
const settingsRepository = require('../../repositories/settingsRepository');
const { todayInZone } = require('../../utils/time');
const { addDays } = require('../../utils/shiftDay');

const LATE_THRESHOLD_7D = 3;

function collect({ now = new Date() } = {}) {
  const db = getDb();
  const tz = settingsRepository.getTimezone();
  const today = todayInZone(tz, now);
  const out = [];

  const pendingLeave = db.prepare(`SELECT COUNT(*) c FROM leave_requests WHERE status='pending' AND created_at <= datetime('now','-1 day')`).get().c;
  if (pendingLeave > 0) out.push({ key: `leave_pending:${today}`, text: `⏳ ${pendingLeave} درخواست مرخصی/مأموریت بیش از ۲۴ ساعت منتظر تصمیم است.` });

  const openDisputes = db.prepare(`SELECT COUNT(*) c FROM record_disputes WHERE status='open' AND created_at <= datetime('now','-3 day')`).get().c;
  if (openDisputes > 0) out.push({ key: `dispute_open:${today}`, text: `📝 ${openDisputes} اعتراض بیش از ۳ روز بدون پاسخ مانده است.` });

  const since = addDays(today, -6);
  const lates = db.prepare(`SELECT u.full_name n, COUNT(*) c FROM attendance_records r JOIN users u ON u.id=r.user_id
    WHERE r.status='late' AND r.record_date BETWEEN ? AND ? AND u.is_active=1 GROUP BY r.user_id HAVING c >= ? ORDER BY c DESC LIMIT 8`).all(since, today, LATE_THRESHOLD_7D);
  if (lates.length) out.push({ key: `late_repeat:${today}`, text: `⚠️ تأخیر مکرر در ۷ روز اخیر: ${lates.map((l) => `${l.n} (${l.c} بار)`).join('، ')}` });

  const yesterday = addDays(today, -1);
  const incomplete = db.prepare(`SELECT COUNT(*) c FROM attendance_records WHERE record_date=? AND status='incomplete'`).get(yesterday).c;
  if (incomplete > 0) out.push({ key: `incomplete:${yesterday}`, text: `🚪 ${incomplete} رکورد دیروز بدون ثبت خروج (ناقص) است.` });

  return out;
}

/** فقط هشدارهایی که قبلاً ارسال نشده‌اند را برمی‌گرداند و ثبت می‌کند. */
function takeNew(items) {
  const db = getDb();
  const ins = db.prepare('INSERT OR IGNORE INTO ai_alert_log(alert_key) VALUES (?)');
  const fresh = items.filter((i) => ins.run(i.key).changes > 0);
  db.prepare(`DELETE FROM ai_alert_log WHERE sent_at < datetime('now','-30 day')`).run();
  return fresh;
}

module.exports = { collect, takeNew };
