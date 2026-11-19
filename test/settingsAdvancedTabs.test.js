// تب‌های زیربخش، خلاصه/جمله‌ی اثر زنده و تنظیم‌های «پیشرفته» (فقط نمایش؛ رفتار دست‌نخورده)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const registry = require('../src/utils/settingsRegistry');

const VIEW = fs.readFileSync(path.join(__dirname, '../public-admin/js/views-admin.js'), 'utf8');

test('ADVANCED_KEYS: همه‌ی کلیدها در رجیستری هستند و پرچم advanced می‌گیرند', () => {
  assert.ok(registry.ADVANCED_KEYS.length > 0);
  for (const k of registry.ADVANCED_KEYS) assert.equal(registry.getDef(k).advanced, true, k);
  const flagged = registry.keys().filter((k) => registry.getDef(k).advanced);
  assert.equal(flagged.length, registry.ADVANCED_KEYS.length);
});

test('پیشرفته‌ها مقدار پیش‌فرض و نوع را تغییر نداده‌اند؛ تنظیم‌های اصلی ناهار/استراحت پیشرفته نیستند', () => {
  ['fixedLunchDeductMinutes', 'lunchWindowStart', 'lunchWindowEnd', 'fixedLunchMode', 'maxReEntriesPerDay', 'paidBreakCount', 'scheduledBreakEnabled', 'scheduledLunchEnabled', 'workDayStart', 'workDayEnd'].forEach((k) => assert.notEqual(registry.getDef(k).advanced, true, k));
  assert.equal(registry.defaultOf('fixedLunchMinOverlapMinutes'), 15);
});

test('UI: تب هر زیربخش، خلاصه‌ی زنده و بخش بسته‌ی پیشرفته در views-admin.js', () => {
  assert.match(VIEW, /role="tablist"/);
  assert.match(VIEW, /data-tab=/);
  assert.match(VIEW, /class="st-adv"/);
  assert.match(VIEW, /data-live=/);
  assert.match(VIEW, /refreshLive\(g\)/);
  // هر زیربخشِ گروه ساعت کاری یک جمله‌ی اثر دارد
  ['ناهار', 'تأخیر و زودتر رفتن', 'استراحت', 'خروج و ورود مجدد', 'پیام خودکار استراحت و ناهار'].forEach((sec) => assert.ok(VIEW.includes(`'${sec}': () =>`), sec));
});

test('SECTION_MAP: گروه‌های بلند همه‌ی کلیدهایشان زیربخش دارند و SECTION_ORDER با آن هم‌خوان است', () => {
  for (const g of ['overtime', 'leave', 'planning', 'security', 'patterns', 'supervisors', 'schedule']) {
    const keys = registry.keys().filter((k) => registry.getDef(k).group === g);
    assert.ok(keys.every((k) => registry.getDef(k).section), `${g}: کلید بدون زیربخش`);
    const order = registry.SECTION_ORDER[g];
    assert.ok(order.length >= 2, g);
    assert.deepEqual([...new Set(keys.map((k) => registry.getDef(k).section))].sort(), [...order].sort(), g);
  }
  // مقدار و نوع تغییر نکرده؛ فقط section اضافه شده
  assert.equal(registry.defaultOf('overtimeFactor'), 1);
  assert.equal(registry.getDef('supervisorRecordEditMonthlyLimit').section, 'سقف‌ها');
});

test('cron picker: ویجت و توابع تبدیل در UI وجود دارند', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public-admin', 'js', 'views-admin.js'), 'utf8');
  for (const s of ['function cronParse', 'function cronBuild', 'function cronHuman', 'function mountCron', 'data-cron-edit', 'st-cron-raw']) assert.ok(src.includes(s), s);
});
