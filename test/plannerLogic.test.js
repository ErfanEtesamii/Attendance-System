// C1 (فاز ۱۵): منطق خالصِ Planner + بررسی ایستای planner.css/index.html (سه بلوک تم، کنتراست، بدون منبع خارجی/inline، ARIA).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../public/js/planner.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

describe('منطق خالصِ Planner (C1)', () => {
  test('dayHue: هفت رنگ یکتا و چرخشی', () => {
    const hues = Array.from({ length: 7 }, (_, i) => P.dayHue(i));
    assert.deepEqual(hues.map((h) => h.n), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(new Set(hues.map((h) => h.cls)).size, 7);
    assert.equal(P.dayHue(7).cls, 'pl-day-1');
    assert.equal(P.dayHue(-1).cls, 'pl-day-7');
    assert.equal(P.dayHue(2).varName, '--pl-day-3');
  });

  test('statusMeta: برچسب فارسی + آیکون متنی + کلاس برای همه‌ی وضعیت‌ها؛ ناشناخته ⇒ در انتظار', () => {
    const want = { done: 'انجام شد', partial: 'نیمه‌کاره', not_done: 'انجام نشد', rescheduled: 'منتقل شد', dropped: 'حذف شد', pending: 'در انتظار' };
    for (const [k, label] of Object.entries(want)) {
      const m = P.statusMeta(k);
      assert.equal(m.label, label);
      assert.ok(m.icon && m.cls.startsWith('pl-st-'), k);
    }
    assert.equal(P.statusMeta('???').label, 'در انتظار');
    assert.equal(P.statusMeta('done').icon, '✓');
  });

  test('chipsFor: عادی/فوریِ مدیر/فوریِ خودم/سرپرست/سیستمی/منتقل‌شده/اختیاری/خارج از برنامه', () => {
    const labels = (t, ctx) => P.chipsFor(t, ctx).map((c) => c.label);
    assert.deepEqual(labels({ priority: 'high' }), ['اولویت بالا']);
    assert.deepEqual(labels({ priority: 'normal' }), ['اولویت معمولی']);
    assert.deepEqual(labels({ isUrgent: true, assignedByUserId: 9 }, { ownerUserId: 5 }), ['⚡ فوری']);
    assert.deepEqual(labels({ isUrgent: true, assignedByUserId: 5 }, { ownerUserId: 5 }), ['⚡ فوری (خودم)']);
    assert.deepEqual(labels({ isUrgent: true, selfAssigned: true }), ['⚡ فوری (خودم)']);
    assert.deepEqual(labels({ managerLocked: true, priority: 'normal' }), ['🔒 از طرف سرپرست', 'اولویت معمولی']);
    assert.deepEqual(labels({ isSystem: true, systemKey: 'review_team_reports' }), ['🔒 واجب']);
    assert.deepEqual(labels({ priority: 'low' }), ['اولویت پایین', 'اختیاری']);
    assert.deepEqual(labels({ outOfPlan: true, priority: 'normal' }), ['خارج از برنامه', 'اولویت معمولی']);
    assert.deepEqual(labels({ source: 'rescheduled', rescheduledFrom: '2026-08-01', priority: 'normal' }, { today: '2026-08-02' }), ['اولویت معمولی', '↪ از دیروز']);
    assert.deepEqual(labels({ source: 'rescheduled', rescheduledFrom: '2026-07-30', priority: 'normal' }, { today: '2026-08-02', fmtDate: (d) => `«${d}»` }), ['اولویت معمولی', '↪ از «2026-07-30»']);
    assert.deepEqual(labels({ carryCount: 2, priority: 'normal' }), ['اولویت معمولی', '↪ منتقل‌شده']);
    // همه‌ی چیپ‌ها متن دارند (فقط به رنگ متکی نیستند)
    for (const c of P.chipsFor({ isUrgent: true, managerLocked: true, priority: 'low', carryCount: 1 })) assert.ok(c.label.length > 2 && c.key && c.cls);
  });

  test('progressOf: سیستمی/خارج از برنامه/حذف‌شده نمی‌آید؛ نیمه‌کاره نیم‌امتیاز؛ خالی ⇒ percent=null', () => {
    assert.deepEqual(P.progressOf([]), { done: 0, total: 0, percent: null });
    const tasks = [
      { status: 'done' }, { status: 'partial' }, { status: 'pending' }, { status: 'rescheduled' },
      { status: 'dropped' }, { status: 'done', isSystem: true }, { status: 'done', outOfPlan: true },
    ];
    assert.deepEqual(P.progressOf(tasks), { done: 1, total: 4, percent: 38 });
    assert.equal(P.progressText({ done: 3, total: 7 }), '۳ از ۷ انجام شد');
    assert.equal(P.progressText({ done: 0, total: 0 }), '');
  });

  test('shiftDate / dayName', () => {
    assert.equal(P.shiftDate('2026-08-31', 1), '2026-09-01');
    assert.equal(P.shiftDate('2026-03-01', -1), '2026-02-28');
    assert.equal(P.dayName('2026-08-01'), 'شنبه');
    assert.equal(P.dayName('2026-08-07'), 'جمعه');
    assert.equal(P.dayName('bad'), '');
  });

  test('detailModel: مدل پایه (عنوان/توضیح/ردیف‌ها) با ctx.fmtDate', () => {
    const m = P.detailModel({ id: 1, title: 'عنوان', description: 'خط۱\nخط۲', priority: 'high', status: 'done', note: 'ok', answeredAt: '2026-08-02 10:00:00', canUndo: true, carryCount: 2 },
      { date: '2026-08-02', today: '2026-08-02', fmtDate: (d) => `<${d}>` });
    assert.equal(m.description, 'خط۱\nخط۲');
    const rows = Object.fromEntries(m.rows.map((r) => [r.key, r.value]));
    assert.equal(rows.priority, 'اولویت بالا');
    assert.equal(rows.date, 'یکشنبه <2026-08-02>');
    assert.equal(rows.source, 'برنامه‌ی خودم');
    assert.equal(rows.history, '۲ بار منتقل شده');
    assert.equal(m.noteEditable, true);
    assert.equal(m.status, 'done');
  });
});

describe('ایستا: planner.css و index.html (C1)', () => {
  const css = read('public/css/planner.css');
  const html = read('public/index.html');
  const pj = read('public/js/planner.js');

  const blockOf = (src, header) => {
    const i = src.indexOf(header);
    assert.ok(i >= 0, header);
    return src.slice(i, src.indexOf('\n}', i));
  };
  const dark = blockOf(css, ':root,\n:root[data-theme="dark"] {');
  const light = blockOf(css, ':root[data-theme="light"] {');
  const media = blockOf(css, '  :root:not([data-theme]) {');
  const names = [...dark.matchAll(/(--pl-[a-z0-9-]+):/g)].map((m) => m[1]);

  test('متغیرهای --pl-* (ink/line/accent/day-1..7 …) در هر سه بلوک تم تعریف شده‌اند', () => {
    for (const must of ['--pl-ink', '--pl-line', '--pl-accent', '--pl-title', '--pl-surface', '--pl-cutout', '--pl-done', ...[1, 2, 3, 4, 5, 6, 7].map((n) => `--pl-day-${n}`)]) {
      assert.ok(names.includes(must), `${must} در dark نیست`);
    }
    for (const n of names) {
      assert.ok(light.includes(`${n}:`), `${n} در light نیست`);
      assert.ok(media.includes(`${n}:`), `${n} در prefers-color-scheme نیست`);
    }
  });

  test('رنگ‌ها فقط با متغیر: هیچ رنگ hex/rgb خارج از سه بلوک تم نیست', () => {
    const outside = css.replace(dark, '').replace(light, '').replace(media, '');
    assert.doesNotMatch(outside, /#[0-9a-fA-F]{3,8}\b/);
    assert.doesNotMatch(outside, /rgba?\(/);
  });

  test('کلاس‌ها با پیشوند pl- و بدون URL/فونت/@import خارجی', () => {
    const selectors = [...css.matchAll(/^([.:][^{\n]+)\{/gm)].map((m) => m[1]).filter((s) => !s.startsWith(':root'));
    for (const s of selectors) assert.match(s, /\.pl-/, s);
    assert.doesNotMatch(css, /url\(|@import|@font-face|https?:\/\//i);
    assert.doesNotMatch(pj, /https?:\/\//);
  });

  test('کنتراست ≥ ۴٫۵ برای عنوان روز/متن/چیپ‌ها در هر دو تم', () => {
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const val = (block, n) => (block.match(new RegExp(`${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
    for (const [name, block] of [['dark', dark], ['light', light]]) {
      for (let n = 1; n <= 7; n += 1) {
        assert.ok(ratio(val(block, `--pl-day-${n}`), val(block, '--pl-cutout')) >= 4.5, `${name} day-${n} روی cutout`);
        assert.ok(ratio(val(block, `--pl-day-${n}`), val(block, '--pl-surface')) >= 4.5, `${name} day-${n} روی surface`);
      }
      assert.ok(ratio(val(block, '--pl-title'), val(block, '--pl-cutout')) >= 4.5, `${name} title`);
      assert.ok(ratio(val(block, '--pl-ink'), val(block, '--pl-surface')) >= 7, `${name} ink`);
      assert.ok(ratio(val(block, '--pl-muted'), val(block, '--pl-surface')) >= 4.5, `${name} muted`);
      assert.ok(ratio(val(block, '--pl-done-ink'), val(block, '--pl-done')) >= 4.5, `${name} done`);
    }
  });

  test('هدف لمسی ≥ ۴۴px برای چک‌باکس/ردیف/دکمه‌ها؛ :focus-visible؛ prefers-reduced-motion؛ unicode-bidi: isolate', () => {
    assert.match(css, /\.pl-check \{[^}]*width: 44px;[^}]*min-height: 44px/);
    assert.match(css, /\.pl-row \{[^}]*min-height: 44px/);
    assert.match(css, /\.pl-btn \{[^}]*min-height: 44px/);
    assert.match(css, /\.pl-seg button \{[^}]*min-height: 44px/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /unicode-bidi: isolate/);
    assert.match(css, /\.pl-day\.is-today \{ border-width: 4px/);
    assert.match(css, /text-decoration: line-through/);
  });

  test('index.html: planner.css لینک و planner.js قبل از app.js (بعد از dailyReport.js)', () => {
    assert.match(html, /<link rel="stylesheet" href="\/css\/planner\.css" \/>/);
    const a = html.indexOf('/js/dailyReport.js'); const b = html.indexOf('/js/planner.js'); const c = html.indexOf('/js/app.js');
    assert.ok(a > -1 && a < b && b < c);
  });
});

describe('Planner: «امروزِ من» و انتقال (D1/D2)', () => {
  const P = require('../public/js/planner.js');
  test('myDayModel: pending/done/other، وضعیت rescheduled/dropped، canUndo، progress سرور', () => {
    const m = P.myDayModel({ date: '2027-05-06', today: '2027-05-06', nextWorkingDay: '2027-05-08', taskCarryMaxTimes: 2, progress: { done: 1, total: 3, percent: 33 },
      tasks: [{ id: 1, title: 'الف' }],
      answered: [{ taskId: 2, title: 'ب', status: 'done', note: 'ن', canUndo: true }, { taskId: 3, title: 'ج', status: 'partial', rescheduleTo: '2027-05-08' }, { taskId: 4, title: 'د', status: 'not_done', rescheduleTo: 'drop', dropped: true }, { taskId: 5, title: 'ه', status: 'done', canUndo: false, systemKey: 'review_team_reports', isSystem: true }] });
    assert.deepEqual(m.pending.map((t) => [t.id, t.status]), [[1, 'pending']]);
    assert.deepEqual(m.done.map((t) => t.id), [2, 5]);
    assert.deepEqual(m.other.map((t) => [t.id, t.status]), [[3, 'rescheduled'], [4, 'dropped']]);
    assert.equal(m.done[1].canUndo, false);
    assert.equal(m.carryMax, 2);
    assert.deepEqual(m.progress, { done: 1, total: 3, percent: 33 });
    assert.equal(P.findInModel(m, 3).id, 3);
    assert.equal(P.findInModel(m, 99), null);
    assert.equal(P.myDayModel(null).pending.length, 0);
  });
  test('moveOptions: فقط فردا و تاریخ مشخص (هرگز drop)؛ moveWarning فقط برای روز شناخته‌شده‌ی غیرکاری؛ movedText', () => {
    assert.deepEqual(P.moveOptions({ isUrgent: true }, { nextWorkingDay: '2027-05-08', fmtDate: (d) => `[${d}]` }).map((o) => [o.value, o.label]), [['tomorrow', 'فردا (روز کاریِ بعدی: [2027-05-08])'], ['date', 'تاریخ مشخص…']]);
    assert.equal(P.moveOptions({}).some((o) => o.value === 'drop'), false);
    assert.equal(P.moveWarning('2027-05-07', { isWorkingDay: true }), '');
    assert.equal(P.moveWarning('2027-05-07', null), '');
    assert.match(P.moveWarning('2027-05-07', { isWorkingDay: false, kind: 'weekend' }), /آخر هفته/);
    assert.match(P.movedText('الف', '2027-05-08'), /«الف» به شنبه 2027-05-08 منتقل شد/);
  });
  test('detailModel: سقف انتقال (ctx.carryMax) ⇒ move غیرفعال با علت؛ زیر سقف/بدون سقف ⇒ فعال', () => {
    const t = { id: 1, title: 'x', status: 'pending', carryCount: 2 };
    assert.equal(P.detailModel(t, { date: '2027-05-06', today: '2027-05-06', carryMax: 2 }).actions.move.enabled, false);
    assert.match(P.detailModel(t, { carryMax: 2 }).actions.move.reason, /سقف انتقال/);
    assert.equal(P.detailModel(t, { carryMax: 3 }).actions.move.enabled, true);
    assert.equal(P.detailModel(t, {}).actions.move.enabled, true);
  });
});
