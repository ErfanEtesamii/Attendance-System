// Smoke test: سرور واقعی (فقط API، بدون بات) را روی دیتابیس موقت بالا می‌آورد و چند درخواست کلیدی می‌زند.
//   npm run smoke
// نیازمند npm install (express و ...). هیچ‌چیز روی دیتابیس واقعی نمی‌نویسد (DB_PATH موقت).

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-smoke-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const SECRET = 'smoke-secret-0123456789abcdef0123456789abcdef';

const env = {
  ...process.env,
  NODE_ENV: 'test', // .env واقعی خوانده نشود
  PORT: String(PORT),
  DB_PATH: path.join(tmp, 'smoke.db'),
  ADMIN_SESSION_SECRET: SECRET,
  TELEGRAM_BOT_TOKEN: '',
  SSL_CERT_PATH: '',
  SSL_KEY_PATH: '',
};

let failures = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${name}${ok ? '' : `  ← ${extra}`}`);
  if (!ok) failures += 1;
}

async function waitForHealth(base, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return true;
    } catch (_) { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  // ساخت ادمین/کارمند تست مستقیم روی همان DB موقت (در یک پروسه جدا، قبل از بالا آمدن سرور)
  const seed = require('child_process').spawnSync(
    process.execPath,
    [
      '-e',
      `const u=require('./src/repositories/usersRepository');
       const a=u.createUser({telegramUserId:'7001',fullName:'ادمین اسموک',role:'admin'});
       const e=u.createUser({telegramUserId:'7002',fullName:'کارمند اسموک',role:'employee'});
       console.log(JSON.stringify({admin:a.id,employee:e.id}));`,
    ],
    { cwd: root, env, encoding: 'utf8' }
  );
  if (seed.status !== 0) throw new Error(`seed ناموفق: ${seed.stderr}`);
  const ids = JSON.parse(seed.stdout.trim().split('\n').pop());

  const server = spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  const base = `http://127.0.0.1:${PORT}`;
  try {
    check('سرور بالا آمد و /api/health پاسخ داد', await waitForHealth(base), serverLog.slice(-400));

    const { createSessionToken } = require('../src/utils/session');
    const { SESSION_COOKIE_NAME } = require('../src/middleware/adminAuth');
    const cookie = (id) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSessionToken({ userId: id }, SECRET, 600))}`;
    const get = (url, c) => fetch(base + url, { headers: c ? { cookie: c } : {} });

    check('GET /api/admin/me بدون سشن ← ۴۰۱', (await get('/api/admin/me')).status === 401);
    const me = await get('/api/admin/me', cookie(ids.admin));
    check('GET /api/admin/me با سشن ادمین ← ۲۰۰', me.status === 200, me.status);
    const dash = await get('/api/admin/dashboard', cookie(ids.admin));
    const dashJson = await dash.json().catch(() => ({}));
    check('GET /api/admin/dashboard ادمین ← ۲۰۰ و totalEmployees=2', dash.status === 200 && dashJson.totalEmployees === 2, JSON.stringify(dashJson));
    check('کارمند به /api/admin/settings ← ۴۰۳', (await get('/api/admin/settings', cookie(ids.employee))).status === 403);
    check('سشن دستکاری‌شده ← ۴۰۱', (await get('/api/admin/me', cookie(ids.admin) + 'x')).status === 401);
    check('مسیر ناشناخته ← ۴۰۴', (await get('/api/nope')).status === 404);
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures) {
    console.error(`\n${failures} بررسی ناموفق بود.`);
    process.exit(1);
  }
  console.log('\nsmoke test موفق بود.');
}

main().catch((err) => {
  console.error('❌ smoke test خطا داد:', err.message);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
