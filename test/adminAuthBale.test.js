// نسخه‌ی بله: public-config و غیرفعال‌بودن ورودهای مخصوص تلگرام (webapp / login widget) وقتی فقط BALE_BOT_TOKEN ست است.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

let hasDeps = true;
try { require.resolve('express'); } catch (_) { hasDeps = false; }

describe('ورود پنل در نسخه‌ی بله', { skip: hasDeps ? false : 'express نصب نیست (npm install)' }, () => {
  let server, base, config, saved;
  before(async () => {
    resetDb();
    config = require('../src/config');
    saved = { t: config.telegramBotToken, b: config.baleBotToken, u: config.baleBotUsername };
    config.telegramBotToken = '';
    config.baleBotToken = 'x';
    config.baleBotUsername = 'my_bale_bot';
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    if (server) server.close();
    config.telegramBotToken = saved.t; config.baleBotToken = saved.b; config.baleBotUsername = saved.u;
    cleanup();
  });
  const post = (url) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'AttendancePanel' }, body: '{}' });

  test('public-config: platform=bale و یوزرنیم بله', async () => {
    const j = await (await fetch(base + '/api/admin/public-config')).json();
    assert.equal(j.platform, 'bale');
    assert.equal(j.botUsername, 'my_bale_bot');
  });
  test('webapp و telegram در بله ۴۰۴ می‌دهند (نه ۵۰۰)', async () => {
    assert.equal((await post('/api/admin/auth/webapp')).status, 404);
    assert.equal((await post('/api/admin/auth/telegram')).status, 404);
  });
});
