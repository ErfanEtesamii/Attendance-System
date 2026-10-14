// A1 (فاز ۱۲): پاسخ/بستن اعتراض از مسیر بات باید در thread کارمند (dispute_messages) هم بیاید،
// closed_by='admin' شود و last_message_at به‌روز شود؛ بستن بدون پاسخ پیامی اضافه نمی‌کند.
process.env.MINI_APP_URL = 'https://example.test/app/'; // دکمه‌ی web_app فقط روی https ساخته می‌شود
const { resetDb, cleanup } = require('./helpers/testEnv');
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('پاسخ اعتراض از بات (A1)', () => {
  let db; let F; let svc; let repo; let bot; let mod; let session; let admin; let mgr; let other; let emp;
  const sent = [];
  const answered = [];

  before(() => {
    db = resetDb();
    require('../src/bot/notifier').sendMessage = async (to, text, opts) => { sent.push({ to: String(to), text, opts }); return true; }; // قبل از require اعلان‌ها
    F = require('./helpers/factories');
    svc = require('../src/services/disputeService');
    repo = require('../src/repositories/disputeRepository');
    session = require('../src/bot/session');
    mod = require('../src/bot/commands/pendingDisputes');
    admin = F.makeUser({ role: 'admin' });
    mgr = F.makeUser({ role: 'manager' });
    other = F.makeUser({ role: 'manager' });
    emp = F.makeUser({ managerId: mgr.id });
    bot = {
      sendMessage: async (to, text, opts) => { sent.push({ to: String(to), text, opts }); return {}; },
      answerCallbackQuery: async (id, o) => { answered.push({ id, o }); },
      editMessageReplyMarkup: async () => ({}),
    };
  });
  after(cleanup);
  beforeEach(() => {
    for (const t of ['dispute_messages', 'record_disputes', 'notifications']) db.prepare(`DELETE FROM ${t}`).run();
    sent.length = 0; answered.length = 0; session.clearAll();
  });

  const open = () => svc.create(emp, { message: 'ساعت خروج اشتباه است' }).dispute;
  const cb = (actor, data) => ({ id: 'q1', from: { id: Number(actor.telegram_user_id) }, data, message: { chat: { id: Number(actor.telegram_user_id) }, message_id: 7 } });
  const textMsg = (actor, text) => ({ chat: { id: Number(actor.telegram_user_id) }, from: { id: Number(actor.telegram_user_id) }, text });
  const replyViaBot = async (actor, d, text) => {
    await mod.handleDisputeCallback(bot, cb(actor, `dispute_reply:${d.id}`));
    await mod.handleDisputeReplyText(bot, textMsg(actor, text), session.get(Number(actor.telegram_user_id)));
  };

  test('پاسخ و بستن از بات ⇒ پیام ادمین در thread کارمند + closed_by=admin', async () => {
    const d = open();
    await replyViaBot(mgr, d, 'اصلاح شد');
    const t = svc.getMine(emp, d.id);
    assert.equal(t.ok, true);
    const last = t.messages[t.messages.length - 1];
    assert.equal(last.message, 'اصلاح شد');
    assert.equal(last.sender_role, 'admin');
    assert.equal(last.is_mine, false);
    assert.equal(t.dispute.status, 'resolved');
    assert.equal(t.dispute.closed_by, 'admin');
    assert.equal(t.dispute.last_sender_role, 'admin');
    assert.equal(t.dispute.message_count, 2);
    assert.ok(db.prepare('SELECT last_message_at FROM record_disputes WHERE id = ?').get(d.id).last_message_at);
  });

  test('بستن بدون پاسخ (دکمه) ⇒ پیامی اضافه نمی‌شود ولی closed_by=admin', async () => {
    const d = open();
    await mod.handleDisputeCallback(bot, cb(admin, `dispute_close:${d.id}`));
    const t = svc.getMine(emp, d.id);
    assert.equal(t.dispute.status, 'resolved');
    assert.equal(t.dispute.closed_by, 'admin');
    assert.equal(t.messages.length, 1);
  });

  test('بستن بدون پاسخ با متن «-» ⇒ بدون پیام', async () => {
    const d = open();
    await replyViaBot(admin, d, '-');
    const t = svc.getMine(emp, d.id);
    assert.equal(t.dispute.closed_by, 'admin');
    assert.equal(t.messages.length, 1);
  });

  test('اسکوپ: سرپرستِ غیرمرتبط نه می‌بندد نه پیام می‌گذارد', async () => {
    const d = open();
    await mod.handleDisputeCallback(bot, cb(other, `dispute_close:${d.id}`));
    assert.equal(repo.findById(d.id).status, 'open');
    assert.equal(svc.getMine(emp, d.id).messages.length, 1);
  });

  test('اعتراضِ از قبل بسته‌شده ⇒ بدون پیام اضافه', async () => {
    const d = open();
    svc.resolveAsAdmin(admin, d.id, {});
    await mod.handleDisputeCallback(bot, cb(admin, `dispute_close:${d.id}`));
    assert.equal(svc.getMine(emp, d.id).messages.length, 1);
  });

  test('اعلان کارمند: پنل با شناسه‌ی اعتراض + تلگرام با دکمه‌ی مستقیم به همان گفت‌وگو', async () => {
    const d = open();
    await replyViaBot(mgr, d, 'بررسی شد');
    const n = db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'dispute_resolved'").get(emp.id);
    assert.ok(n);
    assert.equal(JSON.parse(n.data).disputeId, d.id);
    const tg = sent.find((m) => m.to === String(emp.telegram_user_id));
    assert.ok(tg && /بررسی شد/.test(tg.text));
    assert.match(tg.text, /پاسخ سرپرست: بررسی شد/);
    const btn = tg.opts.reply_markup.inline_keyboard[0][0];
    const url = new URL(btn.web_app.url);
    assert.equal(url.searchParams.get('view'), 'dispute');
    assert.equal(url.searchParams.get('id'), String(d.id));
  });

  test('پیام تازه‌ی ادمین (API/پنل) هم با دکمه‌ی لینک مستقیم به تلگرام کارمند می‌رود', async () => {
    const d = open();
    const r = svc.replyAsAdmin(mgr, d.id, { message: 'در حال بررسی' });
    await require('../src/services/notificationEvents').disputeAdminMessage(d, r.message, { actor: mgr });
    const tg = sent.find((m) => m.to === String(emp.telegram_user_id));
    assert.ok(tg);
    assert.equal(new URL(tg.opts.reply_markup.inline_keyboard[0][0].web_app.url).searchParams.get('id'), String(d.id));
  });
});
