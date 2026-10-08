// S4-12b: سرو پیوست مرخصی — احراز و دسترسی (صاحب، سرپرست تیم، admin/hr)، ۴۰۳ برای بقیه، هدرهای امن، path traversal، Mini App فقط صاحب.
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 9)]);

describe('سرو پیوست مرخصی (S4-12b)', () => {
  let server; let base; let cookies; let U; let db; let dirPath; let reqId; let noAttId; let ghostId; let evilId; let F;
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  before(async () => {
    db = resetDb();
    F = require('./helpers/factories');
    const config = require('../src/config');
    dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'attsrv-'));
    config.attachmentsDir = dirPath;
    config.allowedNetworkCidr = '127.0.0.0/8';
    const svc = require('../src/services/attachmentService');
    const leaveRepo = require('../src/repositories/leaveRepository');
    const manager = F.makeUser({ role: 'manager' });
    U = { admin: F.makeUser({ role: 'admin' }), hr: F.makeUser({ role: 'hr' }), manager, manager2: F.makeUser({ role: 'manager' }), emp: F.makeUser({ managerId: manager.id }), other: F.makeUser() };
    cookies = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, F.sessionCookie(u.id)]));
    const saved = await svc.saveStream(Readable.from([JPEG]), { mime: 'image/jpeg', originalName: 'گواهی.jpg' });
    reqId = leaveRepo.createLeaveRequest({ userId: U.emp.id, startDate: '2028-05-01', endDate: '2028-05-01', leaveType: 'leave', attachment: saved.attachment }).id;
    noAttId = leaveRepo.createLeaveRequest({ userId: U.emp.id, startDate: '2028-05-02', endDate: '2028-05-02', leaveType: 'leave' }).id;
    ghostId = leaveRepo.createLeaveRequest({ userId: U.emp.id, startDate: '2028-05-03', endDate: '2028-05-03', leaveType: 'leave', attachment: { id: 'f'.repeat(32), mime: 'image/png', size: 1 } }).id; // فایلش روی دیسک نیست
    evilId = leaveRepo.createLeaveRequest({ userId: U.emp.id, startDate: '2028-05-04', endDate: '2028-05-04', leaveType: 'leave', attachment: { id: '../../../../etc/passwd', mime: 'image/png', size: 1 } }).id;
    fs.writeFileSync(path.join(dirPath, 'secret.txt'), 'TOP-SECRET');
    const { createApp } = require('../src/server');
    server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => { if (server) server.close(); fs.rmSync(dirPath, { recursive: true, force: true }); cleanup(); });

  const get = async (role, id) => {
    const res = await fetch(`${base}/api/admin/leave-requests/${id}/attachment`, { headers: role ? { cookie: cookies[role] } : {} });
    return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  };

  test('دسترسی: صاحب، سرپرست تیم، admin، hr ⇒ ۲۰۰ با همان بایت‌ها؛ سرپرستِ دیگر و کارمند دیگر ⇒ ۴۰۳؛ بدون ورود ⇒ ۴۰۱', async () => {
    for (const role of ['emp', 'manager', 'admin', 'hr']) {
      const r = await get(role, reqId);
      assert.equal(r.status, 200, role);
      assert.ok(r.buf.equals(JPEG), role);
    }
    for (const role of ['manager2', 'other']) assert.equal((await get(role, reqId)).status, 403, role);
    assert.equal((await get(null, reqId)).status, 401);
  });

  test('هدرهای امن: نوع از mime ذخیره‌شده، nosniff، CSP بسته، بدون کش، نام فایل ساخته‌شده (نه نام اصلی)', async () => {
    const h = (await get('emp', reqId)).headers;
    assert.equal(h.get('content-type'), 'image/jpeg');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.match(h.get('content-security-policy'), /default-src 'none'/);
    assert.match(h.get('cache-control'), /no-store/);
    assert.equal(h.get('content-disposition'), `inline; filename="leave-${reqId}.jpg"`);
  });

  test('۴۰۴: درخواست ناموجود، بدون پیوست، فایلِ حذف‌شده؛ path traversal در ردیف DB هرگز فایل بیرونی را نمی‌دهد؛ id غیرعددی', async () => {
    assert.equal((await get('admin', 999999)).status, 404);
    assert.equal((await get('admin', noAttId)).status, 404);
    assert.equal((await get('admin', ghostId)).status, 404);
    const evil = await get('admin', evilId);
    assert.equal(evil.status, 404);
    assert.ok(!evil.buf.toString().includes('root:') && !evil.buf.toString().includes('TOP-SECRET'));
    assert.equal((await get('admin', 'abc')).status, 404);
    assert.equal((await get('admin', '1%2F..%2F..')).status, 404);
  });

  test('لیست پنل: hasAttachment/attachmentMime/attachmentName بدون افشای شناسه‌ی فایل', async () => {
    const res = await fetch(`${base}/api/admin/leave-requests`, { headers: { cookie: cookies.admin } });
    const items = await res.json();
    const mine = items.find((x) => x.id === reqId);
    assert.deepEqual([mine.hasAttachment, mine.attachmentMime], [true, 'image/jpeg']);
    assert.equal(items.find((x) => x.id === noAttId).hasAttachment, false);
    assert.ok(!JSON.stringify(items).includes('attachment_id'));
    assert.ok(!JSON.stringify(items).match(/[0-9a-f]{32}/));
  });

  test('Mini App: فقط صاحب درخواست؛ دیگران ۴۰۴', async () => {
    const init = (user) => {
      const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(user.telegram_user_id), first_name: 'تست' }) });
      const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
      const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
      params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
      return params.toString();
    };
    const call = (user, id) => fetch(`${base}/api/miniapp/leave/${id}/attachment`, { headers: { 'x-telegram-init-data': init(user) } });
    const own = await call(U.emp, reqId);
    assert.equal(own.status, 200);
    assert.ok(Buffer.from(await own.arrayBuffer()).equals(JPEG));
    assert.equal((await call(U.other, reqId)).status, 404);
    assert.equal((await call(U.admin, reqId)).status, 404, 'Mini App فقط پیوست خود کاربر');
    assert.equal((await call(U.emp, noAttId)).status, 404);
  });
});
