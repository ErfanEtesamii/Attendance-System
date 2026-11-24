// جزئیات روزبه‌روزِ دورکاری یک کارمند برای تب «دورکاری» پروفایل: ورود/خروج، نوبت‌ها، جلسه‌های دورکاری، تک‌تک استراحت‌ها و اینکه هرکدام چه اثری روی ساعت مفید داشت.
// قاعده (همان computeDay): ساعت دورکاری = (پایان − شروع جلسه) منهای کل استراحت‌ها (بدون سهمیه‌ی با حقوق)؛ استراحتِ بسته‌نشده: کار تا شروعش حساب می‌شود؛
// فاصله‌ی حضوری→دورکاری (استراحت via_remote بیرون از جلسه) از ساعت مفید کم می‌شود.
const { getDb } = require('../db/connection');
const attendanceRepository = require('../repositories/attendanceRepository');
const breakRepository = require('../repositories/breakRepository');
const dayService = require('../engine/dayService');
const { mergeWindows, subtractWindows } = require('../engine/computeDay');

const MIN = 60000;
const iso = (ms) => (Number.isFinite(ms) && ms !== Infinity ? new Date(ms).toISOString() : null);
const mins = (a, b) => Math.max(0, Math.round((b - a) / MIN));

function sessionsInRange(userId, from, to) {
  return getDb().prepare('SELECT id, work_date, start_at, end_at, status, source, auto_closed, review_note, approved_start_at, approved_end_at FROM remote_work_sessions WHERE user_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date, start_at, id').all(userId, from, to);
}

function classifyBreaks(breaks, full, credited) {
  return breaks.map((b) => {
    const s = Date.parse(b.start_time); const e = b.end_time ? Date.parse(b.end_time) : Infinity;
    const base = { id: b.id, type: b.break_type, start: b.start_time, end: b.end_time || null, minutes: Number.isFinite(e) ? mins(s, e) : null, viaRemote: !!b.via_remote };
    const idx = full.findIndex(([a, z]) => s >= a && s < z);
    if (idx >= 0) {
      const cut = credited[idx] && credited[idx][1] < full[idx][1] && s >= credited[idx][1];
      return { ...base, kind: cut ? 'unclosed' : 'inside_remote' };
    }
    const overlaps = full.some(([a, z]) => Math.min(e, z) > Math.max(s, a));
    if (overlaps) return { ...base, kind: 'inside_remote' };
    return { ...base, kind: b.via_remote ? 'gap' : 'onsite' };
  });
}

function buildRemoteDays(userId, from, to, { now } = {}) {
  const ctx = dayService.loadContext();
  const records = attendanceRepository.listByUserAndRange(userId, from, to);
  const byDate = new Map(records.map((r) => [r.record_date, r]));
  const sess = sessionsInRange(userId, from, to);
  const dates = new Set([...sess.map((s) => s.work_date), ...records.filter((r) => r.via_remote).map((r) => r.record_date)]);
  const out = [];
  for (const date of [...dates].sort().reverse()) {
    const record = byDate.get(date) || null;
    const day = record ? dayService.computeRecordDay(record, { context: ctx, now }) : null;
    const rd = day && day.remoteDetail;
    const full = rd ? rd.full : [];
    const credited = rd ? rd.credited : [];
    const breaks = record ? classifyBreaks(breakRepository.listByAttendanceRecord(record.id), full, credited) : [];
    const rawSegs = record ? (attendanceRepository.listSegments(record.id) || []) : [];
    const segs = (rawSegs.length ? rawSegs : (record ? [{ check_in_time: record.check_in_time, check_out_time: record.check_out_time }] : []))
      .map((x) => ({ in: Date.parse(x.check_in_time), out: x.check_out_time ? Date.parse(x.check_out_time) : null })).filter((x) => Number.isFinite(x.in));
    const onsitePieces = [];
    for (const sg of segs) for (const [a, b] of subtractWindows([sg.in, sg.out === null ? (now ? new Date(now).getTime() : Date.now()) : sg.out], full)) onsitePieces.push([a, b]);
    const sessions = sess.filter((x) => x.work_date === date).map((x) => {
      const approved = x.status === 'approved';
      const a = Date.parse(x.approved_start_at || x.start_at); const b = Date.parse(x.approved_end_at || x.end_at);
      const idx = approved ? full.findIndex(([fa, fz]) => Math.abs(fa - a) < 1000 || (a >= fa && a < fz)) : -1;
      const credEnd = idx >= 0 ? credited[idx][1] : null;
      return { id: x.id, status: x.status, start: iso(a), end: iso(b), minutes: Number.isFinite(b) ? mins(a, b) : null, creditedMinutes: approved && credEnd !== null ? mins(Math.max(a, full[idx][0]), credEnd) : 0, cutAt: idx >= 0 && credEnd < full[idx][1] ? iso(credEnd) : null, autoClosed: !!x.auto_closed, note: x.review_note || null };
    });
    out.push({
      date, recordId: record ? record.id : null, status: record ? record.status : null, viaRemote: !!(record && record.via_remote),
      checkIn: record ? record.check_in_time : null, checkOut: record ? record.check_out_time : null,
      segments: segs.map((x) => ({ in: iso(x.in), out: iso(x.out) })),
      onsite: onsitePieces.map(([a, b]) => ({ start: iso(a), end: iso(b), minutes: mins(a, b) })),
      sessions, breaks,
      totals: day ? {
        effective: day.effective, remote: day.remoteMinutes || 0, remoteGross: rd ? rd.remoteGross : 0, remoteBreak: rd ? rd.remoteBreak : 0, onsiteEffective: rd ? rd.onsiteEffective : day.effective,
        onsiteMinutes: onsitePieces.reduce((t, [a, b]) => t + mins(a, b), 0), breakAll: rd ? rd.onsiteBreak : day.break, breakPaid: rd ? rd.onsiteBreakPaid : day.breakPaid, breakUnpaid: rd ? rd.onsiteBreakUnpaid : day.breakUnpaid, lunchAuto: rd ? rd.onsiteBreakAuto : day.breakAuto, idle: Number(record.idle_minutes) || 0,
      } : null,
      flags: day ? day.flags : [],
    });
  }
  return out;
}

module.exports = { buildRemoteDays, classifyBreaks, mergeWindows };
