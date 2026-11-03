// ابزارهای تکمیلی ایجنت: رکوردهای تردد/استراحت، دورکاری، تسک‌ها، مرخصی، اعتراض، اضافه‌کاری، شیفت/تعطیلات، رویدادهای مشکوک.
//
// قراردادها (همان قراردادهای tools.js):
//   • فقط‌خواندنی (فقط SELECT) و محدود به کاربران قابل‌دسترسِ پرسنده (userFilter ⇒ visibleUsers/canAccessUser).
//   • فقط ابزار payroll_summary به حقوق/نرخ ساعتی دسترسی دارد (مجوز payroll.read = فقط admin، قابل‌خاموش با AI_ALLOW_PAYROLL=false، و هر بار در audit
//     ثبت می‌شود). بقیه‌ی ابزارها هیچ ستون مالی نمی‌خوانند و stripFinancial هم روی خروجی‌شان اجرا می‌شود.
//   • خروجی فشرده است (سقف توکن سرویس‌های رایگان کم است): خلاصه‌ی تجمیعی + حداکثر چند ردیف، متن‌های آزاد کوتاه‌شده.
//   • ورودی از مدل می‌آید ⇒ تاریخ/عدد اعتبارسنجی می‌شود؛ کوئری‌ها پارامتری‌اند.

const { getDb } = require('../../db/connection');
const config = require('../../config');
const perf = require('../performanceService');
const panelGuide = require('./panelGuide');
const auditRepository = require('../../repositories/auditRepository');
const settingsRepository = require('../../repositories/settingsRepository');
const { formatTime } = require('../../utils/time');
const { jalaliMonthRangeOf } = require('../../utils/jalali');

