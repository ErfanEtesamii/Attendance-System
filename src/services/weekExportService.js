// خروجی برنامه‌ی هفتگی: فقط داده‌ی آماده‌ی getWeek/getMyWeek را به قالب قابل‌ارسال تبدیل می‌کند.
// اینجا هیچ محاسبه‌ی حضور، برنامه یا تسک تکرار نمی‌شود.
const STATUS = { done: 'انجام شد', partial: 'ناقص', not_done: 'انجام نشد', no_answer: 'بدون پاسخ' };
const SOURCE = { planned: 'برنامه‌ای', everyday: 'هرروزه', rescheduled: 'منتقل‌شده', answered_only: 'پاسخ ثبت‌شده' };
const icon = { done: '✅', partial: '⚠️', not_done: '❌', no_answer: '⏳' };
const value = (v) => (v === null || v === undefined ? '' : v);
const schedule = (d) => d.schedule && d.schedule.start && d.schedule.end ? `${d.schedule.start}–${d.schedule.end}` : '';

function buildWeekSheets(week) {
  const user = week.user || {};
  const days = Array.isArray(week.days) ? week.days : [];
  const planHeaders = ['نام کارمند', 'تاریخ شمسی', 'تاریخ میلادی', 'روز هفته', 'نوع روز', 'ساعت برنامه', 'عنوان تسک', 'اولویت', 'فوری؟', 'وضعیت', 'علت', 'توضیح انجام', 'منبع'];
  const planRows = [];
  const dailyRows = [];
  for (const d of days) {
    const base = [user.fullName || '', d.jalali || '', d.date || '', d.weekday || '', d.kindLabel || d.kind || '', schedule(d)];
    const tasks = (d.tasks || []).filter((t) => !t.deleted);
    if (!tasks.length) planRows.push([...base, '', '', '', '', '', '', '']);
    for (const t of tasks) planRows.push([...base, value(t.title), value(t.priority), t.isUrgent ? 'بله' : 'خیر', STATUS[t.status] || value(t.status), value(t.reasonText), value(t.note), SOURCE[t.source] || value(t.source)]);
    const a = d.attendance || {};
    dailyRows.push([d.jalali || '', d.date || '', d.weekday || '', d.kindLabel || d.kind || '', schedule(d), value(a.checkIn), value(a.checkOut), value(a.lateMinutes), value(a.effectiveMinutes), value(a.overtimeMinutes)]);
  }
  const s = week.summary || {}; const t = s.tasks || {}; const a = s.attendance || {};
  const summaryRows = [
    ['نام کارمند', user.fullName || ''], ['بازه', `${value(week.week && week.week.jalaliStart)} تا ${value(week.week && week.week.jalaliEnd)}`],
    ['تکمیل تسک‌ها (درصد)', value(t.completionPercent)], ['تسک انجام‌شده', value(t.done)], ['تسک ناقص', value(t.partial)], ['تسک انجام‌نشده', value(t.notDone)], ['تسک بدون پاسخ', value(t.noAnswer)],
    ['ساعت مفید (دقیقه)', value(a.usefulMinutes)], ['تأخیر (روز)', value(a.lateDays)], ['اضافه‌کاری (دقیقه)', value(a.overtimeMinutes)], ['غیبت (روز)', value(a.absentDays)],
  ];
  return [
    { name: 'برنامه‌ی هفته', headers: planHeaders, rows: planRows },
    { name: 'خلاصه‌ی روزها', headers: ['تاریخ شمسی', 'تاریخ میلادی', 'روز هفته', 'نوع روز', 'ساعت برنامه', 'ورود', 'خروج', 'تأخیر (دقیقه)', 'ساعت مفید (دقیقه)', 'اضافه‌کاری (دقیقه)'], rows: dailyRows },
    { name: 'خلاصه‌ی هفته', headers: ['عنوان', 'مقدار'], rows: summaryRows },
  ];
}

function buildWeekText(week) {
  const user = week.user || {}; const w = week.week || {}; const lines = [`برنامه‌ی هفتگی ${user.fullName || ''} — ${w.jalaliStart || ''} تا ${w.jalaliEnd || ''}`];
  for (const d of week.days || []) {
    lines.push('', `${d.weekday || ''} ${d.jalali || ''} (${d.kindLabel || d.kind || ''}${schedule(d) ? `، ${schedule(d)}` : ''})`);
    const tasks = (d.tasks || []).filter((t) => !t.deleted);
    if (!tasks.length) lines.push('• تسکی ثبت نشده است');
    for (const t of tasks) lines.push(`• ${t.isUrgent ? '⚡ ' : ''}${t.title || ''} [${icon[t.status] || ''} ${STATUS[t.status] || t.status || ''}]`);
  }
  const t = (week.summary || {}).tasks || {}; const a = (week.summary || {}).attendance || {};
  lines.push('', `خلاصه‌ی هفته: ${value(t.done)} انجام‌شده، ${value(t.partial)} ناقص، ${value(t.notDone)} انجام‌نشده، ${value(t.noAnswer)} بدون پاسخ؛ ساعت مفید: ${value(a.usefulMinutes)} دقیقه.`);
  return lines.join('\n');
}

module.exports = { buildWeekSheets, buildWeekText, STATUS, SOURCE };
