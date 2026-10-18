// F1-c (فاز ۱۲): خلاصه‌ی عملکرد هفته از روی «روزهای» ساخته‌شده‌ی employeeWeekService (خالص؛ بدون DB).
//
// فرمول درصد تکمیل تسک‌ها:  percent = round( (done × ۱ + partial × ۰٫۵) / total × ۱۰۰ )   (total = ۰ ⇒ null)
//   «total» = تعداد (تسک، روز)های «سررسیدشده‌ی» غیرسیستمی و درون‌برنامه:
//     • فقط روزهای گذشته‌ی کاری + امروز؛ ردیفِ بی‌پاسخِ «امروز» و روزهای آینده شمرده نمی‌شود (هنوز مهلت دارد)
//     • تسک سیستمی (مثل «بررسی گزارش تیم») و «خارج از برنامه» نمی‌آید (آن‌ها فقط در extra)
//     • تسک حذف‌شده با dropped=true (کارمند آن را کنار گذاشته) شمرده نمی‌شود
//     • تسکِ منتقل‌شده به روز دیگر در هر دو روز شمرده می‌شود (روز مبدأ «انجام‌نشده» و روز مقصد با وضعیت همان روز)
// ساعت: «مورد انتظار» = مجموع plannedMinutes روزهای قبل از امروز + امروز اگر ورود دارد؛ «مفید» = مجموع effectiveMinutes همان روزها.
// «روز بدون گزارش» = روز کاری گذشته‌ی غایب‌نبوده (ورود دارد) که هیچ پاسخ تسکی ندارد.

const isCounted = (t) => !t.isSystem && !t.outOfPlan && !t.dropped;

function summarizeWeek(days, today) {
  const tasks = { total: 0, normal: 0, urgent: 0, selfUrgent: 0, done: 0, partial: 0, notDone: 0, noAnswer: 0, rescheduled: 0, dropped: 0, extra: 0 };
  let lateDays = 0; let absentDays = 0; let noReportDays = 0;
  let expectedMinutes = 0; let usefulMinutes = 0; let overtimeMinutes = 0; let breakPaidMinutes = 0; let breakUnpaidMinutes = 0;
  let closedDays = 0;

  for (const d of days) {
    if (d.monthClosed) closedDays += 1;
    const working = d.kind === 'working' || d.kind === 'half';
    const att = d.attendance && d.attendance.hasCheckIn ? d.attendance : null;
    const past = d.date < today;

    for (const t of d.tasks || []) {
      if (t.outOfPlan && t.status === 'done') tasks.extra += 1;
      if (t.dropped && !t.isSystem && !t.outOfPlan) tasks.dropped += 1;
      if (!isCounted(t)) continue;
      if (d.date > today || (d.date === today && t.status === 'no_answer')) continue;
      tasks.total += 1;
      tasks[t.isUrgent ? 'urgent' : 'normal'] += 1;
      if (t.isUrgent && t.selfAssigned) tasks.selfUrgent += 1; // F1: فوریِ ثبت‌شده توسط خود کارمند (زیرمجموعه‌ی urgent)
      if (t.status === 'done') tasks.done += 1;
      else if (t.status === 'partial') tasks.partial += 1;
      else if (t.status === 'not_done') tasks.notDone += 1;
      else tasks.noAnswer += 1;
      if (t.rescheduleTo) tasks.rescheduled += 1;
    }

    if (att && att.lateMinutes > 0) lateDays += 1;
    if (past && d.absent) absentDays += 1;
    if (past && working && att && !(d.tasks || []).some((t) => t.status !== 'no_answer')) noReportDays += 1;
    if (past || (d.date === today && att)) {
      expectedMinutes += (d.schedule && d.schedule.plannedMinutes) || 0;
      if (att) {
        usefulMinutes += att.effectiveMinutes || 0;
        overtimeMinutes += att.overtimeMinutes || 0;
        breakPaidMinutes += att.breakPaidMinutes || 0;
        breakUnpaidMinutes += att.breakUnpaidMinutes || 0;
      }
    }
  }

  const weighted = tasks.done + tasks.partial * 0.5;
  return {
    tasks: { ...tasks, completionPercent: tasks.total ? Math.round((weighted / tasks.total) * 100) : null },
    attendance: {
      lateDays, absentDays, noReportDays, expectedMinutes, usefulMinutes, overtimeMinutes, breakPaidMinutes, breakUnpaidMinutes,
      usefulPercent: expectedMinutes ? Math.round((usefulMinutes / expectedMinutes) * 100) : null,
    },
    closed: { days: closedDays, allClosed: closedDays === days.length && days.length > 0, partlyClosed: closedDays > 0 && closedDays < days.length },
    formula: 'completionPercent = round((done + 0.5 × partial) / total × 100)',
  };
}

module.exports = { summarizeWeek };
