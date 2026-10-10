// S5-5a: ارسال خودکار xlsx ماهانه به تلگرام — خاموش پیش‌فرض، گیرنده‌ها از تنظیمات، اسکوپ، snapshot، fallback CSV، خطای یک گیرنده.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { sendMonthlyXlsxReports, parseRoles, scopeFor } = require('../src/bot/scheduler/reportDocuments');
const settingsRepo = require('../src/repositories/settingsRepository');
const monthClosuresRepo = require('../src/repositories/monthClosuresRepository');
const auditRepo = require('../src/repositories/auditRepository');
const attendanceRepo = require('../src/repositories/attendanceRepository');
const xlsx = require('../src/utils/xlsx');
const { zonedTimeToUtc } = require('../src/utils/time');
const { makeUser } = require('./helpers/factories');
const { getDb } = require('../src/db/connection');

// «امروز» = ۱۴۰۵/۰۷/۰۱ ⇒ ماه قبل = شهریور ۱۴۰۵ (۲۰۲۶-۰۸-۲۳ تا ۲۰۲۶-۰۹-۲۲)
const NOW = new Date('2026-09-23T06:00:00Z');
const at = (date, hhmm) => zonedTimeToUtc(date, hhmm, 'Asia/Tehran').toISOString();

const fakeBot = (failFor = []) => {
  const calls = [];
  return {
    calls,
    async sendDocument(chatId, buffer, options, fileOptions) {
      if (failFor.includes(String(chatId))) throw new Error('blocked by user');
      calls.push({ chatId: String(chatId), buffer, options, fileOptions });
      return {};
    },
  };
};

// exceljs ساختگیِ مینیمال (ساختار workbook را ثبت می‌کند)
function fakeExcel(log) {
  return {
    Workbook: function Workbook() {
      this.addWorksheet = (name) => {
        log.push(name);
        return { addRow: () => ({ eachCell() {} }), getColumn: () => ({}), };
      };
      this.xlsx = { writeBuffer: async () => Buffer.from('PK-fake') };
    },
  };
}

