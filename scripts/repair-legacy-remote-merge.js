// تعمیر دورکاری‌های «ادغام‌شده در رکورد حضوری» که قبل از migration 051 تأیید شده‌اند (بازه‌ی حضوریِ اصلی‌شان ذخیره نشده بود).
//   node scripts/repair-legacy-remote-merge.js                          → فقط گزارش (dry-run)؛ هیچ چیز تغییر نمی‌کند
//   node scripts/repair-legacy-remote-merge.js --apply                  → اعمال برای مواردی که بازه‌ی حضوری قابل‌اعتماد پیدا شده
//   node scripts/repair-legacy-remote-merge.js --onsite 57=07:44-15:00 --apply
//        ⇒ بازه‌ی حضوریِ دستی برای نشستِ شماره‌ی 57 (ساعت محلیِ شرکت)؛ چند بار قابل‌تکرار. برای روزهایی که خودکار پیدا نمی‌شود یا بعد از ادغام دستی ویرایش شده‌اند.
//
// بازه‌ی حضوریِ اصلی به ترتیب از این‌ها پیدا می‌شود: (۱) --onsite (۲) بازه‌های ورود/خروجِ رکورد (attendance_segments؛ ادغام دست‌شان نمی‌زد)
// (۳) رویدادهای check_in / check_out در audit_log همان روز. نتیجه باید با رکورد فعلی سازگار باشد (ادغام فقط می‌گسترد).
// روزی که بعد از ادغام رکوردش دستی ویرایش شده (در audit) خودکار اعمال نمی‌شود، مگر --onsite بدهید.
// قبل از --apply: سرویس خاموش باشد و از دیتابیس بک‌آپ بگیرید. ماه بسته‌شده هرگز تغییر نمی‌کند.
// کد خروج: ۰ موفق | ۱ خطا | ۲ آرگومان نادرست
const { getDb, closeDb } = require('../src/db/connection');

const EDIT_ACTIONS = ['attendance_record_manually_fixed', 'attendance_record_manually_created', 'attendance_segment_manually_edited', 'attendance_segment_manually_created', 'attendance_segment_deleted', 'record_manually_fixed'];
const SNAP_MS = 2000; // audit_log ثانیه‌ای است و رکورد میلی‌ثانیه‌ای

