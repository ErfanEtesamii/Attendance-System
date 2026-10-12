// کلاینت تست Mini App: سرور واقعی روی پورت تصادفی + initData امضاشده. فقط وقتی express نصب است کار می‌کند.
const crypto = require('crypto');

function initDataFor(user) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: Number(user.telegram_user_id), first_name: 'تست' }),
  });
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

async function startServer() {
  const config = require('../../src/config');
  config.allowedNetworkCidr = '127.0.0.0/8';
  const { createApp } = require('../../src/server');
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(user, method, p, body) {
    const res = await fetch(`${base}/api/miniapp/${p}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-telegram-init-data': initDataFor(user) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }
  return { server, base, call, close: () => server.close() };
}

module.exports = { initDataFor, startServer };