describe('ارسال خودکار xlsx ماهانه (S5-5a)', () => {
  let admin; let hr; let mgr; let emp1; let emp2; let other;
  before(() => {
    resetDb();
    admin = makeUser({ role: 'admin', name: 'ادمین' });
    hr = makeUser({ role: 'hr', name: 'منابع' });
    mgr = makeUser({ role: 'manager', name: 'سرپرست' });
    emp1 = makeUser({ role: 'employee', managerId: mgr.id, name: 'کارمند تیم' });
    emp2 = makeUser({ role: 'employee', name: 'کارمند دیگر' });
    other = makeUser({ role: 'manager', name: 'سرپرست بی‌تیم' });
    attendanceRepo.createManual({ userId: emp1.id, recordDate: '2026-08-30', checkInTime: at('2026-08-30', '08:00'), checkOutTime: at('2026-08-30', '16:30'), status: 'normal' });
  });
  after(cleanup);
  beforeEach(() => { xlsx._setLoaderForTest(() => fakeExcel([])); });
  afterEach(() => { xlsx._setLoaderForTest(null); settingsRepo.update({ reportXlsxEnabled: false, reportXlsxRecipientRoles: 'admin', reportXlsxRequireClosed: false }); });

  test('parseRoles: فقط admin/hr/manager، تکراری و ناشناخته حذف', () => {
    assert.deepEqual(parseRoles(' Admin, hr,hr ,boss,,manager'), ['admin', 'hr', 'manager']);
    assert.deepEqual(parseRoles(''), []);
    assert.deepEqual(parseRoles(undefined), []);
  });

  test('پیش‌فرض خاموش ⇒ هیچ ارسالی', async () => {
    const bot = fakeBot();
    const r = await sendMonthlyXlsxReports(bot, { now: NOW });
    assert.equal(r.skipped, 'disabled');
    assert.equal(bot.calls.length, 0);
  });

  test('گیرنده‌ها از تنظیمات: فقط admin ⇒ یک فایل xlsx با نام/نوع درست و کپشن «زنده»', async () => {
    settingsRepo.update({ reportXlsxEnabled: true });
    const bot = fakeBot();
    const r = await sendMonthlyXlsxReports(bot, { now: NOW });
    assert.equal(r.sent, 1);
    const c = bot.calls[0];
    assert.equal(c.chatId, String(admin.telegram_user_id));
    assert.equal(c.fileOptions.filename, 'monthly-report_1405-06.xlsx');
    assert.match(c.fileOptions.contentType, /spreadsheetml/);
    assert.match(c.options.caption, /شهریور 1405|شهریور ۱۴۰۵/);
    assert.match(c.options.caption, /زنده/);
    assert.ok(Buffer.isBuffer(c.buffer));
    const logged = getDb().prepare("SELECT details FROM audit_log WHERE action='report_exported' ORDER BY id DESC LIMIT 1").get();
    assert.match(logged.details, /"channel":"telegram"/);
    assert.match(logged.details, /"source":"scheduler"/);
  });

  test('اسکوپ: manager فقط تیم خودش؛ manager بدون تیم فایلی نمی‌گیرد؛ admin/hr همه', async () => {
    settingsRepo.update({ reportXlsxEnabled: true, reportXlsxRecipientRoles: 'admin,hr,manager' });
    const sheetsLog = [];
    xlsx._setLoaderForTest(() => fakeExcel(sheetsLog));
    const bot = fakeBot();
    const r = await sendMonthlyXlsxReports(bot, { now: NOW });
    const ids = bot.calls.map((c) => c.chatId).sort();
    assert.deepEqual(ids, [admin, hr, mgr].map((u) => String(u.telegram_user_id)).sort()); // other تیم ندارد
    assert.equal(r.sent, 3);
    const active = require('../src/repositories/usersRepository').listUsers({ onlyActive: true });
    assert.deepEqual(scopeFor({ role: 'manager', id: mgr.id }, active).map((u) => u.id), [emp1.id]);
    assert.equal(scopeFor({ role: 'hr', id: hr.id }, active).length, active.length);
  });

  test('بدون exceljs ⇒ CSV با توضیح در کپشن', async () => {
    xlsx._setLoaderForTest(() => { throw new Error('no exceljs'); });
    settingsRepo.update({ reportXlsxEnabled: true });
    const bot = fakeBot();
    await sendMonthlyXlsxReports(bot, { now: NOW });
    const c = bot.calls[0];
    assert.equal(c.fileOptions.filename, 'monthly-report_1405-06.csv');
    assert.match(c.options.caption, /exceljs/);
    assert.match(c.buffer.toString('utf8'), /نام/);
  });

  test('الزام ماه بسته: بسته‌نشده ⇒ ارسال نمی‌شود؛ بعد از بستن ⇒ snapshot و کپشن بدون «زنده»', async () => {
    settingsRepo.update({ reportXlsxEnabled: true, reportXlsxRequireClosed: true });
    const bot = fakeBot();
    assert.equal((await sendMonthlyXlsxReports(bot, { now: NOW })).skipped, 'not_closed');
    assert.equal(bot.calls.length, 0);

    const { closeMonth } = require('../src/services/monthCloseService');
    closeMonth({ year: 1405, month: 6, closedBy: admin.id, now: NOW });
    const r = await sendMonthlyXlsxReports(bot, { now: NOW });
    assert.equal(r.sent, 1);
    assert.match(bot.calls[0].options.caption, /snapshot/);
    assert.doesNotMatch(bot.calls[0].options.caption, /زنده/);
    assert.ok(monthClosuresRepo.findByMonth(1405, 6));
  });

  test('خطای یک گیرنده بقیه را متوقف نمی‌کند و Job در پایان خطا می‌دهد', async () => {
    settingsRepo.update({ reportXlsxEnabled: true, reportXlsxRecipientRoles: 'admin,hr' });
    const bot = fakeBot([String(admin.telegram_user_id)]);
    const origErr = console.error; console.error = () => {};
    try {
      await assert.rejects(() => sendMonthlyXlsxReports(bot, { now: NOW }), /1 گیرنده ناموفق/);
    } finally { console.error = origErr; }
    assert.equal(bot.calls.length, 1);
    assert.equal(bot.calls[0].chatId, String(hr.telegram_user_id));
  });

  test('نقش نامعتبر ⇒ no_roles؛ و Job در scheduler ثبت است', async () => {
    settingsRepo.update({ reportXlsxEnabled: true, reportXlsxRecipientRoles: 'boss' });
    assert.equal((await sendMonthlyXlsxReports(fakeBot(), { now: NOW })).skipped, 'no_roles');
    assert.match(require('fs').readFileSync(require.resolve('../src/bot/scheduler/index.js'), 'utf8'), /sendMonthlyXlsxReports/);
  });
});
