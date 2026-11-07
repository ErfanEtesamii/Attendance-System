// BaleBot: تبدیل مرکزی web_app به لینک یک‌بارمصرف + sendChatAction (بدون DB/شبکه؛ repository و fetch جعلی).
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

describe('BaleBot.normalizeMarkup / sendChatAction', () => {
  let BaleBot, bot, calls, realFetch;
  before(() => {
    const repoPath = require.resolve('../src/repositories/usersRepository');
    require.cache[repoPath] = {
      id: repoPath, filename: repoPath, loaded: true, children: [], paths: [],
      exports: { findByTelegramId: (id) => (id === '111' ? { id: 7, is_active: 1 } : null) },
    };
    BaleBot = require('../src/bot/baleBot');
    bot = new BaleBot('tok');
    calls = [];
    realFetch = global.fetch;
    global.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ ok: true, result: {} }) }; };
  });
  after(() => { global.fetch = realFetch; delete require.cache[require.resolve('../src/repositories/usersRepository')]; });

  const kb = (...btns) => ({ inline_keyboard: [btns] });

  test('web_app مینی‌اپ ⇒ url با bale_token و حفظ view/id', () => {
    const m = bot.normalizeMarkup(kb({ text: 'a', web_app: { url: 'https://h.example/?view=dispute&id=5' } }), 111);
    const b = m.inline_keyboard[0][0];
    assert.equal(b.web_app, undefined);
    const u = new URL(b.url);
    assert.equal(u.searchParams.get('view'), 'dispute');
    assert.equal(u.searchParams.get('id'), '5');
    assert.match(u.searchParams.get('bale_token'), /^[A-Za-z0-9_-]{20,64}$/);
  });
  test('web_app پنل (/admin/) ⇒ url با t و حفظ go', () => {
    const b = bot.normalizeMarkup(kb({ text: 'p', web_app: { url: 'https://h.example/admin/?go=nightly' } }), 111).inline_keyboard[0][0];
    const u = new URL(b.url);
    assert.equal(u.pathname, '/admin/');
    assert.equal(u.searchParams.get('go'), 'nightly');
    assert.ok(u.searchParams.get('t'));
    assert.equal(u.searchParams.get('bale_token'), null);
  });
  test('کاربر ناشناس / گروه / http ⇒ دکمه حذف؛ دکمه‌های callback می‌مانند و style حذف می‌شود', () => {
    const cb = { text: 'ok', callback_data: 'x', style: 'primary' };
    const wa = { text: 'w', web_app: { url: 'https://h.example/' } };
    assert.deepEqual(bot.normalizeMarkup(kb(cb, wa), 999).inline_keyboard, [[{ text: 'ok', callback_data: 'x' }]]);
    assert.deepEqual(bot.normalizeMarkup(kb(wa), -100).inline_keyboard, []);
    assert.deepEqual(bot.normalizeMarkup(kb({ text: 'w', web_app: { url: 'http://h.example/' } }), 111).inline_keyboard, []);
  });
  test('sendMessage chat_id را به normalizeMarkup می‌دهد', async () => {
    calls.length = 0;
    await bot.sendMessage(111, 'hi', { reply_markup: kb({ text: 'a', web_app: { url: 'https://h.example/' } }) });
    const sent = JSON.parse(calls[0].body.reply_markup);
    assert.ok(sent.inline_keyboard[0][0].url.includes('bale_token='));
  });
  test('sendChatAction: فراخوانی درست و بلعیدن خطا', async () => {
    calls.length = 0;
    await bot.sendChatAction(111, 'typing');
    assert.match(calls[0].url, /sendChatAction$/);
    assert.equal(calls[0].body.action, 'typing');
    global.fetch = async () => { throw new Error('net'); };
    assert.equal(await bot.sendChatAction(111), true);
  });
});