const MAX_DAYS = 93;
const MAX_ROWS = 40;
const cut = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const minutesBetween = (a, b) => { if (!a || !b) return null; const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return Number.isFinite(m) && m >= 0 ? m : null; };
const hm = (iso, tz) => { if (!iso) return null; try { return formatTime(iso, tz); } catch (_) { return null; } };
const marks = (n) => Array.from({ length: n }, () => '?').join(',');
const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length) : null);
const hhmmToMin = (s) => { const m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const minToHhmm = (m) => (m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);

function build({ need, userFilter, ToolError, today, shiftIso, DATE_RE, getTimezone }) {
  const tz = () => getTimezone();

  function dateRange(input) {
    for (const k of ['from', 'to']) if (input[k] !== undefined && !DATE_RE.test(String(input[k]))) throw new ToolError(`${k} باید YYYY-MM-DD (میلادی) باشد.`);
    const to = input.to || today();
    const from = input.from || shiftIso(to, -29);
    if (from > to) throw new ToolError('from نباید بعد از to باشد.');
    if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > (MAX_DAYS - 1) * 86400000) throw new ToolError(`بازه حداکثر ${MAX_DAYS} روز است؛ کوتاه‌ترش کنید.`);
    return { from, to };
  }
  const nameMap = (users) => new Map(users.map((u) => [u.id, u.full_name]));
  const SCOPE = {
    userId: { type: 'integer', description: 'شناسه‌ی یک کارمند (از list_employees)' },
    department: { type: 'string', description: 'فقط یک دپارتمان' },
  };
  const RANGE = {
    from: { type: 'string', description: 'شروع (میلادی YYYY-MM-DD؛ پیش‌فرض ۳۰ روز قبل از to)' },
    to: { type: 'string', description: 'پایان (میلادی YYYY-MM-DD؛ پیش‌فرض امروز)' },
  };

  return [
    // ---------- راهنمای پنل: «فلان چیز کجاست؟» ----------
    {
      name: 'panel_guide',
      description: 'راهنمای پنل: هر صفحه/قابلیت کجاست (مسیر منو)، چه کاری می‌کند، چه نقش‌هایی دسترسی دارند و مراحل انجام کار. query فارسی بدهید؛ بدون query فهرست منو.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'کلمات کلیدی فارسی، مثل «افزودن کارمند» یا «نرخ ساعتی»' } } },
      run(ctx, input) {
        return panelGuide.search(typeof input.query === 'string' ? input.query.slice(0, 120) : '');
      },
    },

    // ---------- تردد و استراحت ----------
    {
      name: 'attendance_log',
      description: 'رکوردهای تردد (ورود/خروج، ساعت کارکرد، استراحت) در یک بازه. با userId: ریز روزبه‌روز؛ بدون userId: خلاصه‌ی هر کارمند.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const db = getDb();
        const recs = db.prepare(`SELECT id, user_id, record_date, check_in_time, check_out_time, status, via_remote FROM attendance_records WHERE user_id IN (${marks(ids.length)}) AND record_date BETWEEN ? AND ? ORDER BY record_date`).all(...ids, from, to);
        const brk = new Map();
        if (recs.length) {
          const rids = recs.map((r) => r.id);
          for (const b of db.prepare(`SELECT attendance_record_id AS rid, start_time, end_time FROM break_records WHERE attendance_record_id IN (${marks(rids.length)})`).all(...rids)) {
            const m = minutesBetween(b.start_time, b.end_time);
            if (m != null) brk.set(b.rid, (brk.get(b.rid) || 0) + m);
          }
        }
        const zone = tz();
        const rows = recs.map((r) => {
          const span = minutesBetween(r.check_in_time, r.check_out_time);
          const b = brk.get(r.id) || 0;
          return { userId: r.user_id, date: r.record_date, status: r.status, in: hm(r.check_in_time, zone), out: hm(r.check_out_time, zone), breakMin: b, workedMin: span == null ? null : Math.max(0, span - b), remote: r.via_remote === 1 };
        });
        if (input.userId !== undefined && input.userId !== null) {
          const truncated = rows.length > MAX_DAYS;
          return { from, to, employee: users[0].full_name, days: rows.length, truncated, records: rows.map(({ userId, ...r }) => r) };
        }
        const names = nameMap(users);
        const per = new Map();
        for (const r of rows) {
          const p = per.get(r.userId) || { name: names.get(r.userId), days: 0, late: 0, incomplete: 0, leave: 0, ins: [], outs: [], worked: 0 };
          p.days += 1;
          if (r.status === 'late') p.late += 1; else if (r.status === 'incomplete') p.incomplete += 1; else if (r.status === 'leave') p.leave += 1;
          const i = hhmmToMin(r.in); const o = hhmmToMin(r.out);
          if (i != null) p.ins.push(i);
          if (o != null) p.outs.push(o);
          p.worked += r.workedMin || 0;
          per.set(r.userId, p);
        }
        const list = [...per.entries()].map(([userId, p]) => ({ userId, name: p.name, days: p.days, lateDays: p.late, incompleteDays: p.incomplete, leaveDays: p.leave, avgIn: minToHhmm(avg(p.ins)), avgOut: minToHhmm(avg(p.outs)), workedHours: Math.round((p.worked / 60) * 10) / 10 }));
        list.sort((a, b) => b.lateDays - a.lateDays || b.days - a.days);
        return { from, to, employees: list.length, truncated: list.length > MAX_ROWS, summary: list.slice(0, MAX_ROWS) };
      },
    },
    {
      name: 'remote_work',
      description: 'جلسه‌های دورکاری (شروع/پایان، وضعیت تأیید، مدت) در یک بازه.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE, status: { type: 'string', enum: ['pending', 'approved', 'rejected'] } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const st = ['pending', 'approved', 'rejected'].includes(input.status) ? input.status : null;
        const rows = getDb().prepare(`SELECT user_id, work_date, start_at, end_at, status, approved_start_at, approved_end_at, auto_closed FROM remote_work_sessions WHERE user_id IN (${marks(ids.length)}) AND work_date BETWEEN ? AND ?${st ? ' AND status = ?' : ''} ORDER BY work_date DESC, start_at DESC`).all(...ids, from, to, ...(st ? [st] : []));
        const names = nameMap(users); const zone = tz();
        const byStatus = {}; let approvedMin = 0;
        for (const r of rows) {
          byStatus[r.status] = (byStatus[r.status] || 0) + 1;
          if (r.status === 'approved') approvedMin += minutesBetween(r.approved_start_at || r.start_at, r.approved_end_at || r.end_at) || 0;
        }
        return {
          from, to, sessions: rows.length, byStatus, approvedHours: Math.round((approvedMin / 60) * 10) / 10, truncated: rows.length > MAX_ROWS,
          rows: rows.slice(0, MAX_ROWS).map((r) => ({ name: names.get(r.user_id), date: r.work_date, start: hm(r.start_at, zone), end: hm(r.end_at, zone), status: r.status, minutes: minutesBetween(r.start_at, r.end_at), autoClosed: r.auto_closed === 1 })),
        };
      },
    },

    // ---------- تسک‌ها ----------
    {
      name: 'tasks_overview',
      description: 'تسک‌ها و برنامه‌ی هفتگی: تعداد تسک، انجام‌شده/نیمه/انجام‌نشده، دلایل، فوری‌ها، ثبت برنامه. با userId فهرست تسک‌ها هم می‌آید.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const db = getDb();
        const names = nameMap(users);
        const planned = db.prepare(`SELECT p.user_id AS uid, COUNT(*) AS n, SUM(t.is_urgent) AS urgent FROM plan_tasks t JOIN weekly_plans p ON p.id = t.plan_id WHERE p.user_id IN (${marks(ids.length)}) AND t.deleted_at IS NULL AND t.is_system = 0 AND t.planned_date BETWEEN ? AND ? GROUP BY p.user_id`).all(...ids, from, to);
        const logs = db.prepare(`SELECT user_id AS uid, status, COUNT(*) AS n, SUM(answered_late) AS late FROM task_daily_logs WHERE user_id IN (${marks(ids.length)}) AND log_date BETWEEN ? AND ? GROUP BY user_id, status`).all(...ids, from, to);
        const reasons = db.prepare(`SELECT reason_code AS code, COUNT(*) AS n FROM task_daily_logs WHERE user_id IN (${marks(ids.length)}) AND log_date BETWEEN ? AND ? AND status <> 'done' AND reason_code IS NOT NULL GROUP BY reason_code ORDER BY n DESC LIMIT 6`).all(...ids, from, to);
        const plans = db.prepare(`SELECT user_id AS uid, status, COUNT(*) AS n FROM weekly_plans WHERE user_id IN (${marks(ids.length)}) AND week_start_date BETWEEN ? AND ? GROUP BY user_id, status`).all(...ids, shiftIso(from, -6), to);
        const per = new Map();
        const row = (uid) => { if (!per.has(uid)) per.set(uid, { name: names.get(uid), planned: 0, urgent: 0, done: 0, partial: 0, notDone: 0, answeredLate: 0, plansSubmitted: 0, plansDraft: 0 }); return per.get(uid); };
        for (const r of planned) { const x = row(r.uid); x.planned = r.n; x.urgent = r.urgent || 0; }
        for (const r of logs) { const x = row(r.uid); if (r.status === 'done') x.done = r.n; else if (r.status === 'partial') x.partial = r.n; else x.notDone = r.n; x.answeredLate += r.late || 0; }
        for (const r of plans) { const x = row(r.uid); if (r.status === 'submitted') x.plansSubmitted = r.n; else x.plansDraft = r.n; }
        const list = [...per.entries()].map(([userId, x]) => ({ userId, ...x, doneRate: x.done + x.partial + x.notDone ? Math.round((x.done / (x.done + x.partial + x.notDone)) * 100) : null }));
        list.sort((a, b) => (a.doneRate == null ? 101 : a.doneRate) - (b.doneRate == null ? 101 : b.doneRate));
        const out = { from, to, employees: list.length, topNotDoneReasons: reasons, truncated: list.length > MAX_ROWS, summary: list.slice(0, MAX_ROWS) };
        if (input.userId !== undefined && input.userId !== null) {
          out.tasks = db.prepare(`SELECT t.title, t.planned_date AS date, t.priority, t.is_urgent AS urgent, (SELECT l.status FROM task_daily_logs l WHERE l.task_id = t.id ORDER BY l.log_date DESC LIMIT 1) AS lastStatus, (SELECT l.reason_text FROM task_daily_logs l WHERE l.task_id = t.id AND l.status <> 'done' ORDER BY l.log_date DESC LIMIT 1) AS reason FROM plan_tasks t JOIN weekly_plans p ON p.id = t.plan_id WHERE p.user_id = ? AND t.deleted_at IS NULL AND t.is_system = 0 AND t.planned_date BETWEEN ? AND ? ORDER BY t.planned_date LIMIT ${MAX_ROWS}`).all(input.userId, from, to)
            .map((t) => ({ title: cut(t.title, 60), date: t.date, priority: t.priority, urgent: t.urgent === 1, lastStatus: t.lastStatus || 'بدون پاسخ', reason: t.reason ? cut(t.reason, 60) : undefined }));
        }
        return out;
      },
    },

    // ---------- مرخصی ----------
    {
      name: 'leave_requests',
      description: 'درخواست‌های مرخصی/مأموریت که با بازه تداخل دارند (نوع، تاریخ، وضعیت، مدت) و خلاصه‌ی وضعیت. با userId و year (شمسی) مانده‌ی مرخصی هم می‌آید.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE, status: { type: 'string', enum: ['pending', 'approved', 'rejected'] }, year: { type: 'integer', description: 'سال شمسی برای مانده‌ی مرخصی (با userId)' } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const st = ['pending', 'approved', 'rejected'].includes(input.status) ? input.status : null;
        const db = getDb();
        const rows = db.prepare(`SELECT r.user_id, r.start_date, r.end_date, r.status, r.unit, r.duration_minutes, r.leave_type AS kind, t.title AS type, r.reason, r.rejected_reason FROM leave_requests r JOIN leave_types t ON t.id = r.leave_type_id WHERE r.user_id IN (${marks(ids.length)}) AND r.start_date <= ? AND r.end_date >= ?${st ? ' AND r.status = ?' : ''} ORDER BY r.start_date DESC`).all(...ids, to, from, ...(st ? [st] : []));
        const names = nameMap(users); const byStatus = {}; const byType = {};
        for (const r of rows) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; if (r.status === 'approved') byType[r.type] = (byType[r.type] || 0) + (r.duration_minutes || 0); }
        const out = {
          from, to, requests: rows.length, byStatus, approvedMinutesByType: byType, truncated: rows.length > MAX_ROWS,
          rows: rows.slice(0, MAX_ROWS).map((r) => ({ name: names.get(r.user_id), type: r.type, kind: r.kind, from: r.start_date, to: r.end_date, unit: r.unit, minutes: r.duration_minutes, status: r.status, reason: r.reason ? cut(r.reason, 50) : undefined, rejectedReason: r.rejected_reason ? cut(r.rejected_reason, 50) : undefined })),
        };
        if (input.userId !== undefined && input.userId !== null && Number.isInteger(input.year)) {
          let yr;
          try { yr = { from: jalaliMonthRangeOf(input.year, 1).from, to: jalaliMonthRangeOf(input.year, 12).to }; } catch (_) { throw new ToolError('year نامعتبر است.'); }
          out.balances = db.prepare(`SELECT t.title AS type, b.entitled_minutes AS entitled, b.carried_over_minutes AS carried,
              COALESCE((SELECT SUM(a.minutes) FROM leave_balance_adjustments a WHERE a.user_id = b.user_id AND a.leave_type_id = b.leave_type_id AND a.jalali_year = b.jalali_year), 0) AS adjustments,
              COALESCE((SELECT SUM(r.duration_minutes) FROM leave_requests r WHERE r.user_id = b.user_id AND r.leave_type_id = b.leave_type_id AND r.status = 'approved' AND r.start_date BETWEEN ? AND ?), 0) AS used
            FROM leave_balances b JOIN leave_types t ON t.id = b.leave_type_id WHERE b.user_id = ? AND b.jalali_year = ?`).all(yr.from, yr.to, input.userId, input.year)
            .map((b) => ({ type: b.type, entitledMin: b.entitled, carriedMin: b.carried, adjustmentsMin: b.adjustments, usedMin: b.used, remainingMin: b.entitled + b.carried + b.adjustments - b.used }));
        }
        return out;
      },
    },

    // ---------- اعتراض‌ها ----------
    {
      name: 'disputes',
      description: 'اعتراض‌های کارمندان به رکورد تردد: تعداد باز/بسته، متن اعتراض، زمان ثبت و بستن.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE, status: { type: 'string', enum: ['open', 'resolved'] } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const st = ['open', 'resolved'].includes(input.status) ? input.status : null;
        const rows = getDb().prepare(`SELECT d.user_id, d.message, d.status, d.created_at, d.closed_at, d.closed_by, d.reopen_count, a.record_date FROM record_disputes d LEFT JOIN attendance_records a ON a.id = d.attendance_record_id WHERE d.user_id IN (${marks(ids.length)}) AND substr(d.created_at, 1, 10) BETWEEN ? AND ?${st ? ' AND d.status = ?' : ''} ORDER BY d.created_at DESC`).all(...ids, from, to, ...(st ? [st] : []));
        const names = nameMap(users); const byStatus = {}; const hours = [];
        for (const r of rows) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; if (r.closed_at) { const m = minutesBetween(r.created_at.replace(' ', 'T') + 'Z', r.closed_at.replace(' ', 'T') + 'Z'); if (m != null) hours.push(m / 60); } }
        return {
          from, to, disputes: rows.length, byStatus, avgResolutionHours: hours.length ? Math.round((hours.reduce((s, x) => s + x, 0) / hours.length) * 10) / 10 : null, truncated: rows.length > MAX_ROWS,
          rows: rows.slice(0, MAX_ROWS).map((r) => ({ name: names.get(r.user_id), recordDate: r.record_date, message: cut(r.message, 100), status: r.status, createdAt: r.created_at, closedAt: r.closed_at || undefined, reopened: r.reopen_count || 0 })),
        };
      },
    },

    // ---------- اضافه‌کاری ----------
    {
      name: 'overtime_decisions',
      description: 'تصمیم‌های اضافه‌کاری (تأیید/رد) روی رکوردهای تردد در یک بازه، با دلیل.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE, status: { type: 'string', enum: ['approved', 'rejected'] } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const st = ['approved', 'rejected'].includes(input.status) ? input.status : null;
        const rows = getDb().prepare(`SELECT o.user_id, o.status, o.reason, a.record_date FROM overtime_approvals o JOIN attendance_records a ON a.id = o.attendance_record_id WHERE o.user_id IN (${marks(ids.length)}) AND a.record_date BETWEEN ? AND ?${st ? ' AND o.status = ?' : ''} ORDER BY a.record_date DESC`).all(...ids, from, to, ...(st ? [st] : []));
        const names = nameMap(users); const byStatus = {}; const perUser = {};
        for (const r of rows) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; const n = names.get(r.user_id); perUser[n] = (perUser[n] || 0) + 1; }
        return { from, to, decisions: rows.length, byStatus, perEmployee: Object.entries(perUser).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })), truncated: rows.length > MAX_ROWS, rows: rows.slice(0, MAX_ROWS).map((r) => ({ name: names.get(r.user_id), date: r.record_date, status: r.status, reason: r.reason ? cut(r.reason, 60) : undefined })) };
      },
    },

    // ---------- شیفت‌ها و تعطیلات ----------
    {
      name: 'shifts_holidays',
      description: 'شیفت‌های تعریف‌شده، شیفت فعلی یک کارمند (با userId)، تعطیلات و برنامه‌ی ویژه‌ی روزها (off/کاری) در یک بازه.',
      input_schema: { type: 'object', properties: { userId: SCOPE.userId, ...RANGE } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const db = getDb();
        const out = {
          from, to,
          shifts: db.prepare('SELECT name, start_time AS start, end_time AS end, grace_late_minutes AS graceLate, work_days AS workDays, overnight, is_untimed AS untimed, max_lunch_minutes AS maxLunch FROM work_shifts ORDER BY name LIMIT 20').all()
            .map((s) => ({ ...s, overnight: s.overnight === 1, untimed: s.untimed === 1 })),
          holidays: db.prepare('SELECT holiday_date AS date, title, kind, half_end_time AS halfEnd, department FROM holidays WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date LIMIT 40').all(from, to)
            .map((h) => ({ date: h.date, title: cut(h.title, 40), kind: h.kind, halfEnd: h.halfEnd || undefined, department: h.department || undefined })),
          note: 'workDays: کدهای هفته 0=یکشنبه … 6=شنبه',
        };
        if (input.userId !== undefined && input.userId !== null) {
          const [u] = userFilter(ctx, { userId: input.userId, includeInactive: true });
          out.employee = u.full_name;
          out.assignments = db.prepare('SELECT s.name AS shift, a.effective_from AS since FROM user_shift_assignments a LEFT JOIN work_shifts s ON s.id = a.shift_id WHERE a.user_id = ? ORDER BY a.effective_from DESC LIMIT 5').all(input.userId);
          out.currentShift = (db.prepare('SELECT s.name FROM users u LEFT JOIN work_shifts s ON s.id = u.shift_id WHERE u.id = ?').get(input.userId) || {}).name || null;
          out.daySchedules = db.prepare('SELECT schedule_date AS date, kind, start_time AS start, end_time AS end, note FROM user_day_schedules WHERE user_id = ? AND schedule_date BETWEEN ? AND ? ORDER BY schedule_date LIMIT 40').all(input.userId, from, to)
            .map((d) => ({ ...d, note: d.note ? cut(d.note, 40) : undefined }));
        }
        return out;
      },
    },

    // ---------- حقوق (فقط با payroll.read و AI_ALLOW_PAYROLL) ----------
    {
      name: 'payroll_summary',
      financial: true,
      description: 'Monthly payroll for a Jalali year/month: hourly rate (thousand toman/hour), useful and overtime minutes, amount (toman), previous month, department totals. With userId also daily breakdown. Sensitive: use only when the manager asks about pay.',
      input_schema: { type: 'object', properties: { year: { type: 'integer' }, month: { type: 'integer' }, ...SCOPE }, required: ['year', 'month'] },
      run(ctx, input) {
        need(ctx, 'payroll.read');
        if (!config.ai.allowPayroll) throw new ToolError('دسترسی ایجنت به حقوق در تنظیمات (AI_ALLOW_PAYROLL) غیرفعال است.');
        if (!Number.isInteger(input.year) || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) throw new ToolError('year و month (شمسی) لازم است.');
        const users = userFilter(ctx, input);
        const single = input.userId !== undefined && input.userId !== null;
        try { auditRepository.logEvent({ userId: ctx.adminUser.id, action: 'payroll_viewed', details: { target: single ? String(input.userId) : 'all', year: input.year, month: input.month, via: 'ai_agent' } }); } catch (_) { /* بهترین‌تلاش */ }
        let r;
        try { r = perf.monthlyPayrollCompared({ users, year: input.year, month: input.month, withDays: single }); } catch (err) { throw new ToolError(err && err.message ? err.message : 'محاسبه‌ی حقوق ممکن نشد.'); }
        const rows = r.rows.map((x) => ({
          userId: x.user.id, name: x.user.fullName || x.user.full_name, department: x.user.department || null,
          rateKt: x.rateKt, usefulHours: Math.round((x.usefulMinutes / 60) * 10) / 10, overtimeMin: x.overtimeMinutes, amountToman: x.amountToman,
          previousAmountToman: x.previousAmountToman, workedDays: x.workedDays, excludedDays: x.excludedDays.length, lateMin: x.lateMinutes, shortfallMin: x.shortfallMinutes,
          projectedAmountToman: x.projectedAmountToman,
          ...(single ? { days: (x.days || []).slice(0, 35).map((d) => ({ date: d.date, usefulMin: d.usefulMinutes, overtimeMin: d.overtimeMinutes, amountToman: d.amountToman, excluded: d.excluded || undefined })), excluded: x.excludedDays } : {}),
        })).sort((a, b) => (b.amountToman || 0) - (a.amountToman || 0));
        return { label: r.label, from: r.from, to: r.to, note: 'rateKt = هزار تومان در ساعت؛ amountToman = تومان. روزهای excluded (اعتراض باز/خروج ثبت‌نشده) در مبلغ نیامده‌اند.', totals: r.totals, departments: r.departments.slice(0, 15), employees: rows.length, truncated: rows.length > MAX_ROWS, rows: rows.slice(0, MAX_ROWS) };
      },
    },

    // ---------- ساختار سازمان ----------
    {
      name: 'org_overview',
      description: 'Organization structure: employees per department, roles, managers with team sizes, inactive count.',
      input_schema: { type: 'object', properties: {} },
      run(ctx) {
        need(ctx, 'performance.read');
        const users = userFilter(ctx, { includeInactive: true });
        const ids = users.map((u) => u.id);
        const rows = getDb().prepare(`SELECT id, full_name, department, role, manager_id, is_active FROM users WHERE id IN (${marks(ids.length)})`).all(...ids);
        const dep = {}; const role = {}; const team = new Map(); let inactive = 0;
        for (const u of rows) {
          if (!u.is_active) { inactive += 1; continue; }
          const d = u.department || 'بدون دپارتمان'; dep[d] = (dep[d] || 0) + 1; role[u.role] = (role[u.role] || 0) + 1;
          if (u.manager_id) team.set(u.manager_id, (team.get(u.manager_id) || 0) + 1);
        }
        const nm = new Map(rows.map((u) => [u.id, u.full_name]));
        return { active: rows.length - inactive, inactive, byDepartment: dep, byRole: role, managers: [...team.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, n]) => ({ userId: id, name: nm.get(id) || `#${id}`, teamSize: n })) };
      },
    },

    // ---------- تنظیمات پنل ----------
    {
      name: 'panel_settings',
      description: 'Company settings of the panel (work hours, overtime rules, leave rules, reminders, planning, patterns...). Optional group filter (workHours, calendar, overtime, leave, reminders, retention, monthClose, reportDelivery, patterns, planning, performance, disputes).',
      input_schema: { type: 'object', properties: { group: { type: 'string' } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const items = settingsRepository.getItems().filter((i) => i.group !== 'security' && i.group !== 'schedule' && (!input.group || i.group === input.group));
        return { count: items.length, truncated: items.length > 60, settings: items.slice(0, 60).map((i) => ({ group: i.group, key: i.key, value: i.value, default: i.isDefault ? undefined : i.default, what: cut(i.description, 70) })) };
      },
    },

    // ---------- لاگ تغییرات (audit) ----------
    {
      name: 'audit_trail',
      description: 'Recent admin/system actions (who did what, when) in a range, optionally filtered by actor userId or action text. Details truncated.',
      input_schema: { type: 'object', properties: { ...RANGE, userId: SCOPE.userId, action: { type: 'string' } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        if (ctx.adminUser.role !== 'admin' && ctx.adminUser.role !== 'hr') throw new ToolError('فقط admin/hr.');
        const { from, to } = dateRange(input);
        const conds = ['substr(occurred_at, 1, 10) BETWEEN ? AND ?']; const args = [from, to];
        if (Number.isInteger(input.userId)) { conds.push('user_id = ?'); args.push(input.userId); }
        if (input.action) { conds.push('action LIKE ?'); args.push(`%${String(input.action).slice(0, 40).replace(/[%_]/g, '')}%`); }
        const db = getDb();
        const rows = db.prepare(`SELECT user_id, action, occurred_at, details FROM audit_log WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args);
        const nm = new Map(db.prepare('SELECT id, full_name FROM users').all().map((u) => [u.id, u.full_name]));
        const byAction = {}; for (const r of rows) byAction[r.action] = (byAction[r.action] || 0) + 1;
        const FIN = /rate|amount|salary|payroll|earning/i;
        const scrub = (d) => { const s = cut(d, 140); return config.ai.allowPayroll || !FIN.test(s) ? s : '[مالی؛ حذف شد]'; };
        return { from, to, shown: Math.min(rows.length, MAX_ROWS), truncated: rows.length > MAX_ROWS, topActions: Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([action, n]) => ({ action, n })), rows: rows.slice(0, MAX_ROWS).map((r) => ({ at: r.occurred_at, who: r.user_id ? (nm.get(r.user_id) || `#${r.user_id}`) : 'سیستم', action: r.action, details: scrub(r.details) })) };
      },
    },

    // ---------- بستن ماه و سلامت سیستم ----------
    {
      name: 'system_status',
      description: 'Month closing status (recent Jalali months), failed background jobs, and firing monitor alerts.',
      input_schema: { type: 'object', properties: {} },
      run(ctx) {
        need(ctx, 'performance.read');
        const db = getDb();
        const nm = new Map(db.prepare('SELECT id, full_name FROM users').all().map((u) => [u.id, u.full_name]));
        return {
          monthClosures: db.prepare('SELECT jalali_year AS year, jalali_month AS month, status, closed_by, closed_at, close_note, reopen_reason FROM month_closures ORDER BY jalali_year DESC, jalali_month DESC LIMIT 12').all()
            .map((m) => ({ year: m.year, month: m.month, status: m.status, closedBy: nm.get(m.closed_by) || null, closedAt: m.closed_at, note: m.close_note ? cut(m.close_note, 60) : undefined, reopenReason: m.reopen_reason ? cut(m.reopen_reason, 60) : undefined })),
          failedJobs: db.prepare("SELECT job_name AS job, started_at AS at, status, error FROM job_runs WHERE status IN ('error', 'interrupted') ORDER BY id DESC LIMIT 8").all().map((j) => ({ job: j.job, at: j.at, status: j.status, error: j.error ? cut(j.error, 80) : undefined })),
          firingAlerts: db.prepare("SELECT alert_key AS alert, first_seen_at AS since, detail FROM monitor_alerts WHERE state = 'firing' LIMIT 10").all().map((a) => ({ alert: a.alert, since: a.since, detail: a.detail ? cut(a.detail, 80) : undefined })),
        };
      },
    },

    // ---------- اجازه‌ی ورود ----------
    {
      name: 'checkin_permissions',
      description: 'Late check-in permission requests (pending/approved/rejected/used/expired) in a range with reasons and decisions.',
      input_schema: { type: 'object', properties: { ...SCOPE, ...RANGE, status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'used', 'expired'] } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { ...input, includeInactive: true });
        const ids = users.map((u) => u.id);
        const st = ['pending', 'approved', 'rejected', 'used', 'expired'].includes(input.status) ? input.status : null;
        const rows = getDb().prepare(`SELECT user_id, permission_date, status, reason, decision_note FROM checkin_permissions WHERE user_id IN (${marks(ids.length)}) AND permission_date BETWEEN ? AND ?${st ? ' AND status = ?' : ''} ORDER BY permission_date DESC`).all(...ids, from, to, ...(st ? [st] : []));
        const names = nameMap(users); const byStatus = {}; const perUser = {};
        for (const r of rows) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; const n = names.get(r.user_id); perUser[n] = (perUser[n] || 0) + 1; }
        return { from, to, requests: rows.length, byStatus, topRequesters: Object.entries(perUser).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })), truncated: rows.length > MAX_ROWS, rows: rows.slice(0, MAX_ROWS).map((r) => ({ name: names.get(r.user_id), date: r.permission_date, status: r.status, reason: cut(r.reason, 60), decisionNote: r.decision_note ? cut(r.decision_note, 50) : undefined })) };
      },
    },

    // ---------- رویدادهای مشکوک ----------
    {
      name: 'suspicious_events',
      description: 'رویدادهای مشکوک ثبت‌شده توسط سیستم (مثل ورود/خروج هم‌زمان از یک IP یا تغییر ناگهانی دستگاه) با وضعیت بررسی.',
      input_schema: { type: 'object', properties: { ...RANGE, status: { type: 'string', enum: ['open', 'reviewed', 'ignored'] } } },
      run(ctx, input) {
        need(ctx, 'performance.read');
        const { from, to } = dateRange(input);
        const users = userFilter(ctx, { includeInactive: true });
        const names = nameMap(users);
        const st = ['open', 'reviewed', 'ignored'].includes(input.status) ? input.status : null;
        const rows = getDb().prepare(`SELECT event_type, user_ids, event_date, details, status FROM suspicious_events WHERE event_date BETWEEN ? AND ?${st ? ' AND status = ?' : ''} ORDER BY event_date DESC LIMIT 200`).all(from, to, ...(st ? [st] : []));
        const byType = {}; const byStatus = {}; const list = [];
        for (const r of rows) {
          let uids = [];
          try { uids = JSON.parse(r.user_ids || '[]'); } catch (_) { uids = []; }
          if (ctx.adminUser.role !== 'admin' && ctx.adminUser.role !== 'hr' && !uids.some((id) => names.has(id))) continue; // اسکوپ سرپرست
          byType[r.event_type] = (byType[r.event_type] || 0) + 1; byStatus[r.status] = (byStatus[r.status] || 0) + 1;
          if (list.length < MAX_ROWS) list.push({ type: r.event_type, date: r.event_date, status: r.status, employees: uids.map((id) => names.get(id) || `#${id}`), details: cut(r.details, 80) });
        }
        return { from, to, total: Object.values(byStatus).reduce((s, x) => s + x, 0), byType, byStatus, truncated: rows.length >= 200, rows: list };
      },
    },
  ];
}

module.exports = { build };
