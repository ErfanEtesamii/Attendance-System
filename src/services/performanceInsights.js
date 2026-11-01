// بینش‌های عملکرد (سبک Search Console): شاخص‌های کیفیت، تفکیک روز هفته/وضعیت/ساعت ورود، رگه‌ها، تسک‌ها، مرخصی و اعتراض.
// بخش «خالص» روی سری روزانه‌ی performanceService کار می‌کند (بدون DB)؛ بارگذارهای DB جدا و کوچک‌اند.
// هیچ قاعده‌ی تازه‌ای برای حضور/تأخیر نیست: وضعیت هر روز همان وضعیت گزارش ماهانه است.

const sum = (a) => a.reduce((t, v) => t + (v || 0), 0);
const avg = (a) => (a.length ? sum(a) / a.length : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
const PRESENT = new Set(['present', 'late']);
// شنبه = ۰ … جمعه = ۶
const persianWeekday = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;
const isWorking = (r) => r.expected > 0 || r.status === 'absent';

function stdev(vals) {
  if (vals.length < 2) return null;
  const m = avg(vals);
  return Math.sqrt(avg(vals.map((v) => (v - m) ** 2)));
}

/** رگه‌ها روی روزهای کاریِ سپری‌شده به ترتیب تاریخ: { longest, current } برای شرط داده‌شده */
function streaks(rows, today, ok) {
  let longest = 0; let cur = 0;
  for (const r of rows) {
    if (!isWorking(r) || r.date >= today || r.status === 'incomplete') continue; // روز غیرکاری/امروز/آینده رگه را نمی‌شکند
    if (r.status === 'leave' || r.status === 'mission' || r.status === 'manual_leave') continue;
    if (ok(r)) { cur += 1; longest = Math.max(longest, cur); } else cur = 0;
  }
  return { longest, current: cur };
}

/** شاخص‌های کیفیت و تفکیک‌ها از روی سری روزانه (هر ردیف: خروجی metricsOfDay + checkIn/checkOut دقیقه از نیمه‌شب) */
function computeInsights(rows, today) {
  const past = rows.filter((r) => r.date < today || r.status !== 'pending');
  const presentRows = rows.filter((r) => PRESENT.has(r.status));
  const absentRows = rows.filter((r) => r.status === 'absent');
  const lateRows = rows.filter((r) => r.status === 'late' || (PRESENT.has(r.status) && r.late > 0));
  const worked = rows.filter((r) => r.useful > 0 && !(r.flags || []).includes('missing_checkout'));
  const ins = rows.map((r) => r.checkIn).filter((v) => v != null);
  const outs = rows.map((r) => r.checkOut).filter((v) => v != null);

  const completed = presentRows.filter((r) => r.date < today);
  const byWeekday = Array.from({ length: 7 }, (_, wd) => {
    const list = rows.filter((r) => persianWeekday(r.date) === wd && isWorking(r) && r.status !== 'future');
    const w = list.filter((r) => r.useful > 0);
    return {
      weekday: wd,
      days: list.length,
      avgUseful: r1(avg(w.map((r) => r.useful))) || 0,
      lateDays: list.filter((r) => r.late > 0).length,
      absentDays: list.filter((r) => r.status === 'absent').length,
      avgCheckIn: r1(avg(list.map((r) => r.checkIn).filter((v) => v != null))),
    };
  });

  const statusBreakdown = {};
  for (const r of rows) statusBreakdown[r.status] = (statusBreakdown[r.status] || 0) + 1;

  // هیستوگرام ساعت ورود (بسته‌های ۳۰ دقیقه‌ای)
  const hist = new Map();
  for (const v of ins) { const b = Math.floor(v / 30) * 30; hist.set(b, (hist.get(b) || 0) + 1); }
  const histogram = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([start, count]) => ({ start, count }));

  const dayCmp = (key) => (a, b) => b[key] - a[key];
  const best = worked.slice().sort(dayCmp('useful'))[0] || null;
  const worst = rows.filter((r) => r.late > 0 || r.shortfall > 0).slice().sort((a, b) => (b.late + b.shortfall) - (a.late + a.shortfall))[0] || null;

  return {
    workingDays: rows.filter((r) => isWorking(r) && r.status !== 'pending' && r.status !== 'future').length,
    presentDays: presentRows.length,
    absentDays: absentRows.length,
    lateDays: lateRows.length,
    attendanceRate: pct(presentRows.length, presentRows.length + absentRows.length),
    punctualityRate: pct(presentRows.length - lateRows.length, presentRows.length),
    fulfillmentRate: pct(sum(completed.map((r) => r.useful)), sum(completed.map((r) => r.expected))),
    avgDailyUseful: r1(avg(worked.map((r) => r.useful))),
    avgCheckIn: r1(avg(ins)), avgCheckOut: r1(avg(outs)),
    checkInSpread: r1(stdev(ins)),
    earliestCheckIn: ins.length ? Math.min(...ins) : null, latestCheckIn: ins.length ? Math.max(...ins) : null,
    streakPresent: streaks(rows, today, (r) => PRESENT.has(r.status)),
    streakOnTime: streaks(rows, today, (r) => r.status === 'present' && !(r.late > 0)),
    bestDay: best ? { date: best.date, useful: best.useful } : null,
    worstDay: worst ? { date: worst.date, late: worst.late, shortfall: worst.shortfall } : null,
    overtime: {
      payable: sum(rows.map((r) => r.overtime)),
      pending: sum(rows.filter((r) => r.otApproval === 'pending').map((r) => r.otRaw)),
      rejected: sum(rows.filter((r) => r.otApproval === 'rejected').map((r) => r.otRaw)),
      days: rows.filter((r) => r.overtime > 0).length,
    },
    remoteDays: rows.filter((r) => r.remote > 0).length,
    pastDays: past.length,
    byWeekday, statusBreakdown, histogram,
  };
}

