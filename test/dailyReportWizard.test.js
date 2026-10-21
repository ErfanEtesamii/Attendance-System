// D7-ب: منطق خالصِ ویزارد گزارش روزانه (public/js/dailyReport.js) + بررسی ساختاری/دسترس‌پذیری Mini App.
// (DOM واقعی در تست نیست؛ جریانِ کامل در docs/DOCUMENTATION.md دستی چک می‌شود.)
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DR = require('../public/js/dailyReport.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const T = '2026-08-03';

describe('منطق ویزارد گزارش روزانه', () => {
  test('کدهای علت با REASON_CODES سرور یکی است', () => {
    const server = require('../src/services/taskReportService').REASON_CODES;
    assert.deepEqual(DR.REASONS.map((r) => r.value), server);
    assert.deepEqual(DR.STATUS.map((s) => s.value), ['done', 'partial', 'not_done']);
  });

  test('validateAnswer: وضعیت/علت/«سایر» ≥ ۵ نویسه/انتقال', () => {
    const ok = { status: 'not_done', reasonCode: 'no_time', reasonText: '', resType: 'tomorrow', resDate: '' };
    assert.ok(DR.validateAnswer(DR.emptyAnswer()));
    assert.equal(DR.validateAnswer({ status: 'done' }), '');
    assert.equal(DR.validateAnswer(ok), '');
    assert.ok(DR.validateAnswer({ ...ok, reasonCode: '' }));
    assert.ok(DR.validateAnswer({ ...ok, reasonCode: 'other', reasonText: 'abcd' }));
    assert.ok(DR.validateAnswer({ ...ok, reasonCode: 'other', reasonText: '  abcd   ' })); // فاصله‌ها حساب نمی‌شود
    assert.equal(DR.validateAnswer({ ...ok, reasonCode: 'other', reasonText: 'پنج نویسه' }), '');
    assert.ok(DR.validateAnswer({ ...ok, reasonText: 'x'.repeat(301) }));
    assert.ok(DR.validateAnswer({ ...ok, resType: 'date', resDate: '' }, { today: T }));
    assert.ok(DR.validateAnswer({ ...ok, resType: 'date', resDate: T }, { today: T })); // امروز آینده نیست
    assert.equal(DR.validateAnswer({ ...ok, resType: 'date', resDate: '2026-08-05' }, { today: T }), '');
    assert.equal(DR.validateAnswer({ ...ok, resType: 'drop' }), '');
  });

  test('toApiAnswer: شکل دقیقِ API', () => {
    assert.deepEqual(DR.toApiAnswer(7, { status: 'done', reasonCode: 'no_time' }), { taskId: 7, status: 'done' });
    assert.deepEqual(DR.toApiAnswer(7, { status: 'partial', reasonCode: 'other', reasonText: ' نیاز  به بررسی ', resType: 'tomorrow' }),
      { taskId: 7, status: 'partial', reasonCode: 'other', reasonText: 'نیاز به بررسی', reschedule: { type: 'tomorrow' } });
    assert.deepEqual(DR.toApiAnswer(7, { status: 'not_done', reasonCode: 'no_time', reasonText: '', resType: 'date', resDate: '2026-08-09' }),
      { taskId: 7, status: 'not_done', reasonCode: 'no_time', reschedule: { type: 'date', date: '2026-08-09' } });
    assert.equal(DR.toApiAnswer(7, { status: 'not_done', reasonCode: 'no_time', resType: 'drop' }).reschedule.type, 'drop');
  });

  test('buildBody: فقط پاسخ‌های معتبر و extraهای پر؛ date فقط در حالت دیرهنگام', () => {
    const tasks = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const answers = new Map([[1, { status: 'done' }], [2, { status: 'not_done', reasonCode: '', resType: 'tomorrow' }]]);
    const extras = [{ title: ' جلسه ', description: '' }, { title: '', description: '' }, { title: 'x'.repeat(121) }];
    const b = DR.buildBody({ tasks, answers, extras }, { today: T });
    assert.deepEqual(b, { answers: [{ taskId: 1, status: 'done' }], extra: [{ title: 'جلسه' }] });
    assert.equal(DR.buildBody({ tasks, answers: {}, extras: [], date: '2026-08-02' }).date, '2026-08-02');
    assert.deepEqual(DR.unanswered(tasks, answers).map((t) => t.id), [2, 3]);
    assert.deepEqual(DR.summarize(tasks, answers), { done: 1, partial: 0, not_done: 1, missing: 1 });
  });

  test('validateExtra: عنوان الزامی و سقف‌ها', () => {
    assert.ok(DR.validateExtra({ title: ' ' }));
    assert.ok(DR.validateExtra({ title: 'x'.repeat(121) }));
    assert.ok(DR.validateExtra({ title: 'ok', description: 'y'.repeat(501) }));
    assert.equal(DR.validateExtra({ title: 'ok' }), '');
  });

  test('seedFromBody: بعد از 409 گیت برنامه، پاسخ‌های ارسال‌نشده حفظ می‌شود (رفت‌وبرگشت با buildBody)', () => {
    const tasks = [{ id: 1 }, { id: 2 }];
    const a = new Map([[1, { status: 'not_done', reasonCode: 'other', reasonText: 'علت مفصل', resType: 'date', resDate: '2026-08-09' }], [2, { status: 'done' }]]);
    const body = DR.buildBody({ tasks, answers: a, extras: [] }, { today: T });
    const seeded = DR.seedFromBody(tasks, body);
    assert.deepEqual(DR.buildBody({ tasks, answers: seeded, extras: [] }, { today: T }), body);
    assert.equal(DR.seedFromBody([{ id: 9 }], body).size, 0); // تسکی که دیگر pending نیست
  });

  test('futureDates: N روز بعد از امروز (بدون خودِ امروز)', () => {
    const d = DR.futureDates('2026-08-30', 3);
    assert.deepEqual(d, ['2026-08-31', '2026-09-01', '2026-09-02']);
  });
});

describe('Mini App: ساختار و دسترس‌پذیری ویزارد گزارش', () => {
  const html = read('public/index.html');
  const app = read('public/js/app.js');
  const css = read('public/css/style.css');

  test('نما، بنر و اسکریپت (قبل از app.js) وجود دارند', () => {
    assert.match(html, /id="view-dreport"[^>]*aria-labelledby="dreport-title"/);
    assert.ok(html.includes('id="dreport-body"') && html.includes('id="dreport-back"') && html.includes('id="report-banner"'));
    assert.ok(html.indexOf('/js/dailyReport.js') > -1 && html.indexOf('/js/dailyReport.js') < html.indexOf('/js/app.js'));
  });

  test('بدون style/on* درون‌خطی در بخش‌های جدید (CSP)', () => {
    const seg = html.slice(html.indexOf('id="view-dreport"'), html.indexOf('id="view-profile"'));
    assert.ok(!/\sstyle=|\son[a-z]+=/i.test(seg));
    const banner = html.match(/<div[^>]*id="report-banner"[^>]*>/)[0];
    assert.ok(!/\sstyle=|\son[a-z]+=/i.test(banner));
  });

  test('کنترل‌ها: fieldset+legend، radio بومی، فوکوس عنوان، aria-live برای پیام', () => {
    assert.ok(app.includes("dEl('fieldset'") && app.includes("dEl('legend'"));
    assert.ok(app.includes("type: 'radio'"));
    assert.ok(app.includes("tabindex: '-1'") && app.includes('focusHeading'));
    assert.ok(app.includes("'aria-live': 'polite'"));
    assert.ok(app.includes("htmlFor: 'dr-reason-text'")); // برچسبِ textarea
    assert.ok(/\.dr-opt:focus-within\s*\{[^}]*outline/.test(css)); // حلقه‌ی فوکوس
    assert.ok(/\.dr-opt\s*\{[^}]*min-height:\s*44px/.test(css)); // هدف لمسی
  });

  test('اتصال گیت‌ها: 409 گزارش ⇒ ویزارد؛ 409 برنامه ⇒ ارسال مجدد همان بدنه؛ ترتیب گزارش ← برنامه ← تأیید', () => {
    assert.ok(app.includes("code === 'daily_report_required'") && app.includes("openReportWizard({ mode: 'checkout'"));
    assert.ok(app.includes("code === 'weekly_plan_required'") && app.includes('const resend = body;'));
    assert.ok(app.includes('openReportConfirm(resend)') && app.includes("doAction('/check-out', resend,"));
    assert.ok(app.includes('handler: () => startCheckout()'));
    assert.ok(app.includes("api('/daily-report', { method: 'POST', body: bodyOf() })"));
    assert.ok(app.includes('بعداً پر می‌کنم') && app.includes('loadReportBanner();'));
  });

  test('متن کارت: «امروز تسک «…» انجام شد؟» و سه گزینه‌ی ✅ 🟡 ❌', () => {
    assert.ok(app.includes('امروز تسک «${t.title}» انجام شد؟'));
    assert.deepEqual(DR.STATUS.map((s) => s.icon), ['✅', '🟡', '❌']);
  });
});
