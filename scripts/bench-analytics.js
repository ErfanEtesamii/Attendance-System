// سنجش عملکرد تحلیل‌ها (S5-6c): داده‌ی شبیه‌سازی‌شده (پیش‌فرض ۵۰ کارمند × ۷۳۰ روز) روی دیتابیس «موقت» ساخته می‌شود
// و همه‌ی مسیرهای /api/admin/analytics/* از طریق HTTP واقعی (سرور Express روی پورت تصادفی) زمان‌گیری می‌شوند.
//   npm run bench:analytics
//   node scripts/bench-analytics.js --users=50 --days=730 --runs=5 [--no-new-indexes] [--json]
//
// ⚠️ هیچ‌چیز روی دیتابیس واقعی نوشته نمی‌شود (DB_PATH موقت؛ NODE_ENV=test ⇒ .env واقعی خوانده نمی‌شود).
// سه حالت برای مقایسه (کش با ANALYTICS_CACHE_TTL_SECONDS کنترل می‌شود، ایندکس‌های جدید با --no-new-indexes):
//   A) بدون ایندکس جدید + بدون کش :  ANALYTICS_CACHE_TTL_SECONDS=0 node scripts/bench-analytics.js --no-new-indexes
//   B) با ایندکس + بدون کش         :  ANALYTICS_CACHE_TTL_SECONDS=0 node scripts/bench-analytics.js
//   C) با ایندکس + کش (پیش‌فرض)    :  node scripts/bench-analytics.js
// ستون «cold» = اولین درخواست (کش خالی)، «warm» = میانه‌ی درخواست‌های بعدیِ همان URL.
// seed با repositoryها انجام می‌شود؛ تنها استثنا یک UPDATE برای عقب‌بردن created_at کاربران است
// (وگرنه موتور روزهای پیش از «تاریخ ثبت کاربر» را not_started می‌شمارد و کل بازه خالی می‌شود).

const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const USERS = parseInt(opt('users', '50'), 10);
const DAYS = parseInt(opt('days', '730'), 10);
const RUNS = Math.max(2, parseInt(opt('runs', '5'), 10));
const NO_NEW_INDEXES = argv.includes('--no-new-indexes');
const AS_JSON = argv.includes('--json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-bench-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DB_PATH: path.join(tmp, 'bench.db'),
  ADMIN_SESSION_SECRET: 'bench-session-secret-0123456789abcdef0123456789abcdef', // secret-scan:allow (مقدار ساختگی)
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_BOT_USERNAME: 'bench_bot',
  ALLOWED_NETWORK_CIDR: '127.0.0.0/8,::1/128,192.168.10.0/24',
  TRUST_PROXY: 'false',
});

const jalaali = require('jalaali-js');
const { getDb, closeDb } = require('../src/db/connection');
const usersRepository = require('../src/repositories/usersRepository');
const attendanceRepository = require('../src/repositories/attendanceRepository');
const breakRepository = require('../src/repositories/breakRepository');
const leaveRepository = require('../src/repositories/leaveRepository');
const { zonedTimeToUtc } = require('../src/utils/time');
const { todayDateString } = require('../src/utils/serverTime');
const { createSessionToken } = require('../src/utils/session');
const { SESSION_COOKIE_NAME } = require('../src/middleware/adminAuth');
const config = require('../src/config');

const TZ = 'Asia/Tehran';
const DEPARTMENTS = ['فنی', 'فروش', 'مالی', 'پشتیبانی', 'انبار'];

// مولد شبه‌تصادفی ثابت (mulberry32) تا اجراها قابل‌مقایسه باشند
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261010);
const gauss = () => (rand() + rand() + rand() + rand() - 2) / 0.58; // تقریباً N(0,1)
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function dropNewIndexes(db) {
  const file = path.join(__dirname, '..', 'src', 'db', 'migrations', '022_analytics_indexes.js');
  if (!fs.existsSync(file)) return [];
  const names = require(file).indexes || [];
  for (const n of names) db.exec(`DROP INDEX IF EXISTS ${n}`);
  return names;
}

