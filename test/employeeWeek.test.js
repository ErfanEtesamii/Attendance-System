// F1-a/F1-b (فاز ۱۲): نمای هفتگی کارمند (حضور/تقویم + برنامه و تسک‌ها) — اسکوپ نقش، تعیین هفته/ناوبری، نوع روز، ساعت برنامه (شیفت/override)، حضور واقعی، غیبت، قفل ماه.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const svc = require('../src/services/employeeWeekService');
const shiftsRepo = require('../src/repositories/shiftsRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const scheduleRepo = require('../src/repositories/userDayScheduleRepository');
const plansRepo = require('../src/repositories/weeklyPlanRepository');
const logsRepo = require('../src/repositories/taskLogRepository');
const reviewsRepo = require('../src/repositories/reportReviewRepository');
const { summarizeWeek } = require('../src/services/employeeWeekSummary');
const { hasPermission } = require('../src/middleware/permissions');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser, makeApprovedMission } = require('./helpers/factories');

const iso = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();
const SAT = '2026-09-12'; // شنبه
const NEXT_SAT = '2026-09-19';

describe('نمای هفتگی کارمند (F1-a)', () => {
  let db; let admin; let hr; let mgr; let other; let emp; let outsider;

  before(() => {
    mock.timers.enable({ apis: ['Date'], now: new Date(`${NEXT_SAT}T08:00:00Z`) });
    db = resetDb();
    admin = makeUser({ role: 'admin' });
    hr = makeUser({ role: 'hr' });
    mgr = makeUser({ role: 'manager' });
    other = makeUser({ role: 'manager' });
    emp = makeUser({ managerId: mgr.id });
    outsider = makeUser({ managerId: other.id });
    const shift = shiftsRepo.createShift({ name: 'عصر', startTime: '15:30', endTime: '21:00', graceLateMinutes: 0, graceEarlyMinutes: 0, workDays: [6, 0, 1, 2, 3], overnight: false, maxLunchMinutes: 0, fixedLunchDeductMinutes: 0 });
    db.prepare('UPDATE users SET shift_id = ? WHERE id = ?').run(shift.id, emp.id);
    attendanceRepo.createManual({ userId: emp.id, recordDate: SAT, checkInTime: iso(SAT, '15:40'), checkOutTime: iso(SAT, '20:30'), status: 'late' });
    scheduleRepo.upsert({ userId: emp.id, date: '2026-09-13', kind: 'off', createdBy: admin.id }); // یکشنبه: آف
    makeApprovedMission(emp.id, '2026-09-14'); // دوشنبه: مأموریت
  });
  after(() => { mock.timers.reset(); cleanup(); });

  test('مجوز: کارمند ندارد؛ سرپرست/hr/ادمین دارند', () => {
    assert.equal(hasPermission('employee', 'team.week_view'), false);
    for (const r of ['manager', 'hr', 'admin']) assert.equal(hasPermission(r, 'team.week_view'), true);
  });

  test('اسکوپ: سرپرست فقط زیرمجموعه؛ کارمند ممنوع؛ کاربر ناموجود ۴۰۴؛ تاریخ بد ۴۰۰', () => {
    assert.equal(svc.getWeek(mgr, emp.id, { start: SAT }).ok, true);
    assert.equal(svc.getWeek(other, emp.id, { start: SAT }).status, 403);
    assert.equal(svc.getWeek(mgr, outsider.id, { start: SAT }).status, 403);
    assert.equal(svc.getWeek(emp, emp.id, { start: SAT }).status, 403);
    assert.equal(svc.getWeek(admin, emp.id, { start: SAT }).ok, true);
    assert.equal(svc.getWeek(hr, emp.id, { start: SAT }).ok, true);
    assert.equal(svc.getWeek(admin, 99999, {}).status, 404);
    assert.equal(svc.getWeek(admin, emp.id, { start: '2026-02-30' }).code, 'INVALID_DATE');
  });

  test('هفته: هر تاریخ داخل هفته به شنبه می‌رسد؛ ناوبری و هفته‌ی جاری', () => {
    const r = svc.getWeek(admin, emp.id, { start: '2026-09-16' });
    assert.equal(r.week.start, SAT);
    assert.equal(r.week.end, '2026-09-18');
    assert.equal(r.week.prevWeekStart, '2026-09-05');
    assert.equal(r.week.nextWeekStart, NEXT_SAT);
    assert.equal(r.week.isCurrentWeek, false);
    assert.equal(r.days.length, 7);
    const cur = svc.getWeek(admin, emp.id, {});
    assert.equal(cur.week.start, NEXT_SAT);
    assert.equal(cur.week.isCurrentWeek, true);
    assert.equal(cur.days[0].isToday, true);
    assert.equal(cur.days[1].isFuture, true);
  });

  test('روز با شیفت ۱۵:۳۰–۲۱:۰۰: ساعت برنامه و حضور واقعی (تأخیر ۱۰ و زودتر رفتن ۳۰)', () => {
    const d = svc.getWeek(admin, emp.id, { start: SAT }).days[0];
    assert.equal(d.kind, 'working');
    assert.deepEqual([d.schedule.start, d.schedule.end, d.schedule.plannedMinutes, d.schedule.shift.name], ['15:30', '21:00', 330, 'عصر']);
    assert.equal(d.attendance.hasCheckIn, true);
    assert.equal(d.attendance.lateMinutes, 10);
    assert.equal(d.attendance.earlyLeaveMinutes, 30);
    assert.equal(d.absent, false);
    assert.ok(d.jalali);
  });

  test('نوع روز: override آف، مأموریت، آخر هفته، غیبت، ماه بسته', () => {
    let days = svc.getWeek(admin, emp.id, { start: SAT }).days;
    assert.deepEqual([days[1].kind, days[1].override.kind, days[1].schedule.plannedMinutes], ['off', 'off', 0]);
    assert.deepEqual([days[2].kind, days[2].schedule.plannedMinutes], ['mission', 0]);
    assert.equal(days[6].kind, 'off'); // جمعه
    assert.equal(days[3].kind, 'working');
    assert.equal(days[3].absent, true, 'روز کاری گذشته بدون ورود');
    assert.equal(days[2].absent, false);
    assert.equal(days.some((x) => x.monthClosed), false);
    db.prepare("INSERT INTO month_closures (jalali_year, jalali_month, period_from, period_to, status, close_count) VALUES (1405, 6, '2026-09-01', '2026-09-30', 'closed', 1)").run();
    days = svc.getWeek(admin, emp.id, { start: SAT }).days;
    assert.equal(days.every((x) => x.monthClosed), true);
  });

  describe('برنامه و تسک‌ها (F1-b)', () => {
    let t1; let t2; let t3; let t4;
    before(() => {
      const plan = plansRepo.getOrCreate(emp.id, SAT);
      plansRepo.markSubmitted(plan.id);
      plansRepo.setSupervisorFeedback(plan.id, { seen: true, comment: 'برنامه خوب است' });
      t1 = plansRepo.addTask(plan.id, { title: 'گزارش فروش', plannedDate: SAT, priority: 'normal' });
      t2 = plansRepo.addTask(plan.id, { title: 'تماس با مشتری', plannedDate: SAT, priority: 'high' });
      t3 = plansRepo.addTask(plan.id, { title: 'تسک فوری', plannedDate: SAT, priority: 'high', isUrgent: true, assignedByUserId: mgr.id, urgentNote: 'امروز', urgentDeadlineTime: '18:00' });
      t4 = plansRepo.addTask(plan.id, { title: 'کار هرروزه', plannedDate: null });
      const gone = plansRepo.addTask(plan.id, { title: 'حذف‌شده', plannedDate: SAT });
      plansRepo.softDeleteTask(gone.id);
      logsRepo.upsert({ taskId: t1.id, userId: emp.id, logDate: SAT, status: 'done', answeredLate: true });
      logsRepo.upsert({ taskId: t2.id, userId: emp.id, logDate: SAT, status: 'not_done', reasonCode: 'no_time', reasonText: 'وقت نشد', rescheduleTo: '2026-09-15' });
      logsRepo.upsert({ taskId: t4.id, userId: emp.id, logDate: '2026-09-15', status: 'done' });
      reviewsRepo.upsert({ reviewerId: mgr.id, subjectUserId: emp.id, reportDate: SAT, comment: 'آفرین', reaction: 'good' });
    });

    test('برنامه‌ی هفته: وضعیت، نظر سرپرست؛ هفته‌ی بدون برنامه ⇒ plan=null و روزها بدون تسک', () => {
      const r = svc.getWeek(admin, emp.id, { start: SAT });
      assert.deepEqual([r.plan.status, r.plan.supervisorComment], ['submitted', 'برنامه خوب است']);
      assert.ok(r.plan.supervisorSeenAt);
      const none = svc.getWeek(admin, emp.id, { start: '2026-08-29' });
      assert.equal(none.plan, null);
      assert.ok(none.days.every((d) => d.tasks.length === 0 && d.review.reviewed === false));
    });

    test('تسک‌های روز: فوری اول، اولویت، وضعیت/علت/انتقال/پاسخ دیرهنگام، بی‌پاسخ، حذف‌شده نیست', () => {
      const d = svc.getWeek(admin, emp.id, { start: SAT }).days[0];
      assert.deepEqual(d.tasks.map((t) => t.title), ['تسک فوری', 'تماس با مشتری', 'گزارش فروش', 'کار هرروزه']);
      const by = (title) => d.tasks.find((t) => t.title === title);
      assert.deepEqual([by('تسک فوری').isUrgent, by('تسک فوری').assignedBy, by('تسک فوری').urgentDeadlineTime, by('تسک فوری').status], [true, mgr.full_name, '18:00', 'no_answer']);
      assert.deepEqual([by('گزارش فروش').status, by('گزارش فروش').answeredLate, by('گزارش فروش').source], ['done', true, 'planned']);
      assert.deepEqual([by('تماس با مشتری').status, by('تماس با مشتری').reasonCode, by('تماس با مشتری').reasonText, by('تماس با مشتری').rescheduleTo], ['not_done', 'no_time', 'وقت نشد', '2026-09-15']);
      assert.deepEqual([by('کار هرروزه').source, by('کار هرروزه').status], ['everyday', 'no_answer']);
    });

    test('انتقال به روز دیگر، «هرروزه» تا انجام‌شدن، و روز غیرکاری بدون تسک هرروزه', () => {
      const days = svc.getWeek(admin, emp.id, { start: SAT }).days;
      const moved = days[3].tasks.find((t) => t.title === 'تماس با مشتری'); // سه‌شنبه ۲۰۲۶-۰۹-۱۵
      assert.deepEqual([moved.source, moved.status], ['rescheduled', 'no_answer']);
      assert.equal(days[3].tasks.find((t) => t.title === 'کار هرروزه').status, 'done');
      assert.equal(days[1].tasks.length, 0, 'یکشنبه آف است');
      assert.equal(days[4].tasks.some((t) => t.title === 'کار هرروزه'), false, 'بعد از done دیگر نمی‌آید');
    });

    test('«مشاهده شد» سرپرست روی روز', () => {
      const days = svc.getWeek(admin, emp.id, { start: SAT }).days;
      assert.equal(days[0].review.reviewed, true);
      assert.deepEqual([days[0].review.reviews[0].reviewerName, days[0].review.reviews[0].comment], [mgr.full_name, 'آفرین']);
      assert.equal(days[3].review.reviewed, false);
    });

    test('اسکوپ همچنان برقرار: سرپرستِ دیگر به تسک‌ها دسترسی ندارد', () => {
      assert.equal(svc.getWeek(other, emp.id, { start: SAT }).status, 403);
    });
  });

  describe('خلاصه‌ی عملکرد هفته (F1-c)', () => {
    test('اعداد مشخص روی هفته‌ی نمونه: تسک‌ها، درصد، تأخیر، ساعت، غیبت', () => {
      const s = svc.getWeek(admin, emp.id, { start: SAT }).summary;
      // شنبه: فوری(بی‌پاسخ) + تماس(انجام‌نشده، منتقل) + گزارش(done) + هرروزه(بی‌پاسخ)؛ سه‌شنبه: تماس منتقل‌شده(بی‌پاسخ) + هرروزه(done)
      assert.deepEqual(
        [s.tasks.total, s.tasks.done, s.tasks.partial, s.tasks.notDone, s.tasks.noAnswer, s.tasks.urgent, s.tasks.normal, s.tasks.rescheduled, s.tasks.completionPercent],
        [6, 2, 0, 1, 3, 1, 5, 1, 33],
      );
      assert.equal(s.attendance.lateDays, 1);
      assert.equal(s.attendance.absentDays, 2); // سه‌شنبه و چهارشنبه
      assert.equal(s.attendance.expectedMinutes, 990); // سه روز کاری × ۳۳۰
      assert.equal(s.attendance.usefulMinutes, 290); // ۱۵:۴۰ تا ۲۰:۳۰
      assert.equal(s.attendance.usefulPercent, 29);
      assert.equal(s.attendance.overtimeMinutes, 0);
      assert.match(s.formula, /0\.5/);
    });

    test('هفته‌ی بدون برنامه/حضور: درصدها null و شمارها صفر', () => {
      const s = svc.getWeek(admin, emp.id, { start: '2026-08-29' }).summary;
      assert.equal(s.tasks.total, 0);
      assert.equal(s.tasks.completionPercent, null);
      assert.equal(s.attendance.usefulMinutes, 0);
    });

    test('وزن‌دهی: partial=۰٫۵؛ سیستمی/خارج‌ازبرنامه/کنارگذاشته‌شده و بی‌پاسخِ امروز/آینده شمرده نمی‌شود؛ روز بدون گزارش', () => {
      const T = (o) => ({ taskId: 1, isSystem: false, outOfPlan: false, dropped: false, isUrgent: false, rescheduleTo: null, ...o });
      const days = [
        { date: '2026-09-12', kind: 'working', absent: false, monthClosed: true, schedule: { plannedMinutes: 100 }, attendance: { hasCheckIn: true, lateMinutes: 0, effectiveMinutes: 90, overtimeMinutes: 5, breakPaidMinutes: 15, breakUnpaidMinutes: 10 },
          tasks: [T({ status: 'done' }), T({ status: 'partial' }), T({ status: 'not_done', isUrgent: true }), T({ status: 'done', isSystem: true }), T({ status: 'done', outOfPlan: true }), T({ status: 'not_done', dropped: true })] },
        { date: '2026-09-13', kind: 'working', absent: false, monthClosed: false, schedule: { plannedMinutes: 100 }, attendance: { hasCheckIn: true, lateMinutes: 4, effectiveMinutes: 100 }, tasks: [] },
        { date: '2026-09-14', kind: 'working', absent: false, monthClosed: false, schedule: { plannedMinutes: 100 }, attendance: { hasCheckIn: true, lateMinutes: 0, effectiveMinutes: 50 }, tasks: [T({ status: 'no_answer' })] },
        { date: '2026-09-15', kind: 'working', absent: false, monthClosed: false, schedule: { plannedMinutes: 100 }, attendance: null, tasks: [T({ status: 'no_answer' })] },
      ];
      const s = summarizeWeek(days, '2026-09-14');
      assert.deepEqual([s.tasks.total, s.tasks.done, s.tasks.partial, s.tasks.notDone, s.tasks.urgent, s.tasks.extra, s.tasks.dropped], [3, 1, 1, 1, 1, 1, 1]);
      assert.equal(s.tasks.completionPercent, 50); // (1 + 0.5) / 3
      assert.equal(s.attendance.lateDays, 1);
      assert.equal(s.attendance.noReportDays, 1, 'فقط ۱۳ام (گذشته، حاضر، بدون پاسخ)');
      assert.deepEqual([s.attendance.expectedMinutes, s.attendance.usefulMinutes, s.attendance.overtimeMinutes, s.attendance.breakPaidMinutes, s.attendance.breakUnpaidMinutes], [300, 240, 5, 15, 10]);
      assert.deepEqual([s.closed.days, s.closed.allClosed, s.closed.partlyClosed], [1, false, true]);
    });

    test('روی هفته‌ی ماه بسته‌شده هم محاسبه و فقط‌خواندنی است', () => {
      const r = svc.getWeek(admin, emp.id, { start: SAT });
      assert.equal(r.readOnly, true);
      assert.ok(r.summary.tasks.total > 0);
    });
  });
});
