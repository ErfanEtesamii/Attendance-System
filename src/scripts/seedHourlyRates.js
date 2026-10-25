// اسکریپت یک‌بارمصرف: ثبت نرخ ساعتی کارمندان از data/hourly-rates.json (Phase 20).
// فایل (gitignored) آرایه‌ای از { "name": "<نام کامل نمایشی>", "rate": 155 } است؛ rate = هزار تومان در ساعت.
//
// استفاده:
//   node src/scripts/seedHourlyRates.js            # فقط پیش‌نمایش (چیزی نوشته نمی‌شود)
//   node src/scripts/seedHourlyRates.js --apply    # ثبت واقعی
//   node src/scripts/seedHourlyRates.js --file path/to/other.json
//
// تطبیق «فقط دقیق» با full_name کاربر است، بعد از نرمال‌سازی ی/ک عربی، فاصله و نیم‌فاصله. حدس زده نمی‌شود:
// نامِ پیدانشده یا مبهم (چند کاربر / تکرار در فایل) آپدیت نمی‌شود و فقط نامش فهرست می‌شود (مثلاً «حیدری» با «حیدریان» قاطی نمی‌شود).
// خروجی هرگز نرخ‌ها را چاپ نمی‌کند.

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'hourly-rates.json');

// ی/ک عربی ⇒ فارسی؛ حذف همه‌ی فاصله‌ها و نیم‌فاصله (U+200C) و کاراکترهای جهت‌دهی؛ حروف کوچک لاتین
function normalizeName(value) {
  return String(value == null ? '' : value)
    .replace(/ي/g, 'ی').replace(/ى/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\s​-‏‪-‮⁦-⁩﻿]+/g, '')
    .toLowerCase();
}

const validRate = (r) => Number.isInteger(r) && r >= 0 && r <= 100000;

// users: [{ id, full_name }]، entries: [{ name, rate }]
// خروجی: { updates: [{ userId, rate }], unmatched: [name], ambiguous: [name], invalid: [name] }  (نام‌ها همان متن ورودی‌اند؛ نرخ فقط در updates)
function matchRates(users, entries) {
  const byName = new Map();
  for (const u of users) {
    const k = normalizeName(u.full_name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(u);
  }
  const seen = new Map();
  for (const e of entries) {
    const k = normalizeName(e && e.name);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const out = { updates: [], unmatched: [], ambiguous: [], invalid: [] };
  for (const e of entries) {
    const label = e && e.name != null ? String(e.name) : '(بدون نام)';
    const k = normalizeName(e && e.name);
    if (!k || !validRate(e.rate)) { out.invalid.push(label); continue; }
    if (seen.get(k) > 1) { out.ambiguous.push(label); continue; } // دو ردیف برای یک نام ⇒ کدام نرخ؟
    const hits = byName.get(k) || [];
    if (hits.length === 0) out.unmatched.push(label);
    else if (hits.length > 1) out.ambiguous.push(label);
    else out.updates.push({ userId: hits[0].id, rate: e.rate });
  }
  return out;
}

function readEntries(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('فایل باید آرایه‌ای از { name, rate } باشد.');
  return parsed;
}

function main() {
  const apply = process.argv.includes('--apply');
  const fi = process.argv.indexOf('--file');
  const file = fi > -1 && process.argv[fi + 1] ? path.resolve(process.argv[fi + 1]) : DEFAULT_FILE;
  let entries;
  try { entries = readEntries(file); } catch (err) {
    console.error(`خواندن فایل نرخ‌ها ناموفق بود (${path.basename(file)}): ${err instanceof SyntaxError ? 'JSON نامعتبر' : err.message}`);
    process.exit(1);
  }
  const usersRepository = require('../repositories/usersRepository');
  const { getDb } = require('../db/connection');
  getDb();
  const result = matchRates(usersRepository.listUsers(), entries);
  if (apply) for (const u of result.updates) usersRepository.setHourlyRateKt(u.userId, u.rate);

  console.log(`${apply ? 'ثبت شد' : 'پیش‌نمایش (چیزی نوشته نشد؛ برای ثبت --apply بزنید)'}: ${result.updates.length} کاربر`);
  const list = (title, arr) => { if (arr.length) { console.log(`\n${title} (${arr.length}):`); arr.forEach((n) => console.log(`  - ${n}`)); } };
  list('تطبیق‌نخورده (کاربری با این نام کامل نیست؛ نام کامل نمایشی را در فایل بنویسید)', result.unmatched);
  list('مبهم (چند کاربر هم‌نام یا نام تکراری در فایل؛ آپدیت نشد)', result.ambiguous);
  list('نامعتبر (نام خالی یا نرخ غیر از عدد صحیح ۰ تا ۱۰۰۰۰۰)', result.invalid);
  if (apply && path.resolve(file) === path.resolve(DEFAULT_FILE)) {
    console.warn('هشدار: فایل data/hourly-rates.json شامل دادهٔ حقوق است؛ پس از تأیید نتیجه آن را حذف یا به محل امن خارج از پروژه منتقل کنید.');
  }
}

if (require.main === module) main();

module.exports = { normalizeName, matchRates, validRate };