function seed() {
  const db = getDb();
  const today = todayDateString();
  const start = addDays(today, -(DAYS - 1));
  const users = [];
  const mgrs = [];
  db.transaction(() => {
    DEPARTMENTS.forEach((dep, i) => {
      mgrs.push(usersRepository.createUser({ telegramUserId: String(700000 + i), fullName: `سرپرست ${dep}`, personnelCode: `M${i}`, department: dep, role: 'manager' }));
    });
    for (let i = 0; i < USERS; i += 1) {
      const d = i % DEPARTMENTS.length;
      users.push(usersRepository.createUser({ telegramUserId: String(800000 + i), fullName: `کارمند ${i + 1}`, personnelCode: `E${i + 1}`, department: DEPARTMENTS[d], role: 'employee', managerId: mgrs[d].id }));
    }
    db.prepare("UPDATE users SET created_at = ? WHERE 1 = 1").run(`${addDays(start, -30)} 00:00:00`);
  })();
  const admin = usersRepository.createUser({ telegramUserId: '790000', fullName: 'ادمین بنچ', personnelCode: 'A0', department: 'مدیریت', role: 'admin' });

  let records = 0; let breaks = 0; let leaves = 0;
  db.transaction(() => {
    for (const u of users) {
      // مرخصی تأییدشده‌ی تصادفی (≈ هر ۱۲۰ روز یک بار، ۱ تا ۳ روز) + چند مأموریت
      const off = new Set();
      for (let day = 10; day < DAYS - 3; day += 90 + Math.floor(rand() * 60)) {
        const len = 1 + Math.floor(rand() * 3);
        const from = addDays(start, day);
        const to = addDays(from, len - 1);
        const kind = rand() < 0.2 ? 'mission' : 'leave';
        const req = leaveRepository.createLeaveRequest({ userId: u.id, startDate: from, endDate: to, leaveType: kind, reason: 'bench' });
        leaveRepository.setStatus(req.id, 'approved', null);
        leaves += 1;
        for (let k = 0; k < len; k += 1) off.add(addDays(from, k));
      }
      for (let n = 0; n < DAYS - 1; n += 1) { // امروز رکورد ندارد (روز در جریان)
        const date = addDays(start, n);
        const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (dow === 5 || off.has(date) || rand() < 0.04) continue; // جمعه، مرخصی، غیبت تصادفی
        const half = dow === 4; // پنجشنبه نیم‌روز
        const inMin = Math.max(450, Math.min(600, Math.round(480 + gauss() * 14 + (rand() < 0.1 ? 25 : 0))));
        const outMin = half ? 13 * 60 + Math.round(gauss() * 10) : 17 * 60 + Math.round(gauss() * 30);
        const rec = attendanceRepository.createManual({
          userId: u.id, recordDate: date,
          checkInTime: zonedTimeToUtc(date, hhmm(inMin), TZ).toISOString(),
          checkOutTime: zonedTimeToUtc(date, hhmm(outMin), TZ).toISOString(),
          status: 'normal',
        });
        records += 1;
        if (!half) {
          breakRepository.createManual({ attendanceRecordId: rec.id, breakType: 'lunch', startTime: zonedTimeToUtc(date, '12:30', TZ).toISOString(), endTime: zonedTimeToUtc(date, '13:00', TZ).toISOString() });
          breaks += 1;
          if (rand() < 0.3) { breakRepository.createManual({ attendanceRecordId: rec.id, breakType: 'short_break', startTime: zonedTimeToUtc(date, '10:30', TZ).toISOString(), endTime: zonedTimeToUtc(date, '10:40', TZ).toISOString() }); breaks += 1; }
        }
      }
    }
  })();
  return { admin, today, start, counts: { users: users.length, records, breaks, leaves } };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const ms = (ns) => Number(ns) / 1e6;

async function main() {
  const db = getDb(); // migrationها اجرا می‌شوند
  const dropped = NO_NEW_INDEXES ? dropNewIndexes(db) : [];
  const t0 = Date.now();
  const { admin, today, start, counts } = seed();
  const seedMs = Date.now() - t0;

  const { createApp } = require('../src/server');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken({ userId: admin.id }, config.adminSessionSecret, 3600))}`;

  // «ماه کامل قبل» به تقویم شمسی
  const [ty, tm, td] = today.split('-').map(Number);
  const j = jalaali.toJalaali(ty, tm, td);
  const prev = j.jm === 1 ? { y: j.jy - 1, m: 12 } : { y: j.jy, m: j.jm - 1 };
  const month = `year=${prev.y}&month=${prev.m}`;
  const range = `from=${start}&to=${today}`;

  const cases = [
    ['late-trend هفتگی (۱۲ هفته، کل)', '/admin/analytics/late-trend?granularity=week&groupBy=none'],
    ['late-trend ماهانه ۲ سال / دپارتمان', `/admin/analytics/late-trend?granularity=month&groupBy=department&${range}`],
    ['late-trend ماهانه ۲ سال / فرد', `/admin/analytics/late-trend?granularity=month&groupBy=user&${range}`],
    ['late-compare / دپارتمان', `/admin/analytics/late-compare?${month}&groupBy=department`],
    ['rankings اضافه‌کاری', `/admin/analytics/rankings?${month}&metric=overtime`],
    ['rankings کسری', `/admin/analytics/rankings?${month}&metric=shortfall`],
    ['attendance-rate / فرد', `/admin/analytics/attendance-rate?${month}&groupBy=user`],
    ['leave-by-type / دپارتمان', `/admin/analytics/leave-by-type?${month}&groupBy=department`],
    ['checkin-distribution ۲ سال', `/admin/analytics/checkin-distribution?${range}&binMinutes=15`],
  ];

  const results = [];
  for (const [label, url] of cases) {
    const times = [];
    let status = 0; let bytes = 0; let cache = '-';
    for (let i = 0; i < RUNS; i += 1) {
      const t = process.hrtime.bigint();
      const res = await fetch(base + url, { headers: { cookie, 'x-requested-with': 'AttendancePanel' } });
      const body = await res.text();
      times.push(ms(process.hrtime.bigint() - t));
      status = res.status; bytes = body.length;
      cache = res.headers.get('x-analytics-cache') || '-';
      if (status !== 200) throw new Error(`${label}: HTTP ${status} ${body.slice(0, 200)}`);
    }
    results.push({ label, coldMs: times[0], warmMs: median(times.slice(1)), bytes, lastCacheHeader: cache });
  }
  server.close();
  closeDb();

  const out = {
    config: { users: USERS, days: DAYS, runs: RUNS, newIndexes: !NO_NEW_INDEXES, droppedIndexes: dropped, cacheTtlSeconds: process.env.ANALYTICS_CACHE_TTL_SECONDS === undefined ? 'default' : process.env.ANALYTICS_CACHE_TTL_SECONDS },
    data: { ...counts, seedMs, dbMb: Math.round((fs.statSync(process.env.DB_PATH).size / 1048576) * 10) / 10 },
    results,
  };
  if (AS_JSON) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`\nکاربر=${counts.users} رکورد=${counts.records} استراحت=${counts.breaks} مرخصی=${counts.leaves} حجم DB=${out.data.dbMb}MB  (seed ${seedMs}ms)`);
    console.log(`ایندکس جدید: ${out.config.newIndexes ? 'بله' : 'خیر'} | TTL کش: ${out.config.cacheTtlSeconds}`);
    console.log('| مسیر | cold (ms) | warm (ms) | حجم پاسخ (KB) | X-Analytics-Cache |');
    console.log('|---|---:|---:|---:|---|');
    for (const r of results) console.log(`| ${r.label} | ${r.coldMs.toFixed(1)} | ${r.warmMs.toFixed(1)} | ${(r.bytes / 1024).toFixed(1)} | ${r.lastCacheHeader} |`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => { console.error(err); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
