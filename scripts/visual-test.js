// Visual smoke/baseline runner. It uses an isolated SQLite path and never sends real initData.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const update = process.argv.includes('--update');
const baseline = path.join(root, 'test', 'visual', 'baseline');
const diff = path.join(root, 'test', 'visual', 'diff');
fs.mkdirSync(update ? baseline : diff, { recursive: true });
const port = 39000 + Math.floor(Math.random() * 1000);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-visual-'));
const base = process.env.VISUAL_BASE_URL || `http://127.0.0.1:${port}`;
const waitFor = async (url) => { for (let i = 0; i < 40; i += 1) { try { const r = await fetch(url); if (r.status < 500) return; } catch (_) {} await new Promise((r) => setTimeout(r, 250)); } throw new Error('visual server did not start'); };
(async () => {
  const child = process.env.VISUAL_BASE_URL ? null : spawn(process.execPath, ['src/server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: path.join(temp, 'visual.db'), WATCHDOG_ENABLED: 'false', RATE_LIMIT_STORE: 'memory' } });
  await waitFor(`${base}/admin/`);
  const browser = await chromium.launch();
  try {
    for (const width of [360, 768, 1440]) for (const theme of ['light', 'dark']) for (const targetPage of [{ key: 'admin-login', path: '/admin/' }, { key: 'styleguide', path: '/admin/_styleguide.html' }]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => { window.Telegram = { WebApp: { initData: '', initDataUnsafe: {}, ready() {}, expand() {} } }; });
      await page.goto(`${base}${targetPage.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const name = `${targetPage.key}-${width}-${theme}.png`; const shot = await page.screenshot({ fullPage: true }); const expected = path.join(baseline, name);
      if (update || !fs.existsSync(expected)) fs.writeFileSync(expected, shot);
      else if (!shot.equals(fs.readFileSync(expected))) { fs.writeFileSync(path.join(diff, name), shot); throw new Error(`visual difference: ${name}`); }
      await page.close();
    }
  } finally { await browser.close(); if (child) child.kill(); try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {} }
})().catch((err) => { console.error(err.message); process.exitCode = 1; });