function offsetMinutes(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
function localToIso(dateStr, hhmm, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - offsetMinutes(new Date(guess), tz) * 60000).toISOString();
}
function isoToLocalHm(iso, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
const addDay = (dateStr) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const auditToIso = (s) => `${String(s).replace(' ', 'T')}.000Z`;
const isoToAudit = (iso) => String(iso).slice(0, 19).replace('T', ' ');

// «۵۷=07:44-15:00» ⇒ { id, start: 'HH:MM', end: 'HH:MM' } | null
function parseOnsiteArg(v) {
  const m = /^(\d+)=(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const pad = (t) => (t.length === 4 ? `0${t}` : t);
  return { id: Number(m[1]), start: pad(m[2]), end: pad(m[3]) };
}

/** گروه‌های «کاربر + روز» که حداقل یک نشستِ ادغام‌شده‌ی بدون بازه‌ی حضوری دارند. */
function findLegacyGroups(db) {
  const rows = db.prepare(`
    SELECT s.id, s.user_id, s.work_date, s.reviewed_at, s.attendance_record_id,
           r.check_in_time AS rec_in, r.check_out_time AS rec_out
      FROM remote_work_sessions s JOIN attendance_records r ON r.id = s.attendance_record_id
     WHERE s.status = 'approved' AND s.onsite_in_at IS NULL AND r.via_remote = 0 AND r.check_in_time IS NOT NULL
     ORDER BY s.work_date, s.user_id, s.id`).all();
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.user_id}|${r.work_date}`;
    if (!groups.has(key)) groups.set(key, { userId: r.user_id, workDate: r.work_date, recordId: r.attendance_record_id, recIn: r.rec_in, recOut: r.rec_out, sessionIds: [], reviewedAt: r.reviewed_at || '' });
    const g = groups.get(key);
    g.sessionIds.push(r.id);
    if ((r.reviewed_at || '') < g.reviewedAt || !g.reviewedAt) g.reviewedAt = r.reviewed_at || g.reviewedAt;
  }
  return [...groups.values()];
}

/** بازه‌ی حضوریِ پیشنهادی برای یک گروه ⇒ { onsite:{start,end}|null, source, note } */
function deriveOnsite(db, g, { overrides, tz }) {
  const ov = g.sessionIds.map((id) => overrides.get(id)).find(Boolean);
  const edited = db.prepare(`SELECT 1 FROM audit_log WHERE action IN (${EDIT_ACTIONS.map(() => '?').join(',')}) AND occurred_at > ? AND details LIKE ? AND details LIKE ? LIMIT 1`)
    .get(...EDIT_ACTIONS, isoToAudit(g.reviewedAt || '1970-01-01T00:00:00Z'), `%"targetUserId":${g.userId}%`, `%${g.workDate}%`);
  if (ov) {
    return { onsite: { start: localToIso(g.workDate, ov.start, tz), end: localToIso(g.workDate, ov.end, tz) }, source: 'دستی (--onsite)', edited: Boolean(edited) };
  }
  if (edited) return { onsite: null, source: null, edited: true, note: 'رکورد بعد از ادغام دستی ویرایش شده؛ با --onsite بازه‌ی حضوری را مشخص کنید' };

  let cand = null; let source = null;
  const segs = db.prepare('SELECT check_in_time, check_out_time FROM attendance_segments WHERE attendance_record_id = ? ORDER BY seq').all(g.recordId);
  if (segs.length && segs[0].check_in_time && segs[segs.length - 1].check_out_time) {
    cand = { start: segs[0].check_in_time, end: segs[segs.length - 1].check_out_time }; source = 'بازه‌های ورود/خروج رکورد';
  } else {
    const lo = isoToAudit(localToIso(g.workDate, '00:00', tz));
    const hi = isoToAudit(localToIso(addDay(g.workDate), '00:00', tz));
    const q = (action, order) => db.prepare(`SELECT occurred_at FROM audit_log WHERE user_id = ? AND action = ? AND occurred_at >= ? AND occurred_at < ? ${order} LIMIT 1`).get(g.userId, action, lo, hi);
    const inEv = q('check_in', 'ORDER BY occurred_at ASC, id ASC');
    const outEv = db.prepare('SELECT occurred_at FROM audit_log WHERE user_id = ? AND action = ? AND occurred_at >= ? AND occurred_at < ? AND occurred_at <= ? ORDER BY occurred_at DESC, id DESC LIMIT 1')
      .get(g.userId, 'check_out', lo, hi, isoToAudit(g.reviewedAt || '9999-12-31T00:00:00Z'));
    if (inEv && outEv) { cand = { start: auditToIso(inEv.occurred_at), end: auditToIso(outEv.occurred_at) }; source = 'لاگ ورود/خروج (audit)'; }
  }
  if (!cand) return { onsite: null, source: null, edited: false, note: 'بازه‌ی حضوری پیدا نشد؛ با --onsite تعیین کنید' };
  // ثانیه‌ای بودن audit: اگر نزدیکِ ساعت رکورد است، همان ساعتِ دقیقِ رکورد
  if (Math.abs(Date.parse(cand.start) - Date.parse(g.recIn)) < SNAP_MS) cand.start = g.recIn;
  if (Math.abs(Date.parse(cand.end) - Date.parse(g.recOut)) < SNAP_MS) cand.end = g.recOut;
  return { onsite: cand, source, edited: false };
}

// ساعت مفیدِ (دقیقه) روزِ یک رکورد با همان موتور محاسبه‌ی حقوق؛ خطا/نبودن ⇒ null
function usefulMinutes(recordId) {
  try {
    const dayService = require('../src/engine/dayService');
    const attendanceRepository = require('../src/repositories/attendanceRepository');
    const rec = attendanceRepository.findById(recordId);
    const d = rec ? dayService.computeRecordDay(rec, { context: dayService.loadContext() }) : null;
    return d && typeof d.effective === 'number' ? d.effective : null;
  } catch (_) { return null; }
}
const fmtMin = (m) => (m === null || m === undefined ? '؟' : `${Math.floor(m / 60)} ساعت و ${m % 60} دقیقه`);

function validate(g, onsite) {
  if (!onsite) return 'بدون بازه‌ی حضوری';
  if (!(onsite.start < onsite.end)) return 'بازه‌ی حضوری نامعتبر (پایان بعد از شروع نیست)';
  if (Date.parse(onsite.start) < Date.parse(g.recIn) - SNAP_MS || Date.parse(onsite.end) > Date.parse(g.recOut) + SNAP_MS) return 'بازه‌ی حضوری با رکورد فعلی ناسازگار است (ادغام فقط می‌گسترد)';
  return null;
}

/** گزارش/اعمال. ⇒ [{ group, status: 'ready'|'applied'|'skipped', reason, source, onsite, proposed }] */
function run({ apply = false, overrides = new Map(), db = getDb(), tz = null, now = new Date() } = {}) {
  const settingsRepository = require('../src/repositories/settingsRepository');
  const monthClosuresRepository = require('../src/repositories/monthClosuresRepository');
  const remoteRepo = require('../src/repositories/remoteWorkRepository');
  const svc = require('../src/services/remoteWorkAdminService');
  const auditRepository = require('../src/repositories/auditRepository');
  const zone = tz || settingsRepository.getTimezone() || 'Asia/Tehran';
  const out = [];
  for (const g of findLegacyGroups(db)) {
    const item = { group: g, status: 'skipped', reason: null, source: null, onsite: null, proposed: null, tz: zone };
    out.push(item);
    if (monthClosuresRepository.findClosedOverlapping(g.workDate, g.workDate).length > 0) { item.reason = 'ماهِ بسته‌شده؛ تغییر نمی‌کند'; continue; }
    const d = deriveOnsite(db, g, { overrides, tz: zone });
    item.source = d.source; item.onsite = d.onsite;
    if (!d.onsite) { item.reason = d.note; continue; }
    const bad = validate(g, d.onsite);
    if (bad) { item.reason = bad; continue; }
    item.beforeUseful = usefulMinutes(g.recordId);
    // پیش‌نمایش: همان منطقِ بازسازی، بدون نوشتن (در تراکنشِ برگشتی)
    const tx = db.transaction(() => {
      for (const id of g.sessionIds) remoteRepo.setOnsiteSpan(id, d.onsite.start, d.onsite.end);
      const r = svc.rebuildMergedRecord(g.recordId, d.onsite, remoteRepo.listApprovedForDay(g.userId, g.workDate));
      const br = db.prepare('SELECT start_time, end_time FROM break_records WHERE attendance_record_id = ? AND via_remote = 1 ORDER BY start_time').all(g.recordId);
      item.proposed = { checkIn: r.checkIn, checkOut: r.checkOut, remoteBreaks: br.map((b) => [b.start_time, b.end_time]) };
      item.afterUseful = usefulMinutes(g.recordId);
      if (!apply) throw new Error('__rollback__');
      auditRepository.logEvent({ userId: null, action: 'remote_work_merge_repaired', details: { userId: g.userId, workDate: g.workDate, recordId: g.recordId, sessionIds: g.sessionIds, onsite: d.onsite, source: d.source, before: { checkIn: g.recIn, checkOut: g.recOut }, after: { checkIn: r.checkIn, checkOut: r.checkOut }, at: now.toISOString() } });
    });
    try { tx(); item.status = 'applied'; } catch (e) { if (e.message !== '__rollback__') throw e; item.status = 'ready'; }
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const apply = args.includes('--apply');
  const overrides = new Map();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--onsite') {
      const o = parseOnsiteArg(args[i + 1]);
      if (!o) { console.error('قالب --onsite نادرست است؛ مثال: --onsite 57=07:44-15:00'); return 2; }
      overrides.set(o.id, o); i += 1;
    } else if (args[i] !== '--apply') { console.error(`آرگومان ناشناخته: ${args[i]}`); return 2; }
  }
  const results = run({ apply, overrides });
  const db = getDb();
  const nameOf = (id) => (db.prepare('SELECT full_name FROM users WHERE id = ?').get(id) || {}).full_name || `#${id}`;
  if (!results.length) { console.log('هیچ دورکاریِ ادغام‌شده‌ی قدیمی‌ای پیدا نشد؛ کاری لازم نیست.'); return 0; }
  for (const r of results) {
    const g = r.group; const hm = (iso) => isoToLocalHm(iso, r.tz);
    console.log(`\n▪ ${nameOf(g.userId)} — ${g.workDate} — نشست(ها): ${g.sessionIds.join(', ')}`);
    console.log(`  رکورد فعلی: ${hm(g.recIn)} تا ${hm(g.recOut)}`);
    if (r.onsite) console.log(`  بازه‌ی حضوریِ اصلی: ${hm(r.onsite.start)} تا ${hm(r.onsite.end)}  [${r.source}]`);
    if (r.proposed) {
      console.log(`  ${r.status === 'applied' ? 'اعمال شد' : 'پیشنهاد'}: رکورد ${hm(r.proposed.checkIn)} تا ${hm(r.proposed.checkOut)}؛ استراحت‌های دورکاری: ${r.proposed.remoteBreaks.length ? r.proposed.remoteBreaks.map((b) => `${hm(b[0])}–${hm(b[1])}`).join('، ') : 'ندارد'}`);
    }
    if (r.proposed) console.log(`  ساعت مفیدِ همان روز: قبل ${fmtMin(r.beforeUseful)} ← بعد ${fmtMin(r.afterUseful)}`);
    if (r.status === 'skipped') console.log(`  رد شد: ${r.reason}`);
  }
  const ready = results.filter((r) => r.status === 'ready').length;
  const applied = results.filter((r) => r.status === 'applied').length;
  console.log(`\nجمع: ${results.length} روز | ${apply ? `اعمال‌شده: ${applied}` : `آماده‌ی اعمال: ${ready}`} | ردشده: ${results.filter((r) => r.status === 'skipped').length}`);
  if (!apply && ready) console.log('برای اعمال: همین دستور را با --apply اجرا کنید (قبلش سرویس را خاموش و از دیتابیس بک‌آپ بگیرید).');
  return 0;
}

module.exports = { run, findLegacyGroups, deriveOnsite, parseOnsiteArg, localToIso };

if (require.main === module) {
  let code = 1;
  try { code = main(process.argv); } catch (err) { console.error('خطا:', err.message); } finally { closeDb(); }
  process.exit(code);
}