// ---------- بارگذارهای DB ----------
function loadTasks(user, from, to) {
  const logsRepo = require('../repositories/taskLogRepository');
  const plansRepo = require('../repositories/weeklyPlanRepository');
  const { REASON_LABELS } = require('../content/reportLabels');
  const logs = logsRepo.listByUserRange(user.id, from, to);
  const out = { total: logs.length, done: 0, partial: 0, notDone: 0, dropped: 0, carried: 0, answeredLate: 0, reasons: [], recentNotDone: [] };
  const reasons = new Map();
  for (const l of logs) {
    const task = plansRepo.findTask(l.task_id);
    if (task && (task.is_system || task.system_key === 'out_of_plan')) { out.total -= 1; continue; }
    if (l.reschedule_to === 'drop') { out.dropped += 1; continue; }
    if (l.status === 'done') out.done += 1; else if (l.status === 'partial') out.partial += 1; else out.notDone += 1;
    if (l.reschedule_to && l.reschedule_to !== 'drop') out.carried += 1;
    if (l.answered_late) out.answeredLate += 1;
    if (l.status !== 'done' && l.reason_code) reasons.set(l.reason_code, (reasons.get(l.reason_code) || 0) + 1);
    if (l.status !== 'done' && task && out.recentNotDone.length < 10) {
      out.recentNotDone.push({ date: l.log_date, title: task.title, status: l.status, reason: l.reason_code ? (REASON_LABELS[l.reason_code] || l.reason_code) : null });
    }
  }
  out.total = out.done + out.partial + out.notDone;
  out.completionRate = pct(out.done + out.partial * 0.5, out.total);
  out.reasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, label: REASON_LABELS[code] || code, count }));
  out.recentNotDone.reverse();
  return out;
}

function loadLeaves(user, from, to) {
  const leaveRepo = require('../repositories/leaveRepository');
  return leaveRepo.listInRangeWithType([user.id], from, to).map((l) => ({
    id: l.id, kind: l.kind, type: l.type_title, status: l.status, from: l.start_date, to: l.end_date, reason: l.reason || null,
  }));
}

function loadDisputes(user, from, to) {
  const disputeRepo = require('../repositories/disputeRepository');
  const inRange = disputeRepo.listByUser(user.id).filter((d) => {
    const day = String(d.created_at || '').slice(0, 10);
    return day >= from && day <= to;
  });
  return { open: inRange.filter((d) => d.status === 'open').length, resolved: inRange.filter((d) => d.status === 'resolved').length };
}

module.exports = { computeInsights, loadTasks, loadLeaves, loadDisputes, persianWeekday, isWorking };
